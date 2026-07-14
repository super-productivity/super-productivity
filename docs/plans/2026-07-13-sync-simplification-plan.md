# Sync Simplification Plan

**Status:** Rebased and revised after three independent safety, compatibility, execution, and cost-benefit reviews; amended 2026-07-14 after a code-verified audit of every factual claim (four parallel code reviews)

**Date:** 2026-07-14

**Baseline commit:** b3d8c74257a957a7e3404836bd3bb0a8deb985e4

**Scope:** Conflict-review behavior, file-provider target state, and duplicate SuperSync trigger pipelines

## 1. Outcome

Delete sync lifecycle policy only where a smaller path preserves persisted-data compatibility, provider eligibility, and notification delivery.

The smallest safe order is:

1. audit builds that received the conflict-review feature and freeze the schema-v3 compatibility boundary;
2. fix file-provider state crossing remote-target changes;
3. add one background full-sync scheduler that cooperates with every existing full-sync owner;
4. route SuperSync WebSocket and eligible local-operation triggers through it;
5. delete the duplicated partial download/upload pipelines only after focused behavior and request-cost gates pass;
6. remove only the conflict-review producers and UI that the deployment/persisted-data audit proves disposable;
7. correct current sync documentation after behavior settles.

**Timing constraint:** the conflict-review feature (962c5bbeb1, merged 2026-07-11) is on master but in no release tag, and releases ship every one to two weeks. Every stable release cut before Task 6 expands the persisted-data obligation from edge/dogfood cohorts to the whole fleet. If the Task 1 audit authorizes deletion, land a minimal producer freeze — stop conflict-journal writes and disable the disjoint-merge producer — before the next release cut, ahead of Phase 1. The freeze is a small reversible diff; the full rollback (Task 6) then proceeds on its own schedule.

Atomic browser startup and replacement of flag-and-poll maintenance exclusion remain worthwhile correctness projects, but they are not prerequisites for deleting the two partial SuperSync pipelines. Keeping them separate avoids turning a bounded simplification into a cross-tab/bootstrap and every-import-owner rewrite.

## 2. Removal verdict

| Surface                                                                       | Verdict                                      | Cost-benefit conclusion                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema v3, v2-to-v3 barrier, IndexedDB version 10, and replace/patch readers  | **Keep**                                     | Removing them can reject stored operations or silently diverge. Their maintenance cost is tiny relative to data-loss risk.                                                                                                                                                                                                                              |
| Disjoint-merge planner/writer                                                 | **Conditional removal; high benefit**        | Removing the experimental producer reduces conflict states. Keep both payload readers because deployed non-stable builds and persisted providers may already contain patch operations.                                                                                                                                                                  |
| Conflict journal writer and review UI/route/banner/badge                      | **Conditional removal; high benefit**        | No stable tag contains the feature, but master edge artifacts, Android internal builds, and previews may contain device-local discarded values. Task 1 decides the supported-data obligation.                                                                                                                                                           |
| Conflict journal database/reader                                              | **Keep until the data obligation expires**   | It may hold the only copy of discarded values. A temporary read/export path is cheaper than silently stranding supported data.                                                                                                                                                                                                                          |
| Flip-specific capture/replay handling                                         | **Nothing to remove**                        | Flip dispatches an ordinary synced entity update. Remove UI references only, never generic update capture/replay.                                                                                                                                                                                                                                       |
| File-target state leak                                                        | **Fix now; high value**                      | This is a contained correctness issue that can cause cross-target reads or writes. It is not counted as simplification.                                                                                                                                                                                                                                 |
| WebSocket partial-download pipeline                                           | **Remove; allow a thin adapter**             | It duplicates the orchestration shell (session boundary, provider resolution, error-to-status mapping, cursor gate, cycle-guard claim); apply/conflict already delegate to the shared download core, and it never publishes IN_SYNC. A small high-watermark/retry/auth adapter may remain when it is safer than inventing a scheduler outcome protocol. |
| ImmediateUploadService                                                        | **Conditional removal; likely high benefit** | Normal full sync can replace it under the exact stable SuperSync eligibility policy. File providers must never inherit the trigger.                                                                                                                                                                                                                     |
| SyncCycleGuardService                                                         | **Keep in this roadmap**                     | Full sync and force upload still use it. Removal belongs to a later exclusion-boundary project after all references move.                                                                                                                                                                                                                               |
| Flag-and-poll maintenance exclusion                                           | **Worth fixing separately**                  | The same-tab check-then-set race is real, but migrating sync, encryption, imports, restore, profile switch, and undo is a larger correctness project, not a deletion prerequisite.                                                                                                                                                                      |
| Page-lifetime Web Lock                                                        | **Worth a separate startup proposal**        | It improves current/current startup but cannot make an old client acquire the lock, adds bootstrap/fallback states, and deletes no sync path.                                                                                                                                                                                                           |
| Full enforcement/test matrix document                                         | **Do not add now**                           | It creates another truth surface during active changes. Correct false claims now; consolidate current contracts after implementation.                                                                                                                                                                                                                   |
| Split-file, tombstone, migration, native-transition, and older-schema readers | **Keep**                                     | Retirement conditions are not met; payoff is low and recovery/downgrade risk is high.                                                                                                                                                                                                                                                                   |

