# Conflict Journal, Disjoint-Field Auto-Merge & Review UI

How LWW conflict auto-resolutions are recorded (conflict journal), when two
concurrent edits are kept instead of one discarded (disjoint-field auto-merge),
and how the user reviews what happened (`/sync-conflicts` page, banner, badge).

Code lives in `src/app/op-log/sync/`:

| Concern                        | Files                                                               |
| ------------------------------ | ------------------------------------------------------------------- |
| Journal data model + store     | `conflict-journal.model.ts`, `conflict-journal.service.ts`          |
| Classification (taxonomy)      | `conflict-journal-emission.util.ts`                                 |
| Disjoint-field auto-merge      | `conflict-disjoint-merge.util.ts`, `conflict-resolution.service.ts` |
| Review UI derivation + actions | `sync-conflict-review.util.ts`, `sync-conflict-ui.service.ts`       |
| Banner / badge                 | `sync-conflict-banner.service.ts`                                   |
| Page                           | `src/app/pages/sync-conflicts-page/`                                |

## Conflict journal

Every LWW conflict auto-resolution is recorded as a `ConflictJournalEntry` in a
**standalone IndexedDB database `SUP_CONFLICT_JOURNAL`** — deliberately separate
from `SUP_OPS` so journaling can never touch op-log schema/versioning or risk
its data.

Contracts:

- **Observe-only.** Recording an entry never influences which op LWW picked,
  and every journal write swallows its own errors — a journal failure must
  never throw back into conflict resolution. Corollary: the op-log write and
  the journal write are **not atomic**. The op log is the source of truth; the
  journal is a best-effort record, and a crash between the two can lose a
  journal entry but never an operation. The never-throw contract covers reads
  and status writes too (`list` → `[]`, `getEntry` → `undefined`, mark
  kept/flipped swallowed): `list()` is awaited inside the post-resolution
  notification step, so a journal failure degrades the badge/review surface,
  never the sync. One asymmetry: a `merged` entry claims "both sides kept", so
  it is journaled only AFTER the merged op is durably appended — the journal
  can under-report a merge, but never report one that didn't happen.
- **Device-local, never synced.** Entries capture the discarded (losing) side
  of a conflict verbatim — exactly the data the op log intentionally dropped.
  Uploading them would resurrect discarded data; they are also excluded from
  backups/exports (see wiki `3.06-User-Data`).
- **Cleared on full dataset replacement.** Journal entries describe conflicts
  in the op history; when that history is replaced wholesale the entries are
  stale (and, across user profiles, a privacy leak).
  `BackupService.importCompleteBackup` — the chokepoint every replacement path
  funnels through (profile switch, JSON import, local-backup restore, SuperSync
  restore) — calls `ConflictJournalService.clearAll()`.
- **Retention.** Pruned on app start to whichever bound binds first: entries
  older than 14 days (`JOURNAL_RETENTION_DAYS`) or beyond the newest 200
  (`JOURNAL_MAX_ENTRIES`).

### Classification taxonomy

`buildConflictJournalEntry` classifies each resolved conflict
(precedence order): `clock-corruption-suspected` → `delete-wins` →
`delete-lost` → `noise` → `newer`/`tie`. `noise` (status `info`) fires only
when the DISCARDED side changed nothing but NOISE_FIELDS (`modified`,
`lastModified`, `created`) — i.e. no real content was lost. Everything else is
status `unreviewed` and counts toward the badge.

### Field diffs and per-side presence

`fieldDiffs` is the union of both sides' changed fields, each value captured
verbatim, plus `localChanged`/`remoteChanged` flags recording whether each side
actually touched the field. The flags distinguish "this side never changed the
field" from "changed it to some value" — without them, a union diff stores the
untouched side as `undefined`, and Flip would dispatch `{ field: undefined }`,
clearing a winner-only field. Entries persisted before the flags existed lack
them; readers (`loserChangesFor`/`winnerChangesFor`) fall back to
value-presence, which is exact for that data because op payloads are pure JSON
and cannot encode a real `undefined`.

### Non-adapter ("opaque") ops

Not every persistent action is adapter-shaped (`{ [payloadKey]: { id,
changes } }` or a flat entity). `convertToSubTask` persists
`{ taskId, targetParentId, afterTaskId }`; scheduling/ordering/advanced-config
actions have similar domain-specific shapes. Extraction resolves each op's
delta from two sources in order:

1. the adapter-shaped action payload (`extractUpdateChanges`);
2. the capture-time `entityChanges` computed by `OperationCaptureService`
   (covers TIME_TRACKING and `syncTimeSpent`).

Extraction is scoped to the entity currently in conflict. `entityId` and
`entityIds` are treated as one deduplicated set, matching server conflict
detection even for inconsistent legacy metadata. For a multi-entity op, only a
matching `entityChanges` entry with `opType: UPDATE`, a plain-object delta, and
no identity (`id`) field is accepted. A multi-entity op without such a safe
target delta is opaque; it must not borrow the primary entity's adapter payload
because doing so could attribute one entity's values to another. Direct-format
legacy bulk payloads are therefore opaque for non-primary entities.

