# Sync Architecture Review: Why Every Fix Is Expensive

**Status:** Proposal for discussion — nothing here is accepted. · **Date:** 2026-09-26
**Baseline commit:** `6169df9e9` (`origin/master`)
**Question:** Did the sync architecture go in the wrong direction? Could we throw
away half of it?
**Scope:** client op-log (`src/app/op-log/`), `packages/sync-core`,
`packages/sync-providers`, `packages/shared-schema`, `packages/super-sync-server`,
sync UI (`src/app/imex/sync/`), and the sync-facing meta-reducers.

## 1. Verdict

Mostly no — with one important exception.

- **Sound, keep:** the op-log itself (persistent actions captured into a
  durable log; snapshot plus tail replay; provider adapters), end-to-end
  encryption, the providers, and the server's auth/quota/transport work. Most of
  that code would exist under any design.
- **The wrong turn:** _how devices converge_. An operation is a replayed
  **intent** (an NgRx action whose reducers and meta-reducers decide at apply
  time which entities change). Convergence, however, works **per declared
  entity**: vector-clock conflict detection per entity id, whole-entity
  last-write-wins (LWW) resolution, whole-op accept/reject, and the winner
  re-expressed as an entity snapshot. The declared entity ids do not match
  what the reducers write, so every multi-entity action that can meet a
  concurrent edit needs hand-written compensation or it stops sync.
  This mismatch is the single largest source of fix code (§2.2) and it is
  open-ended: it grows with the number of multi-entity actions.
- **Half?** Not by deletion. Inside the current model almost every piece holds
  something else up (the July simplification plan kept nearly everything for
  that reason). Deleting dead, dormant and duplicated code is worth
  **~7–10k production lines**. Replacing the conflict model (§5, Phase 3) and
  consolidating persistence (§5, parallel track) could remove roughly
  **another 8–12k** over time, plus most of the ~27k lines of conflict unit
  tests. That is roughly a third of the client op-log, not half — and not in
  one go.

## 2. Evidence

All numbers are production lines (non-spec `.ts`, plus `.html` where noted)
measured on `6169df9e9`; method in Appendix A. Treat categorisations as
approximate.

### 2.1 Size and growth

| Area                                                      | Production lines | Test lines |
| --------------------------------------------------------- | ---------------: | ---------: |
| `src/app/op-log/` (excluding `testing/`)                  |           50,145 |   ~125,000 |
| `packages/sync-core` + `sync-providers` + `shared-schema` |           13,246 |     14,186 |
| `packages/super-sync-server/src`                          |           13,856 |    ~45,800 |
| `src/app/imex/sync/` (`.ts` + `.html`)                    |            9,315 |     13,261 |

- The client op-log alone is about twice the whole tasks feature
  (`src/app/features/tasks/`, 23,709 lines) and about a fifth of all production
  TypeScript in `src/app/`.
- Five of the eight services grandfathered over the 1,200-line service cap in
  `eslint.config.js` are sync services: `conflict-resolution` (4,817),
  `file-based-sync-adapter` (3,356), `operation-log-store` (3,212),
  `operation-log-sync` (2,704) and `sync-wrapper` (2,085).

Growth of `src/app/op-log/` on the mainline (first-parent snapshots, excluding
specs and `testing/`):

| Date  | 2026-01-15 |  03-01 |  05-01 | 06-01\* |  07-01 |  08-01 |  09-26 |
| ----- | ---------: | -----: | -----: | ------: | -----: | -----: | -----: |
| Lines |     24,142 | 29,685 | 30,924 |  28,867 | 30,364 | 46,266 | 50,145 |

\* The 06-01 snapshot follows the May extraction of sync-core/sync-providers
into `packages/` (+10.1k lines there).

`conflict-resolution.service.ts` grew from 1,104 lines (2026-07-01) to 4,144
(07-21) and 4,825 (08-16). The two weeks of 2026-07-06 to 07-20 added
~17.9k production lines across the sync folders — about a third of all
growth since the op-log merge.