The previous broad “remove roughly 6,000 lines together” decision is rejected. Schema-v3 and multi-entity recovery follow-ups now share that area. Compatibility readers and unrelated data-loss fixes must be fenced explicitly.

## 3. Contracts that every slice preserves

1. One user intent creates one durable operation. Remote or replayed operations do not re-trigger local effects.
2. Remote operations are durable before reducer application. Apply status, vector-clock merge, archive completion, and downloaded cursor retain crash-safe ordering.
3. Resume/visibility suppression opens synchronously before debounce or lock acquisition.
4. One validation session owns nested download, piggyback, conflict, and apply work. No caller publishes IN_SYNC before classification.
5. Normal and compensation operations retain full client clocks until server comparison. Approved bounded pruning remains capped at 20 clients.
6. A receiver stops at the first unsupported, newer, invalid, or migration-failing operation and advances only through the valid prefix.
7. Schema-v3 replace-mode and patch-mode LWW operations remain distinguishable and replayable. Version and IndexedDB downgrade barriers remain.
8. Raw rebuild resumes before ordinary sync; reducer-pending work blocks sync.
9. Import/rebuild retain preflight-before-mutation, backup, atomic replacement, cursor, and crash-resume ordering.
10. Encryption fails closed. Operation metadata and isPayloadEncrypted are not authenticated policy inputs.
11. File revisions remain staged until durable apply and cursor commit. Delete-all ordering across split, tombstone, and backup artifacts remains.
12. Pending local writes flush before the conflict frontier is read. Conflict planning/execution remain inside the operation-log critical section.
13. SuperSync conflict prefetch and per-user lastSeq reservation stay in one transaction; clean-slate replacement preserves monotonic lastSeq.
14. Piggybacked operations apply before corresponding local entries are marked synced.
15. A compatibility reader is deleted only after its explicit support condition is true.

## 4. Success criteria

- [ ] Schema v3, its migration/downgrade barrier, and replace/patch replay remain readable from every supported persisted path.
- [ ] Target-A operations cannot read, upload, delete, back up, or repopulate state for target B, including after restart.
- [ ] A background request arriving during foreground, initial, background, or maintenance work is retained and drained by exactly one pending owner.
- [ ] WebSocket delivery retains a sequence high-watermark, bounded transient retry, cursor-based completion, and terminal authentication behavior.
- [ ] Persisted local operations request full sync only under the current non-file operation-sync provider policy.
- [ ] File providers receive no new automatic I/O.
- [ ] The partial WebSocket download pipeline and ImmediateUploadService disappear only after focused replacement tests and the request-cost gate pass.
- [ ] Conflict-review producers/UI disappear only to the extent authorized by the deployed-build and persisted-data audit.
- [ ] Conflict-journal and disjoint-merge producers stop writing before the first stable release that would otherwise ship them, or the audit explicitly accepts shipping and the expanded data obligation.
- [ ] No public provider protocol, server contract, persistence repository layer, cross-tab lease, or general error taxonomy is introduced.
- [ ] Each deletion slice removes more production state/policy than its replacement adds.

Line count is evidence, not the goal. A phase succeeds only when it removes behavioral states and failure paths without removing a required reader or guarantee.

