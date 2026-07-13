# Sync Simplification Plan

**Status:** Proposed after repository audit, three-agent review, and independent Codex adversarial review
**Date:** 2026-07-13
**Baseline commit:** `29a59757ab774c0fe3bb9b9455515cd7cc9e72e9`
**Scope:** Client-side sync orchestration, file-based protocol support, compatibility surface, and the boundaries around persistence/conflict handling

## 1. Recommendation

Reduce scope and duplicate protocols before adding architecture.

The recommended order is:

1. establish one current, executable sync contract;
2. make explicit product decisions about unreleased conflict-review scope and the released split-file format;
3. fix the cross-tab encryption-maintenance exclusion gap before moving session ownership;
4. route partial sync triggers through the existing full-sync coordinator and delete their duplicate lifecycle policy;
5. delete compatibility paths that have proven expiry conditions;
6. consider upload-protocol changes only if they demonstrably remove more state and compatibility code than they add;
7. reassess the remaining hotspots before extracting file drivers or large workflows.

This plan deliberately does **not** commit to a new `@sp/sync-engine` package, a new provider exchange layer, new persistence repositories, a general error-classifier hierarchy, or an immediate split of `ConflictResolutionService`. Those moves may reorganize complexity without reducing it.

## 2. Evidence

At the baseline commit:

| Area                | Current evidence                                                                                                                     | Consequence                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Orchestration       | `SyncWrapperService` is 1,656 lines; `OperationLogSyncService` is 2,091 lines; immediate upload and WebSocket download add 568 lines | Normal sync, upload-only, download-only, force, and encryption maintenance have overlapping lifecycle policy                 |
| Upload piggybacking | SuperSync upload can return remote operations that enter validation, conflict, apply, cursor, and follow-up-upload paths             | Upload is a second download protocol; “upload-only” is not actually isolated                                                 |
| File sync           | `FileBasedSyncAdapterService` is 2,540 lines and supports released single-file and split-file formats                                | Revision state, migration, recovery, deletion, and format detection are cross-cutting; two naïve drivers are not independent |
| Conflict review     | Unreleased commit `962c5bbeb1` added about 6,007 lines across journal, disjoint merge, review UI, banner/badge, and flip behavior    | This is the last inexpensive point to trim a large permanent product/maintenance surface                                     |
| Persistence         | `OperationLogStoreService` is 2,512 lines while native SQLite migration/rollout remains active                                       | Implementation splitting now would overlap a storage migration and endanger atomic transitions                               |
| Documentation       | Effect guidance conflicts across docs; the architecture doc still contains schema-version-1 status while code is version 2           | Engineers cannot reliably distinguish current contracts from historical design                                               |

The previous `2026-07-03-sync-engine-extraction-plan.md` remains useful research for a future standalone library, but this plan supersedes it as the immediate complexity-reduction roadmap. The active `@sp/sync-core` / `@sp/sync-providers` dependency direction remains unchanged.

## 3. Non-negotiable contracts

Unless a task is explicitly approved as a separate behavior or correctness change:

1. One user intent creates one durable operation. Remote/replayed operations do not re-trigger local effects.
2. Remote operations are appended before reducer application. Reducer checkpoint, vector-clock merge, archive completion, application status, and downloaded cursor retain their crash-safe ordering.
3. A genuine cross-tab session/maintenance Web Lock complements rather than replaces the existing upload, download, operation-log, and archive resource locks. Browser-based destructive maintenance fails before mutation when that primitive is unavailable; a per-tab fallback is not presented as cross-tab safety.
4. There is one shared validation session. Nested piggyback/download/conflict work can fail its enclosing top-level session.
5. No caller publishes `IN_SYNC` before the enclosing validation session is classified.
6. Vector clocks are compared before server pruning; clients do not prune during conflict resolution; the size limit remains 20.
7. Import and raw rebuild retain clean-slate semantics, preflight-before-mutation, backup, atomic replacement, cursor, and crash-resume ordering.
8. Encryption fails closed. No refactor creates a plaintext fallback when encryption is configured or mandatory.
9. File download revisions are staged until operations are durably applied and the cursor is committed. Eager revision promotion can permanently skip unapplied work.
10. File delete-all remains one ordered cross-format operation: split sources, single-file/tombstone, then backup artifacts.
11. Conflict frontier read, detection, host-state enrichment, planning, durable execution, and deferred-action drain remain inside the existing operation-log critical section.
12. A merged conflict operation is durable before its best-effort, non-atomic journal entry. Journal failure never fails sync.
13. Compatibility is removed only with an explicit supported-version condition and rollback path.
14. Under the current SuperSync protocol, the server atomically rejects conflicting/superseded uploads before acceptance, and the client applies piggybacked operations returned with an accepted upload before marking its local entries synced. Any future decoupled acknowledgement protocol requires a stable conflict-decision watermark and stronger frontier rules as separate behavior work.

