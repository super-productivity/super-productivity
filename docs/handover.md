# Handover — Sync Simplification (Task 2 done; Tasks 1, 3–7 open)

**Date:** 2026-07-15
**Branch:** `feat/the-sync-layer-is-extremly-complex-any-ff5006` (pushed; remote == local)
**HEAD at handover:** `0d46f1c2b9` (+ this doc commit)
**Base:** merged with `master` at `6fefd741c5` — branch was 0 behind master when Task 2 landed.

> ⚠️ **Every change here is high-risk sync code.** A subtle bug silently corrupts or loses user data across devices and is hard to recover. Read `docs/sync-and-op-log/` and `docs/sync-and-op-log/contributor-sync-model.md` before editing. Re-verify replay determinism, concurrent/remote edits, and vector-clock conflicts on every change.

---

## 1. TL;DR

- The roadmap lives in **`docs/plans/2026-07-13-sync-simplification-plan.md`** (7 tasks). It was re-aligned to master `6fefd741c5` this session; its factual claims are verified against that baseline.
- **Task 2 (file-provider target isolation) is fully implemented, multi-reviewed, fixed, and pushed** (9 commits). It is its own mergeable tranche.
- **Tasks 1, 3, 4, 5, 6, 7 are NOT started** (plan-only).
- The plan mandates: **do not combine tasks into one PR**; each task is a separate reviewable tranche approved on its own.

---

## 2. The plan at a glance (`docs/plans/2026-07-13-sync-simplification-plan.md`)

| Task | What                                                                                  | Status                         |
| ---- | ------------------------------------------------------------------------------------- | ------------------------------ |
| 1    | Audit deployed builds / persisted conflict data (blocks Task 6)                       | **open** — audit only, no code |
| 2    | Isolate file-provider state across target changes (correctness fix)                   | **DONE** (this session)        |
| 3    | One background full-sync scheduler                                                    | open                           |
| 4    | Make WebSocket events notification-only (delete WsTriggeredDownloadService shell)     | open                           |
| 5    | Replace eligible ImmediateUploadService with full sync                                | open                           |
| 6    | Focused conflict-review rollback (delete disjoint-merge + journal writer + review UI) | open — gated by Task 1         |
| 7    | Correct current sync documentation                                                    | open                           |

Separate (not in the tranches): **Proposal A** atomic browser startup (Web Lock), **Proposal B** race-free sync/maintenance exclusion. See plan §10.

**Timing constraint (plan §1 "Outcome"):** the conflict-review feature (`962c5bbeb1`) is on master but in **no release tag**. If Task 1 authorizes deletion, land a _minimal producer freeze_ (stop conflict-journal writes + disable the disjoint-merge producer) **before the next release cut**, ahead of Phase 1 — otherwise the journal data obligation expands to the whole stable fleet.

---

## 3. Task 2 — what shipped (9 commits, `c9ad0b7901`..`0d46f1c2b9`)

**Problem:** `FileBasedSyncAdapterService` keys ALL per-target state (sync version, revs, vector clocks, seq/download cursor, within-cycle caches) by **provider id only**. Nothing cleared it on a config save, so a provider switch, an account switch behind the same provider id (Dropbox/OneDrive keep the same id across accounts), or an identity-affecting config/folder change reused the previous target's state against the new target → cross-target reads/writes / silent data loss.

**Two-part fix:**

1. **Eager invalidation.** `invalidateAllTargets()` clears every target-scoped map (via one `_targetScopedMaps` source of truth — also closed a pre-existing bug where `_lastRecoveredCorruptRev` was never cleared) and bumps a monotonic in-tab `_targetGeneration`. Wired from `WrappedProviderService`'s `providerConfigChanged$` subscription. Two ingresses that bypass `setProviderConfig` — the Electron LocalFile picker (folder persisted main-side post-#8228) and Android `setupSaf()` — are routed through the same signal via a module-level bridge `notifyFileProviderTargetChanged()` on `SyncProviderManager` (mirrors the `encryption-password-dialog-opener` self-registration pattern). Machine-only OAuth token refresh (unchanged account) goes through the credential store, not `setProviderConfig`, so it correctly does NOT invalidate.