## 5. Non-goals

- A new sync-engine package or host-port abstraction.
- CRDTs, timestamp last-write-wins, or full-state-only sync.
- New operation strings, schema versions, encryption envelopes, or server exchanges.
- An acknowledgement-only upload protocol.
- A universal queue with foreground result waiters or presentation state.
- More aggressive file-provider auto-sync.
- A cross-tab lease, owner heartbeat, or generation protocol.
- Failing closed for core offline import/profile workflows merely because Web Locks are unavailable.
- Splitting ConflictResolutionService only to reduce file length.
- Characterization tests that bless a known divergence.

If a task requires one of these, stop and write a separate behavior proposal with migration and rollback analysis.

## 6. Phase 0 — Establish the compatibility and provider boundary

### Task 1: Audit deployed builds and persisted conflict data

**Size:** Small audit; blocks conflict-feature deletion

Record:

- every distribution channel containing commits at or after 962c5bbeb1, including master edge artifacts, Android internal builds, and previews;
- the stable baseline: v18.14.0 ships schema v2 and operation-log DB version 7; schema v3, the v2-to-v3 barrier, DB version 10, and the conflict-review feature are all unreleased and reach stable together in the next tag;
- whether those cohorts are supported/dogfood-only and what persisted-data promise applies;
- the representations supported cohorts can create: schema-v3 replace/patch operations in IndexedDB, file providers, backups, or SuperSync, plus the device-local conflict journal;
- the retention/export/deletion decision for journal rows containing discarded values.

Only after the cohort audit, add or retain persisted fixtures for representations reachable by supported builds. The audit may authorize removal of writers; it cannot authorize schema downgrade or reader removal while supported stored data remains possible.

**Acceptance criteria:**

- [ ] The master baseline is schema v3, not v2; the audit records that the deployed stable fleet stays v2/DB 7 until the next tag.
- [ ] The producer-freeze-before-next-release decision (see Outcome) is made explicitly.
- [ ] Supported and unsupported cohorts are an explicit product decision, not inferred from release tags.
- [ ] Journal rows have a documented read/export/expiry or deletion policy.
- [ ] Replace/patch fixtures cover each persisted path the supported-cohort audit proves reachable.
- [ ] Ordinary multi-entity recovery, live-versus-hydration, and transaction-rollback coverage is retained.

**Stop condition:** Do not begin conflict-feature deletion while a deployed cohort or persisted representation is unknown. Preserve the reader/UI needed to recover supported data.

### Task 2: Isolate file-provider state across target changes

**Size:** Medium correctness fix

Start with a failing test where target A has I/O in flight, configuration switches to B, and A would otherwise perform a later remote side effect using reloaded B configuration. Also recreate the adapter after the switch/crash to expose stale persisted provider-ID state.

Use the smallest conservative design:

1. serialize a file sync session and every authoritative target/configuration mutation behind one narrow target-transition boundary;
2. bind the session to one immutable provider/configuration snapshot;
3. increment one adapter-wide generation on any file-provider configuration save or LocalFile folder change;
4. clear all in-memory and persisted target-scoped revision, cursor, corruption, pending, and cache state;
5. validate the generation before every remote upload, delete, or backup side effect;
6. force discovery/full read after any configuration save.

Accept the extra full read even when the target is unchanged. Do not add stable target identities unless later profiling proves the optimization worthwhile. Never put credentials, keys, or raw secret-bearing URLs in an identity, log, or cache key; SuperSync's target-keyed cursor hashes baseUrl plus access token and must not be copied.

Three verified constraints on the design:

- The generation bump must also fire from the Electron LocalFile picker success callback: since #8228 the folder lives main-side, not in privateCfg, so config-store change events cannot observe it.
- "Any configuration save" includes encryption, compression, and interval toggles; each forces a full-file re-download, and a forced from-zero read with pending local operations can surface the whole-file conflict dialog. Accept and test this consequence; narrow the invalidation to identity-affecting fields only if it proves painful in practice.
- Reuse the existing delete-all state clearing in FileBasedSyncAdapterService as the clear primitive and providerConfigChanged$ as one trigger source.

