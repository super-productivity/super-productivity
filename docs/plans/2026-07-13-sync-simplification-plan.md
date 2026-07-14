# Sync Simplification Plan

**Status:** Revised after repository audit and three independent reviews

**Date:** 2026-07-14

**Baseline commit:** `29a59757ab774c0fe3bb9b9455515cd7cc9e72e9`

**Scope:** Client sync orchestration, unreleased conflict behavior, file-provider state, and destructive maintenance

## 1. Outcome

Reduce the number of sync paths and ownership protocols before extracting architecture.

The implementation order is:

1. remove the unreleased conflict-journal/review experiment as one semantic rollback;
2. document only the sync behavior that exists today;
3. fix file-provider state leaking across remote-target changes;
4. make the existing single-active-browser-tab policy atomic;
5. route background triggers through full sync and delete both partial-sync lifecycles;
6. replace flag-and-poll maintenance exclusion with one in-tab exclusive boundary;
7. reassess the remaining hotspots before authorizing more work.

This deliberately avoids a cross-tab sync-session protocol. The product already rejects a second active browser tab. Making that rule atomic removes the need for cross-tab capture gates, generation counters, owner heartbeats, waiter lists, and retry coordination.

## 2. Decisions from review

| Question                                                           | Decision                          | Reason                                                                                                                       |
| ------------------------------------------------------------------ | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Unreleased conflict journal, review UI, `Flip`, and disjoint merge | Remove together                   | They form one coupled semantic feature of roughly 6,000 lines. Keeping only part creates ambiguous conflict behavior.        |
| Released split-file format                                         | Retain unchanged                  | Old clients still require compatibility. Freezing the format now adds a third compatibility state without enabling deletion. |
| Browser concurrency                                                | One active tab                    | This is already product behavior and is covered by the existing multi-tab E2E. Web Locks should make ownership atomic.       |
| Background sync                                                    | Full sync only                    | WebSocket and local-operation triggers do not need independent validation, conflict, cursor, and status lifecycles.          |
| Foreground sync                                                    | Preserve current result semantics | A user-triggered sync must not be converted into a fire-and-forget background waiter.                                        |
| Destructive maintenance                                            | Serialize in the active tab       | Atomic single-tab ownership removes the need to coordinate maintenance with another current client tab.                      |
| Compatibility retirement                                           | Conditional                       | No format or storage path is removed without a support-version condition and rollback path.                                  |

## 3. Success criteria

- [ ] Current browsers cannot initialize two active app tabs for the same origin.
- [ ] The conflict journal/review UI, `Flip`, and disjoint-merge implementation are absent.
- [ ] A file provider cannot reuse cached revision/cursor state after its configured remote target changes.
- [ ] WebSocket notifications and persisted local operations both request normal full sync.
- [ ] `WsTriggeredDownloadService` and `ImmediateUploadService` are deleted.
- [ ] Background triggers use only `idle`, `running`, and `dirty` state, with at most one pending rerun.
- [ ] Foreground `sync()` behavior and initial-sync bookkeeping remain unchanged.
- [ ] Sync and destructive maintenance share one authoritative in-tab exclusion mechanism.
- [ ] No new public package, provider protocol, server contract, persistence repository layer, or general error hierarchy is introduced.
- [ ] The net production change is deletion-heavy after each phase.

Line count is evidence, not the goal. A phase succeeds only when it removes behavioral states and failure paths.

## 4. Current contracts to preserve

These are current safety rules, not proposed architecture:

1. One user intent creates one durable operation. Remote or replayed operations do not re-trigger local effects.
2. Remote operations are durable before reducer application. Apply status, vector-clock merge, archive completion, and downloaded cursor retain crash-safe ordering.
3. Resume and visibility handling opens the trigger-suppression window synchronously, before debounce or lock acquisition.
4. One validation session owns nested download, piggyback, conflict, and apply work. No caller publishes `IN_SYNC` before that session is classified.
5. Normal and conflict-compensation operations retain full client clocks until the server compares them. Existing bounded snapshot, migration, repair, compaction, and hydration paths may prune; the maximum remains 20.
6. A receiver stops at the first unsupported, newer, invalid, or migration-failing operation and advances only through the valid prefix.
7. Ordinary sync does not run over incomplete remote application state. Raw rebuild resumes first; reducer-pending work blocks.
8. Import and raw rebuild retain preflight-before-mutation, backup, atomic replacement, cursor, and crash-resume ordering.
9. Encryption fails closed. Operation metadata and `isPayloadEncrypted` are not authenticated policy inputs.
10. File revisions remain staged until operations are durably applied and the cursor is committed. Delete-all remains ordered across split, single-file/tombstone, and backup artifacts.
11. Pending local writes are flushed before the conflict frontier is read. Conflict planning and durable execution remain inside the operation-log critical section.
12. SuperSync conflict prefetch and per-user `lastSeq` reservation remain in the same transaction; clean-slate replacement preserves monotonic `lastSeq`.
13. Piggybacked remote operations from an accepted upload are applied before the corresponding local entries are marked synced.
14. Compatibility is deleted only after its explicit support condition is true.