2. **In-flight guard.** A switch can happen DURING a sync, and the same `provider` object reads live config, so an in-flight write of the previous target's data could land on the new target. `_withTargetGuard(rawProvider, capturedGeneration)` returns a **Proxy** that asserts `_targetGeneration === capturedGeneration` before every `uploadFile`/`removeFile` (reads pass through). The generation is captured at each remote-entry boundary by **shadowing** the `provider` param: `_uploadOps`, `_uploadSnapshot`, `_downloadOps`. A mismatch throws `FileSyncTargetChangedError`, which `SyncWrapperService` maps to `UNKNOWN_OR_CHANGED` (silent self-heal — next sync re-reads/re-uploads against the current target). Downloads also **abort before committing a baseline** (`_abortDownloadIfTargetChanged`) if the target changed mid-download, so a stale seq cursor can't be committed under the shared key. `deleteAllData`'s `removeFile` is intentionally unguarded (deliberate user wipe of a chosen target).

**The guard invariant is compile-enforced:** `_withTargetGuard` returns a phantom-branded `GuardedFileSyncProvider`; every write-path helper's `provider` param takes that branded type, so passing a raw provider to a write path is a **build error** (verified: `TS2345`). Only `createAdapter` and `_deleteAllData` keep the raw type.

### Commit stack

```
0d46f1c2b9 refactor(sync): compile-enforce the in-flight guard via a branded provider type
de7ead4491 fix(sync): map FileSyncTargetChangedError on the force-upload paths
0acad10941 fix(sync): abort a download whose target changed before committing its baseline
00eef90bb7 docs(sync): correct Task 2 guard comments; make targetGeneration private
9815cebd9a fix(sync): guard split-migration writes on the download path
f23aaedff0 fix(sync): extend in-flight target guard to snapshot uploads
2f8cbef162 fix(sync): abort file upload when the target changes mid-operation
1a17f51312 fix(sync): invalidate file target on LocalFile picker/SAF change
c9ad0b7901 fix(sync): invalidate file-provider target state on config change
```

### Key files touched

- `src/app/op-log/sync-providers/file-based/file-based-sync-adapter.service.ts` (guard, invalidation, branded type, download abort)
- `src/app/op-log/sync-providers/provider-manager.service.ts` (`notifyFileProviderTargetChanged` bridge + `notifyProviderConfigChanged`)
- `src/app/op-log/sync-providers/wrapped-provider.service.ts` (invalidate on `providerConfigChanged$`)
- `src/app/features/config/form-cfgs/sync-form.const.ts` (picker/SAF onClick → notify on success)
- `src/app/op-log/core/errors/sync-errors.ts` (`FileSyncTargetChangedError`)
- `src/app/imex/sync/sync-wrapper.service.ts` (error → `UNKNOWN_OR_CHANGED` in normal + 2 force-upload catches)

### Tests (all green)

adapter **135**, sync-wrapper **149**, upload-orchestration **82**, wrapped-provider 14, provider-manager 2, sync-errors 6. Every modified file passes `npm run checkFile`.

---

## 4. Multi-review outcome (this session)

Task 2 got two review passes: an inline 2-agent review, then a full multi-review (6 Claude lenses + Codex). **Verdict: APPROVED after fixes.** Codex (cross-model) caught two real gaps the Claude reviewers missed — both fixed:

- **Data-loss (fixed `0acad10941`):** a download reads target A; a mid-download switch let the stale baseline + seq cursor commit under the shared key → next sync could skip the new target's ops. Now aborts before the baseline commits.
- **UX (fixed `de7ead4491`):** `FileSyncTargetChangedError` was only mapped in the normal `sync()` catch; the two force-upload catches showed a generic ERROR snack. Now both self-heal silently.
- **Hardening (done `0d46f1c2b9`):** branded `GuardedFileSyncProvider` type so the guard is compiler-enforced.

### Task 2 documented residuals (NOT bugs; deliberate scope)