## 4. Non-goals

- Replacing the operation log, vector clocks, offline-first behavior, or E2EE.
- Introducing CRDTs, global timestamp LWW, or full-state-only sync.
- Changing operation action strings, compact codes, schema versions, encryption envelopes, or server contracts inside behavior-preserving refactors.
- Treating smaller files, more interfaces, or fewer lines as success without a smaller change surface.
- Encoding a known divergence as expected behavior to make a characterization test green.
- Adding a public package or host port without a concrete second consumer.

## 5. Phase 0 — Establish truth and decide what should exist

### Task 1: Create one authoritative sync contract

**Description:** Add a concise current contract and make the README/contributor docs point to it. Mark the large architecture document as explanatory/historical where it duplicates current rules.

**Acceptance criteria:**

- [ ] One document owns the contracts in Section 3 and labels implemented behavior, compatibility behavior, and known gaps.
- [ ] The obsolete regular-`Actions` exception is removed; schema-version status matches `CURRENT_SCHEMA_VERSION = 2`.
- [ ] The current server-backed upload/conflict invariant is distinguished from the stronger watermark/frontier contract required by any future ack-only design.
- [ ] Other sync docs link to the contract instead of redefining it.

**Verification:**

- [ ] `npx prettier --check` passes for edited Markdown.
- [ ] Searches for stale effect guidance and `CURRENT_SCHEMA_VERSION = 1` return only explicitly historical content.

**Dependencies:** None.
**Likely files:** `docs/sync-and-op-log/sync-contract.md`, `docs/sync-and-op-log/README.md`, `docs/sync-and-op-log/operation-rules.md`, `docs/sync-and-op-log/operation-log-architecture.md`.
**Scope:** Medium.

### Task 2: Create the compatibility ledger

**Description:** Inventory compatibility code before introducing new boundaries. Record owner, oldest supported producer/client, evidence query, retain/remove condition, migration behavior, and rollback.

**Initial candidates:**

- released single-file/split-file format migration and tombstones;
- legacy PFAPI metadata bridge (`_syncVectorClockToPfapi`);
- deprecated schema/snapshot aliases;
- `CONFLICT_STALE` server compatibility;
- transitional IndexedDB `adoptConnection` ownership;
- provider/config cache invalidation and per-target local sync metadata.

**Acceptance criteria:**

- [ ] Every candidate is classified as retain, normalize at ingress, freeze adoption, or remove after a named condition.
- [ ] No removal is bundled with this inventory task.
- [ ] File-format and server-version decisions have explicit multi-release rollback notes.

**Verification:**

- [ ] Every ledger entry links to production call sites and focused tests/fixtures.
- [ ] Markdown formatting passes.

**Dependencies:** None.
**Likely file:** `docs/sync-and-op-log/compatibility-ledger.md`.
**Scope:** Small.

### Gate A: Decide unreleased conflict-review scope

The conflict journal/disjoint merge/review feature is not in `v18.14.0`. Before release, choose deliberately:

1. **Trim (recommended unless product value is clear):** remove review page, badge/banner, and mutable Flip workflow; independently decide whether disjoint merge is safe enough to retain.
2. **Diagnostic middle ground:** retain a device-local read-only journal without review mutation or attention-grabbing UI.
3. **Retain full feature:** accept its permanent UI, storage, test, and conflict-execution costs; create separate correctness work for the documented composition and Flip gaps.

Do not refactor this surface before the decision. If retained, conflict decomposition requires its own implementation plan after the known convergence gap is resolved or explicitly excluded.

### Gate B: Decide split-file lifecycle

Split-file sync is contained in `v18.14.0`; it cannot be reverted as unreleased code.