An op with neither is **opaque** (`hasOpaqueChanges`). Opaque ops still
represent real state changes, so:

- a loser side with opaque ops is **never** classified `noise` — the loss
  surfaces as `unreviewed`;
- the raw action payload is preserved in the entry as a `kind: 'action'`
  field diff (field = action type), so the discarded change stays reviewable
  after the op itself is gone;
- `kind: 'action'` diffs are excluded from flip/stale computations — they are
  not entity fields;
- a side with opaque ops is **never disjoint-merge eligible** (see below).

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
cascade or re-merge on later syncs. Merged resolutions are journaled with
`winner: 'merged'`, status `info` (nothing was discarded), recording per-field
which side supplied each value.

**Composition residual (pre-existing class):** the merged op is an ordinary
partial UPDATE, so it is NOT closed under later whole-op LWW composition. When
a concurrent third-device op overlapping a merged field crosses paths with the
merged op after both are synced, `_checkEntityForConflict`'s no-pending-local
fast path applies whichever op each client receives last, with no reconciling
snapshot op — clients can permanently diverge on the overlapped field. This
hole predates the merge feature: two plain concurrent user ops crossing after
both are synced hit the identical branch (present at the pre-SPAP-14 baseline);
the merged op is simply one more op subject to it, neither widening nor fixing
it. Class-level fix ideas — per-field timestamps, a reconciling op on
concurrent-apply, or carrying parent-op identity so a later conflict can
decompose a merge — belong to a follow-up at the op-log level.

## Review UI (`/sync-conflicts`)

Entry points: a banner after a sync that auto-resolved conflicts, an
unreviewed-count badge, and a link in Settings → Sync. Two views: unreviewed
and history (everything, newest first).

Per-entry actions (`SyncConflictUiService`):

- **KEEP** confirms the auto-resolution (`status: 'kept'`). Bulk keep-all
  exists.
- **FLIP** re-applies the discarded side by dispatching a NORMAL entity update
  action — the same action a manual edit dispatches — so the operation-capture
  meta-reducer turns it into a synced op that propagates everywhere. No history
  rewind; a flip is a brand-new edit on top of current state. Before applying,
  a **stale guard** asks for confirmation if the entity was edited after the
  conflict resolved. It checks a winner-changed field whose current value
  diverged from the journaled winner value, plus — for **remote-won** entries
  only — a **loser-only** field (one the flip writes but the winner never
  changed, so it is invisible to the winner values) whose current value is not
  already what the flip would write. The loser-only check is scoped to
  `winner === 'remote'` because only then did the loser's (local, optimistically
  applied) value persist in current state, giving a valid "unedited" baseline;
  for a local win the loser (remote) value was never applied and no base is
  journaled, so `current !== flipVal` there is the normal post-resolution state,
  not an edit. The bulk flip path shows no dialog, so it **skips** stale entries
  rather than overwriting them.

  KNOWN GAP: a post-resolution edit to a **loser-only field on a LOCAL-won
  entry** is not yet detectable (no journaled base), so a flip there can still
  overwrite it silently — a follow-up needs a per-field post-resolution baseline
  in the journal.

**Flip capability is deliberately narrow** (`canFlip`); everything else
returns `unsupported`, keeps the entry `unreviewed`, and shows an error snack —
an entry is only ever marked `flipped` when an op was actually dispatched:

- only TASK / PROJECT / NOTE / TAG (types whose flip is expressible as a
  normal `{ id, changes }` update);
- not for `delete-lost` / `delete-wins` — re-applying a delete or resurrecting
  a deleted entity needs delete/restore semantics a plain update cannot
  express (deferred);
- not when the loser has no re-appliable field values (empty diffs, opaque
  `kind: 'action'` diffs);
- not when the loser's changes touch unsafe fields (`FLIP_UNSAFE_FIELDS`):
  relationship-bearing fields (`projectId`, `parentId`, `subTaskIds`,
  `tagIds`, `taskIds`, `backlogTaskIds`, `noteIds`) are kept consistent across
  entities by meta-reducers, and re-applying one side of the pair via a bare
  adapter update would corrupt the other entity's membership lists;
  schedule/reminder fields (`dueDay`, `dueWithTime`, `deadlineDay`,
  `deadlineWithTime`, `reminderId`, `remindAt`, `deadlineRemindAt`) have
  invariants (mutual exclusivity, TODAY_TAG membership, reminder create/cancel)
  that live in dedicated flows.

A flipped TASK title is dispatched with `isIgnoreShortSyntax: true` — it is a
journaled literal value, not user input, so `#tag`/`+project`/`@schedule`
tokens in the discarded title must NOT re-parse into cross-entity mutations.
