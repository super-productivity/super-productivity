# Conflict Journal, Disjoint-Field Auto-Merge & Review UI

How LWW conflict auto-resolutions are recorded (conflict journal), when two
concurrent edits are kept instead of one discarded (disjoint-field auto-merge),
and how the user reviews what happened (`/sync-conflicts` page, banner, badge).

Code lives in `src/app/op-log/sync/`:

| Concern                          | Files                                                                     |
| -------------------------------- | ------------------------------------------------------------------------- |
| Journal data model + store       | `conflict-journal.model.ts`, `conflict-journal.service.ts`                |
| Classification (taxonomy)        | `conflict-journal-emission.util.ts`                                       |
| Disjoint-field auto-merge        | `conflict-disjoint-merge.util.ts`, `conflict-resolution.service.ts`       |
| Review UI derivation + actions   | `sync-conflict-review.util.ts`, `sync-conflict-ui.service.ts`             |
| Banner / badge                   | `sync-conflict-banner.service.ts`                                         |
| Page                             | `src/app/pages/sync-conflicts-page/`                                      |

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
  journal entry but never an operation.
- **Device-local, never synced.** Entries capture the discarded (losing) side
  of a conflict verbatim — exactly the data the op log intentionally dropped.
  Uploading them would resurrect discarded data; they are also excluded from
  backups/exports (see wiki `3.06-User-Data`).
- **Profile-scoped by clearing.** User profiles are complete, isolated
  instances, but this side store is not part of the profile backup/import
  cycle. `switchProfile` therefore calls `ConflictJournalService.clearAll()` so
  the next profile can never see the previous profile's entity titles/values or
  Flip against the wrong dataset.
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
- neither side has opaque ops (their changes could not be carried into the
  synthesized entity — merging would silently drop them and the two clients
  would synthesize DIFFERENT entities);
- both sides changed at least one real (non-noise) field;
- the two sides' non-noise changed-field sets are disjoint.

**Convergence contract:** both clients must synthesize the byte-identical
merged entity regardless of which one performs the merge. Each client starts
from its own current state (`base + ownChanges`) and overlays the other side's
non-noise fields (disjoint, so nothing is clobbered); noise fields both sides
changed resolve via a deterministic `(timestamp, clientId)` tiebreak.

**Atomicity / no-re-merge contract:** the merged resolution is exactly ONE new
UPDATE op with a **flat full-entity payload**, layered on top of both sides'
history like a normal edit — there is no history rewind. Because the payload is
flat (not `{ changes }`-shaped), `extractUpdateChanges` yields `{}` for it, so
a merged op can never itself become disjoint-merge eligible: merges do not
cascade or re-merge on later syncs. Merged resolutions are journaled with
`winner: 'merged'`, status `info` (nothing was discarded), recording per-field
which side supplied each value.

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
  a **stale guard** compares the entity's current values to the journaled
  winner values and asks for confirmation if the entity was edited after the
  conflict resolved.

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
- not when the loser's changes touch relationship-bearing fields
  (`projectId`, `parentId`, `subTaskIds`, `tagIds`, `taskIds`,
  `backlogTaskIds`, `noteIds`) — those are kept consistent across entities by
  meta-reducers, and re-applying one side of the pair via a bare adapter
  update would corrupt the other entity's membership lists.