The new contract document in Task 2 must link each rule to its enforcement point and one focused test. It must not copy historical design prose or describe work in this plan as already implemented.

## 5. Explicit non-goals

- A new `@sp/sync-engine` package or host-port abstraction.
- CRDTs, timestamp last-write-wins, or full-state-only sync.
- New operation action strings, compact codes, schema versions, encryption envelopes, or server exchanges.
- An acknowledgement-only upload protocol.
- Separate single-file and split-file driver hierarchies.
- Splitting persistence services while native SQLite migration and rollout are active.
- Splitting `ConflictResolutionService` merely to reduce file length.
- A universal sync queue with foreground waiter lists, presentation metadata, cross-tab generations, or retries.
- A new cross-tab local-operation capture gate.
- Characterization tests that bless a known divergence.

If a later task requires one of these, stop and write a separate behavior proposal with migration and rollback analysis.

## 6. Phase 0 — Remove scope and establish truth

### Task 1: Roll back the unreleased conflict-review feature

**Size:** Large deletion, one atomic semantic change

**Dependencies:** None

Remove the journal, review route/UI, banner/badge, `Flip` behavior, and disjoint-merge behavior introduced by `962c5bbeb1` and its follow-ups. Restore the previously tested conflict semantics; do not blindly revert unrelated subsequent fixes.

This task spans more files than a normal slice because partial removal would leave persisted and runtime behavior disagreeing. Keep it one logical change and make no adjacent refactors.

**Acceptance criteria:**

- [ ] Conflict outcomes match the last behavior before the feature was introduced.
- [ ] Journal database/schema code, journal services, review models, review UI, navigation, badge/banner, translations, and dedicated tests are removed.
- [ ] `Flip` and disjoint-merge action/operation handling are removed from capture, replay, conflict resolution, and documentation.
- [ ] Existing ordinary conflict, replay, migration, and sync tests remain green.
- [ ] Repository searches find no production references to removed symbols or routes.
- [ ] No released operation or persisted format is removed accidentally.

**Verification:**

- Run focused conflict-resolution, operation-capture/replay, and migration specs.
- Run `npm run checkFile` for every changed TypeScript or SCSS file.
- Run the full unit suite before merging the rollback.
- Inspect the final diff specifically for unrelated modifications hidden among deletions.

**Stop condition:** If any removed operation was present in a released schema or can exist on supported clients, stop. Convert that operation to an explicit compatibility reader instead of deleting it.

### Task 2: Publish one concise current sync contract

**Size:** Small

**Dependencies:** Task 1

Create `docs/sync-and-op-log/sync-contract.md`. Keep the rules in Section 4 in a compact table with columns for contract, enforcement, and focused test.

Update the README and contributor guide to point to it. Fix, rather than duplicate, stale claims:

- `ALL_ACTIONS` is exceptional for op-log capture; ordinary state-changing effects use `LOCAL_ACTIONS`.
- The shared schema version is 2, not 1.
- Removed conflict-review behavior is not described as current.

Do not create a separate coverage map or compatibility ledger. Add a short compatibility table to this document only where it clarifies a currently supported reader/writer path.

**Acceptance criteria:**

- [ ] Every statement describes implemented behavior or is labeled as a known gap.
- [ ] Each contract has an enforcement link and at least one focused test link.
- [ ] README, contributor guidance, operation rules, and architecture status do not contradict it.
- [ ] Proposed work remains in this plan, not the current contract.

**Verification:**

- Run Prettier on changed Markdown.
- Search for the stale `Actions` exception and schema-version-1 claims.
- Review links from a clean checkout path.

