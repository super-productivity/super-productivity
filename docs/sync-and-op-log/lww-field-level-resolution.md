# Design note: LWW resolutions that carry only the fields that must win

**Status:** proposal, 2026-09-30. Nothing here is implemented. @johannesjo
decides (see [Decisions](#decisions-for-johannesjo)). Tracker: #10393, queue
item 1. Findings: #10382.

## Problem

After a conflict the winning device uploads a replace-mode `[X] LWW Update`
that carries its whole entity. Every receiver replaces the entity with it, so a
concurrent edit of a field the winner never touched is erased. The same
resolution also drops the loser's edits when the remote side wins. The fuzz
harness and E2E reproductions trace these issues to it:

- **#10379** (class `whole-entity-lww-drops-fields`): habit counts, note locks,
  done status and tracked time erased everywhere.
- **#10260** (class `remote-win-keeps-local-edit`): the losing device keeps
  its rejected edit, which never uploads.
- **#10385** (unreleased, since #10252): the snapshot is read before the same
  download's commuting ops apply, so it erases them on the other device.
- **Part of the tracked-time loss** (#10378, #10257): a delta becomes an
  absolute value in a snapshot, or is rejected with its side.

## How it works today

All in [`conflict-resolution.service.ts`](../../src/app/op-log/sync/conflict-resolution.service.ts)
unless noted.

1. `autoResolveConflictsLWW` first calls `_resolveConflictsWithLWW`, which
   builds every resolution op. Only after that are the batch's non-conflicting
   remote ops appended and applied in one batch. Anything the resolution reads
   from the store is therefore pre-batch (#10385).
2. `_resolveConflictsWithLWW` plans winners through sync-core's
   `planLwwConflictResolutions`, then tries `_tryCreateDisjointMergeOp` per
   conflict. It refuses the merge when:
   - an entity has more than one conflict in the batch;
   - the plan is a delete or archive plan, or a remote op is multi-entity;
   - the type has no [`RECREATE_FALLBACK`](../../src/app/op-log/core/recreate-fallback.const.ts)
     entry (NOTE, METRIC, TASK_REPEAT_CFG, ISSUE_PROVIDER);
   - either side holds an additive time op (`isAdditiveTimeOp`, #10147);
   - `isDisjointMergeEligible` fails
     ([`conflict-disjoint-merge.util.ts`](../../src/app/op-log/sync/conflict-disjoint-merge.util.ts)):
     an opaque op on either side (`isOpaqueChangeOp`: habit count
     `setSimpleCounterCounterToday`, auto-add `planTasksForToday`), a
     multi-entity op, or both sides writing the same field.
3. A merge emits one `lwwUpdateMode: 'patch'` op. Its delta comes only from
   the two sides' ops (`synthesizeMergedChanges`), never from the store. Both
   originals are rejected and the patch is applied locally and uploaded.
4. Otherwise, when the local side wins, `_createLocalWinUpdateOp` reads the
   entity from the store and emits `createLWWUpdateOp(..., 'replace')`. It
   carries a merged, incremented clock and the local max timestamp. Time
   fields go out as absolute values; `foldSyncTimeSpentDeltas`
   ([`fold-sync-time-spent.util.ts`](../../src/app/op-log/sync/fold-sync-time-spent.util.ts))
   is used only by the bulk reconciliation path.
5. Sync-core's `partitionLwwResolutions`
   ([`packages/sync-core/src/conflict-resolution.ts`](../../packages/sync-core/src/conflict-resolution.ts))
   rejects **all local ops of every conflict, whoever wins**. The remote win
   applies the remote ops, which are usually partial, so a local-only field
   edit stays in local state and never uploads (#10260).
6. `isCommutingTimeDeltaCrossing` treats a time delta crossing a disjoint edit
   as no conflict at all. That is why #10385's notes edit bypasses step 1's
   snapshot.
7. Receivers apply the op in
   [`lwwUpdateMetaReducer`](../../src/app/root-store/meta/task-shared-meta-reducers/lww-update.meta-reducer.ts):
   - `'replace'` becomes `setOne` (omitted fields are dropped);
   - `'patch'` (or no mode) becomes `updateOne` (omitted fields are kept);
   - an absent entity becomes `addOne`, backfilled from `RECREATE_FALLBACK`
     when the type has an entry, otherwise raw;
   - for tasks, the reducer keeps project, tag and Today lists in step. There
     is no note equivalent for `note.todayOrder`.
8. The wire envelope, `LwwUpdatePayload`, is in
   [`packages/sync-core/src/operation.types.ts`](../../packages/sync-core/src/operation.types.ts):
   `actionPayload`, `lwwUpdateMode`, `recreatesEntityAfterDelete`,
   `projectMoveFootprint` and `clearedFields`. Its flat `actionPayload` reads
   as opaque to `extractOpChanges`, so a resolution op that meets another
   concurrent edit always falls back to whole-entity LWW.

## Options

### A. Field patch: generalize the disjoint merge to overlapping fields

Build every update-vs-update resolution as the merge builds it today:

- **Delta:** the union of both sides' changed fields, read from their ops.
- **Overlapping fields:** a field both sides wrote takes the winner's value.
  The tiebreak must be one both devices compute identically, like
  `noiseTiebreakSide`.
- **Emitted op:** one `'patch'` with a dominating clock, applied locally and
  uploaded. The loser's other fields upload too, so this covers both
  directions.

Three pieces are needed next to lifting the overlap refusal:

1. **Aggregate per entity:** fold all of one entity's conflicts in a batch into
   one side each, instead of refusing.
2. **Keep time deltas out of the patch:** apply remote deltas, and re-emit a
   rejected local delta as a new `syncTimeSpent` op. This is option C, and A
   needs it: #10385's local side holds a delta.
3. **Optionally admit NOTE:** add a `RECREATE_FALLBACK` entry, plus
   `todayOrder` upkeep in `lwwUpdateMetaReducer`.

| Fixes                                                                             | Does not fix                                                                                                 |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **#10385**, structurally: no store snapshot, so nothing is read too early         | Opaque single-entity ops: habit count (pins "habit count lost to a rename", "habit rename loses to a count") |
| **#10379** overlap cases: pin "done status is lost when both devices also rename" | Multi-entity ops: `planTasksForToday` blocks the task pin of #10260 and #10378's non-time fields             |
| **#10379** time pin, with pieces 1 and 2                                          | Deletes and archives: they stay on their own paths                                                           |
| **#10260** and **#10379** note pins, only with piece 3                            | A second concurrent edit against the patch: still whole-entity LWW (step 8)                                  |
| The **#10260** remote-win direction, for readable fields                          | Released devices that resolve the conflict themselves (see compatibility)                                    |

### B. Keep replace, but build the snapshot correctly

Keep `_createLocalWinUpdateOp`'s full snapshot and fix what goes into it:

- build it after the batch's non-conflicting ops apply;
- overlay the remote side's readable fields that the local side did not write;
- fold the remote `syncTimeSpent` deltas in with `foldSyncTimeSpentDeltas`.

A variant applies the losing remote ops first and re-writes the local winner's
fields on top. That also keeps opaque remote ops such as a habit count, but it
briefly puts remote values into the local store.

| Fixes                                                                                           | Does not fix                                                                                         |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **#10385**                                                                                      | **#10260**: nothing changes on the remote-win side                                                   |
| The local-win half of **#10379**, including notes: a full snapshot needs no `RECREATE_FALLBACK` | A third device's concurrent edit: a whole snapshot still erases it                                   |
| Time in the local-win direction                                                                 | Staggered-sync divergence of untouched fields, the reason `synthesizeMergedChanges` avoids snapshots |

**Cost:** the local-win op is persisted today in one atomic append before the
batch applies. Building it afterwards needs a second write after the apply, and
a crash window between them that hydration must replay the same way.

### C. Carry time as a delta, never as an absolute value in a resolution

- No resolution may drop a `syncTimeSpent` delta.
- Remote deltas always apply.
- A rejected local delta is re-emitted as a new `syncTimeSpent` op with a
  merged clock. It is never applied locally, since the local reducer is a
  no-op for it.
- A replace snapshot that must stay folds the remote deltas in.

| Fixes                                                                                                      | Does not fix                                                             |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Tracked-time loss in #10379 (pin "tracked time is lost to a later concurrent rename")                      | Every non-time field                                                     |
| **#10378**, independent of `planTasksForToday`'s opacity (pin "two devices tracking one unscheduled task") | The per-day `s`/`e` work times on `TIME_TRACKING` (#10382, low severity) |

**#10257** (per-device counters) needs checking against the implementation;
this note does not claim it.

## Released clients and graceful degradation

Checked with `git show v18.15.0:` and `git show v19.1.0:` on
`lww-update.meta-reducer.ts`, `operation-converter.util.ts`,
`conflict-resolution.service.ts`, `conflict-disjoint-merge.util.ts`,
`task.reducer.ts` and sync-core's `operation.types.ts`.

| Payload                                                                      | v18.15.0 to v18.21.1                                                                                                   | v18.22.0 to v19.1.0 | master                                 |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------- |
| A: `'patch'`, entity present                                                 | `updateOne`, like today's merges (v18.15.0 already emits `'patch'`)                                                    | same                | same                                   |
| A: `'patch'` with a cleared field                                            | clear is a no-op: `clearedFields` is ignored (#9776)                                                                   | clear applied       | clear applied                          |
| A: `'patch'`, entity absent on the receiver (it applied a concurrent delete) | `addOne`: TASK, PROJECT, TAG and SIMPLE_COUNTER are backfilled; NOTE is added raw and fails validation, so REPAIR runs | same                | same, unless the fix adds a NOTE entry |
| B: `'replace'`                                                               | `setOne`, unchanged wire                                                                                               | same                | same                                   |
| C: re-emitted `syncTimeSpent`                                                | additive for remote ops, same reducer                                                                                  | same                | same                                   |
| Unknown key beside `actionPayload`                                           | dropped                                                                                                                | dropped             | dropped                                |

What the table means for each option:

- **No new marker, no schema bump (rule 10).** `lwwUpdateMode: 'patch'`
  already is the inert marker every release honours. No option adds a wire
  key, action type or persisted field.
- **The fix only acts where the resolving device runs it.** A v19.1.0 device
  that resolves a conflict still emits today's replace snapshot. Mixed fleets
  keep today's loss in that case, and nothing worse by code reading. The harness
  cannot run v19.1.0, so a mixed-fleet double resolution (both devices resolve
  the same conflict) is unverified.
- **NOTE is the only released-client hazard.** It is why admitting NOTE is a
  separate decision: a released receiver that applied a concurrent note delete
  recreates a partial note (the #10380 shape).

**Feature review guide, long-term cost:**

- **Persisted model:** unchanged. A NOTE `RECREATE_FALLBACK` entry adds a
  default, not a field.
- **Sync wire:** `LwwUpdatePayload`, `action-types.enum.ts` and
  `action-type-codes.ts` are unchanged. The existing `'patch'` and
  `syncTimeSpent` shapes are reused.
- **Plugin API:** untouched.
- **Maintenance:** A removes the snapshot path's special cases and extends the
  existing generic path, which fits rule 12. B adds ordering machinery to a
  service that is grandfathered far past the 1200-line cap, a cap that may
  only shrink. C adds one re-emit rule.

## Fuzz pins and E2E proof

Pin outcomes are expected by code reading and not yet run. Each fix PR turns
its pins into regression pins and must leave every other pin unchanged,
including #10380's and #10381's.

| Pin (`sync-fuzz-pinned-traces.json`)                        | A (pieces 1 and 2) | A + NOTE                          | B            | C          |
| ----------------------------------------------------------- | ------------------ | --------------------------------- | ------------ | ---------- |
| done status lost when both devices rename                   | fixed              | fixed                             | fixed        | —          |
| tracked time lost to a later concurrent rename              | fixed              | fixed                             | fixed        | fixed      |
| note lock lost to an unpin; note content loses to an unpin  | —                  | fixed, if `todayOrder` is handled | lock only    | —          |
| habit count lost to a rename; habit rename loses to a count | —                  | —                                 | variant only | —          |
| two devices tracking one unscheduled task (#10378)          | —                  | —                                 | —            | time fixed |
| task rename loses to tracking (#10260)                      | —                  | —                                 | —            | —          |

**E2E first** (AGENTS.md "Reproduce first", rule 12: both conflict directions,
both timestamp winners):

- **#10385:** `e2e/tests/sync/supersync-commuting-edit-beside-local-win.spec.ts`
  on branch `ccr-211e334d-0r60po`. It is `test.fixme` and red 4 of 4, and
  queue item 2 ports it.
- **#10379:** needs new specs.
  - Done status plus concurrent renames: the task path, a local-win direction.
  - Tracked time against a later rename.
  - Note lock against an unpin, if NOTE is admitted.
- **#10260:** needs new specs for the remote-win direction. Use the note
  content pin's steps if NOTE is admitted, and a task case with readable
  fields otherwise.
- **#10378:** the pin's steps, two browsers tracking one Inbox task.
- **Must stay green:**
  - `supersync.spec.ts` "3.1 Concurrent disjoint task edits merge";
  - `supersync-lww-conflict.spec.ts`;
  - `supersync-time-delta-rename-crossing.spec.ts`;
  - `supersync-time-tracking-advanced.spec.ts`;
  - `supersync-round-time-conflict.spec.ts`;
  - `supersync-simple-counter-lww-type.spec.ts`;
  - `supersync-clear-field-9776.spec.ts`.

## Recommendation

**Option A, including C's delta handling, delivered in steps.** A extends the
existing generic path instead of adding per-action logic (rule 12). It is the
only option that fixes both conflict directions, and it removes the store read
behind #10385 rather than reordering it. Its payload is one every release since
v18.15.0 applies as a merge. B is the fallback if only the smallest change for
#10385 is wanted, but it leaves #10260 and third-device erasure.

1. **PR 1:** admit overlapping readable fields, aggregate per-entity conflicts,
   and keep deltas out of the patch (re-emit rejected local deltas).
   - Proof: #10385's E2E and a new #10379 task E2E.
   - Expected pins: "done status…" and "tracked time lost to a later rename".
   - This replaces a separate targeted fix for #10385 (queue item 3).
2. **PR 2:** time deltas survive regardless of merge eligibility (#10378).
3. **PR 3, only if decided:** admit NOTE.

Opaque ops (habit count, `planTasksForToday`) stay out of scope. Each needs a
per-action field contract, which is the last resort under rule 12, so they
wait for evidence.

## Decisions for @johannesjo

1. **Direction:** A, B, or neither? If A, does #10385 ship as PR 1 of this
   design rather than as a separate targeted fix?
2. **Overlap tiebreak:** today's winner is sync-core's planner. A field both
   sides wrote needs a tiebreak both devices compute identically. Is the
   `(timestamp, clientId)` order of `noiseTiebreakSide` acceptable for real
   fields?
3. **NOTE:** admit it, accepting that a released device which applied a
   concurrent note delete recreates a partial note that REPAIR must fix? Or
   keep notes on whole-entity LWW until v19.1.0 leaves the fleet?
4. **Resolution ops as input:** should a later conflict read a `'patch'`
   resolution op's `actionPayload` as field changes (step 8)? That changes the
   no-re-merge contract in
   [conflict-journal-and-review.md](./conflict-journal-and-review.md).
5. **Opaque ops:** confirm that habit counts and `planTasksForToday` stay on
   whole-entity LWW for now.