### 2.2 Where the fix lines went

689 fix commits touched the sync folders between the op-log merge
(2026-01-11) and the baseline. Each was given one primary root cause (regex
rules plus a manual read of all subjects and the ~60 largest diffs):

| Root cause                                                    | Fixes | Net prod lines | Test lines added |
| ------------------------------------------------------------- | ----: | -------------: | ---------------: |
| **Multi-entity / intent conflict resolution**                 |    51 |     **+7,437** |      **+23,900** |
| Client persistence, hydration, compaction, crash atomicity    |    37 |         +3,750 |          +10,467 |
| SuperSync server (61 of these are deploy/monitoring, 0 lines) |   136 |         +3,680 |          +17,987 |
| Full-state ops: imports, clean slate, first sync, USE_REMOTE  |    47 |         +3,467 |          +10,799 |
| File-provider consistency (ETag, `.bak`, split files, gaps)   |    38 |         +2,466 |           +7,075 |
| Encryption                                                    |    58 |         +2,397 |           +5,334 |
| Schema, migration, legacy data                                |    36 |         +1,915 |           +2,736 |
| Provider auth, transport, platform                            |    59 |         +1,738 |           +3,498 |
| Everything else (replay determinism, orchestration, UI, …)    |   227 |         +7,881 |          +24,665 |
| **Total**                                                     |   689 |    **+34,731** |     **+106,461** |

- Fixes are 62% of all sync growth since the merge (features 25%).
- Commits that _shrank_ sync code removed ~5.8k lines in total, against
  ~62k added by commits that grew it.
- Of the 45 largest fixes (+16.3k lines), 27 (+10.9k) came from audit findings
  and hardening passes, 11 (+4.0k) from user reports, 7 unclear.

### 2.3 Anatomy of the conflict engine

About 62% (~3,000 lines) of `conflict-resolution.service.ts` is compensation
for the granularity mismatch rather than generic LWW:

| Part                                                                                                                                                                               |                       ≈ Lines |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------: |
| Generic LWW core: detection, frontier, op factory, persist/apply                                                                                                                   |                         1,430 |
| One multi-entity op, per-entity winners: mixed-winner compensation, the fail-closed gate, Today/planner re-placement, `roundTimeSpentForDay` splitting, narrowed bulk replacements |       1,130 (+451 in helpers) |
| Delete/archive vs update: cascades, recreating deleted entities and relationships, delete-wins, restore                                                                            |                         1,390 |
| Field merge layered on whole-entity LWW: disjoint-field merge, #9073 arrival-order crossings                                                                                       |             460 (+417 helper) |
| Commuting exemptions (sections, time deltas)                                                                                                                                       | 25 (+~850 in section helpers) |
| Other (E2EE footprint auth, banner/journal hooks, dead helpers)                                                                                                                    |                           345 |

The same compensation leaks into `lww-update.meta-reducer.ts` (1,017 lines, of
which ~435 rebuild project/tag/Today/parent relationships that the original
action's reducer would have maintained) and `bulk-archive-filter.util.ts`
(re-implements what the delete/archive reducers do).

### 2.4 The class keeps coming back

- **Fail closed:** 26 action creators declare several entity ids; only 10
  have a resolution path in `_assertMultiEntityPlansAreSafe`
  (`conflict-resolution.service.ts:2532`). The rest throw
  `UnsupportedMultiEntityConflictError` when they meet a concurrent edit,
  which stops sync until the user replaces all data on one side.
- **Users hit it repeatedly,** each time for another action type: #9405 and
  #9426 (Today planning), #9537 (End-of-day archive), #9601
  (`roundTimeSpentForDay`), #9768 and #10102 (`moveToArchive`, again after the
  earlier fixes). Each fix extended an allowlist or added a resolution path.
