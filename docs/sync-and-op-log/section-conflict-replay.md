# SECTION and Content Reorder Conflict Replay Contract

**Status:** Active sync-correctness contract.

This document owns the narrow exceptions that preserve SECTION and content
reorder semantics when a server rejects a concurrent local operation. The executable
owners are:

- `src/app/op-log/sync/section-conflict-commutativity.util.ts`
- `src/app/op-log/sync/reorder-conflict.util.ts`
- `src/app/op-log/sync/reorder-conflict.util.spec.ts`
- `src/app/op-log/sync/superseded-operation-resolver.service.ts`
- `src/app/op-log/sync/superseded-operation-resolver.service.spec.ts`
- `e2e/tests/sync/supersync-section-convergence.spec.ts`
- `src/app/op-log/testing/integration/reorder-conflict-wedge.integration.spec.ts`
- `e2e/tests/sync/supersync-reorder-conflict-wedge.spec.ts`
- `e2e/tests/sync/supersync-issue-provider-reorder-conflict.spec.ts`
- `e2e/tests/sync/supersync-reorder-single-entity-rule.spec.ts`
- `e2e/tests/sync/supersync-reorder-competing-and-delete.spec.ts`
- `e2e/tests/sync/webdav-reorder-competing-and-delete.spec.ts`

## Why generic entity LWW is insufficient

SECTION actions encode ordered relationships across a section and its Project
or Tag work context. Replacing a rejected move, removal, or reorder with a
snapshot of one entity loses reducer semantics: a task can remain in two
containers, disappear from both, or converge with different ordering on each
client.

The resolver may therefore replay a rejected SECTION intent instead of
collapsing it into a generic entity snapshot. This is a deliberately narrow
exception, not permission to replay arbitrary rejected actions.

Note, habit, board and issue-provider reorders also carry list writes that an entity snapshot
cannot represent. When one crosses a commuting single-entity edit, both intents
must survive. Applying the remote action alone does not resolve the server's
rejection of the pending local clock.

## Admission contract

Only these action families are candidates:

- `SECTION_UPDATE_ORDER`
- `SECTION_ADD_TASK`
- `SECTION_REMOVE_TASK`
- `NOTE_UPDATE_ORDER`, `COUNTER_UPDATE_ORDER`, `BOARDS_SORT`, `ISSUE_PROVIDER_SORT_FIRST`
- the absolute single-entity patches `NOTE_UPDATE`, `SECTION_UPDATE`,
  `COUNTER_UPDATE`, `ISSUE_PROVIDER_UPDATE`, `BOARDS_UPDATE`, `COUNTER_SET_TODAY`
  and `COUNTER_SET_FOR_DATE`

`COUNTER_SET_TODAY` and `COUNTER_SET_FOR_DATE` are exceptions to the proof below;
see the end of this section. For every other candidate, replay is admitted only
when all of the following hold:

1. The rejected operation has an existing entity frontier concurrent with its clock.
2. Exactly one retained operation matches the affected entity/clock frontier.
3. That retained row is an applied, synced, non-rejected remote operation.
4. `areCommutingSectionOperations()` or
   `areCommutingReorderAndContentOperations()` recognizes the exact pair.
5. Operation metadata exactly matches the action payload used to make the
   decision.

The recognized crossings are:

- a move and removal of the same task from the move's source section;
- a section-order update crossing a placement/removal that touches one of the
  ordered sections;
- a content reorder crossing a single-entity patch of an entity it lists, under
  the structural rule below; and