### Task 3: Isolate file-adapter state when the remote target changes

**Size:** Small to medium

**Dependencies:** None; may run independently of Tasks 1–2

`FileBasedSyncAdapterService` currently keys long-lived revision/cache maps by provider ID. A WebDAV or local-file configuration can point the same provider ID at another remote target while the singleton adapter survives.

Start with a failing regression test that changes the configured target on the same adapter instance.

Prefer the smallest safe fix:

1. explicitly clear target-scoped cached revision/cursor state and require a full remote read when the target configuration changes;
2. introduce a stable target identity only if an explicit reset cannot be made correct.

Never place credentials, encryption keys, or raw secret-bearing URLs in an identity, log, or persistent cache key. Do not change the public provider interface unless the regression proves it necessary.

**Acceptance criteria:**

- [ ] State learned from target A cannot suppress reads or writes for target B.
- [ ] Switching targets forces safe discovery/full-read behavior.
- [ ] Reusing the same target retains existing revision optimizations.
- [ ] Split migration, tombstones, pending-revision promotion, backup recovery, and delete ordering remain unchanged.

**Verification:**

- Add the red/green target-switch regression to the file adapter specs.
- Run the focused file-adapter and wrapped-provider specs.
- Run `npm run checkFile` for every changed TypeScript file.

### Phase 0 checkpoint

Do not start orchestration work until:

- the semantic rollback is green;
- the current contract has no proposed behavior in it;
- the target-switch regression passes; and
- the production diff is materially smaller than the baseline.

## 7. Phase 1 — Make the existing browser policy atomic

### Task 4: Hold an exclusive page-lifetime Web Lock

**Size:** Medium

**Dependencies:** Phase 0 checkpoint

Extend `LockService` with the narrow primitive needed by startup and acquire an exclusive, page-lifetime application-instance lock before data-bearing initialization.

For browsers with Web Locks:

- request the lock with `ifAvailable`;
- signal startup as soon as the callback receives a non-null lock;
- keep the callback pending for the page lifetime;
- release on unload/teardown;
- treat failure to acquire as authoritative and show the existing multi-instance blocker.

Do not await the lifetime request itself from startup; it resolves only when ownership ends.

Keep BroadcastChannel detection for supported old clients and browsers without Web Locks. When Web Locks are available, the lock is the authority and BroadcastChannel is only compatibility/notification. Electron and native platforms retain their process-local behavior.

Expose only the reliability fact later maintenance needs: whether cross-tab ownership is guaranteed. Do not add owner IDs, heartbeats, generations, cross-tab busy states, or retries.

**Acceptance criteria:**

- [ ] Two simultaneous current browser tabs result in exactly one app initialization.
- [ ] A second tab fails quickly instead of waiting to become active behind the first.
- [ ] Closing/crashing the owner permits a later tab to initialize.
- [ ] A current client and an old BroadcastChannel-only client still detect each other where the old protocol permits.
- [ ] Missing Web Locks uses the existing fallback for ordinary startup but is reported as unreliable ownership.
- [ ] Electron and native startup behavior is unchanged.

**Verification:**

- Unit-test acquired, unavailable, release, and missing-API paths.
- Read `e2e/CLAUDE.md`, then extend the existing multi-tab E2E for simultaneous and sequential startup.
- Run the focused startup/lock specs, E2E, and required `checkFile` commands.

**Stop condition:** If a supported browser cannot provide atomic ownership and BroadcastChannel cannot exclude a simultaneous startup, do not invent a distributed lease in this plan. Document that browser limitation and keep destructive maintenance fail-closed there.

### Phase 1 checkpoint

Stress simultaneous startup before relying on the single-tab invariant. No later task may claim cross-tab safety from the BroadcastChannel timeout alone.

## 8. Phase 2 — Collapse background sync paths

### Task 5: Add a background-only coalescer

**Size:** Small

**Dependencies:** Task 4

Add the smallest background entry point around normal full sync. Its complete state machine is:

- `idle`: start one background full sync;
- `running`: set `dirty`;
- completion with `dirty`: clear it and run once more;
- completion without `dirty`: return to `idle`.

Further triggers during the trailing run may set `dirty` again, but there is never more than one pending rerun.