Cover one normal configuration-driven provider plus Electron LocalFile's picker path, which bypasses ProviderManager. Also cover an OAuth re-authentication to a different account (Dropbox/OneDrive keep the same provider ID) and the within-cycle download cache, which can otherwise embed target A's snapshot in a file written to target B. The common adapter path should cover other file providers without a provider-specific test matrix.

**Acceptance criteria:**

- [ ] A late A operation performs no upload/delete/backup against B and cannot repopulate B state.
- [ ] Restart cannot reload A revision/cursor/cache state under B's provider ID.
- [ ] Normal configuration changes and LocalFile picker changes invalidate authoritatively.
- [ ] An account switch behind an unchanged provider ID invalidates like a target change.
- [ ] The within-cycle cache cannot carry target-A data into a target-B write.
- [ ] Every configuration save forces safe discovery/full read.
- [ ] Split migration, tombstones, pending-revision promotion, backup recovery, and delete ordering remain unchanged.

**Verification:** Run the focused adapter/provider/configuration tests and npm run checkFile for each modified TypeScript file.

**Stop condition:** If configuration cannot be snapshotted or target mutation cannot wait for the active file session, stop. A post-completion cache check cannot undo data already written to the wrong remote.

### Phase 0 checkpoint

The supported-data boundary is explicit and target-switch in-flight/restart regressions are green before deletion starts.

## 7. Phase 1 — Collapse partial SuperSync lifecycles

### Task 3: Add one background full-sync scheduler

**Size:** Medium

The scheduler observes all active full-sync runs, including foreground and initial sync; it cannot track only work it starts. SyncWrapperService.isSyncInProgress$ already observes every sync() run, so the new work is reconciling the four non-aligned busy signals — isSyncInProgress$ (excludes force upload), isEncryptionOperationInProgress (encryption and force upload), the provider manager's SYNCING status, and SyncCycleGuard.isActive (does not span conflict-dialog waits) — into one busy definition. The scheduler is the sole owner of generic pending/dirty background work. SyncCycleGuard remains authoritative for cycle exclusion.

Its public contract is fire-and-forget request(), with bounded idle/running/dirty state:

| Event                                                 | Transition                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------- |
| Eligible request while idle                           | Start one background full sync.                                     |
| Eligible request while any sync/maintenance is active | Set dirty; do not make a sync call that would return HANDLED_ERROR. |
| Run succeeds and dirty is clear                       | Return to idle.                                                     |
| Run succeeds and dirty is set                         | Clear dirty and run once more.                                      |
| Run fails with dirty clear                            | Return to idle; source-specific retry policy may request again.     |
| Run fails with dirty set                              | Drain one trailing run, then apply the same rules.                  |

Triggers during a trailing run may set dirty once again, but there is never more than one generic pending rerun.

Do not add foreground result waiters, presentation state, a public failure taxonomy, or cross-tab scheduler state. Preserve SyncEffects initial-sync bookkeeping and synchronous resume/visibility suppression at the existing trigger boundary. Initial and after-enable triggers stay on a directly awaited sync() call — SyncEffects flips initial-sync-done from that promise, and every afterInitialSyncDone-gated effect otherwise stalls to its timer fallback — so they must never route through fire-and-forget request().

**Acceptance criteria:**

- [ ] Requests during foreground, initial, background, or maintenance work drain afterward.
- [ ] Bursts have at most one pending rerun.
- [ ] Failure releases state; source-specific retry remains outside the generic scheduler.
- [ ] Foreground result/error and initial-sync behavior are unchanged.
- [ ] There is one generic dirty owner, not one in the scheduler and another in an exclusion service.
- [ ] One busy definition reconciles the four existing activity signals.

**Verification:** Unit-test idle, burst, external-busy, foreground overlap after download, maintenance overlap, dirty rerun, repeated dirty, failure, and release.

**Stop condition:** If direct foreground/initial runs cannot be observed, route their activity signal through the coordinator or defer Tasks 4–5. Never interpret HANDLED_ERROR as completed work; it is a truthy string, so a naive truthiness check reads it as success.

### Task 4: Make WebSocket events notification-only

**Size:** Medium, deletion-heavy

Keep the WebSocket connection/authentication transport and a thin notification adapter. A valid event records the maximum advertised sequence and requests Task 3 full sync.