Choose:

1. **Freeze adoption:** remove new enablement from current clients while preserving `true` for existing configured folders. Record that supported old clients can still enable/re-enable it, so this reduces adoption but is not yet a retirement gate.
2. **Retain:** characterize how the synchronized toggle propagates through ordinary operations, snapshots, old clients, provider switching, and locally hydrated state; only then consider remote-format auto-detection and internal strategy extraction.
3. **Retire later:** freeze adoption first. Retirement is not implementable while supported released clients can automatically migrate a restored single-file folder back to split format; local-file/WebDAV storage has no server capability gate that can stop them.

Driver extraction is conditional on retaining both formats. Retirement requires a separate mixed-version plan after every re-upgrading release is outside the supported window.

### Task 2A: Execute the Gate A scope decision

**Description:** Turn the product decision into deletion or an explicit retention commitment before adding architecture.

**Acceptance criteria:**

- [ ] If Trim is selected, remove one independently revertible family per PR: review route/page/badge/banner, mutable Flip workflow, journal, and disjoint merge. Decide journal and disjoint merge independently rather than treating the original feature commit as indivisible.
- [ ] If the diagnostic middle ground is selected, delete mutation and attention UI before retaining the read-only journal.
- [ ] If the full feature is retained, record the owner and correctness work for the known composition/Flip gaps; do not refactor it in Phase 0.
- [ ] Each chosen deletion lands with its references, translations, tests, and documentation removed in the same PR.

**Verification:** affected focused specs, `checkFile` for every changed TypeScript/SCSS file, full unit tests after the final family, and `git grep` proving removed entry points have no production references.
**Dependencies:** Gate A.
**Scope:** One small/medium PR per selected family.

### Task 2B: Execute the Gate B adoption decision

**Description:** If Freeze or Retire later is selected, remove new split-format enablement from current UI/config creation while preserving `true` configurations and all existing split folders. If Retain is selected, make no production change here and proceed to the characterization slices below.

**Acceptance criteria:**

- [ ] Freeze never coerces an existing `true` value to false and never downgrades a remote folder.
- [ ] Existing split-enabled configurations still sync after upgrade; a new current client cannot newly enable the toggle through supported UI.
- [ ] The limitation that supported old clients can re-enable/re-upgrade remains in the compatibility ledger.

**Verification:** config form/default/hydration tests plus one existing-`true` file-sync integration case.
**Dependencies:** Gate B.
**Scope:** Small if Freeze/Retire later is selected; no-op if Retain is selected.

### Task 2C: Delete evidence-expired compatibility one family at a time

**Description:** Use Task 2's ledger to select only proven-expired paths. Candidates include `migrateIfNeeded`, deprecated snapshot aliases/re-exports, `clearCache`, the PFAPI bridge, and `CONFLICT_STALE`; names are candidates, not authorization to delete.

**Acceptance criteria:**

- [ ] Each PR removes one ledger family and its tests after its producer/support condition is proven.
- [ ] Migration, mixed-version, downgrade, and rollback evidence is attached to the ledger entry.
- [ ] If no family is safely expired, record that result with evidence rather than manufacturing a deletion.

**Verification:** focused compatibility/migration tests, full relevant package tests, and production-reference searches.
**Dependencies:** Task 2.
**Scope:** One small PR per eligible family.

### Task 3: Produce a coverage map and fill only session-boundary gaps

**Description:** Map existing specs to the session contract. Most download/upload/retry/latch behavior is already covered; add only missing external boundaries.

**Missing currently-green cases to verify/add:**

- normal sync and force upload skip when the session is busy and release ownership after resolve/reject;
- immediate and WebSocket paths release after a rejected promise;
- a busy entrant never resets the active session’s validation state.

**Acceptance criteria:**

- [ ] A checked-in matrix maps each top-level entry and maintenance path to its ownership, validation, error, and release tests.
- [ ] Only uncovered cases add tests; existing assertions are not weakened.
- [ ] Tests characterize unchanged production behavior. Any newly exposed failure becomes a separate red/green correctness slice rather than a blessed expectation.

**Verification:**

- [ ] Focused wrapper, guard, validation, immediate-upload, WebSocket, and encryption-maintenance specs pass.
- [ ] `npm run checkFile <filepath>` passes for every changed TypeScript file.

