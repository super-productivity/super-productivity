# Disjoint-Field Auto-Merge and Conflict Composition

Concurrent edits to different fields can be combined safely; overlapping edits
use deterministic LWW. The implementation lives in
`src/app/op-log/sync/conflict-disjoint-merge.util.ts` and
`conflict-resolution.service.ts`.

## Conflict journal retirement

The device-local journal, review page, badge and summary banner have been
removed. Startup deletes only the old `SUP_CONFLICT_JOURNAL` IndexedDB database
and `SUP_CONFLICT_JOURNAL_CLEARED_BEFORE` localStorage marker. Old journal rows
are discarded without export; task data, pending operations and local backups
are retained. This changes no sync schema, wire operation or winner semantics.

Deletion does not delay startup. If a running older tab holds a connection open,
the browser completes the pending deletion once all old connections close.
An older client can recreate its own journal database; a subsequent new-client
startup requests its deletion again. A browser storage error leaves cleanup for
another startup and is logged without failing bootstrap.

This document keeps its historical filename so existing merge/composition links
continue to resolve.

## Disjoint-field auto-merge

When two clients concurrently edit the SAME entity, whole-entity LWW would
discard one side's real edits. Instead, the conflict resolves per field: the
remote ops apply as themselves, and the resolver re-sends, as field patches,
only its own fields whose latest write is newer than every remote write of the
same field, each at that write's own timestamp (see
[lww-field-level-resolution.md](./lww-field-level-resolution.md), #10379,
#10422). Eligibility (`isFieldPatchEligible` in `conflict-field-patch.util.ts`

- the archive-plan guard in `conflict-resolution.service.ts`):

* neither side has a DELETE op, and the plan is not an archive plan;
* neither side contains a multi-entity op. Resolution rejects the original ops,
  so merging only the conflicted entity would silently drop the bulk op's
  sibling-entity updates. Unsafe partial compensation fails closed before any
  op-log mutation, leaving the local operation pending and surfacing a sync
  error. Whole-set remote DELETE/archive winners and recreated local archives
  retain their existing atomic paths. The one explicitly
  decomposable legacy action (`TASK_ROUND_TIME_SPENT`) re-emits its known
  per-task time fields from CURRENT state (so a later local edit is not
  overwritten). Current round-time capture intentionally emits an empty
  `entityChanges` array, so the resolver uses the action's static
  `timeSpent`/`timeSpentOnDay` contract only after validating its payload and ID
  metadata. This includes a remote-winning conflict target when the remote delta
  is safely extractable and disjoint (for example, remote title versus local
  rounded time), as well as non-conflicting siblings. Overlapping target
  fields remain remote-won only when the remote delta covers the whole coupled
  local field set; a partial overlap or opaque remote target delta fails closed.
  A sibling missing from current state is not recreated (a later delete owns it).
  Arbitrary bulk actions are not split from `entityChanges`: relationship/list
  mutations may carry atomic invariants that plain payload shape cannot prove;
* neither side has opaque ops (their changes could not be carried into the
  re-sent fields — merging would silently drop them and the two clients
  would resolve DIFFERENTLY). Since #10422 a remote LWW row of the same entity
  is admitted: it applies as itself, and only which fields it writes is read;
  the local side must be readable `{ id, changes }` edits;
* both sides changed at least one real (non-noise) field, or the remote
  side holds such a row;
* time stays out of the patch: a local `syncTimeSpent` delta is kept pending
  and rebased past the remote side instead; a remote delta, `removeTimeSpent`,
  or a delta beside an absolute time write (or beside a remote row that may
  write time) refuses the patch;
* an overlapping patch that would clear a reminder field (`reminderId`,
  `remindAt`, `dueWithTime`, `deadlineRemindAt`) refuses: v18.15.0–v18.21.x
  receivers ignore `clearedFields`;
* all conflicts of one entity in the batch resolve together as ONE
  resolution (one re-send per winning local op, each dominating the one
  before). `detectConflicts` emits one conflict per remote op, and per-conflict patches
  would dominate one another, so a superseded sibling would drop its fields
  (`aggregateEntityConflict`);
* the entity type has a `RECREATE_FALLBACK` (`TASK` / `PROJECT` / `TAG` /
  `SIMPLE_COUNTER`). The merged op is a partial delta, so if it wins over a
  concurrent DELETE on a client that already applied that delete (a passive
  observer, which does NOT pass through the full-entity reconstruction in
  `_convertToLWWUpdatesIfNeeded`), `lwwUpdateMetaReducer`'s `addOne` recreate
  branch must backfill it to a schema-valid entity. Types without a fallback
  (`NOTE` / `METRIC` / `TASK_REPEAT_CFG` / `ISSUE_PROVIDER`) would recreate an
  invalid entity, so they fall back to whole-entity LWW (whose local-win op
  carries a full snapshot). Residual: fallback types can still recreate with
  `DEFAULT_*` backfill diverging from holders in that rare race — the same
  bounded limitation documented in `recreate-fallback.const.ts`.

**Convergence contract:** both clients must assign every field to the same
side regardless of which one resolves. A field both sides wrote goes to the
side whose latest write of it is newer by the planner's rule (timestamp, then
the clientId of that op), which is symmetric between the two devices; each
resolver re-sends only the fields assigned to it. The re-sent values come ONLY
from the resolver's own ops, **not** from its current entity snapshot. A
full-entity snapshot would drag along fields NEITHER side touched; if such an
untouched field momentarily differs between the two clients (an ordinary
staggered-sync race — e.g. one client already applied a third device's edit the
other has not), the two snapshots would differ, tie under LWW, and diverge
PERMANENTLY. See `localWinningFieldGroups`.

**Timestamps:** a re-send carries a field only at the timestamp of the op that
wrote it, never at the other side's newer time (#10422). Otherwise the re-sent
older field beats a third device's newer edit of it.

**Atomicity / no-re-merge contract:** each re-send is a new UPDATE op carrying
a **flat PARTIAL delta** (only the re-sent fields), layered on top of both
sides' history like a normal edit — there is no history rewind.
`lwwUpdateMetaReducer` applies it via `updateOne` (a shallow merge), so fields
outside the delta keep their own values on each client. A later conflict with
such a row reads only **which** fields it writes (its keys, or every field for
a `'replace'` row), never its values: the row applies as itself, and the local
fields newer than it, or that it does not write, are re-sent after it. Rows
never merge with each other (a pending local row keeps whole-entity LWW).

### Composition residual (pre-existing class)

The merged op is an ordinary partial UPDATE, so later whole-op LWW composition
needs another causal reconciliation step. The #9073 no-pending mitigation now
reconstructs retained, decomposable overlapping sides and routes them through
deterministic LWW; a local winner emits the normal dominating full-replacement
operation.

That mitigation is bounded by the evidence and operation shape available on the
receiver. Arrival-order behavior remains when the concurrent local evidence was
compacted away or cannot be decomposed safely (multi-entity, local
delete/archive, and merged/opaque or noise-shaped composition cases). A mixed
fleet adds another limit: receivers predating replacement-mode LWW apply the
reconciling full snapshot as a patch and can retain fields that a current client
clears. Fallback cases cannot always construct a synthetic conflict and retain the
arrival-order limitation above.

Class-level fixes — per-field timestamps, a guaranteed reconciling operation on
every concurrent apply, or carrying parent-op identity so later resolution can
decompose a merge — belong to a follow-up at the op-log level.