Keep this entry point fire-and-forget. It must not accumulate result waiters or presentation state. Preserve the exact foreground `SyncWrapperService.sync()` result/error semantics and keep initial-sync bookkeeping in `SyncEffects`.

The resume/visibility suppression window must still open synchronously at the existing trigger boundary, before debounce and before the coalescer.

**Acceptance criteria:**

- [ ] A burst while idle starts one full sync.
- [ ] Any burst while running causes one pending rerun, not one run per event.
- [ ] A failure still permits the dirty rerun and leaves the coalescer idle afterward.
- [ ] Foreground/user-triggered sync behavior is unchanged.
- [ ] No cross-tab state, waiter list, retry timer, or new result type is added.

**Verification:**

- Unit-test idle, burst, dirty-rerun, repeated-dirty, and failure paths with deferred promises.
- Run focused sync-wrapper/effects specs and required `checkFile` commands.

### Task 6: Make WebSocket events notification-only

**Size:** Medium, deletion-heavy

**Dependencies:** Task 5

Keep the WebSocket connection, authentication, and notification transport. Replace its download-only lifecycle with a request to the background coalescer, retaining only the useful debounce/event budget.

Delete `WsTriggeredDownloadService` and its duplicated validation, conflict, apply, cursor, provider-status, and cycle-guard policy.

**Acceptance criteria:**

- [ ] A valid WebSocket notification requests full sync through Task 5.
- [ ] Bursts remain bounded.
- [ ] Authentication/terminal connection errors retain their existing handling.
- [ ] Piggyback, validation, conflict, cursor, and status behavior come only from full sync.
- [ ] The download-only service and its production references are gone.

**Verification:**

- Update WebSocket trigger tests to assert notification-to-background-sync behavior.
- Run focused WebSocket, sync-wrapper, and operation-sync specs.
- Run required `checkFile` commands.

### Task 7: Make persisted local operations trigger full sync

**Size:** Medium, deletion-heavy

**Dependencies:** Task 6

After the existing two-second persistence debounce, request background full sync. Delete `ImmediateUploadService` and its upload-only validation, piggyback, conflict, cursor, status, and retry lifecycle.

One extra HTTP round trip is an acceptable simplification cost. Do not re-create upload-only behavior inside the coalescer.

**Acceptance criteria:**

- [ ] Persisted local work requests full sync after the existing debounce.
- [ ] Bursts are coalesced and no local operation is silently ignored because a run was already active.
- [ ] Piggybacked remote operations follow the normal full-sync ordering contract.
- [ ] The immediate-upload service and its production references are gone.
- [ ] Removing the side path does not delay durable local operation capture behind a long-lived sync or maintenance lock.

**Verification:**

- Update local-operation trigger tests for debounce, burst, running, and failure behavior.
- Run focused capture, upload/piggyback, conflict, sync-wrapper, and effects specs.
- Run required `checkFile` commands.

### Task 7 cleanup: remove obsolete cycle policy only when proven unused

After Tasks 6–7, delete `SyncCycleGuardService` only if:

- production references are zero;
- full sync cannot re-enter through another public path; and
- session validation still has exactly one top-level owner.

Otherwise retain it and record the remaining owner. Do not contort code merely to satisfy a deletion target.

### Phase 2 checkpoint

Before maintenance work:

- WebSocket and local-operation events both reach normal full sync;
- foreground sync tests are unchanged;
- no partial-sync service owns validation/status/cursor policy; and
- the phase deletes substantially more production code than it adds.

## 9. Phase 3 — Narrow in-tab maintenance correctness

### Task 8: Replace flag-and-poll exclusion with one exclusive boundary

**Size:** Medium

**Dependencies:** Phase 2 checkpoint

Replace the check-then-set behavior in `runWithSyncBlocked()` with one exclusive in-tab boundary shared by:

- normal foreground/background sync entry;
- force/maintenance sync entry; and
- encryption maintenance.

Use the existing lock infrastructure and one lock name. Keep UI status signals as observations, not ownership authority. Activate the new boundary for all remaining entry points in the same change; do not leave a mixed flag/lock state between commits.

Do not make optimistic local operation capture acquire this long-lived boundary. Capture remains protected by the short operation-log critical section.

**Acceptance criteria:**