**Dependencies:** None.
**Likely files:** one matrix document plus existing focused specs.
**Scope:** Small.

### Task 4A: Pin load-bearing dual-format adapter invariants

**Description:** Existing file integration suites use the default single-file mode. Add only the minimum shared matrix needed to protect existing folders before any file-format code changes.

**Acceptance criteria:**

- [ ] Single and split modes cover migration/tombstone, pending-revision promotion, backup recovery, cross-format delete ordering, and one concurrent-conflict case.
- [ ] No broad parameterization of unrelated edge suites is included; add cases later only for code a subsequent task changes.

**Verification:** focused file integration specs, adapter spec, and every changed-file `checkFile` pass.
**Dependencies:** Gate B must choose retain/freeze. Do not skip this coverage for a future retirement; it is evidence required to design that retirement safely.
**Likely files:** file-based test harness plus at most two integration specs.
**Scope:** Small/medium.

### Task 4B: Pin synchronized-toggle and remote-target behavior

**Description:** Characterize that `isUseSplitSyncFiles` is synchronized configuration through ordinary operations, snapshots, and runtime hydration. Separately pin provider/account/remote-target switching before changing persisted map ownership or keying.

**Acceptance criteria:**

- [ ] Local-only key tests and operation/snapshot round trips prove the toggle's actual propagation.
- [ ] Target switching proves whether cached expected versions, revisions, cursors, and clocks reset or are keyed safely.

**Verification:** focused config/hydration, adapter, and target-switching specs pass.
**Dependencies:** Task 4A.
**Scope:** Small/medium.

### Task 4C: Pin mixed-release migration and re-upgrade

**Description:** Add fixtures/cases for a current client, a released split-enabled client, and restored single-file data. Prove the current automatic re-upgrade and tombstone behavior before any retirement design.

**Acceptance criteria:**

- [ ] A restored single-file folder plus a released split-enabled client reproduces automatic migration back to split format.
- [ ] Freeze/retain behavior is tested with old-client writes and current-client recovery.
- [ ] Broader multi-client/failure matrices are deferred until a production format change needs them.

**Verification:** focused mixed-fixture file integration specs and scheduled WebDAV workflow pass.
**Dependencies:** Tasks 4A and 4B.
**Scope:** Medium.

### Cross-tab ownership policy

The implementation tasks below must first encode these semantics:

- user-triggered sync, force operations, and destructive maintenance wait for the shared owner up to the existing lock timeout;
- background immediate/WebSocket/automatic entries use a non-blocking `ifAvailable`/fallback equivalent and make no status or validation mutation when busy; a busy result registers one shared, coalesced after-release retry rather than relying on an unrelated future event;
- a foreground acquisition timeout uses the current handled-error path; a background miss remains quiet and retryable;
- the entry order is: synchronously claim the in-tab guard, acquire the cross-tab owner, then open validation/hydration windows, set `_isSyncInProgress`, and publish `SYNCING` inside the lock callback; timeout/busy paths release the guard and perform none of those lifecycle mutations;
- a sync that already owns the session keeps it across conflict dialogs because the conflict critical section cannot be split safely; background entrants publish no lifecycle while waiting, but one coalesced waiter may remain pending and run after release;
- maintenance confirmation happens before acquisition, mutable preflight is repeated after acquisition, and no interactive prompt occurs after the first destructive mutation;
- only top-level entries acquire the owner. Nested upload/download/operation-log/archive locks remain non-reentrant, retain their names/order/scope, and never acquire the session owner.

Extending `LockService` with non-blocking acquisition must include an equivalent atomic fallback for Electron/Android/single-instance use; do not bypass the service with ad hoc `navigator.locks` calls. In a multi-tab-capable browser without `navigator.locks`, normal sync may retain today's explicitly unsafe fallback, but destructive maintenance must reject before its first mutation. The startup instance handshake is not a substitute because simultaneous tabs can both pass it.

The owner returns an explicit `busy` outcome. One per-tab retry registration waits/requeues with a capped delay until the owner releases, sync is disabled/offline, or the app is destroyed; timeout alone does not silently discard pending work. During Phase 0 it retries the original entry class. After Task 6 it marks the full-sync coalescer dirty. Collision tests must prove `busy -> owner release -> successful work` without another user, timer, visibility, or network event.

