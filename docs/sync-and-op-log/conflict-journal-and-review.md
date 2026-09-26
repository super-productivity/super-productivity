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

When two clients concurrently edit the SAME entity but DIFFERENT (non-noise)
fields, whole-entity LWW would discard one side's real edit. Instead, both are
kept by synthesizing a single merged UPDATE op. Eligibility
(`isDisjointMergeEligible` + the archive-plan guard in
`conflict-resolution.service.ts`):

- neither side has a DELETE op, and the plan is not an archive plan;
- neither side contains a multi-entity op. Resolution rejects the original ops,
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
- neither side has opaque ops (their changes could not be carried into the
  synthesized delta — merging would silently drop them and the two clients
  would synthesize DIFFERENT results);
- both sides changed at least one real (non-noise) field;
- the two sides' non-noise changed-field sets are disjoint;
- the entity has only ONE conflict in this batch. `detectConflicts` emits one
  conflict per remote op with no per-entity aggregation, so an entity with ≥2
  concurrent remote ops would synthesize multiple merged ops whose clocks
  dominate one another — a dominated sibling can be superseded and its field
  silently dropped. Such entities fall back to whole-entity LWW (honest refusal;
  per-entity aggregation into one op is a possible future improvement);
- the entity type has a `RECREATE_FALLBACK` (`TASK` / `PROJECT` / `TAG` /
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

**Convergence contract:** both clients must synthesize the byte-identical
merged **changes delta** regardless of which one performs the merge. The delta
is the union of both sides' non-noise fields (disjoint, so nothing is clobbered)
plus the noise fields either side changed, resolved via a deterministic
`(timestamp, clientId)` tiebreak. Crucially the delta is derived ONLY from the
two sides' ops — **not** from either client's current entity snapshot. A
full-entity snapshot would drag along fields NEITHER side touched; if such an
untouched field momentarily differs between the two clients (an ordinary
staggered-sync race — e.g. one client already applied a third device's edit the
other has not), the two snapshots would differ, tie under LWW at the identical
`max(timestamp)`, and diverge PERMANENTLY. See `synthesizeMergedChanges`.

**Atomicity / no-re-merge contract:** the merged resolution is exactly ONE new
UPDATE op carrying a **flat PARTIAL delta** (only the changed fields), layered
on top of both sides' history like a normal edit — there is no history rewind.
`lwwUpdateMetaReducer` applies it via `updateOne` (a shallow merge), so fields
outside the delta keep their own values on each client. Because the payload is
flat (not `{ changes }`-shaped), `extractUpdateChanges` yields `{}` for it, so
a merged op can never itself become disjoint-merge eligible: merges do not
cascade or re-merge on later syncs.

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