- [ ] Sync and maintenance cannot pass a check-then-set race.
- [ ] A maintenance operation waits for active sync and prevents a new sync until it ends.
- [ ] Foreground operations receive their current result/error behavior.
- [ ] No nested acquisition occurs in force/encryption paths.
- [ ] Operation capture remains durable while sync is running.

**Verification:**

- Write deferred-promise tests for both race directions, failure release, timeout policy, and operation capture.
- Run sync-wrapper, encryption, force-upload, capture, and lock specs.
- Run required `checkFile` commands.

### Task 9: Keep each dataset replacement workflow inside the boundary

**Size:** Medium; split by caller family if more than five production files change

**Dependencies:** Task 8

Inventory the production callers of `BackupService.importCompleteBackup()`. Acquire the maintenance boundary at the workflow owner, after user confirmation and before the final mutable preflight.

The JSON file-import workflow must keep both backup import and import-encryption handling inside one acquisition. Nested persistence helpers continue to use the short operation-log lock and must not reacquire the maintenance boundary.

Wrap other caller families only with a failing concurrency test or a demonstrated path to overlap with sync. Make each additional family a focused follow-up rather than broadening the common abstraction.

When reliable browser ownership from Task 4 is unavailable, destructive replacement must fail before mutation. Electron/native remain protected by their single-instance plus in-process boundary.

**Acceptance criteria:**

- [ ] No sync can begin between JSON state replacement and its encryption/server-reset handling.
- [ ] User confirmation occurs before acquiring the boundary; mutable preflight is repeated after acquisition.
- [ ] No prompt occurs after destructive mutation begins.
- [ ] E2EE server-restore prohibitions fail before local or remote mutation.
- [ ] The workflow has one maintenance owner and no nested maintenance acquisition.
- [ ] Backup atomicity, recovery, and clean-slate ordering remain unchanged.

**Verification:**

- Add a red/green JSON import-versus-sync concurrency test.
- Test unavailable reliable ownership, cancellation, encryption failure, and release on error.
- Run focused file-import, backup, encryption, sync-wrapper, and lock specs.
- Run required `checkFile` commands.

## 10. Deferred compatibility work

No compatibility deletion is authorized by this plan.

| Surface                             | Keep now | Reconsider only when                                                                                     |
| ----------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| Split-file read/write/migration     | Yes      | The minimum supported client can read the chosen successor and rollback no longer requires split writes. |
| Single-file/tombstone readers       | Yes      | Remote-format telemetry is not required; use an explicit support/version policy and fixture audit.       |
| Native persistence transition paths | Yes      | SQLite migration and rollout are complete, downgrade behavior is decided, and recovery fixtures pass.    |
| Operation/schema migrations         | Yes      | No supported client or stored backup can emit the old form.                                              |

Existing split-format tests already cover migration/tombstones, pending-revision promotion, backup recovery, and delete ordering. Do not add a second characterization suite unless it exposes a missing contract.

## 11. Reassessment gate

After Phase 3, collect:

- production lines and services deleted versus added;
- remaining independent sync lifecycle owners;
- remaining branches in `SyncWrapperService`, `OperationLogSyncService`, and `FileBasedSyncAdapterService`;
- focused and full-suite failures;
- performance/network impact of full sync for former partial triggers; and
- unsupported-browser behavior.

Only then decide whether another extraction is justified.

A new abstraction is allowed only when it:

1. has at least two concrete current consumers;
2. removes more state and policy than it adds;
3. preserves the contracts in Section 4;
4. has a migration and rollback story; and
5. can be reviewed as a behavior-neutral change.

## 12. Approval and commit boundaries

Approve work in tranches:

1. Tasks 1–3;
2. Task 4;
3. Tasks 5–7;
4. Tasks 8–9.

Stop after each checkpoint for review. Do not combine phases into one pull request.

Suggested commit boundaries:

1. `refactor(sync): remove unreleased conflict review flow`
2. `docs(sync): define current sync contract`
3. `fix(sync): reset file state when remote target changes`
4. `fix(startup): make browser single-instance ownership atomic`
5. `refactor(sync): coalesce background full-sync requests`
6. `refactor(sync): route websocket events through full sync`
7. `refactor(sync): replace immediate upload with full sync`
8. `fix(sync): serialize sync and maintenance atomically`
9. `fix(sync): keep import and encryption maintenance atomic`

Each implementation commit must contain its focused tests. Every modified TypeScript or SCSS file must pass `npm run checkFile <filepath>`.