### Task 5A: Close the password-change versus normal-sync race

**Description:** First create a real two-page, same-origin browser reproducer that shows today's interleaving. In the same red/green PR, add the shared owner only to normal sync and password change, retaining the in-tab guard, validation latch, and all resource locks.

**Acceptance criteria:**

- [ ] The test is observed failing against baseline behavior and passes with the implementation; no red test is merged.
- [ ] Password change cannot enter its first mutation while normal sync in another tab owns the session, and normal sync cannot enter while password mutation is active.
- [ ] With `navigator.locks` unavailable, destructive maintenance fails before mutation; a simultaneous-start two-page case proves the per-tab mutex/startup handshake is not mistaken for exclusion.
- [ ] Only top-level entries acquire the new lock; nested helpers cannot re-enter it and deadlock.
- [ ] Lock timeout, rejection, conflict-dialog hold, preflight revalidation, zero pre-acquisition lifecycle mutation, and release-in-`finally` behavior follow the policy above.

**Verification:** focused unit specs plus a two-page browser test for wait/exclusion/release; password-change, clean-slate, and normal-sync specs pass.
**Dependencies:** Tasks 2A-2C and Task 3. Gate actions must be completed or explicitly deferred with owner/rationale before adding the ownership primitive.
**Scope:** One medium correctness PR.

### Task 5B: Migrate remaining top-level sync entries one at a time

**Description:** Migrate force upload, immediate upload, and WebSocket download in separate PRs. Retain every existing guard until all entries and maintenance callers use the shared owner.

**Acceptance criteria:**

- [ ] Each PR changes one entry class and adds its two-page exclusion/rejection-release case.
- [ ] Foreground force waits; background immediate/WebSocket paths use non-blocking acquisition and preserve quiet retry semantics.
- [ ] Password change cannot overlap the newly migrated entry from a second tab.
- [ ] A background miss registers exactly one after-release retry and eventually runs without an external trigger.

**Verification:** focused entry-path and password-race specs plus the same-origin browser test after each migration.
**Dependencies:** Task 5A.
**Scope:** One small/medium PR per entry class.

### Task 5C: Move remaining encryption transitions into exclusive maintenance

**Description:** Migrate enable/disable and any remaining destructive encryption callers one at a time, preserving their existing resource locks and fail-closed behavior. Delete the old flag-plus-polling exclusion only after every caller and top-level entry uses the shared owner.

**Acceptance criteria:**

- [ ] Enable, disable, and password change cannot overlap sync or each other across tabs.
- [ ] Every caller has pre-mutation failure, active-work drain, concurrent-maintenance, success, failure, and retry coverage.
- [ ] The old exclusion mechanism is deleted only when production references reach zero.

**Verification:** unit and two-page concurrency specs, clean-slate/rebuild specs, and scheduled encrypted SuperSync E2E pass after each caller migration.
**Dependencies:** Task 5B. Implement before moving or removing side-channel guards.
**Scope:** One small/medium PR per remaining caller, not one combined change.

### Checkpoint 0

- [ ] Contract and compatibility ledger reviewed by a sync maintainer.
- [ ] Gates A and B have recorded decisions.
- [ ] Gate A/B implementation tasks are complete or explicitly deferred with owner/rationale; every evidence-expired compatibility family selected in Task 2 is removed one family at a time.
- [ ] Missing session, encryption, and retained-format tests are green.
- [ ] No public API or speculative engine/provider abstraction exists; the only new production ownership primitive is justified by the reproduced cross-tab maintenance race.

**Rollback:** Documentation/test-only tasks can be reverted independently. If characterization exposes a correctness failure, stop structural work and open a focused correctness task; do not change the test to bless the failure.

## 6. Phase 1 — Collapse duplicate top-level sync paths

This phase changes trigger timing but deliberately keeps the existing upload/download protocol. It requires separate approval after Checkpoint 0 and must not be mixed with server-contract changes.

### Gate C: Collapse partial side channels

The current `SyncEffects` path is not a queue: leading-only `throttleTime` plus `exhaustMap` drops triggers during an active run. Phase 1 must first create one explicit `idle | running | dirty` coalescer, then choose the smallest WebSocket outcome:

1. **Delete push transport (preferred if product requirements allow):** rely on visibility, online, activity, local-edit, startup, and manual triggers. Trade-off: no immediate convergence on an idle visible device; SuperSync currently has no wall-clock polling fallback. Remove the client first and keep the server endpoint through the old-client support window.
2. **Retain transport as notification-only:** a WebSocket notification marks the full-sync coalescer dirty; it owns no download, validation, conflict, cursor, status, or auth lifecycle.
3. **Retain a measured partial path:** use Section 7 only if the first two choices fail explicit latency/request budgets.

Record these budgets before implementation:

- an idle local edit starts its sync attempt within the current 2,000 ms immediate-upload debounce plus 250 ms scheduler tolerance;
- if WebSocket push remains, an idle notification starts its attempt within the current 500 ms debounce plus 250 ms tolerance;
- an idle local-edit burst adds at most one HTTP round trip versus today's immediate-upload path;
- any number of triggers during one active run causes exactly one follow-up run, never zero or more than one;
- initial-sync completion bookkeeping, user-triggered error presentation, and quiet background failure behavior remain unchanged.

Only the normal coordinator publishes global sync status. Upload piggyback/conflict/frontier ordering remains unchanged. Do not add an ack-only protocol merely to preserve the old request count.

### Task 6: Replace the drop-based trigger operator with one coalescer

**Description:** Introduce a single `idle | running | dirty` owner inside the existing full-sync trigger path before routing any new source to it. Do not create parallel queues in services.

**Acceptance criteria:**

- [ ] Inventory every direct top-level `SyncWrapperService.sync()` caller, including manual sync, before-close, initial/enablement flow, and wrapper-internal resyncs; classify each as queued or an evidence-backed bypass.
- [ ] Existing startup, visibility, online, activity, interval, enablement, and manual sources use the same owner.
- [ ] Triggers during `running` set `dirty`; completion atomically starts exactly one follow-up and clears it.
- [ ] Initial-sync completion is not lost when its trigger coalesces, and foreground/background origin only affects surviving presentation policy—not queue identity.
- [ ] A foreground request arriving during a background run attaches to the required follow-up and its promise resolves/rejects with that follow-up's `SyncStatus`; it never inherits the background run's quiet result.
- [ ] Multiple foreground requests for the same pending follow-up share that result. Before-close and internal resync callers are explicitly tested as queued or intentional bypasses rather than silently dropped.
- [ ] A cross-tab owner's `busy` result marks pending work and produces exactly one run after owner release even though the local coalescer was not already `running`.
- [ ] The fixed budgets above are executable assertions or recorded benchmark thresholds.

**Verification:** deterministic trigger/effect specs for idle/running/dirty, direct-caller promise results, initial sync, before-close, internal resync, online/offline, foreground/background priority, cross-tab busy/release, failure, and one follow-up; wrapper specs pass.
**Dependencies:** Gate C.
**Scope:** Medium behavior change; no WebSocket/immediate deletion in this PR.

### Task 7: Delete WebSocket push or reduce it to a notification source

**Option A — delete:** remove client connection/reconnect/heartbeat and notification code; prove return-to-visible, online, activity, startup, local-edit, and manual convergence. Retain the server endpoint until the compatibility ledger's old-client condition expires, then delete server routing/limits in a separate PR.

**Option B — notification-only:** characterize transient versus terminal auth first, route notifications into Task 6's coalescer, centralize terminal SuperSync auth/socket-stop policy in the surviving wrapper, and delete `WsTriggeredDownloadService`. Do not pass trigger provenance through the queue for auth handling.

**Acceptance criteria:**

- [ ] The chosen option meets its convergence and latency budgets.
- [ ] No WebSocket event starts a parallel partial session or owns validation/status.
- [ ] If retained, any terminal SuperSync auth failure stops the socket at the common wrapper boundary while tolerated transient 401 behavior remains unchanged.
- [ ] Deleted client/server pieces have independent compatibility and rollback points.

**Verification:** coalescer/wrapper/provider-auth tests, multi-client convergence, visibility/online/activity cases, request-count comparison, and scheduled SuperSync E2E.
**Dependencies:** Task 6 and Gate C.
**Scope:** One medium client PR; later server deletion is a separate small/medium PR after its support condition.

### Task 8: Route local-operation triggers through the same queue

**Acceptance criteria:**

