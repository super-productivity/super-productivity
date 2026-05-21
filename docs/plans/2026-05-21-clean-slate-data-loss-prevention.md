# Clean-Slate Upload Data-Loss Prevention

**Date:** 2026-05-21
**Status:** Design — revised after multi-review (6 parallel reviewers: Correctness, Security, Architecture, Alternatives, Performance, Simplicity). Convergent findings folded in. Codex skipped (stdin hang in this environment).
**Scope:** Sync upload path; SuperSync + file-based providers. Client-side only.
**Tracking issue:** [#7709](https://github.com/super-productivity/super-productivity/issues/7709)

## Context

Issue #7709 describes a multi-device data-loss chain: a single device uploads a partial / stale local state to the server as a full-state op (SYNC_IMPORT, BACKUP_IMPORT, or REPAIR — all are treated as clean-slate by `operation-log-upload.service.ts:129-130`), the server deletes its op-log history, and every other device that auto-syncs inherits the partial snapshot. The reported user lost ~2 weeks of work across three laptops this way.

Five user-reachable triggers produce destructive uploads today (the multi-review added the fifth):

1. Encryption password change / first-encryption-enable → `CleanSlateService.createCleanSlate()` → upload with `isCleanSlate: true`
2. "Keep local" in the sync conflict dialog → `SyncImportConflictCoordinatorService.forceUploadLocalState()` (passes `skipServerEmptyCheck: true`)
3. "Force upload" snack-bar action from various error dialogs (LockPresentError, EmptyRemoteBodySPError, JsonParseError, LegacySyncFormatDetectedError, DialogSyncError, DecryptError)
4. Server-migration into an empty server (auto-triggered, no user confirm; **only appends a SYNC_IMPORT op, no local destruction** — destructive only on the server side via the `isCleanSlate=true` flag)
5. **`BackupService.importComplete` (backup-file restore)** — runs the same non-atomic `clearAllOperations → append → setVectorClock → saveStateCache` sequence as `createCleanSlate` (`backup.service.ts:194/221/225/227`). Fifth destructive trigger; the original plan missed it.

## The two load-bearing problems

This plan addresses two independent root causes. Either one alone is sufficient to cause the reported bug.

### Problem A — Non-atomic destructive sequence (THE reported precondition)

Both `clean-slate.service.ts:149-168` and `backup.service.ts:194-227` run in order:

```
1. clearAllOperations()         ← OPS table emptied
2. append(syncImportOp)         ← lastSeq goes back to 1
3. setVectorClock(...)
4. saveStateCache(...)          ← state_cache populated
```

If the process is interrupted between step 1 and step 4 (crash, tab close, browser kill, even a thrown exception in `append`/`setVectorClock`), the device is left with `OPS` empty AND `state_cache` either stale or never written. On a low-activity device (under `COMPACTION_THRESHOLD = 500` ops) `state_cache` was never written in the first place. Result: `isWhollyFreshClient()===true` on next launch, which routes through the `LocalDataConflictError(0, {})` throw at `operation-log-sync.service.ts:606`.

This is the exact precondition chain the issue describes.

### Problem B — No completeness check before clean-slate

Destructive uploads use the *current* in-memory NgRx state as authoritative. If NgRx is partial (hydration incomplete, post-`clearAllOperations()` window, post-rollback empty state), the partial state is what gets sent. Nothing compares "what's about to be uploaded" against "what was here a minute ago."

**Per multi-review:** Problem B is not in the reported incident (Problem A explains it cleanly). Problem B is hypothetical — defending against unobserved failure modes. The original plan made Problem B the headline fix; this revision demotes it to a follow-up gated on forensic evidence from production logs.

## Goals

1. **Primary:** Close Problem A — destructive sequences either complete fully or leave the device in its prior state.
2. **Primary:** Fix the `{}` empty remote snapshot at `operation-log-sync.service.ts:606` so the conflict dialog has something to render.
3. **Primary:** Log forensic data on every clean-slate upload so the next incident (and any unobserved Problem B occurrences) can be diagnosed.
4. **Conditional (gated on evidence from log data after PR-B):** Add completeness gating if and only if logs show partial-state uploads happening in the wild.

## Non-goals

- Server-side completeness gating (worth doing as a follow-up; out of scope for this client-side plan).
- Replacing the conflict dialog UX.
- Changing the `BACKUP_IMPORT` / `REPAIR` clean-slate-by-default semantics in `operation-log-upload.service.ts:129-130`.
- **Defense against a fully-compromised client process.** The threat model assumes the local Angular runtime is trusted; this plan addresses bugs (partial hydration, interrupted destructive flows), not adversaries with IDB write access or XSS-level capabilities.
- Feature-flagging the rollout. The codebase has no flag framework (verified) and the changes either are safe to ship unconditionally (atomicity, logging, throw-fix) or rare enough that a flag adds more risk than it removes (preflight, modal).

## Design

### Fix 2 (LOAD-BEARING) — Atomic destructive sequence

**Where:** A new helper on `OperationLogStoreService`:

```ts
async runDestructiveStateReplacement(opts: {
  syncImportOp: Operation;
  newVectorClock: VectorClock;
  newState: unknown;
  lastAppliedOpSeq: number;
  schemaVersion: number;
}): Promise<void>
```

Two callers refactor to use it: `CleanSlateService.createCleanSlate()` (lines 149-168) and `BackupService.importComplete()` (lines 194-227). Both currently run the four-step sequence as independent IDB transactions.

**Implementation: snapshot-then-swap, not multi-store transaction** (per Alternatives alt #2 + Performance W1):

```ts
async runDestructiveStateReplacement(opts) {
  // Step 1: Stage the new snapshot to STATE_CACHE under STAGING_KEY (single-store write,
  // single record, can carry a multi-MB payload without tx-lifetime concerns)
  await this.db.put(STORE_NAMES.STATE_CACHE, {
    id: STATE_CACHE_STAGING_KEY,
    state: opts.newState,
    lastAppliedOpSeq: opts.lastAppliedOpSeq,
    vectorClock: opts.newVectorClock,
    compactedAt: Date.now(),
    schemaVersion: opts.schemaVersion,
  });

  // Step 2: Verify the stage write (round-trip read)
  const staged = await this.db.get(STORE_NAMES.STATE_CACHE, STATE_CACHE_STAGING_KEY);
  if (!staged || staged.state === undefined) {
    throw new Error('Clean-slate stage write failed verification');
  }

  // Step 3: Destructive transaction — small writes only, all stores
  const tx = this.db.transaction(
    [STORE_NAMES.OPS, STORE_NAMES.STATE_CACHE, STORE_NAMES.VECTOR_CLOCK],
    'readwrite',
  );
  await tx.objectStore(STORE_NAMES.OPS).clear();
  await tx.objectStore(STORE_NAMES.OPS).put(/* the SyncImportEntry built from syncImportOp */);
  await tx.objectStore(STORE_NAMES.VECTOR_CLOCK).put({ clock: opts.newVectorClock, lastUpdate: Date.now() }, SINGLETON_KEY);
  await tx.objectStore(STORE_NAMES.STATE_CACHE).put({ ...staged, id: SINGLETON_KEY });
  await tx.objectStore(STORE_NAMES.STATE_CACHE).delete(STATE_CACHE_STAGING_KEY);
  await tx.done;

  // Step 4: Cache invalidation
  this._appliedOpIdsCache = null;
  this._cacheLastSeq = 0;
  this._invalidateUnsyncedCache();
  this._vectorClockCache = opts.newVectorClock;
}
```

**Boot-time reconciliation:** On `_ensureInit`, if `STATE_CACHE_STAGING_KEY` exists, delete it. A staging row that survived means the destructive tx never committed; the device's prior state is intact and the staging row is dead weight.

**Why snapshot-then-swap over a single 3-store tx with the full state inside it:**
- The large `state` payload (hundreds of KB to MB for users with archives) lives in a single-store write *outside* the destructive tx. The destructive tx contains only small writes (`clear`, three small `put`s, one `delete`).
- WebKit on Capacitor iOS has no precedent in this codebase for multi-store readwrite transactions carrying multi-MB payloads (every existing `db.transaction(...)` call in `operation-log-store.service.ts` is single-store). The snapshot-then-swap pattern keeps the cross-store tx small enough to avoid testing the limits.
- Performance W1's recommendation to "smoke test multi-store tx on each runtime" still applies, but the surface area to test is much smaller.

**On `pre-migration-backup.service.ts`:** This service is currently a placeholder (`PreMigrationBackupService.createPreMigrationBackup` is a no-op that logs `'[PreMigrationBackup] PLACEHOLDER'`). The original plan implied it was a working safety net. **Implement it in PR-A:** before `runDestructiveStateReplacement`, dump the current state + vector clock to a record in the existing `IMPORT_BACKUP` store (`STORE_NAMES.IMPORT_BACKUP`), keyed by `'pre-clean-slate'`. On failure or post-hoc user request, restore via the existing backup-restore flow. This gives a real recovery path independent of IDB atomicity.

### Fix 3 (LOAD-BEARING) — Empty-snapshot throw at `operation-log-sync.service.ts:606`

**Critical correction from multi-review:** Line 606 is in the op-streaming branch (`result.newOps.length > 0`). It is reached *after* the three `if (result.providerMode === 'fileSnapshotOps' && result.snapshotState)` early-returns at lines 458/484/517. `result.snapshotState` is **undefined** at line 606. The original plan's "thread `result.snapshotState`" instruction was wrong for this site.

**Two-part fix:**

(a) **Earlier throws** (lines 458, 484) already construct `LocalDataConflictError(unsyncedCount, result.snapshotState, result.snapshotVectorClock)` — verify these and add the `vectorClock` argument to line 484 if missing.

(b) **Line 606 throw** has no snapshot. Compute a synthetic payload from `result.newOps`:

```ts
const remoteOpCount = result.newOps.length;
throw new LocalDataConflictError(
  0,
  { __synthetic: true, opCount: remoteOpCount },
  result.snapshotVectorClock,  // may be undefined; OK
);
```

(c) **Narrow `LocalDataConflictError.remoteSnapshotState` type to a discriminated union** so the dialog can render "Remote: N operations" for the synthetic case and a real entity-count summary for the snapshot case:

```ts
type RemoteDataDescriptor =
  | { kind: 'snapshot'; counts: { tasks: number; projects: number; tags: number; notes: number; trackedHours: number } }
  | { kind: 'opCount'; opCount: number };
```

This requires changes to:
- `LocalDataConflictError` constructor (`sync-errors.ts:95-105`) — replace `remoteSnapshotState: Record<string, unknown>` with `remoteData: RemoteDataDescriptor`.
- The two real-snapshot throw sites (lines 458/484) — compute counts from `result.snapshotState` before throwing.
- `_handleLocalDataConflict` (`sync-wrapper.service.ts:1161-1262`) — pass `remoteData` into `conflictData.remote` instead of `mainModelData`.
- `dialog-sync-conflict.component.html` — branch on `descriptor.kind`.

**Security note:** the narrowed type eliminates the future-XSS risk Security C1 raised — decrypted remote task titles can no longer leak into the dialog via arbitrary `mainModelData` payloads.

### Fix 4 (LOAD-BEARING) — Forensic logging

**Where:** `OpLog.warn` at every clean-slate upload entry point and at every `LocalDataConflictError` throw.

**Payload (counts-only; no entity content per CLAUDE.md sync rule 9):**

```ts
{
  cleanSlateReason: 'PASSWORD_CHANGED' | 'USE_LOCAL' | 'FORCE_UPLOAD' | 'SERVER_MIGRATION' | 'FIRST_ENCRYPTION' | 'BACKUP_RESTORE' | 'REPAIR',
  triggerSource: string,  // for FORCE_UPLOAD: which error class triggered it
  inMemoryCounts: { tasks, projects, tags, notes, trackedHours },
  stateCacheCounts: { tasks, projects, tags, notes, trackedHours } | null,
  vectorClockSize: number,  // size only, never the contents (Security C2)
  lastSeq: number,
  hasPriorStateCache: boolean,
}
```

**Constraints:**
- Never log vector-clock contents (per-device client IDs are sensitive). Size only.
- Never log entity IDs, titles, or any per-entity data.
- Add the same log at the three `LocalDataConflictError` throw sites (458/484/606) with the remote counts where available.

**Why this is load-bearing:** PR-D (conditional preflight) is gated on the evidence this generates. Without these logs we have no basis to decide whether Problem B happens in the wild.

### Fix 5 (DEFENSE-IN-DEPTH) — Confirmation modal

**Single modal, no counts in copy** (per Simplicity W4 — counts make the dialog look load-bearing, invite litigation):

```
This will replace the data on the server.

Every other device that syncs after this will be overwritten by
what's currently on this device. This cannot be undone except by
restoring from a backup.

[Cancel]  [Yes, replace server]
```

Counts go to the forensic log (Fix 4), not the modal UI.

**Performance constraint (Performance S2):** the modal must NOT hold the sync lock while waiting for the user. Acquire the lock only *after* the user clicks "Yes, replace server." Pre-modal reads (preflight, if added in PR-D) are lock-free.

**Trigger sites:** all four user-initiated paths (password change, "Keep local", force-upload snackbars, backup restore). Skipped for first-encryption-enable on a *truly* fresh client (`lastSeq===0 && state_cache===null && server-side reports empty`), since this is the legitimate bootstrapping case.

### Fix 6 — Dead code cleanup

`incrementCompactionCounter()` (`operation-log-store.service.ts:1145-1173`) has no production callers (only test specs). Its `state: null` placeholder write at lines 1151-1163 motivates the defensive guard at `loadStateCache` line 1051.

**Delete both** the write path and the guard (per Correctness S1 — keeping the guard without the writer is confusion-bait for future readers). Update the spec files that reference `incrementCompactionCounter` to either delete those tests or test the deletion semantics (i.e., that the dead write path is gone).

### Fix 1 — DEFERRED to PR-D

The original plan made `CleanSlatePreflightService` the headline fix. Multi-review converged on cutting it from v1:

- **Simplicity C1, C2:** Heuristic gates without incident evidence are YAGNI. Ship Fixes 2/3/4/6 first and let the logs from Fix 4 tell us whether partial-state uploads actually happen in the wild.
- **Alternatives alt #4:** If a gate is needed later, prefer a *temporal* gate ("refuse clean-slate uploads unless the client successfully downloaded server state within the last 5 minutes") over a count-based threshold. Temporal eliminates the threshold-tuning problem (Q1), the no-reference problem (Q2), and the legitimate-deletion-bypass problem (Q4) in one move.

**If PR-D ships (only if Fix 4 logs show partial-state uploads):**

Three call sites (the multi-review corrected this — the plan's original three-callers-through-`createCleanSlate` claim was wrong; `createCleanSlate` has only one production caller at `encryption-password-change.service.ts:97`):

1. `encryption-password-change.service.ts` around line 97 (before `createCleanSlate`)
2. `sync-import-conflict-coordinator.service.ts` `forceUploadLocalState` around line 51
3. `sync-wrapper.service.ts` `forceUpload` around line 843

**Gate logic (temporal, not threshold):**

```ts
const lastSuccessfulDownloadAt = await syncProvider.getLastSuccessfulDownloadAt();
const fresh = lastSuccessfulDownloadAt && (Date.now() - lastSuccessfulDownloadAt < 5 * 60 * 1000);
if (!fresh) {
  // Refuse with: "Sync hasn't downloaded server state recently. Reload the app
  // to download, then try again. (If you really want to replace the server data,
  // use Export → Reset → Re-import.)"
  return REFUSE;
}
```

**Escape hatch (Alternatives alt #8):** the refusal dialog includes a "Save local data to file" button calling the existing JSON-export flow. The user always has a recovery path regardless of preflight outcome.

**TOCTOU mitigation** (Correctness W1): if the preflight ever needs to compare in-memory state to a reference, compute the snapshot once via `getStateSnapshotAsync()` and pass it through to the destructive call — don't re-read.

## Implementation phases

Reordered per multi-review convergence (Correctness S3, Architecture S1, Simplicity S1, Security S3):

| PR | Contents | Risk | Rollback |
| --- | --- | --- | --- |
| **PR-A** | Atomicity via `runDestructiveStateReplacement` + pre-migration backup implementation (Fix 2); empty-snapshot fix + `RemoteDataDescriptor` type (Fix 3); dead-code cleanup (Fix 6) | Medium — touches IDB write patterns and the conflict dialog dialog data shape | Single revert |
| **PR-B** | Forensic logging (Fix 4) | Very low — pure observability | Trivial |
| **PR-C** | Confirmation modal (Fix 5) | Low — UI-only, doesn't refuse uploads | Trivial |
| **PR-D** | *Conditional.* Temporal preflight gate (Fix 1 — temporal, not count-based) + export-to-file escape hatch | Medium — refuses uploads | Trivial via call-site removal |

PR-A is the actual bug-closing PR — it eliminates Problem A and fixes the empty-snapshot rendering. PR-B builds the evidence base for PR-D. PR-C is a defense-in-depth layer. PR-D ships only if Fix 4 logs show partial-state uploads happening.

## Testing

### Unit tests

- **`runDestructiveStateReplacement` fault injection:** simulate failure at each step (stage write, verify read, each line of the destructive tx). Verify post-condition is "OPS unchanged, STATE_CACHE singleton unchanged, VECTOR_CLOCK unchanged" — even with a staging row left over.
- **Boot-time staging reconciliation:** seed STATE_CACHE with a `STATE_CACHE_STAGING_KEY` row, run init, verify the staging row is deleted and the singleton is untouched.
- **`LocalDataConflictError` shape:** verify each of the three throw sites constructs the correct `RemoteDataDescriptor` variant.
- **`pre-migration-backup` round-trip:** write a backup via the new implementation, verify it can be restored.

### Integration tests (Karma)

In `compaction.integration.spec.ts` style:
- `createCleanSlate` interrupt-during-tx → device state unchanged.
- `BackupService.importComplete` interrupt-during-tx → device state unchanged.
- Both flows complete-and-commit → device state correctly replaced.

### Cross-platform smoke test

Per Performance W1: verify the destructive tx commits on each runtime (Electron, Chromium web, Capacitor iOS, Capacitor Android) with a multi-MB pre-staged STATE_CACHE row.

### E2E

One Playwright test reproducing the issue #7709 chain on the *fixed* code:
1. Set up a device with 10 tasks + 1 hour tracked.
2. Trigger `createCleanSlate` and inject an exception at the destructive tx.
3. Reload the app.
4. Assert: device state matches pre-trigger state; no fresh-client conflict dialog.

## Resolved questions (from the original plan)

- **Q1 (50% threshold):** Cut. Replaced with temporal gate in PR-D (if ever needed).
- **Q2 (no-reference case):** Cut along with Q1. Temporal gate doesn't need reference counts.
- **Q3 (reference counts storage):** Cut along with Q1. No new schema.
- **Q4 (transaction threading):** Resolved — helper method on `OperationLogStoreService` (now that BackupService is a second caller, helper is justified).
- **Q5 (op-streaming preview):** Resolved — synthetic `{ kind: 'opCount', opCount: N }` descriptor; dialog branches on `kind`.
- **Q6 (BACKUP_IMPORT/REPAIR):** Resolved — they get atomicity (Fix 2) and the modal (Fix 5), no preflight needed even when preflight ships.

## Open questions for PR-A review

These are smaller decisions, not design alternatives:

- **OA1.** Should `IMPORT_BACKUP` store be reused for the pre-migration backup, or should we add a new store? The store already exists for the legacy migration backup; reusing it requires distinguishing the two backups by key.
- **OA2.** Should `runDestructiveStateReplacement` accept the operation entry directly or build it from primitives? Affects testability vs. caller ergonomics.
- **OA3.** Cross-platform smoke test execution — manual on each runtime before merge, or block on a CI matrix? Currently no Capacitor CI in this repo.

## What this plan does NOT fix

- **Fully-compromised client.** Out of scope per threat model. A malicious browser extension, XSS attacker with IDB write access, or compromised app process can wipe the user's own server data; the preflight reads NgRx via `StateSnapshotService`, which can be poisoned.
- **External IDB wipe.** A user whose browser cache is cleared still appears as a fresh client. The atomicity fix doesn't help, but the pre-migration backup (now real, not placeholder) means the user has a JSON export to restore from if they hit the destructive trigger.
- **Server-side acceptance.** Old/buggy/malicious clients can still wipe their own server data because the server trusts `isCleanSlate=true` unconditionally. Server-side completeness gating (Alternatives alt #1) is the right follow-up and is tracked as a separate plan.

## Evidence / verification

Code references verified at `feat/issue-7709-567f99` HEAD `c5158dd35b`:

- Destructive triggers: `encryption-password-change.service.ts:97` (only production caller of `createCleanSlate`), `sync-import-conflict-coordinator.service.ts:51-67`, `sync-wrapper.service.ts:687/699/712/739/843/1021/1140`, `_handleLocalDataConflict` at 1161-1262, `backup.service.ts:191-233` (5th trigger).
- Destructive primitive: `clean-slate.service.ts:81-176`. Non-atomic sequence at 149-168. Client-ID rotation + vector-clock reset at 121-126.
- `BackupService.importComplete` non-atomic sequence: `backup.service.ts:194` (clear), `:221` (append), `:225` (setVectorClock), `:227` (saveStateCache).
- Upload-service clean-slate-by-default: `operation-log-upload.service.ts:129-130`.
- `isWhollyFreshClient`: `sync-local-state.service.ts:25-30`.
- Empty-snapshot throw: `operation-log-sync.service.ts:606`. `result.snapshotState` is undefined at this line (verified — past all three `fileSnapshotOps` early-returns at 458/484/517).
- `pre-migration-backup.service.ts`: confirmed placeholder, all methods are no-ops.
- `handleServerMigration` (`server-migration.service.ts:200-269`): only appends a SYNC_IMPORT op locally; no `clearAllOperations` / `saveStateCache` / `setVectorClock`. The "Keep local" path is destructive only on the server (via `isCleanSlate=true` flag on upload), not on the local device. (One multi-review reviewer overstated this as a non-atomic local sequence; verification shows it isn't.)
- `incrementCompactionCounter`: no production callers (verified via grep across `src/`).
- Compaction threshold: `operation-log.const.ts:88` (`COMPACTION_THRESHOLD = 500`).
- Confirmation prompt fail-open: `dialog-sync-conflict.component.ts:153-168`. Only fires when `|remoteChanges - localChanges| >= 20`.
- No feature-flag mechanism: grep confirmed (`FeatureFlag|featureToggle|growthbook|posthog` all absent from `src/`).

## Revision history

- **2026-05-21 (initial):** First design pass. Preflight + atomicity + modal + logging + throw-fix + dead code. 50% completeness threshold. 3-PR rollout (logging/throw, atomicity, preflight/modal).
- **2026-05-21 (post-multi-review):** Substantial revision after 6-reviewer parallel pass.
  - Added `BackupService.importComplete` as the 5th destructive trigger (multi-review C2 finding).
  - Corrected Fix 3 — line 606 has no `snapshotState`; synthetic descriptor for op-streaming case; introduced `RemoteDataDescriptor` discriminated union.
  - Corrected Fix 1 caller graph — `createCleanSlate` has only one production caller; preflight wraps three independent call sites if it ships.
  - Cut preflight (Fix 1) from v1; gated on log evidence from Fix 4.
  - Switched atomicity from multi-store-tx-with-large-payload to snapshot-then-swap (smaller destructive tx, sidesteps WebKit/Capacitor concerns).
  - Switched from inline IDB calls to `runDestructiveStateReplacement` helper (BackupService is a second caller, helper justified).
  - Acknowledged `pre-migration-backup.service.ts` is a placeholder; PR-A implements it for real.
  - Removed Q3 schema-migration cost claim (STATE_CACHE rows already support optional fields).
  - Removed feature-flag plan (no flag framework in codebase).
  - Reordered PRs: atomicity first (PR-A), logging second (PR-B), modal third (PR-C), preflight conditional fourth (PR-D).
  - Modal copy: dropped counts (per Simplicity W4).
  - Added explicit threat-model statement excluding fully-compromised clients (per Security W2).
  - Forensic log payload: counts-only, never vector-clock contents (per Security C2).
  - Narrowed `LocalDataConflictError.remoteSnapshotState` type to eliminate future XSS surface (per Security C1).
  - Added export-to-file escape hatch in PR-D (per Alternatives alt #8).