- **The reorder actions are next** — reproduced in this review, see §6.
- **Decisions already made around the same cause:**
  - ADR #5: an atomic `completeProject` op needed ~1,565 lines of conflict
    machinery for one action and was reverted;
  - ADR #7: the delete-wins marker exists because an entity-level LWW cannot
    undo the `deleteProject` cascade;
  - the disjoint-field merge exists because whole-entity LWW threw away
    concurrent edits to different fields (#9095);
  - section commutativity and the #9073 crossing logic exist because
    concurrent ops that do not commute were applied in different orders on
    different devices.

## 3. Root causes

### 3.1 Intent ops, entity-level convergence (primary)

What an operation _declares_ and what its reducers _write_ differ
(verified examples):

| Action                         | Declares                              | Actually writes                                                                                    |
| ------------------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `deleteProject`                | the project                           | the project, its tasks, notes, sections, repeat configs, archive data                              |
| `moveToOtherProject`           | the root task                         | the task tree and both projects' `taskIds`                                                         |
| `updateNoteOrder`              | every reordered **note**              | `project.noteIds` (a **project**) or `note.todayOrder`                                             |
| `addTagToTask`                 | `[taskId, tagId]`, both typed as TASK | the task and the tag                                                                               |
| any task move / plan / reorder | the moved tasks                       | derived lists: project/tag `taskIds`, Today order, `planner.days`, `subTaskIds`, `section.taskIds` |

Consequences:

1. A conflict on one declared entity rejects or keeps the whole op, but the
   op's effects on other entities have to be rebuilt by hand
   (`lww-update.meta-reducer.ts`, compensation ops) — or the resolver fails
   closed.
2. Conflicts are detected on entities the op does not touch (`updateNoteOrder`
   vs a note content edit, §6) and missed on entities it does touch (its
   write to `project.noteIds`).
3. Ops that do not conflict by declared id are applied local-first on each
   device, so two devices apply the same concurrent pair in different orders.
   Replicating operations converges only when concurrent operations commute
   (the op-based CRDT requirement); reducers do not commute in general (lists,
   cascades, derived fields). The code already says so at
   `conflict-resolution.service.ts:4452` (#9073): a blind apply "would let
   ARRIVAL ORDER decide the winner … and permanently diverge".

Either every non-commuting pair of actions gets classified and resolved by
hand (open-ended: grows with actions × actions), or every device applies
operations in one agreed order.

### 3.2 Live state versus the log (persistence)

Reducers run before an op is durable, and snapshots
(`state_cache.current`, compaction) are copied from live NgRx state rather than
derived from the log. A stack of guards exists only to prove that live state
equals a log prefix: #8469, #8751, #9084, #9140, #9438, the deferred-action
buffer and cooldowns. On top of that there are 9 client-side snapshot
mechanisms and 6 separate "replace the whole state" paths, each with its own
transaction, validation and recovery-point policy (12 bespoke transaction
variants in `operation-log-store.service.ts`).

### 3.3 Repair is a synced full-state op

`REPAIR` is uploaded like an import. That needed a causal sub-protocol
(`repairBaseServerSeq`, stale-repair rebase, incoming-repair deferral) and
produced #9773 (an incoming repair opened the import dialog and could discard
local work) and the deferred-repair livelock fixed in PR #9795. The whole-state healers it runs
(`data-repair.ts` 1,601 lines, `is-related-model-data-valid.ts`,
`auto-fix-typia-errors.ts`) predate the op-log; they were built for whole-file
sync.

### 3.4 Partial server emulation on file storage (secondary)

File providers emulate a cursor, retention and compare-and-swap, but not
piggybacked ops, per-op acceptance or full-state op identity. Each missing
property surfaced later as a bug fixed with a local guard (the #10119 /
#10226 / #10239 / #10256 family). Two file formats are live (v2 single file,
opt-in v3 split), so several fixes exist twice and have already drifted
(retry de-duplication exists only in v3). This costs ~4.7k lines — real, but
much smaller than §3.1, and unifying the provider paths would not reduce the
conflict engine.

### 3.5 Process: hardening without an observed failure

27 of the 45 largest fixes came from audit findings. Two audit-driven guards
caused user regressions: `_assertMultiEntityPlansAreSafe` (#8944, no
confirmed scenario) wedged sync for #9405/#9426/#9537 and took seven follow-up
fixes; the E2EE tamper checks locked a user out (#9256). The rules added in
`CLAUDE.md` ("hardening needs an observed instance"; an E2E reproduction for
every sync fix, `6169df9e9`) address exactly this.

## 4. Where this review disagrees with `operation-log-architecture.md`

`operation-log-architecture.md` rejects server-assigned ordering because it
"requires server connectivity for ordering — incompatible with offline-first
and file-based providers that have no server". Two points in that premise do
not hold up:

- **Offline edits do not need a position in the order until they upload.**
  At upload they are rebased on top of what arrived meanwhile — which the same
  section lists as a requirement ("rebase offline edits cleanly on
  reconnect").
- **Both transports already have an order.** SuperSync assigns `serverSeq`
  ("a total order within one user's current sync dataset",
  `packages/super-sync-server/docs/architecture.md`). Dropbox, OneDrive and
  strong-ETag WebDAV writes are compare-and-swap, so the file's op list is
  linear; each op carries the `sv` of the upload that wrote it. LocalFile and
  weak-ETag WebDAV are best-effort today and would stay so.

The field guide's own summary — "Sequence orders delivery; clocks prove
causality" — describes the situation: the order exists but is only used for
delivery. Vector clocks came in June 2025 for the old whole-file sync, where
comparing two whole-state versions is exactly their job; the op-log kept them
and moved detection down to individual entities.

## 5. Proposal

### Phase 0 — Stop the generator (no code)

Proposed contributor rules (for the maintainer to adopt or reject; this plan
does not edit `CLAUDE.md`):

1. No new per-action special case in `ConflictResolutionService`. A
   multi-entity conflict bug is fixed by making the action declare what it
   writes, making its reducer total, or routing it through an existing generic
   path. The existing size ratchet on the file stays; a fix that must add lines
   removes more elsewhere in the conflict area.
2. New synced actions are single-entity, or declare exactly the entities their
   reducers write.
3. No new kind of synced full-state operation.

### Phase 1 — Delete what is dead, dormant or duplicated

| Item                                                                                                                                                               |                                         ≈ Lines | Evidence                                                                                                            | Condition                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------: | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/pfapi/**/*.js` (compiled legacy JS, 4 files)                                                                                                              |                                           1,777 | imported nowhere (grep)                                                                                             | none                                                                                                                                                                                                                                                                                                                                               |
| Conflict journal + review UI/page/banner                                                                                                                           |                                          ~1,800 | switched off at its only caller (`remote-ops-processing.service.ts:516`); every journal write sits behind that flag | the freeze (#9061, `71a9a4338`) and the feature (`962c5bbeb`) first shipped together in v18.15.0, so no stable release wrote journal rows — only master/internal-track builds from 2026-07-11 to 07-16 could have. This corrects the premise banner of `2026-07-13-sync-simplification-plan.md`; decide whether those few rows need an export path |
| Concurrent-snapshot auto-merge branch (`_tryConcurrentSnapshotMerge`)                                                                                              |                                            ~110 | `AUTO_MERGE_CONCURRENT_SNAPSHOT: false` is a constant (`packages/sync-providers/src/file-based-sync-data.ts:224`)   | none                                                                                                                                                                                                                                                                                                                                               |
| `listFiles` in six providers                                                                                                                                       |                                            ~150 | no production caller                                                                                                | none                                                                                                                                                                                                                                                                                                                                               |
| `_syncVectorClockToPfapi`                                                                                                                                          |                                             ~30 | writes `pf.META_MODEL` before every non-SuperSync sync for a sync that no longer exists                             | confirm the one-time migration never re-runs                                                                                                                                                                                                                                                                                                       |
| Uncalled store methods (`clearFullStateOps`, `clearUnsyncedOps`, `filterNewOps`, `loadStateCacheBackup`, `incrementCompactionCounter`; `appendBatch` is test-only) |                                            ~200 | no production callers                                                                                               | none                                                                                                                                                                                                                                                                                                                                               |
| Test-only private helpers in `conflict-resolution.service.ts` (`_deepEqual`, `_extractEntityFromPayload`, `_extractUpdateChanges`)                                 |                                             ~35 | only reached from specs via `as any`                                                                                | none                                                                                                                                                                                                                                                                                                                                               |
| Dead service entry points `ProjectService.updateOrder`, `TagService.updateOrder`, `SimpleCounterService.updateAll`                                                 |                                             ~15 | no callers (the actions and reducers must stay: old ops still replay)                                               | none                                                                                                                                                                                                                                                                                                                                               |
| Inactive SQLite adapter                                                                                                                                            |                            ~1,100 (+1,600 spec) | the DB-adapter factory returns IndexedDB on every platform                                                          | ship behind a flag or park on a branch                                                                                                                                                                                                                                                                                                             |
| Duplicate WebSocket-download and immediate-upload pipelines                                                                                                        |                                            ~550 | Tasks 4–5 of `2026-07-13-sync-simplification-plan.md`                                                               | that plan's gates                                                                                                                                                                                                                                                                                                                                  |
| v2/v3 file-format duplication                                                                                                                                      | ~300 (factor out) or ~1,500 (retire one format) | fixes land twice and have drifted                                                                                   | decide the long-term format                                                                                                                                                                                                                                                                                                                        |
| Legacy pfapi → op-log migration and pre-v14 backup import                                                                                                          |                                          ~2,200 | still patched (#9808)                                                                                               | a sunset date plus an "import your JSON backup" message                                                                                                                                                                                                                                                                                            |

Total: roughly 7–10k production lines at low risk, the conditional items
included.

### Phase 2 — Decide the conflict rule (product decision)

Under a total order, a concurrent edit to the **same field** is won by the
edit that reaches the server (or the file) **last**, not by the newest
wall-clock timestamp. A device offline for a week would land its edits last
and overwrite newer edits to the same fields. That is the norm for this class
of app and removes clock-skew exposure, but it is a behavior change. If it is
unacceptable, the better target is per-field LWW (field-level timestamps),
not rebase — see Phase 3's kill criteria.

Edits to **different** fields both survive under a total order without any
merge code, which today needs the disjoint-field merge.

### Phase 3 — Rebase prototype (SuperSync only, behind a flag)

Goal: find out, cheaply, whether "apply every operation in the transport's
order; when remote ops arrive while local ops are pending, rewind the pending
ones, apply the remote ones, replay the pending ones through the real
reducers" can replace per-entity LWW resolution — without changing the wire
format or the server.

#### 3.1 Model

- **Confirmed state** = the confirmed baseline plus every confirmed op in
  `serverSeq` order (remote ops and this device's accepted ops alike).
- **Live state** = confirmed state plus the pending local ops, replayed in
  local creation order.
- A conflict is no longer detected or resolved; its outcome is whatever the
  reducers produce in that order. Policy (edit of a deleted entity, reorder
  listing a deleted id) lives in reducers.
- The no-pending path is unchanged: remote ops are applied as today.

#### 3.2 Confirmed baseline (new building block)

Today `state_cache.current` is copied from live state and includes pending
ops' effects (compaction reads `getStateSnapshotForOperationLog()`), so there
is no way to get back to "confirmed only". Add:

- an in-memory reference to the confirmed NgRx state object (structural
  sharing makes this almost free);
- a persisted `state_cache.confirmed` row
  `{ state, lastConfirmedServerSeq, lastAppliedOpSeq }` in the existing store
  (no `DB_VERSION` bump needed for a new key), written at the end of a sync
  that leaves nothing pending (confirmed equals live) and after each rebase;
- a compaction rule: never prune ops after the confirmed baseline.

This is also the persistence track's "checkpoint from the log" (§3.2), so the
work is not specific to the prototype.

#### 3.3 The rebase step

Where: `RemoteOpsProcessingService`, in place of "detect conflicts → LWW"
when the flag is on and the provider is SuperSync.

1. If nothing is pending, apply the remote ops as today.
2. `confirmed' = replay(confirmed, remoteOps)` — remote ops in `serverSeq`
   order, through the existing bulk-apply path (effects do not see it;
   capture does not record it).
3. `live' = replay(confirmed', pendingOps)` — same path; the ops stay pending.
4. Install `live'` with one non-persistent dispatch (a `rebaseState` action
   handled by a meta-reducer, like `loadAllData`).
5. Persist: remote ops marked applied, `state_cache.confirmed = confirmed'`.
6. Upload the pending ops with clocks that dominate everything received
   (reject-and-replace with the same payloads, as
   `_recreateOpWithMergedClock` does today). The server's unchanged
   per-entity check then sees `GREATER_THAN`. If another device uploaded in
   between and the server rejects, repeat download → rebase → upload, bounded
   (for example three attempts), then fall back to today's path.
7. Piggybacked ops with a lower `serverSeq` than this device's accepted ops
   are rebased the same way, so this device ends in server order too.

#### 3.4 Fallbacks during the prototype

Use today's LWW path, and log a counted reason, when:

- a pending op has archive side effects (`moveToArchive`, restore, archive
  flush) — the archive lives in IndexedDB outside NgRx and cannot be rewound;
- a full-state op is involved (imports, `REPAIR`) — the existing import gate
  keeps handling those;
- there is no confirmed baseline yet (first sync after upgrading);
- replaying a pending op throws (the reducer-failure guard reports it).

#### 3.5 Reducer requirements (an explicit prototype task)

- **Total:** handle missing references (task in a deleted project, reorder
  listing a deleted id).
- **Deterministic:** no `Date.now()` or randomness in reducers (already
  required for replay).
- **Derive cascades from state, not from payload snapshots:** `deleteProject`
  (`allTaskIds`, `noteIds`), `moveToArchive` (task trees), `planTasksForToday`
  (id lists), and reorders that replace a list verbatim —
  `updateNoteOrder` sets `noteIds: ids`, which would drop a note added
  concurrently on another device. The audit lists every such action; each is
  fixed or becomes a fallback.

#### 3.6 Mixed fleet

There is no desktop auto-updater, so released clients stay for years.

- Rebasing clients keep stamping vector clocks, so released clients keep
  working as today.
- Released clients' LWW resolutions arrive as ordinary ops; a rebasing client
  applies them in server order.
- Rebased uploads dominate everything their author saw, so a released client
  classifies them as `GREATER_THAN` unless it has its own concurrent pending
  op — then it resolves as today and its resolution op is again ordered.
- Expected: new ↔ new converge by construction; old ↔ new converge whenever
  the old client's resolution is expressed as an op; old ↔ old unchanged.
  This is a hypothesis to prove, not a result.

#### 3.7 Acceptance criteria

- Every `@supersync` E2E passes with the flag on.
- `e2e/tests/sync/supersync-reorder-conflict-wedge.spec.ts` and
  `src/app/op-log/testing/integration/reorder-conflict-wedge.integration.spec.ts`
  pass with the flag on (enable the pending tests).
- New E2Es converge with the flag on: concurrent edits to different fields of
  one task (#9095 shape); `deleteProject` against a task added to that project
  elsewhere; Today planning against a rename.
- A mixed-fleet E2E (reusing the `COMPAT_OLD_ASSETS` / `COMPAT_NEW_ASSETS`
  harness of `supersync-released-client-compatibility.spec.ts`, with v19.1.0
  as the old build) converges for the same scenarios.
- Rebase latency with 500 pending ops on a 10k-task state is measured on a
  mid-range Android device.
- Every fallback reason seen in the E2E run is counted and explained.

#### 3.8 Kill criteria

- The mixed-fleet E2E shows a divergence that does not occur with the flag
  off.
- Making reducers total and state-derived needs semantic changes in more than
  about ten reducers — the cost would move rather than disappear.
- Rebase latency is unacceptable on Android at realistic pending counts.
- Phase 2 rejects arrival-order semantics.

#### 3.9 What it would remove if adopted (estimates)

- Most compensation and special cases in `conflict-resolution.service.ts`
  (~3k of 4.8k lines) and its helpers (disjoint merge, most of section
  commutativity, partial-plan preservation, bulk-archive intent handling).
- `superseded-operation-resolver.service.ts` (602) and most concurrency paths
  of `rejected-ops-handler.service.ts`.
- Most of the ~27k lines of conflict unit tests.
- Roughly 5–8k production lines client-side. `lww-update.meta-reducer.ts` and
  the server's per-entity conflict query must stay as long as released
  clients write LWW ops.

#### 3.10 Also unlocks

The rebase step is the mechanism #9773 found missing: "apply the repair, then
re-apply this device's pending unsynced ops … needs a mechanism that does not
exist yet (ordering, archive side effects, ops whose target the repair
removed)". With it, an incoming `REPAIR` can honour the contract
`SyncImportFilterService` already documents (concurrent work replays on top)
instead of being deferred. `SYNC_IMPORT` and `BACKUP_IMPORT` keep dropping
concurrent work by design (sync rule 7).

### Phase 4 — Staged retirement (only if Phase 3 passes)

1. Flag on for SuperSync on `master` (Play internal track, Snap `edge`) and
   watch the fallback counters.
2. Remove LWW resolution for SuperSync on current clients; keep the LWW
   _reader_ for released clients' ops.
3. File providers with compare-and-swap (Dropbox, OneDrive, strong-ETag
   WebDAV): rebase onto the file's ops before every write. The uploader's
   embedded snapshot then always includes the ops it writes, which closes the
   #10256 class by construction. LocalFile and weak-ETag WebDAV stay
   best-effort.
4. Vector clocks stay on the wire as long as any released client can read the
   data; they stop being a conflict mechanism for current clients.

### Parallel track — Persistence consolidation

Independent of the conflict decision:

1. One `commitBaseline()` primitive (state, clock, applied-op ids and cursor in
   one transaction) for the six "replace the whole state" paths.
2. Snapshots derived from the log (the confirmed baseline of §3.2) instead of
   copied from live state; then retire the guards that only prove live state
   equals a log prefix, one at a time, each with its E2E.
3. Evaluate repair as a local, read-time normalization instead of a synced
   `REPAIR` op. Caveat: repair logic differs between app versions, so a local
   normalization must be safe when two versions disagree — the reason it is
   synced today.

## 6. Bugs found during this review

### Bug 1 — Reordering notes, habits, boards or sections stops sync (reproduced)

- **What:** a pending reorder (`updateNoteOrder`, `updateSimpleCounterOrder`,
  `sortBoards`, `updateSectionOrder`) meets a concurrent edit of any
  reordered entity from another device, or the other way round.
  `_assertMultiEntityPlansAreSafe` has no path for these multi-entity ops and
  throws `UnsupportedMultiEntityConflictError`; sync stops. v18.15.0 to
  v19.0.1 show "Sync stopped for safety … report this code"; v19.1.0 (#10140)
  adds "Resolve…", and a manual sync opens the whole-dataset "Keep local /
  Keep remote" dialog.
- **Shipped:** every release from v18.15.0 to v19.1.0 (`git tag --contains
5e754d355`).
- **Evidence:** `e2e/tests/sync/supersync-reorder-conflict-wedge.spec.ts`
  (notes, real SuperSync server, `test.fixme`) and
  `src/app/op-log/testing/integration/reorder-conflict-wedge.integration.spec.ts`
  (all four reorders plus the remote-reorder direction for notes, `xit`). All
  fail on `6169df9e9` with, for example,
  `SYNC_MULTI_ENTITY_UNSUPPORTED side=local actionType=[Note] Update Note Order entityCount=2`.
- **Not affected:** `updateProjectOrder` and `updateTagOrder` have the same
  shape but no caller today.
- **Issue:** _to be filed_.

### Bug 2 — File-sync upload writes a stale snapshot (already filed)

An upload that merges versions it never downloaded embeds this device's own
state as the file snapshot, while `recentOps` also carries the merged ops; a
device bootstrapping from seq 0 then marks every op as already applied
(`_buildMergedSyncData`, `snapshotAppliedOpIds`). Already filed as #10256.

### Suspected — Superseded multi-entity op re-issued for its first entity only (not reproduced)

`SupersededOperationResolverService` groups replaced ops by `op.entityId`
(`superseded-operation-resolver.service.ts:436-530`). A rejected multi-entity
op other than `moveToArchive` or a section op is therefore re-issued as an LWW
snapshot of its **first** entity, and its effects on the other entities never
reach other devices. Only reached after a server rejection, an empty download
and a forced full download; not reproduced, so documented here only.

### Checked and dropped

The REPAIR op append and the state-cache save run in separate transactions
(`repair-operation.service.ts:93-110`). A crash between them is harmless: the
REPAIR op carries the full state and replays on restart.

### Test-infrastructure gap

`SuperSyncPage.syncAndWait()` and `triggerSync()` resolve the whole-dataset
conflict dialog with **Keep remote** on their own (`_handleSyncDialogs`,
step 2, called from `_waitForSyncCompletion`). Since #10140 (`355d845c9`,
2026-09-18) a manual sync that hits `UnsupportedMultiEntityConflictError`
opens that dialog; before, it left sync in an error state and the helper threw.
So the `@supersync` suite no longer fails loudly on this class —
`supersync-round-time-conflict.spec.ts` still names "syncAndWait fails" as its
detection mechanism. Proposed: fail the helper when the dialog was opened by
this error, unless the test opts in. **Issue:** _to be filed_.

## 7. Open questions for the maintainer

1. Is "last to reach the server wins" acceptable for same-field conflicts
   (Phase 2)? This gates Phase 3.
2. Conflict journal: only master/internal-track installs from 2026-07-11 to
   07-16 can hold rows. Drop them, or keep a one-off export path?
3. v2 or v3 as the long-term file format?
4. SQLite: ship behind a flag or park?
5. A sunset date for the legacy pfapi migration?
6. Priority against feature work: Phases 0–1 are cheap; Phase 3 is a
   multi-week prototype with a clear kill switch.

## Appendix A — How the numbers were measured

- Line counts: `wc -l` over non-spec `.ts` files (plus `.html` for
  `src/app/imex/sync/`), excluding `testing/` where stated, at `6169df9e9`.
- Growth: first-parent mainline snapshots
  (`git rev-list --first-parent -1 --before=<date> origin/master`).
- Fix categories: `git log --numstat` over the sync folders
  (`src/app/op-log`, the four sync packages, `src/app/root-store/meta`,
  `src/app/imex/sync`), non-merge commits after the op-log merge
  (2026-01-11); duplicate cherry-picks removed. Production lines exclude specs,
  tests, `testing/`, docs, scripts and vendored code. Each fix has one primary
  category; categories are fuzzy at the edges (archive can be conflict or
  persistence, encryption can be imports).
- Conflict-engine anatomy and the essential-versus-accidental split come from
  reading line ranges; treat them as ±10%.

## Appendix B — Confidence

- **Verified in code or by running:** §2.1, §2.4, the declared-versus-written
  table, the Phase 1 evidence column, bug 1 (Karma and E2E), bug 2 (code read,
  and filed by the maintainer as #10256).
- **Estimates:** §2.2 categories, §2.3 anatomy, every "≈ lines" figure, and all
  Phase 3 savings.
- **Hypotheses to test:** §3.6 mixed-fleet convergence and the Phase 3
  performance budget.