The current pipeline already delegates download, conflict, and apply to the shared download core and never publishes IN_SYNC; the deletion target is its duplicated orchestration shell (session boundary, provider resolution, error-to-status mapping, cursor gate, cycle-guard claim). The second IN_SYNC owner is ImmediateUploadService, removed in Task 5. The transport keeps its own reconnect/backoff and terminal auth-close handling; the adapter's suspension must not duplicate it.

The adapter owns only:

- burst/event-budget protection;
- one sequence high-watermark;
- bounded delayed retry after transient failure or a successful sync whose durable downloaded cursor is still below the high-watermark;
- suspension on missing credentials or terminal authentication failure.

The high-watermark clears only after the durably committed cursor is greater than or equal to it. Generic full-sync success alone is insufficient. This is an intentional behavior correction: today a successful but paginated download drops the watermark without checking the cursor. Do not add a characterization test blessing the current lossy behavior.

Delete or shrink WsTriggeredDownloadService. Success means removing its direct download, validation, conflict, apply, cursor-commit, provider-status, and cycle-guard pipeline; the final thin adapter or filename may remain if that is the smallest reliable design.

**Acceptance criteria:**

- [ ] An event arriving after an active sync's download phase causes a trailing full sync.
- [ ] Success with cursor below the advertised sequence retains the high-watermark and schedules a bounded retry.
- [ ] Cursor at/above the sequence clears it.
- [ ] Transient failure retries are bounded; terminal auth failure suspends retries.
- [ ] Validation, conflict, apply, cursor commit, and provider status have one owner: normal full sync.

**Verification:** Cover busy arrival, cursor-below-watermark, bounded retry, and auth suspension with unit/integration tests. Add one opt-in live WebSocket E2E covering notification, durable cursor/replay, and restart; existing E2E defaults disable this path.

**Stop condition:** Keep a thin adapter if deleting it loses pending-event, cursor, retry, or auth semantics. Prefer one reliable path over a smaller lossy path.

### Task 5: Replace eligible immediate upload with full sync

**Size:** Medium, deletion-heavy

After the existing persistence debounce, split the current predicate into:

- stable eligibility: E2E block flag is false, client is online, and an active operation-sync-capable non-file provider exists;
- occupancy: the provider manager's active-sync signal plus the encryption-operation flag, which also covers force upload.

Stable ineligibility continues to skip. Occupancy becomes a Task 3 dirty request instead of dropping the trigger; this is the intentional behavior correction required to prevent lost local work during an active run.

Do not add a manual-only check in this refactor: ImmediateUploadService does not currently have one. A manual-only behavior change needs separate product approval and tests. Provider readiness remains checked before the full sync performs I/O. The two low-level upload calls below the wrapper (encryption password change and the import-conflict coordinator) are not triggers and stay where they are.

Delete ImmediateUploadService only after piggyback ordering and the request-cost gate pass. “One extra round trip” is not assumed because full download can paginate.

**Request-cost gate:**

- deterministically count provider requests for idle/no-backlog, local backlog, and one remote-backlog case;
- compare one debounced burst before and after;
- record the delta;
- run broader byte/latency/pagination benchmarks only if the focused bound exposes a material regression.

**Acceptance criteria:**

- [ ] Eligible SuperSync local work requests one burst-coalesced full sync.
- [ ] File-provider tests prove no new automatic I/O.
- [ ] Work persisted during another run is drained rather than ignored.
- [ ] Piggybacked operations apply durably before local entries are marked synced.
- [ ] The upload-only production pipeline and references are gone.

**Verification:** Cover stable eligibility, file-provider exclusion, foreground/maintenance overlap, piggyback ordering, and request counts with unit/integration tests. Extend the single live notification/restart E2E with one local append if practical. Run the scheduled SuperSync/WebDAV workflow.

**Stop condition:** Retain ImmediateUploadService if the focused request delta is unacceptable or stable provider eligibility cannot be preserved. Do not rebuild upload-only policy inside the scheduler.

### Phase 1 incidental deletions (verified zero or spec-only references)

Bundle these with the matching task; re-verify references at deletion time:

- SyncTriggerService's dead local-data trigger branch: `_onUpdateLocalDataTrigger$` is a constant `of(null)`, so its interval-reset branch fires once at startup and never again (Task 5).
- Legacy SyncStatus enum members UpdateLocalAll, Conflict, IncompleteRemoteData, and NotConfigured; the wrapper only returns InSync/UpdateRemote today (Task 3).
- The deprecated `skipDuringSync` alias of `skipWhileApplyingRemoteOps` (spec-only references).
- The write-only plain `isDataImportInProgress` field on ImexViewService; the observable stays.
- After Tasks 4–5 delete two of the three identical error-to-status mapping blocks, extract the survivor into a helper rather than leaving it inline.

### Phase 1 checkpoint

- WebSocket and eligible SuperSync local-operation events reach normal full sync without lost work.
- File providers have no new automatic traffic.
- Foreground and initial-sync semantics are unchanged.
- The live notification/restart E2E and scheduled SuperSync/WebDAV jobs pass.
- The phase deletes substantially more lifecycle policy than it adds.

## 8. Phase 2 — Remove proven-disposable conflict surfaces

### Task 6: Perform a focused conflict-review rollback

**Size:** Large deletion, gated by Task 1

Remove only what the supported-build/persisted-data decision authorizes:

- disjoint-merge planning/writing;
- conflict journal writing;
- review route/UI, banner, badge, navigation, and translations;
- journal persistence only after its read/export/expiry obligation ends.

Preserve:

- schema version 3 and its v2-to-v3 migration/barrier;
- IndexedDB version 10 downgrade protection;
- replace/patch payload types, conversion/replay, and supported persisted fixtures;
- ordinary single- and multi-entity conflict recovery;
- live-versus-hydration and transaction-rollback coverage;
- the legacy whole-file conflict dialog (DialogSyncConflictComponent under imex/sync), which predates the review feature and stays;
- unrelated fixes added after 962c5bbeb1.

There is no Flip-specific operation handler to remove. UI deletion must not touch generic entity-update capture/replay.