- [ ] The current 2,000 ms debounce is preserved unless Gate C explicitly changes its budget.
- [ ] Local edits during an active session produce at most one follow-up session.
- [ ] `ImmediateUploadService` is deleted only after edit-to-remote latency and request-count evidence is accepted.
- [ ] Upload piggyback processing remains inside the normal coordinator, preserving deferred acknowledgement and conflict-frontier ordering.

**Verification:** capture-effect, sync-trigger, wrapper, upload/conflict, and multi-client SuperSync specs plus scheduled E2E pass.
**Dependencies:** Tasks 6 and 7 plus Gate C.
**Scope:** Medium.

### Checkpoint 1 — Primary simplification boundary

- [ ] Partial triggers share the existing queue/coordinator, or each retained partial path has measured value.
- [ ] Upload piggyback conflict/frontier ordering is unchanged unless the conditional protocol research below is separately approved.
- [ ] Encryption maintenance has real exclusive ownership.
- [ ] Full unit/integration suites and scheduled SuperSync/WebDAV workflows pass.

**Rollback:** Each trigger migration must be independently revertible. Do not delete an old side channel until the replacement path passes the same focused specs, concurrency cases, latency/request-count comparison, and scheduled E2E.

## 7. Fallback — Session consolidation if partial paths remain

If Gate C retains multiple top-level paths, use one lifetime-only session abstraction. Do not add a third permanent wrapper around the existing guard and latch.

Preferred end state: merge `SyncCycleGuardService` and `SyncSessionValidationService` into one `SyncSessionService` with a single state instance. During incremental migration, any compatibility facade must delegate to that same instance.

Required result shape:

```ts
type SessionRunResult<T> =
  | { kind: 'busy' }
  | { kind: 'ran'; value: T; validationFailed: boolean };
```

The service synchronously claims ownership, opens exactly one validation session, runs the callback, samples validation only after callback transitions finish, and releases in `finally`. Callers retain status/dialog policy.

Migrate one path per PR in this order:

1. WebSocket download;
2. immediate upload;
3. normal sync;
4. force upload, only after characterizing its currently different validation semantics;
5. encryption maintenance through the exclusive/waiting API, not the busy-skipping API.

At completion, production top-level ownership calls exist in one service only. If old guard/latch services cannot be deleted, stop and reassess whether the abstraction reduced complexity.

## 8. Conditional later work

These are follow-up decisions, not pre-approved implementation phases.

### Ack-only upload protocol research

This is not part of the recommended immediate roadmap. Reconsider it only if trigger consolidation leaves upload piggybacking as a measured dominant source of change cost.

Any spike must satisfy all of these before production adoption:

- the server response carries an explicit capability/version marker; a new client retains the old piggyback pipeline until it has observed that marker, including for self-hosted servers and server rollback;
- the response supplies a stable server-sequence watermark covering its conflict decision; accepted local sequence IDs remain staged/unsynced until download, conflict/rejection handling, and the durable client cursor reach that watermark, so `getUnsyncedByEntity()` still provides the local conflict frontier;
- staged acknowledgements/frontiers survive restart; the current in-memory pending-ack list is insufficient;
- crash/retry tests cover server acceptance, response receipt, download, conflict resolution, cursor commit, and local acknowledgement boundaries and prove request-ID deduplication cannot lose an accepted acknowledgement or frontier;
- compatibility tests cover new-client/old-server, old-client/new-server, server rollback, and capability loss;
- the measured deletion of piggyback processing/status/test code exceeds the new capability, staging, retry, and rollout code.

If satisfying those conditions requires a second durable acknowledgement/frontier state machine, reject the protocol change and retain piggybacking.

### File-format strategy extraction

Proceed only if Gate B retains both formats and Checkpoint 1 leaves the adapter as a proven hotspot.

First write an ownership design for:

- shared per-remote-target state: expected version, synthetic cursor, pending/committed revision, last clock, and caches;
- a stable non-secret remote-target identity or safe reset/full-download rule on config/account change;
- common encoded-file I/O, encryption, backup/recovery, and revision CAS;
- cross-format detection and single-to-split migration;
- cross-format delete-all ordering.