- two note orders or two habit orders, or a note order and the delete of a
  note it lists (#10377, below).

A reorder writes exactly one ordered list per context: `project.noteIds` for
project notes, `note.todayOrder` for Today and every tag view,
`simpleCounter.ids`, `boardCfgs`, the context's slots of `section.ids`, or
`issueProvider.ids`. A concurrent patch of one listed entity commutes with it
when the patch keeps the entity's identity and its reducer writes neither that
list nor its membership. The payload and declared entity IDs must agree, the op
must be a single-entity update of the action's own entity type, and its changes
must be a nonempty object. `LIST_ROUTED_FIELDS` names every field a reducer
routes into a list or its membership:

- `id` is identity: only an unchanged `id` commutes;
- a note's `projectId` and a section's `contextId` and `contextType` move the
  entity to another container of the list;
- a section's `taskIds` is the task placement list its own actions own; and
- a note's `isPinnedToToday` adds or removes it in `note.todayOrder`. That
  commutes with a project note reorder, which writes another list, but not with
  a Today or tag reorder: released reducers overwrite `todayOrder` with the
  order's stale membership.

Every other field is written on that entity only: note text, lock and colour,
section title and expansion, habit settings including enabled state and type,
board configuration, issue-provider settings of any provider kind, and one day's
habit count. `reorder-conflict.util.spec.ts` runs every model field
(`Required<Model>` fixtures) of every patch through the real reducers and
meta-reducers. Each admitted field must leave the list and its membership
unchanged, commute in both application orders and replay idempotently. A new
list-writing field fails that spec until it is classified. Deltas, moves,
deletes, bulk updates and any action outside the patch table never commute.
These checks establish commutativity; they do not replace normal operation or
model validation.

A note with two pending Today membership writes, such as an unpin and a re-pin,
keeps the safety stop even against a project reorder. Each rejected op would be
reissued as a pin, and released receivers prepend a pin without deduplication.
The current pin reducer is idempotent, so hydration can replay a rejected pin
and its reissue.

Two reorders that share an entity, and a reorder against the delete of a listed
note, converge once the remote op applies and the pending reorder is reissued
from the resulting state (`isReissuedReorderCrossing`, #10377). The admitted
lists are `project.noteIds`, `note.todayOrder` and `simpleCounter.ids`:

- **Competing orders of one list:** the remote order applies over the pending
  one and the reissue carries the list as it now stands, so the order that
  reached the server first wins. Either device's order may survive (#10264's
  decision); timestamps do not decide. Every Today and tag order writes
  `note.todayOrder`, so they compete with each other. Two habit orders must
  list the same habits: each fills the slots of its own habits, so orders over
  different habit sets (a habit added, enabled or disabled on one device) end
  differently on each side and keep the stop.
- **A project order against a Today or tag order:** each writes only its own
  list, so both survive.
- **A note delete:** the delete wins. A pending reorder is reissued without the
  deleted id and keeps its positions of the other notes. A remote order applied
  over a pending delete drops the id: on current clients a note order changes
  positions, never membership. Since #10377 `projectReducer`'s
  `updateNoteOrder` keeps only ids already in `noteIds` and keeps unlisted
  members at the front, as the note reducer does for `todayOrder` (#10298). A
  dangling id crashed the notes panel; a dropped member, such as a note added
  before a competing order, vanished from the project on every device.
  Released reducers write the ids as given; they only ever receive reissues,
  which carry the full current list.
- **File-based providers never reject an upload,** so the reissue does not wait
  for a rejection (`reissueCrossedPendingReorders`, same causal proof: the
  crossing remote row is the retained, applied one). It runs after every
  download (`RemoteOpsProcessingService`) and before every upload
  (`OperationLogUploadService`), scanning every retained applied remote row.
  Without it, competing orders diverge on WebDAV (verified by disabling it).
  While live state may hold an unpersisted change the reissue is deferred and
  the upload holds the crossed order back, so a stale original never uploads.
  A crossed order without the proof keeps the safety stop. Known gap: a held
  order whose remote row is compacted away before the next sync is no longer
  seen as crossed and uploads as it is. SuperSync rejects it and stops as
  before; on a file-based provider receivers that already hold the remote op
  skip it as superseded, so the holding device keeps its own order.

A pending note or habit order that commutes with a concurrent remote op stays
out of a conflict over the entity's other pending ops (`nonCommutingPendingOps`,
#10420). The edit conflict resolves as it would without the order, and neither
winner rejects the order. Like a kept time delta, the order then moves in place
past the remote clocks of the conflicts it crosses, together with every later
pending op of the device on an entity it lists (`keptCommutingReorders`,
`rebaseKeptReorders`), so the server accepts it after either winner. Its
payload does not change. A crash before the move leaves the old clock: SuperSync
rejects the order into the paths above, and without causal proof (the remote
row lost) that keeps the stop. A file-based provider uploads it with the old
clock; no E2E covers that crash window. Board, section and issue-provider
orders stay in the conflict and keep the stop.
An order whose conflict's remote op is an order or note delete it crosses
(`isReissuedReorderCrossing`) does not move when that op applies: the reissue
above runs only while the order is concurrent with it, and a moved order
would upload its stale list. A released receiver writes a deleted note's id
as given and its notes panel crashes (the v19.1.0 E2E below).

A remote LWW resolution row of a habit commutes with a habit order that lists
the habit: the LWW meta-reducer writes the habit only, and no habit field is
list-routed, so neither the row's mode nor its keys are read (decision 5). A
note row keeps the stop, since a note snapshot carries `projectId` and
`isPinnedToToday`; so do board, section and issue-provider orders.

A habit delete keeps the stop: a habit order fills the slots of the habits it
lists, so a delete shifts them around an unlisted (disabled) habit and the two
application orders differ. Boards, sections and issue providers keep the stop
for competing orders and deletes: `sortIssueProvidersFirst` keeps deleted ids,
and none of these crossings has an E2E yet. Container moves and Today
membership against a Today or tag reorder are not recognized either. Missing, ambiguous, malformed or
non-commuting evidence does not admit replay. Recognized content reorders
(including section reorders) then remain pending with
`UnsupportedMultiEntityConflictError`: generic entity LWW loses list writes.
`COUNTER_SET_TODAY` and `COUNTER_SET_FOR_DATE` need no causal proof: each is
reissued with its original day's current count (a local no-op), because a
whole-habit LWW snapshot overwrites unrelated fields and stopping sync would
block habit clicks. Other patches retain their existing fallback: without proof,
a rejected patch becomes a whole-entity LWW snapshot (#10338 changes that
snapshot for habits).

A pin or unpin without proof keeps that fallback too. Proof can be missing
after compaction removed the conflict row, and on clock-gap rejections that no
downloaded op explains, which need not involve a reorder at all. Stopping there
would leave the whole-dataset replacement as the only way out. Known gap: the
note snapshot carries `isPinnedToToday` but not receivers' `note.todayOrder`
write, so their Today list can miss the change. A pin that wins a download-time
LWW conflict against another edit of the same note already has the same gap.

## State-based projection

An admitted intent is projected against one stable NgRx snapshot whose state is
fully represented by durable operations. There is no `await` between the
phantom-change check and snapshot read; the operation-log lock keeps later user
actions behind the recovery transaction.

`projectSectionReplayAgainstState()` returns one of four outcomes:

- **replay:** create a replacement operation using current ordering and anchors;
- **work-context-state:** create the exact Project/Tag state compensation needed
  to preserve work-context ordering;
- **superseded:** the current durable state already makes the intent obsolete,
  so reject the stale predecessor without a replacement; or
- **blocked:** the transition cannot be represented safely; recognized reorders
  stop with the safety error, while other SECTION actions retain generic LWW.

`projectReorderConflictAgainstState()` reuses SECTION projection for section
orders. For other admitted reorders it carries the current owner list. Habit
orders retain only the original IDs still present, preserving unlisted slots
and avoiding conflicts with disabled habits absent from the original drag.
Patch replacements carry only the originally changed fields with their
current values; a habit settings replacement therefore keeps the dialog's
`type`. These replacements are local no-ops and remain idempotent when
hydration also replays rejected originals.
Habit-grid edits retain `COUNTER_SET_FOR_DATE` and their original `date`, including
when that date was today on the originating device.

Issue-provider order replacements carry the complete current provider list:
their sort-first reducer appends unlisted IDs, so retaining only the original
footprint would move later additions. Current membership omits deleted providers;
a deleted update target is superseded without recreating it. Provider updates
use the existing retained-evidence proof and fallback, without the habit-count
exception for missing proof.

Replacement ordering is scoped by owner list, work-context task order or content
action/entity (and day for habit counts).
Replacements use a merged, incremented clock that dominates the rejected and
retained frontiers (for an unproven habit count, the rejected frontier and
every clock the rejection download collected). The client must not prune that clock before the server
performs conflict detection.

The resolver appends all replacement/compensation operations and rejects their
stale predecessors in one operation-log transaction. A crash must not expose
only one half of the recovery.

## Released-client compatibility

Clients in the v18.4.0-v18.4.3 compatibility window understand schema-4 SECTION
removals but ignore later work-context anchor fields. A semantic removal is
therefore paired with a complete Project/Tag LWW replacement when needed, which
their existing reducer can apply to converge task ordering.

Do not use a schema bump as a substitute for this compensation. Any change to
the replacement payload must be checked against the released-fleet rules in
[`operation-log-architecture.md`](./operation-log-architecture.md#bump-policy--a-bump-does-not-protect-the-released-fleet).

Content reorder recovery reuses existing action payloads without a schema or
persisted-model change. Its E2E covers both note and dated-habit resolution
histories consumed by unmodified v19.1.0. Older clients that resolve first retain
their original safety gate; see the [S2 validation report](../plans/2026-09-26-sync-S2-result.md)
and [dated-habit result](../plans/2026-09-26-sync-habit-date-reorder-result.md)
for released-asset provenance and the tested limits.

The provider suite checks both GitLab and Jira replacement histories against
unmodified v19.1.0 assets, including restart and the rendered tab order. If that
released client encounters the conflict first, it still stops with pending work intact;
the new resolver cannot change old-client behavior. See the
[provider fix validation](../plans/2026-09-26-sync-issue-provider-reorder-reproduction.md#provider-independent-recovery).

The structural rule's E2E checks, against unmodified v19.1.0 assets, that a
released receiver renders a reissued pin once, that it consumes a project order
reissued over its own pin, and that it keeps a StopWatch habit's type after a
reissued settings edit. File-based providers never reissue: every client applies
both original ops, which commute on released reducers because Today membership
is admitted only against project orders.

The #10377 reissues are ordinary `updateNoteOrder` and
`updateSimpleCounterOrder` ops carrying the full current list, the same shape
as the reissues above, with a clock that dominates the remote op, so released
receivers apply them after it in any arrival order. A released client that
holds the pending side still stops, as before.

The #10420 E2E (`supersync-reorder-beside-conflict.spec.ts`) checks against
v19.1.0 assets that a released device consumes a habit order moved past its own
rename, and an order the current device reissues after the released device's
whole-habit resolution row. Its note case has the released device delete a
note that the current device edited beside its pending order.

## Verification

Run the focused unit suite:

```bash
npm run test:file src/app/op-log/sync/superseded-operation-resolver.service.spec.ts
```

Run the real-client convergence scenario through the scheduled SuperSync E2E
workflow, or locally when the dedicated server environment is available:

```bash
npm run e2e:file e2e/tests/sync/supersync-section-convergence.spec.ts -- --retries=0
```

The E2E must continue to prove concurrent move, removal, reorder, and dependent
placements converge and survive restart.
