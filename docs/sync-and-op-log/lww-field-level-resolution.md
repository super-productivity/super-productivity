# Design note: LWW resolutions that carry only the fields that must win

**Status:** proposal, 2026-09-30. Nothing here is implemented. @johannesjo
decides (see [Decisions](#decisions-for-johannesjo)). Tracker: #10393, queue
item 1. Findings: #10382.

## Problem

After a conflict, the resolving device uploads a replace-mode `[X] LWW Update`
that carries its whole entity. Receivers replace the entity with it, which
erases a concurrent edit of a field the winner never touched. When the remote
side wins, the local side's edits are dropped instead. The fuzz harness and
E2E reproductions trace these issues to this:

- **#10379** (`whole-entity-lww-drops-fields`): habit counts, note locks, done
  status and tracked time are erased everywhere.
- **#10260** (`remote-win-keeps-local-edit`): the losing device keeps its
  rejected edit, which never uploads.
- **#10385** (unreleased, since #10252): the snapshot is read before the same
  download's commuting ops apply, so it erases them on the other device.
- **Part of the tracked-time loss** (#10378): a delta is rejected together with
  the side that lost.

## How it works today

All of this is in
[`conflict-resolution.service.ts`](../../src/app/op-log/sync/conflict-resolution.service.ts)
unless noted.

1. `autoResolveConflictsLWW` calls `_resolveConflictsWithLWW` first, and that
   builds every resolution op. Only afterwards are the batch's non-conflicting
   remote ops appended and applied, so any store read is pre-batch (#10385).
2. `_resolveConflictsWithLWW` plans the winners with sync-core's
   `planLwwConflictResolutions`, which uses the max timestamp and then the
   clientId of that op. It then tries `_tryCreateDisjointMergeOp`, which
   refuses:
   - more than one conflict per entity in the batch;
   - any delete, archive or multi-entity op;
   - a type without a
     [`RECREATE_FALLBACK`](../../src/app/op-log/core/recreate-fallback.const.ts)
     entry (only TASK, PROJECT, TAG and SIMPLE_COUNTER have one);
   - an additive time op (`isAdditiveTimeOp`, #10147);
   - a failed `isDisjointMergeEligible` check
     ([`conflict-disjoint-merge.util.ts`](../../src/app/op-log/sync/conflict-disjoint-merge.util.ts)):
     an opaque op (habit count `setSimpleCounterCounterToday`,
     `planTasksForToday`), a noise-only side, or a field both sides wrote.
3. A merge emits one `lwwUpdateMode: 'patch'` op whose delta comes only from
   the two sides' ops (`synthesizeMergedChanges`). This is why both resolvers
   build the same bytes. Both originals are rejected; the patch is applied
   locally and uploaded.
4. Otherwise a local win runs `_createLocalWinUpdateOp`:
   - It reads the store and emits a `'replace'` op. SIMPLE_COUNTER goes out as
     `'patch'` with `clearedFields` instead (`asPatchSnapshotIfTypeShadowed`).
   - `buildTimeAwareResolutionBatches`
     ([`fold-sync-time-spent.util.ts`](../../src/app/op-log/sync/fold-sync-time-spent.util.ts))
     folds the batch's non-conflicting and winning remote `syncTimeSpent`
     deltas into TASK snapshots.
   - The deltas of a remote side that **lost** are rejected, and their time is
     gone.
5. A second producer is `SupersededOperationResolverService`
   ([`superseded-operation-resolver.service.ts`](../../src/app/op-log/sync/superseded-operation-resolver.service.ts)).
   It rebuilds every server-rejected pending op, merged patches included, as a
   `'replace'` snapshot from the store. The pin "done status is lost when both
   devices also rename the task" runs through it.
6. Sync-core's `partitionLwwResolutions`
   ([`conflict-resolution.ts`](../../packages/sync-core/src/conflict-resolution.ts))
   rejects **every local op of every conflict, whoever wins**. A remote win
   applies the remote ops, which are usually partial. A local-only field edit
   therefore stays in local state and never uploads (#10260).
7. `isCommutingTimeDeltaCrossing` treats a time delta that crosses a disjoint
   edit as no conflict. That is how #10385's notes edit bypasses step 1.
8. Receivers apply the op in
   [`lwwUpdateMetaReducer`](../../src/app/root-store/meta/task-shared-meta-reducers/lww-update.meta-reducer.ts):
   - `'replace'` → `setOne`;
   - `'patch'` → `updateOne`;
   - an absent entity → `addOne` with the `RECREATE_FALLBACK` backfill. NOTE is
     added raw, and a marked `recreatesEntityAfterDelete` patch is ignored.
   - Tasks keep their project, tag and Today lists in step. Nothing keeps
     `note.todayOrder` in step.
9. The envelope is `LwwUpdatePayload`
   ([`operation.types.ts`](../../packages/sync-core/src/operation.types.ts)).
   Its flat `actionPayload` extracts as `{}`, so the merge sees a resolution op
   as opaque (the no-re-merge contract in
   [conflict-journal-and-review.md](./conflict-journal-and-review.md)).

## Options

### A. Field patch: generalize the disjoint merge to overlapping fields

- **Every update-vs-update resolution becomes a merge:** a `'patch'` that
  holds the union of both sides' fields as read from their ops.
- **A field both sides wrote** takes the value of the planner's winner, so no
  second tiebreak is needed.
- **The loser's other fields upload too,** so this covers both directions.

Its pieces:

1. **Allow overlap, and aggregate one entity's conflicts into one side each.**
   Two resolvers with staggered batches must provably build byte-identical
   patches, or equal-timestamp patches tie and diverge (why more than one
   conflict per entity is refused today). A both-devices-resolve test is
   required.
2. **Keep time out of the patch** (option C's rule).
3. **Route `SupersededOperationResolverService` through the same builder.**
   Otherwise a server-rejected patch comes back as a replace snapshot.

| Fixes                                                   | Does not fix                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **#10385**: no store snapshot                           | Opaque ops: habit counts, `planTasksForToday`                                  |
| **#10379** overlap cases: pin "done status…"            | Delete and archive paths                                                       |
| **#10379** time pin, through piece 2's re-emitted delta | #10260 for tasks: no reproduction of a readable-field remote win yet (rule 15) |

### B. Keep replace, but build the snapshot correctly

- Build the snapshot after the batch applies.
- Overlay the readable fields that only the remote side wrote.
- Fold in the losing remote deltas too.

| Fixes                                                                 | Does not fix                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **#10385**                                                            | **#10260**: nothing changes on the remote-win side                  |
| Local-win #10379 cases with readable remote fields, e.g. the done pin | A later resolver's snapshot that never saw the fields: the time pin |
|                                                                       | Staggered-sync divergence of untouched fields                       |

**Cost:** the local-win op is persisted today in one atomic append before the
apply. Building it afterwards needs a second write, and a crash window that
hydration must replay identically.

### C. Time: a delta travels once, as a delta or folded in, never twice

- **A replace snapshot:** carries absolute time with every surviving delta
  folded in, including a losing remote side's deltas, and re-emits nothing.
  Today the losing ones are missing.
- **A patch:**
  - omits the time fields;
  - applies the remote deltas;
  - re-emits a rejected local delta as a new `syncTimeSpent` op, which is not
    applied locally.
- **The re-emitted op must stay out of restart replay the way pending local
  deltas already do.** Hydration applies tail ops as remote, so it would add
  the time again.
- **Residual:** a released client's replace snapshot that wins still wipes the
  local time. The re-emitted delta then reaches everyone except this device.

| Fixes                                               | Does not fix                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| Time lost to a losing remote side                   | Non-time fields                                                            |
| **#10378** time, independent of `planTasksForToday` | Per-day work start and end times on `TIME_TRACKING` (#10382, low severity) |

### Independent of A and B: admit NOTE

- **Today's merge would fix both note pins** once NOTE has a
  `RECREATE_FALLBACK` entry (lock vs pin, content vs pin): their fields are
  disjoint.
- **A clean regression pin also needs `todayOrder` upkeep** in
  `lwwUpdateMetaReducer`. Otherwise `divergence:.note.todayOrder.*` stays.

## Released clients and graceful degradation

Checked with `git show v18.15.0:` and `git show v19.1.0:`.

- **Both tags:** `'patch'` → `updateOne`, `'replace'` → `setOne`, remote
  `syncTimeSpent` is additive, and unknown envelope keys are dropped.
  v18.15.0 already emits `'patch'` for merges.
- **No new wire key, action type or persisted field, and no schema bump
  (rule 10).**

**The hazards of sending a `'patch'` where a `'replace'` went before:**

1. **Clears.** v18.15.0 ignores `clearedFields`, and v19.1.0 applies it. The
   v18.22.0 boundary is from
   [contributor-sync-model.md](./contributor-sync-model.md#clearing-a-field--undefined-does-not-survive-the-wire-9776),
   not checked against a tag.
   - An older receiver keeps a stale value, e.g. a cleared `dueWithTime` or
     `reminderId`, where `setOne` cleared it.
   - This is the same documented residual as `asPatchSnapshotIfTypeShadowed`.
2. **Absent entity.** A receiver that applied a concurrent delete recreates
   the entity from the patch:
   - TASK becomes valid but content-less (defaults);
   - NOTE is added raw and invalid, so REPAIR runs (#10380 shape);
   - a replace would have recreated it fully.

   Recreate snapshots must stay `'replace'`, as `asPatchSnapshotIfTypeShadowed`
   already keeps them.

**The fix only acts where the resolving device runs it.**

- A v19.1.0 device that resolves a conflict still emits a replace snapshot.
- v18.15.0 and v19.1.0 lack the `isAdditiveTimeOp` refusal, so they can still
  merge a delta into a patch (#10147).
- A mixed fleet in which both devices resolve is unverified, because the
  harness can't run v19.1.0.

**Long-term cost (feature review guide):** persisted model, sync wire and
plugin API are unchanged. A extends the generic merge (rule 12). B adds
ordering machinery to a service grandfathered past the 1200-line cap.

## Fuzz pins and E2E proof

Expected outcomes are by code reading and have not been run. Each fix PR turns
its pins into regression pins and leaves all others unchanged, including those
of #10380 and #10381.

| Pin                                                         | A (pieces 1–3)                  | B                                | C          | NOTE admission                         |
| ----------------------------------------------------------- | ------------------------------- | -------------------------------- | ---------- | -------------------------------------- |
| done status lost when both devices rename                   | fixed                           | fixed                            | —          | —                                      |
| tracked time lost to a later concurrent rename              | fixed, via the re-emitted delta | —                                | with A     | —                                      |
| note lock lost to an unpin; note content loses to an unpin  | —                               | lock only; `todayOrder` diverges | —          | fixed, if `todayOrder` is kept in step |
| habit count lost to a rename; habit rename loses to a count | —                               | —                                | —          | —                                      |
| two devices tracking one unscheduled task (#10378)          | —                               | —                                | time fixed | —                                      |
| task rename loses to tracking (#10260)                      | —                               | —                                | —          | —                                      |

**Start from an E2E** (rule 12: both conflict directions, both timestamp
winners):

- **#10385:** `e2e/tests/sync/supersync-commuting-edit-beside-local-win.spec.ts`
  on `ccr-211e334d-0r60po`. It is `test.fixme`, red 4 of 4, and queue item 2
  ports it.
- **New specs:** #10379's done and time pins (with a restart after the time
  case), a both-devices-resolve case, #10378, and the note pins if NOTE is
  admitted.
- **Must stay green:** `supersync.spec.ts` "3.1" and the `supersync-*` specs
  for `lww-conflict`, `time-delta-rename-crossing`, `time-tracking-advanced`,
  `round-time-conflict`, `simple-counter-lww-type` and `clear-field-9776`.

## Recommendation

**Option A with C's time rule, in steps.** It extends the existing generic
path (rule 12) and removes the store read behind #10385 instead of reordering
it. Every release applies its payload as a merge. B is the smaller change for
#10385 alone, but it leaves #10260, and a later resolver's snapshot still
erases.

1. **PR 1:** pieces 1–3, proven by #10385's E2E and a #10379 task E2E. It
   replaces a separate fix for #10385 (queue item 3).
2. **PR 2:** C for #10378, where a losing side's deltas survive.
3. **Separately, if decided:** admit NOTE, with `todayOrder` upkeep.

Opaque ops stay out of scope: each needs a per-action field contract, which
is rule 12's last resort. The remote-win half of #10260 for tasks waits for a
reproduction.

## Decisions for @johannesjo

1. **Direction:** A, B, or neither? If A, does #10385 ship as its PR 1?
2. **Clears on v18.15.0–v18.21.x:** accept that those receivers keep a stale
   optional value when a resolution becomes a patch? The alternative is to
   keep replace for resolutions that clear a field.
3. **NOTE:** admit it, accepting that a released device that applied a
   concurrent note delete recreates an invalid note that REPAIR must fix? Or
   keep notes on whole-entity LWW until v19.1.0 leaves the fleet?
4. **Resolution ops as input:** should a later conflict read a `'patch'`
   op's `actionPayload` as fields? That would end the no-re-merge contract.
5. **Opaque ops:** confirm that habit counts and `planTasksForToday` stay on
   whole-entity LWW for now.