Keep revision promotion in the facade/session-state owner after durable cursor commit. Keep migration/delete in cross-format coordinators. Only format algorithms belong in plain internal strategy modules; avoid additional Angular services. Preserve facade-level contract tests throughout. Because the move is over 500 lines, use a reproducible mechanical extraction and review semantic edits separately.

Write a dedicated implementation plan after the owner map is approved.

### Destructive dataset replacement

This is cohesive but high risk. If still painful after Checkpoint 1, create a separate plan with three green slices:

1. characterize preflight, capture-race, backup, atomic replacement, cursor, replay, resume, and rollback ordering;
2. extract the durable workflow behind existing delegating methods;
3. separate boot-time recovery presentation without losing persistent Undo, dismissal/retirement, or backup-ID mismatch handling.

### Persistence

Finish native SQLite token flip, migration wiring, staged retained-source rollout, and removal of `adoptConnection` first. Retain `OperationLogStoreService` as the atomic facade. `RemoteOperationApplyStorePort` already exists; do not recreate it. After rollout, inventory consumer method sets and add at most one capability seam only if it deletes a real dependency or enables substitution without extra Angular tokens.

### Conflict execution

Keep behind Gate A and a separate correctness/implementation plan. Any future split must preserve the entire existing operation-log critical section. Reuse existing `@sp/sync-core` planners; do not create another generic planning layer. Preserve the exact “merged op appended, then best-effort journal” ordering.

### Public engine package

Create `@sp/sync-engine` only when a concrete second host exists and the app-side seam is stable enough that extraction is mostly mechanical.

### Wrapper error-policy extraction

Do not characterize every branch in the already-large wrapper spec pre-emptively. Before a concrete error-policy move, cover only the families that extraction will touch—such as empty body/legacy format, lock/auth, password/decryption, WebCrypto, or packaged-platform permission handling—and land those tests against unchanged production behavior first.

## 9. Verification and rollback matrix

| Area                          | Focused verification                                   | Checkpoint verification             | Rollback                                               |
| ----------------------------- | ------------------------------------------------------ | ----------------------------------- | ------------------------------------------------------ |
| Contracts/compatibility       | Markdown + evidence searches                           | Maintainer review                   | Revert docs independently                              |
| Session/encryption            | guard, validation, entry-path, encryption specs        | full unit + encrypted SuperSync E2E | revert one path; no partial mutation                   |
| Trigger consolidation         | WS/immediate/trigger/wrapper specs                     | scheduled SuperSync                 | keep old trigger until parity, revert independently    |
| Conditional ack-only research | capability/frontier/crash/old-server contracts         | multi-client + scheduled SuperSync  | retain piggyback pipeline until capability window ends |
| File strategies               | adapter + both-format integration + migration/recovery | scheduled WebDAV/SuperSync          | unchanged public facade; revert mechanical stack       |
| Replacement                   | rebuild/backend/recovery specs                         | restore/conflict E2E                | delegating facade + preserved backup                   |
| Persistence                   | IDB/SQLite contracts                                   | native device gate                  | retained IDB source/feature flag                       |
| Conflict                      | conflict/journal/archive/convergence                   | multi-client SuperSync              | separate semantic project; no mixed refactor           |

Every modified `.ts` or `.scss` file must pass `npm run checkFile <filepath>`. Run the full scheduled SuperSync and WebDAV workflow at each protocol or high-risk checkpoint.

## 10. Success measures

- Top-level trigger work has one queue/coordinator; encryption maintenance participates in cross-tab exclusion.
- Current upload acknowledgement preserves the server's atomic conflict-decision contract; any future decoupling proves a durable decision watermark/frontier before adoption.
- Normal sync changes do not require editing normal, immediate, and WebSocket lifecycle code separately.
- Compatibility surface has owners and expiry conditions; expired branches are deleted one family at a time.
- If both file formats remain, format-specific changes normally stay in one strategy while shared revision/migration/delete invariants have one owner.
- Persistence atomicity and the existing resource-lock scopes remain unchanged.
- Documentation has one current invariant source and an explicit known-gap list.
- No new public package or abstraction survives unless it deletes more code/dependencies than it adds.

## 11. First approval tranche

Approve only Tasks 1-5C and the Gate A/B decisions initially. Then approve trigger consolidation (Gate C and Tasks 6-8) separately. Do not approve conditional protocol or extraction work until Checkpoint 1 shows which complexity remains.
