# Fresh-client first-sync: data-loss trap + decrypt-race

**Date:** 2026-06-03
**Status:** Implemented A1 + B + D (with tests). Fix C residual accepted + documented — see §10.
A1's never-synced guard was hardened on the piggyback path (capture-timing fix) — see §11.
**Area:** op-log sync (`src/app/op-log/sync`, `packages/sync-providers/src/super-sync`)

## 0. Implementation status (2026-06-03)

| Fix    | What shipped                                                                                                                                                                                                                                                                                                                                                                                                                                              | Tests                                                                  |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **A1** | `SyncImportConflictGateService` flags `isNeverSynced` (`!hasSyncedOps()`) on the incoming-import dialog data; the dialog requires an explicit native `confirm()` before the destructive `USE_LOCAL` on a never-synced client, and the safe `USE_REMOTE` button gets `cdkFocusInitial` so the keyboard default never overwrites the server. New i18n keys `FIRST_SYNC_WARNING` / `FIRST_SYNC_USE_LOCAL_CONFIRM`.                                           | gate spec (+3), dialog component spec (new, 6), sync-service spec (+2) |
| **B**  | `OperationLogDownloadService` logs the "encrypted ops, no key" condition at `normal` only for never-synced clients whose local config has **no** encryption flag (expected onboarding prompt) and keeps `error` for already-synced clients **and** for clients whose local config still flags encryption on (dropped-credential signature — survives a wiped op store via the provider's `isEncryptionEnabled()`). Still throws `DecryptNoPasswordError`. | download spec (+3)                                                     |
| **D**  | `SuperSync.isReady()` returns `false` when `isEncryptionEnabled && !encryptKey` (self-inconsistent encrypted config), keeping the client out of auto-sync/destructive recovery until the key is re-entered.                                                                                                                                                                                                                                               | super-sync vitest (+5)                                                 |
| **C**  | **Not shipped.** The blanket "block upload for `!hasSyncedOps()`" regresses first-device empty-server seeding; the encrypted-upload hazard it targeted is covered by **D** + download-before-upload ordering. The remaining example-task _pollution_ has no safe status-based guard (verified — see §10) and its only correct fix is an identity-based onboarding cleanup feature. **Residual accepted + documented.**                                    |                                                                        |

## 1. TL;DR

When a **fresh client** (new install / new device) connects to an **existing, populated,
encrypted** SuperSync dataset for the first time, two things happen that look unrelated in
the logs but share **one root cause**:

1. A **`SYNC_IMPORT` conflict dialog** ("USE LOCAL / USE REMOTE") appears. Choosing
   **USE LOCAL** force-uploads the client's throwaway startup state as a new `SYNC_IMPORT`,
   **overwriting the entire real remote dataset** → silent data loss, one wrong click away.
2. A red **`DecryptNoPasswordError`** is logged during the first sync (mostly working as
   designed — it triggers the password prompt — but noisy, and it rides the same
   half-configured window the codebase already flags as hazardous).

Severity is **higher than first thought**: the trigger is not user-specific data. Every
fresh install seeds **4 example tasks** (`ExampleTasksService`), so **every new device that
later connects to a populated remote** reproduces this.

## 2. Reproduction

1. Install fresh client (latest release). On first boot, with no sync configured,
   `ExampleTasksService` creates 4 example tasks (`CREATE_PROJECT`, `SET_UP_SYNC`,
   `LEARN_KEYBOARD_SHORTCUTS`, `GO_FURTHER`) + default config writes. → **6 op-log ops captured.**
2. Configure SuperSync + encryption (existing account with a large dataset).
3. First real sync: download finds an encrypted `SYNC_IMPORT` → `DecryptNoPasswordError` →
   password prompt → key entered → retry.
4. Retry downloads the `SYNC_IMPORT`; the 6 local ops trip the conflict gate → **conflict
   dialog**. USE LOCAL would wipe remote; USE REMOTE adopts remote (correct).

## 3. Root cause (shared)

A genuinely-fresh client performs **local work before its first sync completes**:
`ExampleTasksService` (`src/app/core/example-tasks/example-tasks.service.ts:74-81`) +
default `[Global Config] Update` ops. Because these land in the op-log:

- `getLastSeq()` (`operation-log-store.service.ts:995`) > 0, so
  `isWhollyFreshClient()` (`sync-local-state.service.ts:18` = `!snapshot && lastSeq === 0`)
  returns **false** → the gentle fresh-client confirm path
  (`operation-log-sync.service.ts:598`) is skipped.
- `hasMeaningfulPendingOps()` (`sync-import-conflict-gate.service.ts:41`) sees 4 TASK
  `Create` ops → **"meaningful user work"** → `dialogData` populated → conflict dialog
  (`operation-log-sync.service.ts:663`).
- `hasMeaningfulStateData()` (`has-meaningful-state-data.util.ts`) is also true
  (`task.ids.length > 0`), so even the skipped path would have thrown a conflict.

This is **not fixable by timing** ("don't seed examples until after sync"): the user enables
sync _after_ boot, so the example tasks already exist. The fix must live at the
**conflict-detection layer**.

## 4. The three problems

### P1 — Conflict dialog is a data-loss trap (headline)

`operation-log-sync.service.ts:655-687`. For a never-synced client, USE LOCAL →
`forceUploadLocalState` → `SYNC_IMPORT` over remote (`sync-import-conflict-coordinator.service.ts:51`,
`skipServerEmptyCheck`). A client that has **never contributed to remote** has nothing of its
own up there to protect; offering a symmetric, default-less choice that can wipe the real
dataset is the bug.

### P2 — Decrypt-race noise + half-configured window

`SuperSync.isReady()` (`super-sync.ts:148`) = `!!(cfg && cfg.accessToken)` — ready on
access-token alone. The config lands in **two writes** (access token first; then
`encryptKey`+`isEncryptionEnabled` via `updateEncryptionPassword`,
`sync-config.service.ts:289`). Between them, `isEnabledAndReady$`
(`sync-wrapper.service.ts:160`) is true, so `triggerSync$` (`sync.effects.ts:170,151`) fires.
Download hits encrypted ops, `getEncryptKey()` (`super-sync.ts:451`) returns `undefined`,
and `operation-log-download.service.ts:255` throws `DecryptNoPasswordError` — logged at
`error` (`:252`). The throw is **intentional** (triggers the password dialog,
`:251`), but it is logged identically to the dangerous case the credential store already
documents: `(encryptKey=[empty], isEncryptionEnabled=true)` is the "smoking-gun signature
for a silent credential drop" (`credential-store.service.ts:112-129`).

### P3 — Latent unencrypted-upload hazard

Upload encrypts iff a key exists: `isPayloadEncrypted = !!encryptKey`
(`operation-log-upload.service.ts:437`). During the P2 window `getEncryptKey()` is
`undefined`, so an upload would push local ops **unencrypted into an encrypted dataset**.
The only guard today is the fresh-client upload block
(`operation-log-sync.service.ts:165-175`), which keys off `isWhollyFreshClient()` — already
**disabled** here by the 6 example-task ops. The sole thing that saved us is that download
runs before upload and threw first. Not realized in the captured log, but latent.

## 5. Unifying discriminator: `hasSyncedOps()`

All three problems share one concept: **"has this client ever completed a sync?"**
`OperationLogStoreService.hasSyncedOps()` (`operation-log-store.service.ts:1023`, already
excludes MIGRATION/RECOVERY) answers it. A `hasSyncedOps() === false` client cannot have
_diverged_ from remote — its local ops are pre-first-sync startup state.

## 6. Fix plan (by risk)

### Fix A — P1: never-synced clients can't accidentally overwrite a populated remote

- **Where:** `operation-log-sync.service.ts` incoming-`SYNC_IMPORT` gate (≈648-687); reuse in
  the piggyback path (≈209-214).
- **Minimal (recommended default):** when `await hasSyncedOps() === false` and the incoming
  full-state op is from a **remote** client, still show the dialog **but** default to
  USE_REMOTE and add an explicit "USE LOCAL overwrites the server's data" warning. No
  heuristics, no new state. Removes the coin-flip trap; keeps the escape hatch for the rare
  standalone-real-data user.
- **Enhanced (needs §7 decision):** when local state is **example-tasks-only**, skip the
  dialog and adopt remote silently. Requires identifying example-only state (record example
  task IDs at creation, or a dedicated flag) — see §7.
- **Verify:** new spec in `operation-log-sync.service.spec.ts` (or the conflict gate spec):
  never-synced + remote `SYNC_IMPORT` + example tasks → no destructive USE_LOCAL default;
  synced client → unchanged behavior. Manual: two-device flow reproduces no-trap.

### Fix B — P2: scope the decrypt error + log severity to the real failure

- **Where:** `operation-log-download.service.ts:249-258`.
- **Change:** keep throwing `DecryptNoPasswordError` (still drives the password dialog), but
  log at `error` only when `hasSyncedOps() === true` (established client that suddenly can't
  decrypt = the dangerous dropped-credential signature). For `hasSyncedOps() === false`
  (expected onboarding prompt), log at normal/info "encryption password required". Requires
  passing/injecting the synced flag into the download service.
- **Verify:** spec asserts severity branch on the synced flag. Manual: fresh encrypted-sync
  device shows info, not a red stack.

### Fix C — P3: widen the unencrypted-upload guard

- **Where:** `operation-log-sync.service.ts:165-175`.
- **Change:** block regular uploads when `hasSyncedOps() === false` (not only
  `isWhollyFreshClient()`). Prevents a never-synced client (example-task ops present) from
  uploading unencrypted into an encrypted dataset.
- **⚠ Interaction risk:** the **first-device-seeds-empty-server** path. Today a client with
  example tasks on an _empty_ server is `isWhollyFreshClient()===false` → not blocked →
  uploads (seeds). Widening the block to `!hasSyncedOps()` would block that. Must confirm
  seeding still fires via `serverMigrationService.handleServerMigration`
  (download path `operation-log-sync.service.ts:562-576`) for never-synced clients on empty
  servers — and likely loosen that branch from `isWhollyFreshClient` to `!hasSyncedOps` in
  tandem. **Do not ship Fix C without a spec covering empty-server seeding.**
- **Verify:** specs for (1) never-synced + populated encrypted server → upload blocked;
  (2) never-synced + empty server → still seeds via migration.

### Fix D — P2 robust: close the half-configured readiness window (optional, moderate risk)

- **Where:** `provider-manager.service.ts` (`_encryptAndCompressCfg` holds global-config
  `isEncryptionEnabled`, line ~138) or the `isEnabledAndReady$` derivation.
- **Change:** treat the provider as **not ready** while local global-config
  `isEncryptionEnabled === true` AND the provider `encryptKey` is empty — so auto-sync does
  not fire into the setup gap; it resumes when the key lands (config-change already
  recomputes readiness).
- **Deadlock check:** safe because the cross-device "discover encryption" flow has local
  `isEncryptionEnabled === false` (this device hasn't learned encryption yet) → not blocked →
  still uses the download-error → password-prompt path. Only the local
  setup-writes-flag-before-key gap is closed.
- **Verify:** spec — readiness false while `(isEncryptionEnabled && !encryptKey)`, true once
  key present; cross-device discovery flow unaffected.

## 7. Decision required

**Fix A scope** — for a never-synced client meeting a populated remote `SYNC_IMPORT`:

- **Option 1 (minimal, recommended):** keep the dialog, default USE_REMOTE + destructive
  warning on USE_LOCAL. Safe, tiny, no new state. The rare standalone-real-data user can
  still deliberately choose USE_LOCAL.
- **Option 2 (enhanced):** also auto-adopt remote with **no dialog** when local is
  example-tasks-only (zero-friction onboarding). Needs example-task-id tracking +
  "example-only" detection. More code, slightly more surface, but the smoothest UX.

Recommendation: ship **Fix A Option 1 + Fix B** first (smallest safe surface that kills the
trap and the noise), then evaluate **Fix C/D** with their seed/readiness specs, and consider
**Option 2** as a follow-up if zero-friction onboarding is wanted.

## 8. Out of scope / non-goals

- No timing-based suppression of example-task creation (root cause is conflict-detection).
- No change to the by-design SYNC_IMPORT "drop CONCURRENT ops" semantics (CLAUDE.md rule 7).
- The dangling-ref replay warnings (`Filtered non-existent taskIds`, `Skipping LWW Update …
archived/deleted`) are working-as-designed guards — not addressed here.

## 9. Test/verification checklist

- [ ] `npm run test:file src/app/op-log/sync/operation-log-sync.service.spec.ts`
- [ ] conflict-gate / download-service specs for the new branches
- [ ] `npm run checkFile` on every touched `.ts`
- [ ] Manual two-device repro: new device + populated encrypted remote → no data-loss trap,
      no red decrypt error, data adopted from remote.

## 10. Why Fix C was changed during implementation

The plan's Fix C — widen the upload block from `isWhollyFreshClient()` to `!hasSyncedOps()` —
was found to **contradict an existing, deliberate design**: `ServerMigrationService`
(`server-migration.service.ts:102-112`) treats a never-synced client on an _empty_ server
as a normal-upload seeding case (NOT a SYNC_IMPORT migration). Blanket-blocking uploads for
`!hasSyncedOps()` would strand a first device with real data on an empty server. So the
blanket change would regress first-device seeding.

The hazard Fix C targeted (pushing **unencrypted** ops into an **encrypted** dataset during
the credential-setup window) is instead covered without that regression:

- **Fix D** makes the provider _not ready_ while `isEncryptionEnabled && !encryptKey`, so
  auto-sync (and therefore upload) does not fire in the self-inconsistent encrypted state.
- The existing **download-before-upload** ordering (`operation-log-sync.service.ts:52-63`)
  aborts the sync on `DecryptNoPasswordError` before any upload runs when the remote is
  encrypted and no key is present.

### Known residual (accepted, not fixed) — example-task pollution

A never-synced client can still upload its 4 example-task ops onto a populated remote it just
adopted. This is **real and not rare**: a _non-encrypted_ SuperSync account has no
`SYNC_IMPORT` (the first device seeds it via normal upload — `server-migration.service.ts:102-112`),
so the A1 / USE_REMOTE path never fires. A 2nd device downloads the account, then uploads its
`ExampleTasksService` tasks, which then propagate to all devices. Annoying, but **not data
loss** (normal conflict resolution merges them).

**Why no status-based guard fixes this (verified 2026-06-03):**

- `!hasSyncedOps()` at upload time is **ineffective**: downloaded remote ops are persisted
  with `syncedAt` set (`operation-log-store.service.ts:379,419,496`), so `hasSyncedOps()`
  flips `true` during the _download_ phase — before the upload runs.
- A "has this client ever _uploaded_" signal **deadlocks**: the first legitimate upload is
  also `local`+unsynced, so the client could never start contributing.
- Auto-discarding pre-existing local ops on adoption **risks real data loss** for a standalone
  user who built real tasks offline before connecting — strictly worse than the pollution.

**The only safe fix is identity-based**: track the example-task IDs at creation and remove
those _untouched_ tasks when a never-synced client first syncs to a populated remote (so an
_edited_ example task still syncs as real data). That is a genuine onboarding+sync feature
(ID tracking + adoption hook + untouched-detection + local cleanup), not a surgical guard.

**Decision (2026-06-03):** accept the residual for now. A1+B+D already remove the data-loss
trap and the noisy error; the example-task pollution is minor and bounded. Identity-based
cleanup is left as a scoped follow-up if/when it's worth the onboarding-code surface.

## 11. Follow-up: never-synced guard must be captured pre-sync (piggyback path)

Fix A routes `isNeverSynced` through the shared `SyncImportConflictGateService` so both the
download and piggyback-upload paths guard the destructive `USE_LOCAL`. A review (2026-06-03)
found the piggyback path computed `isNeverSynced` from a **live** `hasSyncedOps()` read taken
_after_ the upload had already run. Two writes in the same sync flip that flag to `true`
mid-cycle:

- the preceding **download** persists adopted remote ops with `syncedAt`
  (`operation-log-store.service.ts` `markSynced`/append), and
- the **upload** marks accepted local ops synced before the gate runs
  (`operation-log-upload.service.ts:260`).

So a genuinely never-synced client could reach the piggyback conflict dialog with the guard
already disarmed (`isNeverSynced=false`), re-opening the exact `USE_LOCAL`-overwrites-remote
trap A1 was meant to close. The download path was unaffected (its gate runs before
`processRemoteOps` persists anything).

**Fix:** capture the never-synced snapshot **once at sync-cycle start, before download**
(`SyncWrapperService.sync` → `OperationLogSyncService.hasSyncedOps()`) and thread it into both
`downloadRemoteOps()` and `uploadPendingOps()`, which forward it to the gate as
`checkIncomingFullStateConflict(ops, { isNeverSynced })`. The gate prefers the passed value and
falls back to a live read only for standalone callers (immediate-upload, password-change,
ws-triggered download) where no preceding download has run.

**Tests:** gate honors a caller-provided `isNeverSynced` without consulting live history;
the piggyback path flags `isNeverSynced: true` even when the upload marks ops synced
(`operation-log-sync.service.spec.ts`); the wrapper threads the pre-download snapshot into
both calls.
