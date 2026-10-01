# Design note: LWW resolutions that carry only the fields that must win

**Status:** decided 2026-09-30 (see [Outcome](#outcome)). Option A's PR 1 is
implemented (see [Implementation](#implementation-pr-1)); "How it works today"
below describes the code before it. Tracker: #10393, queue item 1. Findings:
#10382.

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
   builds every resolution op from the store. Only afterwards are the batch's
   non-conflicting remote ops applied, so every store read is pre-batch
   (#10385).
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
     `planTasksForToday`), a noise-only side, or a field both sides wrote;
   - a whole-entity-win plan, or missing entity state or clientId.
3. A merge emits one `lwwUpdateMode: 'patch'` op whose delta comes only from
   the two sides' ops (`synthesizeMergedChanges`, removed by #10422). This is
   why both resolvers build the same bytes. Both originals are rejected; the patch is applied
   locally and uploaded.
4. Otherwise a local win runs `_createLocalWinUpdateOp`:
   - It reads the store and emits a `'replace'` op. SIMPLE_COUNTER goes out as
     `'patch'` with `clearedFields` instead (`asPatchSnapshotIfTypeShadowed`).
   - `buildTimeAwareResolutionBatches`
     ([`fold-sync-time-spent.util.ts`](../../src/app/op-log/sync/fold-sync-time-spent.util.ts))
     folds the batch's non-conflicting and winning remote time ops (deltas,
     rounding, absolute `timeSpentOnDay` edits) into TASK snapshots.
   - The deltas of a remote side that **lost** are rejected, and their time is
     gone.
5. A second producer is `SupersededOperationResolverService`
   ([`superseded-operation-resolver.service.ts`](../../src/app/op-log/sync/superseded-operation-resolver.service.ts)).
   It rebuilds every server-rejected field-update op, merged patches included,
   as a `'replace'` snapshot from the store. It rebases a commuting time delta
   in place instead (`rebasePendingLocalOps`). The pin "done status is lost when both
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
   - `'patch'` or any other mode, including none → `updateOne`;
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
- **A field both sides wrote** takes the value of `plan.winner` (sync-core's
  planner: max timestamp, then the clientId of that op). Today
  `synthesizeMergedChanges` lets the remote value win a shared key, and its
  noise tiebreak uses `localOps[0].clientId`; both must switch to the planner's
  rule so two resolvers agree on equal-timestamp ties.
- **The loser's other fields upload too,** so this covers both directions.

Its pieces:

1. **Allow overlap, and aggregate one entity's conflicts into one side each.**
   Two resolvers with staggered batches must provably build byte-identical
   patches, or equal-timestamp patches tie and diverge (why more than one
   conflict per entity is refused today). A both-devices-resolve test with a
   timestamp tie is required.
2. **Keep time out of the patch** (option C's patch rule).
3. **Route `SupersededOperationResolverService` through the same builder.**
   Otherwise a server-rejected patch comes back as a replace snapshot.

| Fixes                                                   | Does not fix                                                                                                                                                                  |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#10385** for merge-eligible shapes: no store snapshot | Opaque, multi-entity and fallback-less types still use the pre-batch store read                                                                                               |
| **#10379** overlap cases: pin "done status…"            | Opaque ops: habit counts, `planTasksForToday`; delete and archive paths                                                                                                       |
| **#10379** time pin, through piece 2's rebased delta    | #10260's pins: habit (opaque count), task (opaque `planTasksForToday` on the winner), note (needs NOTE admission); the readable-field shape has no reproduction yet (rule 15) |
|                                                         | Regresses: a device that applied a concurrent delete recreates TASK, PROJECT or TAG from the patch with defaults for every other field                                        |

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
  - keeps the local delta out of the rejected set and rebases it in place past
    the resolution clock (`rebasePendingLocalOps`, as
    `SupersededOperationResolverService` already does). Its id, seq and
    payload stay, so it uploads once and replays once.
- **Not a new op.** Restart replay is status-blind
  ([`operation-log-hydrator.service.ts`](../../src/app/op-log/persistence/operation-log-hydrator.service.ts)),
  so a rejected original plus a re-sent copy would add the time twice.
- **Open: a remote win by a replace snapshot.** A released client's winning
  snapshot wipes this device's time while the rebased delta still reaches the
  others. The delta must be re-applied after the winner, or the device
  diverges. The design has no rule for this yet.

| Fixes                                     | Does not fix                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| Time lost to a losing remote side         | Non-time fields                                                            |
| **#10378** time, local-win direction only | Per-day work start and end times on `TIME_TRACKING` (#10382, low severity) |

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
   [contributor-sync-model.md](./contributor-sync-model.md) ("Clearing a
   field", #9776), not checked against a tag.
   - An older receiver keeps a stale value, e.g. a cleared `dueWithTime` or
     `reminderId`, where `setOne` cleared it.
   - This is the same documented residual as `asPatchSnapshotIfTypeShadowed`.
2. **Absent entity.** A receiver that applied a concurrent delete recreates
   the entity from the patch:
   - TASK becomes valid but content-less (defaults);
   - NOTE is added raw and invalid, so REPAIR runs (#10380 shape);
   - a replace would have recreated it fully.
   - Under A this widens from today's disjoint merges to every overlapping
     resolution. The resolving device usually cannot know about the delete.

   Recreate snapshots must stay `'replace'`, as `asPatchSnapshotIfTypeShadowed`
   already keeps them.

**The fix only acts where the resolving device runs it.**

- A v19.1.0 device that resolves a conflict still emits a replace snapshot.
- v18.15.0 and v19.1.0 lack the `isAdditiveTimeOp` refusal, so they can still
  merge a delta into a patch (#10147). C puts more standalone deltas on the
  wire at contention time, so this exposure grows on receivers with pending
  edits.
- A mixed fleet in which both devices resolve is unverified, because the
  harness can't run v19.1.0.

**Long-term cost (feature review guide):** persisted model, sync wire and
plugin API are unchanged. A extends the generic merge (rule 12). B adds
ordering machinery to a service grandfathered past the 1200-line cap.

## Fuzz pins and E2E proof

Expected outcomes are by code reading and have not been run. Each fix PR turns
its pins into regression pins and leaves all others unchanged, including those
of #10380 and #10381.

| Pin                                                         | A (pieces 1–3)               | B                                | C                         | NOTE admission                         |
| ----------------------------------------------------------- | ---------------------------- | -------------------------------- | ------------------------- | -------------------------------------- |
| done status lost when both devices rename                   | fixed                        | — (superseded path unchanged)    | —                         | —                                      |
| tracked time lost to a later concurrent rename              | fixed, via the rebased delta | —                                | with A                    | —                                      |
| note lock lost to an unpin; note content loses to an unpin  | —                            | lock only; `todayOrder` diverges | —                         | fixed, if `todayOrder` is kept in step |
| habit count lost to a rename; habit rename loses to a count | —                            | —                                | —                         | —                                      |
| two devices tracking one unscheduled task (#10378)          | —                            | —                                | time, local-win direction | —                                      |
| task rename loses to tracking (#10260)                      | —                            | —                                | —                         | —                                      |

**Start from an E2E** (rule 12: both conflict directions, both timestamp
winners):

- **#10385:** `e2e/tests/sync/supersync-commuting-edit-beside-local-win.spec.ts`
  on `ccr-211e334d-0r60po`. It is `test.fixme`, red 4 of 4 per the issue, and
  queue item 2 ports it.
- **New specs:** #10379's done and time pins (with a restart after the time
  case), a both-devices-resolve case, #10378, and the note pins if NOTE is
  admitted.
- **Must stay green:** `supersync.spec.ts` "3.1" and the `supersync-*` specs
  for `lww-conflict`, `time-delta-rename-crossing`, `time-tracking-advanced`,
  `round-time-conflict`, `simple-counter-lww-type` and `clear-field-9776`.

## Recommendation

**Option A with C's time rule, in steps.** It extends the existing generic
path (rule 12) and removes the store read behind #10385 instead of reordering
it for merge-eligible shapes. Every release applies its payload as a merge,
except for clears on v18.15.0–v18.21.x. B is the smaller change for
#10385 alone, but it leaves #10260, and a later resolver's snapshot still
erases. For #10260, A addresses only the readable-field shape, by construction;
no current pin shows it.

**Revert first?** #10385 is an unreleased regression from #10252, but
reverting #10252's crossing rule brings back #10214, which v19.1.0 has (per
#10385 and #10340). So it needs a fix forward (rule 15).

1. **PR 1:** pieces 1–3, including C's patch rule (the local delta rebased in
   place). Proof: #10385's E2E, a #10379 task E2E, and the restart after the
   time case. It covers #10385's reproduced shape (a readable done toggle).
   Queue item 3 still owns the fallback paths.
2. **PR 2:** the rest of C: fold losing deltas into replace snapshots, and the
   remote-win rule once designed (#10378).
3. **Separately, if decided:** admit NOTE, with `todayOrder` upkeep.

Opaque ops stay out of scope: each needs a per-action field contract, which
is rule 12's last resort. The remote-win half of #10260 for tasks waits for a
reproduction.

## Decisions for @johannesjo

1. **Direction:** A, B, or neither? If A, does #10385 ship as its PR 1?
2. **Recreate from a patch:** accept that a device which applied a concurrent
   delete recreates a TASK, PROJECT or TAG with defaults for the fields outside
   the patch, where today's replace recreates it fully?
3. **Clears on v18.15.0–v18.21.x:** accept that those receivers keep a stale
   optional value when a resolution becomes a patch? The alternative is to
   keep replace for resolutions that clear a field.
4. **NOTE:** admit it, accepting that a released device that applied a
   concurrent note delete recreates an invalid note that REPAIR must fix? Or
   keep notes on whole-entity LWW until v19.1.0 leaves the fleet?
5. **Resolution ops as input:** should a later conflict read a `'patch'`
   op's `actionPayload` as fields? That would end the no-re-merge contract.
6. **Opaque ops:** confirm that habit counts and `planTasksForToday` stay on
   whole-entity LWW for now.
7. **Time on a remote win:** re-apply the rebased local delta after a winning
   replace snapshot, or accept that #10378 is fixed only in the local-win
   direction?

## Outcome

Decided by @johannesjo on 2026-09-30 ([#10393](https://github.com/super-productivity/super-productivity/issues/10393)):

1. **A, later and separately.** #10385 does not wait for it: the local-win
   snapshot now carries the readable fields of the same batch's
   nonconflicting task updates (`buildTimeAwareResolutionBatches`), the way
   it already carried their time. Opaque ops still take the pre-batch read.
2. **Recreate from a patch:** accepted as a residual; the fuzz harness should
   count it.
3. **Clears:** accepted, with a sunset. When A starts, weigh keeping
   `'replace'` for resolutions that clear `reminderId` or `dueWithTime`.
4. **NOTE:** not admitted until v19.1.0 has left the fleet.
5. **Resolution ops as input:** no; the no-re-merge contract stays.
6. **Opaque ops:** stay on whole-entity LWW.
7. **Time on a remote win:** local-win direction only, for now.

**Decision 5a (2026-10-01, #10421).** Asked whether rule 1 below stays within
decision 5, @johannesjo answered: "Ponder in sub agent and act according to
recommendation". As recommended:

- A conflict may read **which** top-level keys a single-task LWW `'patch'`
  row writes or clears (`actionPayload`, `clearedFields`), and only to decide
  that a pending side of `syncTimeSpent` deltas commutes with it.
- The row's values are never read, no op is built from it, and rows never
  merge with each other. The no-re-merge contract of decision 5 stays.
- `'replace'`, unreadable, legacy, multi-entity and time-writing rows keep
  whole-entity LWW. Any other use of a row's keys needs a new decision.

## Implementation (PR 1)

[`conflict-field-patch.util.ts`](../../src/app/op-log/sync/conflict-field-patch.util.ts)
holds the rules; `ConflictResolutionService._tryCreateFieldPatch` builds the op.

- **Overlap:** every update-vs-update conflict of a TASK, PROJECT, TAG or
  SIMPLE_COUNTER whose ops are readable resolves per field (#10422, see
  below). A field both sides wrote goes to the side whose latest write of it
  is newer (timestamp, then clientId), noise fields included; the old
  `(timestamp, localOps[0].clientId)` noise tiebreak is gone.
- **Flat snapshots:** an overlapping patch, and a superseded patch, admit
  only ops whose payload is an `{ id, changes }` update. `moveToOtherProject`
  carries the full pre-move task, which would write the old `projectId` back.
- **Aggregation:** an entity's conflicts (one per remote op) resolve together
  as one patch of both full sides (`aggregateEntityConflict`).
- **Time:** a local `syncTimeSpent` delta is neither in the patch nor
  rejected. It stays pending and is rebased in place past the remote sides,
  together with the patch after it (`rebaseKeptTimeDeltas`). A remote delta,
  `removeTimeSpent`, or a delta beside an absolute time write keeps the
  whole-entity path.
- **Clock:** the patch also dominates the batch's commuting single-entity ops
  on its entity (e.g. a third client's delta), or the server rejects it as
  concurrent. It carries none of their fields.
- **Superseded ops:** `SupersededOperationResolverService` re-emits a rejected
  group of readable single-entity edits as a `'patch'` of the fields they
  wrote, read from current state, with `doneOn` beside `isDone`. LWW rows,
  deltas, opaque ops and reminder clears keep the whole-entity snapshot.
- **No echo:** a resolution emits no patch when no local field won (unless
  it keeps a delta), and a no-pending crossing
  (#9073) that the remote side won emits nothing; the winner's device
  patches. An echo is a new opaque row that can beat another device's pending
  edit.
- **Done toggles:** a patch carries the `doneOn` the task reducer derives
  (the op's timestamp, or a clear when undone), as the op converter does for
  replay; otherwise live state and a restart differ.
- **A later round:** since #10422 a remote LWW row beside pending readable
  edits takes the per-field path. Where that path refuses (e.g. a local
  reminder clear, or a local time delta beside a row that writes time) and the
  row wins, the local fields that still hold their values after the row
  applied are re-emitted as a patch, in the same transaction as their
  rejection (`survivingLocalFields`). The row's payload is not read (decision
  5); a replace row used to hide this case by overwriting the fields
  everywhere.
- **Content banner:** a patch reports a content field only where both sides
  wrote it (`findPatchContentConflicts`).

**Residuals:**

- **Decision 2:** a device that applied a concurrent delete recreates the
  entity from the patch with defaults outside it. It now also covers
  overlapping resolutions.
- **Decision 3:** a v18.15.0–v18.21.x receiver ignores a patch's clears. An
  overlapping resolution whose patch would clear `reminderId`, `remindAt`,
  `dueWithTime` or `deadlineRemindAt` keeps the whole-entity path, so that
  shape keeps #10379's loss. Disjoint merges patched clears before and still
  do.
- **Derived fields:** apart from `doneOn`, a patch sets fields, not their
  reducer side effects (e.g. a subtask estimate's parent total). This
  predates PR 1 for disjoint merges and now covers overlapping ones.
- **A time delta beside a resolution row:** a pending side of only
  `syncTimeSpent` deltas does not conflict with a single-task LWW `'patch'`
  row whose payload and `clearedFields` hold no `timeSpent`/`timeSpentOnDay`
  key (`isCommutingTimeDeltaCrossing`, #10408, #10421). The delta stays
  pending and is rebased after one server rejection, like a delta beside a
  rename; no snapshot is built. Only the row's keys are read, never its
  values, and rows still never merge (decision 5a). A `'replace'` row, which
  `setOne` applies to every field, or a row that writes or clears a time
  field still wins whole-entity, as on master.
- **That rule is one-directional:** it covers a pending delta meeting an
  incoming row. A pending row meeting an incoming delta, and the no-pending
  path (`_buildNoPendingConcurrentConflict`, #9073), still resolve as before.
  The WebDAV E2E converges in both directions without it, so no guard is
  added (no evidence of harm).
- **Opaque ops, NOTE, deletes and archives** keep whole-entity LWW, so the
  habit, note and task-tracking pins of #10379 and #10260 stay.
- **Released resolvers:** a v19.1.0 device that resolves still emits replace
  snapshots; patches take over as clients update.
- **Asymmetric time rule:** a local delta admits the patch, a remote one
  refuses it. On SuperSync only the rejected uploader resolves; on a
  file-based provider two devices can resolve the same conflict, one with a
  patch and one on the whole-entity path. The rows then meet as opaque LWW
  rows and converge, but #10379's loss can return in that shape. The
  both-devices-resolve proof is unit-level only.
- **Surviving-field echoes:** a field the winning row wrote with the same
  value as the local op counts as surviving and is re-emitted.
- **Side-level winner (fixed by #10422):** a field both sides wrote used to
  take the winning side's value, and the patch carried the newest timestamp of
  both sides, so a resolver re-sent the other side's older fields at a time
  they were never written, and they beat a third device's newer edit, in both
  conflict directions. See "Per-field winners" below.
- **Stale local-win snapshot:** a local side that is not readable (an opaque
  op such as `planTasksForToday` from tracking or a habit count, a delete, a
  multi-entity op, or a delta beside a time write) still wins whole-entity
  with a snapshot read before the batch (#10421, open for those sides). A
  readable local side against a row resolves per field since #10422, which
  also fixes the accepted `tasks:20725028` trade (pinned as a regression).
- **Server order of remote winners (#10423):** an incoming nonconflicting op
  that a remote winner of the same entity causally dominates reached the
  server first, so it is persisted and applied before that winner
  (`orderIncomingPrefix`). A winner beside a local win of its entity keeps
  its place after the local win, which it must override on replay.
- **A winner that also tracks time:** a remote `syncTimeSpent` refuses the
  patch, so #10260 stays for a task renamed while another device times it.
- **Undone toggles:** the `doneOn` clear beside `isDone: false` travels in
  `clearedFields`, which v18.15.0–v18.21.x ignore (stale `doneOn` there).
- **Pinned:** the delta-versus-patch-row divergence and the stale-snapshot
  restart change are regression pins; since #10422 the latter's trace no
  longer shows `older-write-won:task.notes` either (a later time delta no
  longer makes an older notes edit win, #10437's class). A failing trace (ref
  #10421) pins a remote rename applied after a local-win snapshot of its task,
  which diverges the same way on master; it also guards the local-win
  exception of the server-order rule (without it, the title changes on
  restart).

**Residual decisions (2026-10-01).** @johannesjo, after the residuals were
put to him: "Double check decisions in sub agents then do everything as
recommended (and file the follow up of it makes sense)". So:

- the delta-versus-patch-row divergence and the stale-snapshot restart change
  are accepted as pinned residuals, with follow-ups #10408 and #10421;
- `survivingLocalFields` stays, since it reads no row payload (decision 5);
- the remote win's timestamp is accepted as pinned, with follow-up #10422,
  which waits on #10421.

## Per-field winners (#10422)

**The rule.** An update-vs-update conflict whose local side is readable
`{ id, changes }` field updates, and whose remote side is readable ops or LWW
rows of the same single entity, resolves per field:

1. The remote ops apply as themselves, in server order (like remote winners,
   #10423).
2. Each local field whose latest local write is newer than every remote write
   of the same field (timestamp, then clientId) is re-sent as a `'patch'`
   row, at the timestamp of the op that wrote it (`localWinningFieldGroups`,
   one row per such op, oldest first). The original local ops are rejected; a
   local time delta stays pending and is rebased (unchanged).
3. A remote readable op writes the fields of its change; a remote `'patch'`
   row writes its keys (`actionPayload`, `clearedFields`); a `'replace'` row
   writes every field.

So no field ever travels at a time it was not written, and every resolver,
from either side, assigns each field to the same side. It replaces the
side-level winner (`synthesizeMergedChanges`, `isRemoteWinEcho`) and covers
the readable half of #10421 (a readable local edit against a row no longer
builds a replace snapshot read before the batch). No per-action exception, no
new wire key, action type or schema bump.

**Decision needed (asked on #10393, not decided).** Step 3 reads which keys a
remote `'patch'` row writes, to decide which local fields it beats. Decision
5a allowed that only for the time-delta rule, and "any other use of a row's
keys needs a new decision". Values are still never read, no op is built from
a row, and rows never merge with each other: a pending local row keeps
whole-entity LWW.

**Released clients (v18.15.0, v19.1.0).** The rows are ordinary `'patch'`
rows that every released client applies via `updateOne`. A released client
reads them as opaque and resolves against them whole-entity, as it does
against any row; it now meets rows stamped at their fields' own, older times.

**What it leaves (residuals):**

- **Whole-entity snapshots of unreadable sides** (opaque, delete,
  multi-entity, or a delta beside a time write) still erase other devices'
  fields. A resolver re-sending its fields at the other side's newer time
  used to mask some of them; `sync-fuzz:compare` shows them in seeds where
  the old over-stamped re-send carried the erased value back by accident
  (`field-unwritten:task.title`, `field-reverted:task.notes`,
  `field-reverted:habit.countOnDay`), next to the known Today list-position
  divergence (#10381). Each was judged on its original seed: the shrunk
  traces fail the same way on master, and the full seeds trade those losses
  for kept done toggles, notes and time.
- **Superseded re-emits** (`SupersededOperationResolverService`) still stamp
  a group with the latest timestamp of its own ops.
- **Pending local rows** keep whole-entity LWW, so a re-send that is still
  pending when another device's row arrives loses or wins as a whole.