1. **Between-operations / during-apply window.** Per-operation (not per-cycle) generation capture leaves a narrow residual: a switch _after_ a successful download (during op-apply, or between an upload's write and its own `setLastServerSeq` cursor commit) is not caught. The write self-heals via the conditional-write `revToMatch` check; the download-abort closes the dominant window. Fully closing it needs **per-cycle session-generation threaded through the orchestrator** (`OperationLogSyncService`) — a larger change (plan Task 2 step 1 "serialize target mutation behind one boundary").
2. **Invalidation fires _after_ the target goes live** (picker/SAF persist, then notify). Sub-ms race is negligible, but a crash in that gap leaves stale provider-keyed state paired with the new target — violates Task 2's own "restart cannot reload A's state under B's key" criterion. Belongs to the same "serialize target mutation" work.
3. **Every `setProviderConfig` save invalidates ALL providers' cursors** → an extra full re-read even on an unchanged target. This is the plan's explicitly accepted tradeoff; "narrow to identity-affecting fields" is the plan's "only if painful" follow-up.
4. `_backfillEncryptionIntent` → `setProviderConfig` → invalidate can spuriously abort an in-flight sync for legacy configs (same identity, only encryption flag added). Self-heals. Low priority; consider gating same-identity saves.

---

## 5. What a new agent should do next

**Pick ONE tranche; do not bundle.** Recommended order (plan §12):

1. **Task 1** (audit) — a product/data-retention decision (which cohorts are supported; journal-row retention/export/deletion policy incl. the `SUP_CONFLICT_JOURNAL_CLEARED_BEFORE` localStorage marker). Blocks Task 6. No code, but needs the producer-freeze decision (see timing constraint above).
2. **Task 3** (background full-sync scheduler) — the natural next _code_ tranche. Plan §7 Task 3 has the full state machine + acceptance criteria. Reconciles 3 busy signals (`isSyncInProgress$`, `isEncryptionOperationInProgress`, `SyncCycleGuard.isActive`); provider `SYNCING` stays presentation-only. `sync()` returns truthy `'HANDLED_ERROR'` — never treat as success.
3. **Tasks 4/5** route WebSocket + eligible ImmediateUpload triggers through the Task 3 scheduler, then delete the duplicated pipelines. Note master's #9028 added a WS local-win re-upload to the WS shell (folds into full sync's re-upload loop).
4. **Task 6** (conflict rollback) — gated by Task 1. Preserve list is extensive (schema-v3/v4 barriers, delete-wins, #9048 cascade recovery, #9035 clientId tiebreak, #9045 decrypt-path footprint auth). The disjoint-merge branch is cleanly separable from the recovery/guard/delete-win code (verified). See plan §8 "Known seams".
5. **Task 7** (docs).

**If continuing Task 2 instead:** the highest-value residual is #1 above — per-cycle session-generation capture in `OperationLogSyncService` to close the during-apply window. It's a real design change; scope it as its own increment with tests.

---

## 6. How to build / test / verify

```bash
npm run checkFile <file.ts|scss>          # prettier + lint ONE file (run on every modified file)
npm run test:file <path.spec.ts>          # single Karma spec (real Chrome; ~30–60s incl. build; build type-checks)
npm test                                  # full unit suite (slow)
npm run e2e:file <path> -- --retries=0    # single Playwright e2e
```

- **Full SuperSync + WebDAV E2E:** dispatch the `E2E Tests (Scheduled)` GitHub Action for this branch (preferred over local; see `AGENTS.md`). Not run yet for Task 2.
- Karma real-Chrome runs in this sandbox; the test build type-checks (that's how the branded type was validated).
- Services must stay < 1200 LOC (lint warns). The file adapter is a known over-limit offender being shrunk over time — do not grow it further; extract when touched.

**Before merging Task 2:** run the full `npm test` + the scheduled SuperSync/WebDAV E2E in CI. This session ran focused specs only.

---

## 7. Context / gotchas

- **Plan is authoritative and current:** `docs/plans/2026-07-13-sync-simplification-plan.md`, baseline `6fefd741c5`. Its §3 "Contracts" list is the invariant checklist every slice must preserve. §11 is deferred compatibility work (nothing may be deleted merely by finishing this plan).
- **Sync-correctness rules** in `AGENTS.md` (effects inject `LOCAL_ACTIONS`; multi-entity change = meta-reducer not effect fan-out; `TODAY_TAG` is virtual; logical clock via `DateService`; never log user content). Read `docs/sync-and-op-log/contributor-sync-model.md`.
- The branch was **rebased** during this work (baseline moved b3d8c7→7e273a→6fefd7). If a stale remote/other machine has old commit hashes for this branch, force-push-with-lease is expected.
- `sync()` returns the truthy string `'HANDLED_ERROR'` on handled failure — a naive truthiness check reads it as success. This bites Task 3.
- The generation counter is **in-tab, not persisted** (a fresh tab has nothing in-flight to guard) and is **not** a security/policy input (only bumped by local UI/config actions).