Known seams for the deletion diff: inside ConflictResolutionService the merge producer shares the recovery apply batch, checkpoint-exempt op IDs, the atomic mixed-source append, and the failed-merge fallback re-entry with the multi-entity recovery fix (#8990); review the diff against those seams specifically. The journal clearAll() hooks in OperationLogSyncService and BackupService stay wired while the reader/store stays and leave only with the store. The corruption-classification WeakSet side channel exists only for journal taxonomy and goes with the writer. Disjoint-merge eligibility is coupled to the recreate-fallback constants; the review-UI translations exist in en.json only.

If supported users can still have journal rows, first stop new writes and retain a read-only review/export path for the decided support window. Do not orphan or silently delete the only discarded values.

**Acceptance criteria:**

- [ ] Stored v3 replace/patch operations still download/replay from every supported backend.
- [ ] No schema downgrade, DB downgrade, or generic update removal appears in the diff.
- [ ] Ordinary conflict recovery and safety tests remain green.
- [ ] Removed UI/writers have zero production references.
- [ ] Journal DB deletion, if any, matches the approved data policy.
- [ ] The diff is reviewed against 962c5bbeb1 and current master so later fixes are not swept away.

**Verification:** Run focused conflict, capture/replay, persistence integration, migration, supported provider/server fixtures, the full unit suite, required checkFile commands, and a deletion-focused diff audit.

**Stop condition:** If a symbol is both a feature producer and compatibility reader, split the roles and keep the reader. If that cannot be done cleanly, keep the path rather than risk unreadable data.

## 9. Phase 3 — Consolidate documentation

### Task 7: Correct current documentation without a competing truth source

**Size:** Small to medium

Correct known false current-state claims, including schema v3 and the ALL_ACTIONS capture exception. After Tasks 3–6 settle, publish a short invariant index only if it replaces duplicated prose or clearly marks older architecture documents historical.

Do not add a mandatory enforcement/test matrix merely to satisfy this plan. Link focused enforcement/tests where they clarify a non-obvious invariant, and keep proposed behavior out of current-contract documentation.

**Acceptance criteria:**

- [ ] No current-status documentation claims schema version 1 or 2; historical migration documentation remains.
- [ ] Conflict-review behavior matches the final Task 6 decision.
- [ ] README, contributor guidance, operation rules, and architecture status do not contradict one another.
- [ ] There is one clearly identified current contract surface, not another coverage ledger.

**Stop condition:** If a new document would mostly duplicate maintained guidance, update and link the existing guidance instead.

## 10. Separate correctness proposals

These issues are real, but coupling them to the deletion roadmap worsens reviewability and rollback.

### A. Atomic current/current browser startup

A separate proposal should:

- acquire a page-lifetime Web Lock before DataInitService construction, hydration, or SUP_OPS open;
- prove the losing current tab never hydrates or captures;
- test simultaneous startup, owner close/crash, and later startup;
- retain early BroadcastChannel compatibility for old clients without claiming an old/current atomic guarantee;
- define supported behavior when Web Locks are unavailable.

This improves current/current ownership but does not make an old client participate. No sync simplification may claim mixed-version safety from this lock alone.

### B. Race-free sync and destructive-maintenance exclusion

First introduce a behavior-neutral coordinator backed by current flag/guard behavior. Route owner families through it in small commits while the old implementation remains the sole authority:

- normal and force sync;
- encryption enable/disable/password change;
- JSON import and local-backup restore;
- SuperSync restore;
- profile switching before its first mutation;
- undo/recovery replacement.

Only after no owner bypasses the coordinator should its internals switch to one exclusive boundary. Preserve foreground try-now semantics, at least the current 90-second maintenance wait, and already-owned internal helpers for nested force/conflict paths. JSON replacement and encryption/server-reset handling stay in one acquisition. Optimistic capture keeps its short operation-log lock.

When Web Locks exist, test two current clients even if startup detection races. For mixed old/current and unsupported browsers, state the remaining limitation; do not disable core offline workflows or claim a guarantee that the old client cannot honor.

SyncCycleGuardService can be deleted only after this project owns every cycle entry and production references are zero.

## 11. Deferred compatibility work

No compatibility deletion is authorized merely by completing this plan.

| Surface                                        | Keep now    | Reconsider only when                                                                                               |
| ---------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| Schema-v3 replace/patch readers and v2 barrier | Yes         | No supported client, provider, backup, or server row can contain the form and downgrade policy changes explicitly. |
| Split-file read/write/migration                | Yes         | Minimum supported clients read the successor and rollback no longer needs split writes.                            |
| Single-file/tombstone readers                  | Yes         | A support/version policy and fixture audit prove they are unreachable.                                             |
| Native persistence transition paths            | Yes         | SQLite rollout and downgrade decisions are complete and recovery fixtures pass.                                    |
| Conflict journal reader/store                  | Conditional | Task 1's supported-data retention/export obligation has ended.                                                     |
| SyncCycleGuardService                          | Yes         | Separate proposal B owns every entry point and references are zero.                                                |

## 12. Reassessment and approval

After each phase collect:

- production lifecycle owners and lines deleted versus added;
- remaining owners of validation, conflict, cursor, provider status, retry, and pending work;
- focused, full-suite, live-trigger, and scheduled E2E failures;
- deterministic provider request deltas;
- persisted-format/downgrade fixture results;
- consumer counts for SyncSessionValidationService and SyncCycleGuardService (Tasks 4–5 each remove consumers, strengthening proposal B);
- known cross-tab limitations.

Approve work in reviewable tranches:

1. deployed-build/persisted-data audit;
2. file-target isolation fix;
3. background scheduler;
4. WebSocket pipeline collapse;
5. eligible immediate-upload collapse after the request-cost gate;
6. focused conflict rollback after the data audit;
7. documentation consolidation.

Do not combine phases into one pull request. Keep the browser-startup and destructive-maintenance proposals outside these tranches.

Suggested commits:

1. docs(sync): audit conflict data compatibility
2. fix(sync): isolate state across file target changes
3. refactor(sync): coalesce background full-sync requests
4. refactor(sync): route websocket notifications through full sync
5. refactor(sync): replace eligible immediate upload with full sync
6. refactor(sync): remove disposable conflict review paths
7. docs(sync): consolidate current sync contracts

Every implementation commit contains focused tests. Every modified TypeScript or SCSS file passes npm run checkFile <filepath>. Run the scheduled SuperSync/WebDAV workflow for provider or trigger behavior changes.
