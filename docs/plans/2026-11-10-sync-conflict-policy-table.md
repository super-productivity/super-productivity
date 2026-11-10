# Sync conflict policy: one table and an engine size budget (evaluation)

**Status:** Proposed. Evaluation only: no production code, test or lint
configuration was changed.
**Owner and tracking:** @johannesjo. No dedicated issue yet; it belongs under
tracker
[#10393](https://github.com/super-productivity/super-productivity/issues/10393).
**Last verified against the code:** 2026-11-10, master `954256d` (app v20.0.0).
**Completion or removal condition:** delete this file once the decisions in
[Decisions needed](#decisions-needed-from-johannesjo) are answered. What is
adopted moves into
[contributor-sync-model.md § Conflict resolution](../sync-and-op-log/contributor-sync-model.md#conflict-resolution--stay-on-generic-paths)
with the PR that implements it; what is rejected needs no record beyond the
answer on the tracker.

**Question.** Per-entity and per-action conflict policy is spread over many
separate sets and maps with hidden coupling. Would one declarative policy table,
plus a size budget for the engine as a whole, make the next conflict fix cheaper
and safer, and what is the smallest behaviour-neutral way to get there?

**Short answer.**

- **The size budget: yes, as its own small PR.** The per-file cap was met by
  moving code, and the engine kept growing. One aggregate number in CI is the
  only form that moving code cannot satisfy.
- **A policy table: only the per-entity half, and only together with the next
  fix that needs it.** It is small (18 types, six constants), and it would
  separate the one coupling that shaped three fixes in the measured period.
  It adds lines; it does not remove any.
- **A per-action table, a completeness test, and generic delete-versus-update
  code: no.** In the measured period no action type and no entity type was
  added, so "a new key silently took a default" has no observed instance. The
  growth came from new dimensions and from procedural code for tasks, which a
  table does not hold.

Every figure below is marked _measured_ (reproduced on `954256d` in this
session, commands in [Reproducing the numbers](#reproducing-the-numbers)) or
_estimated_.

## What was read and measured

### The file family

The engine as listed in the task: every non-spec file in
[`src/app/op-log/sync/`](../../src/app/op-log/sync/) named `conflict-*`,
`lww-*`, `superseded-*`, `reorder-*`, `section-conflict-*`,
`fold-sync-time-spent`, `time-preserving-task-snapshot`,
`preserve-partial-bulk-plan`, `bulk-archive-intent` or `rejected-ops-handler`,
plus
[`recreate-fallback.const.ts`](../../src/app/op-log/core/recreate-fallback.const.ts),
[`lww-update.meta-reducer.ts`](../../src/app/root-store/meta/task-shared-meta-reducers/lww-update.meta-reducer.ts)
and
[`packages/sync-core/src/conflict-resolution.ts`](../../packages/sync-core/src/conflict-resolution.ts).

| Measure (all measured)                                               | `6169df9e9` (2026-09-26) | `954256d` (2026-11-10) |
| -------------------------------------------------------------------- | ------------------------ | ---------------------- |
| Files                                                                | 14                       | 26                     |
| Physical lines                                                       | 10,175                   | 12,537 (+23%)          |
| … without the conflict journal (3 files, 913 lines)                  | 9,262                    | 12,537 (+35%)          |
| … also without the meta-reducer and `sync-core`                      | 7,671                    | 10,697 (+39%)          |
| Non-blank, non-comment lines                                         | 7,116                    | 9,145 (+29%)           |
| `conflict-resolution.service.ts`, physical lines                     | 4,817                    | 1,170                  |
| Spec files for the family / their lines                              | not measured             | 18 / 31,679            |
| Commits touching the family in the period                            |                          | 48                     |
| … of which `fix(sync)`                                               |                          | 34                     |
| `fix(sync)` commits on master in the period                          |                          | 72                     |
| `fix` commits of any scope touching sync paths                       |                          | 88                     |
| `ActionType` members / entity types (without the three special ones) | 147 / 18                 | 147 / 18               |

The conflict journal was retired on the first day of the period (#10287), so
the second row is the fair growth figure for code that still exists. The third
row is the closest match to the task's "about 7,600 to 10,750 (+41%)"; the
task's "35 of 91" is 34 of 72 or 34 of 88 here, depending on what counts as a
sync fix. The differences do not change any conclusion.

Three more facts about that growth, all measured:

- **The per-file cap was met by moving code.** #10621 split the service into
  seven sibling services and two utils (3,834 lines added, 3,472 removed) and
  deleted its pinned entry from `eslint.config.js`. The `max-lines` rule covers
  `**/*.service.ts` only
  ([`eslint.config.js:427`](../../eslint.config.js)); the contributor model
  already says "its `*.util.ts` helpers are uncapped".
- **The name pattern leaks.** Three helpers imported only by family files do
  not match it: `replay-update-on-recreated-entity.util.ts` (62 lines, added
  2026-11-04 by #11474), `scope-bulk-archive-payload.util.ts` (54) and
  `collect-deleted-ids.util.ts` (59). With them the engine is 29 files, 12,712
  physical lines, 9,253 non-blank non-comment lines.
- **No key arrived.** `ActionType` has 147 members at both commits with no
  member added or removed, and `ENTITY_TYPES` is unchanged. The last entity
  type, `SECTION`, was added on 2026-09-23, before the period.

### Inventory of policy constants

23 named data constants and one classifier bundle live in the family; one more
constant lives in a helper outside the name pattern (_measured_; the task counts
28, presumably including classifier functions, which are listed under
[Classifiers](#classifiers-and-inline-branches)). "Absent means" is the default
a key gets by not being listed.

**Keyed by entity type (6).**

| Constant (file)                                                                                  | Members today                      | Switches                                                                                                       | Read by                                                                                                                                                                     | Absent means                                                 |
| ------------------------------------------------------------------------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `RECREATE_FALLBACK` (`core/recreate-fallback.const.ts:89`)                                       | TASK, PROJECT, TAG, SIMPLE_COUNTER | (1) defaults backfilled when an LWW update recreates a deleted entity; (2) admission to field-patch resolution | `lww-update.meta-reducer.ts:941`; `conflict-local-win-ops.service.ts:114`; `conflict-field-patch.util.ts:523`; `auto-fix-typia-errors.ts` (TASK and SIMPLE_COUNTER by name) | No backfill; whole-entity LWW instead of field patches       |
| `MERGED_SNAPSHOT_TYPES` (`conflict-field-patch.util.ts:310`)                                     | TASK_REPEAT_CFG                    | Per-field resolution re-sent as one full replace snapshot                                                      | `conflict-local-win-ops.service.ts:112`                                                                                                                                     | Field patch if in `RECREATE_FALLBACK`, else whole-entity LWW |
| `PATCH_SNAPSHOT_OPTIONAL_FIELDS` (`lww-snapshot-patch-mode.util.ts:26`)                          | SIMPLE_COUNTER                     | A whole-entity snapshot is sent as a patch, because a required field is named like an envelope key             | same file, `asPatchSnapshotIfTypeShadowed`                                                                                                                                  | Snapshot sent as `replace`                                   |
| `ARRAY_RECREATE_UNSAFE_ENTITY_TYPES` (`lww-update.meta-reducer.ts:548`)                          | REMINDER                           | Recreate-append of an array entity is skipped                                                                  | same file, `applyArrayEntityLwwUpdate`                                                                                                                                      | Array item is recreated                                      |
| `LIST_ROUTED_FIELDS` (`reorder-conflict.util.ts:68`)                                             | NOTE, SECTION                      | Which entity fields move an entity between ordered lists, so do not commute with a reorder                     | same file (3 sites)                                                                                                                                                         | Every field commutes with every reorder                      |
| `RECREATE_REPLAY_REDUCERS` (`replay-update-on-recreated-entity.util.ts:36`, outside the pattern) | SIMPLE_COUNTER                     | Winning semantic updates are replayed through the feature reducer onto the recreated entity                    | `conflict-entity-state.service.ts:203`                                                                                                                                      | Update payload is read as fields                             |

**Keyed by action type (9).**

| Constant (file)                                                                       | Members today                                                               | Switches                                                 | Read by                                                                                        | Absent means                             |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `INDEPENDENT_MULTI_DELETE_ACTIONS` (`conflict-resolution.util.ts:342`)                | `deleteTasks`, `deleteTags`, `deleteTaskRepeatCfgs`, `deleteSimpleCounters` | Bulk delete is narrowed to the surviving ids             | `conflict-resolution-planner.service.ts` (4 sites); `conflict-bulk-preservation.service.ts:73` | Fail-closed stop                         |
| `DECOMPOSABLE_MULTI_ACTION_FIELDS` (`conflict-resolution.util.ts:274`)                | `roundTimeSpentForDay`                                                      | Per-task deltas of a bulk row are replayed independently | `conflict-resolution-planner.service.ts:265`, `:531`                                           | Fail-closed stop                         |
| `SCOPED_PLAN_MULTI_ACTIONS` (`preserve-partial-bulk-plan.util.ts:40`)                 | `planTasksForToday`, `planDeadlineTasksForToday`                            | Rejected plan row is replaced by one narrowed copy       | same file; `conflict-bulk-preservation.service.ts:399`; `isResolvableTodayListAction`          | Fail-closed stop                         |
| `ORDERING_ONLY_MULTI_ACTIONS` (`conflict-resolution.util.ts:374`)                     | `moveTaskInTodayTagList`, `removeTasksFromTodayTag`                         | Row is rejected with no replacement                      | `isResolvableTodayListAction`                                                                  | Fail-closed stop                         |
| `REORDERS` (`reorder-conflict.util.ts:47`)                                            | note, habit, board, section and issue-provider order                        | Op is a content reorder                                  | same file                                                                                      | Not a reorder crossing: the generic path |
| `PATCHES` (`reorder-conflict.util.ts:122`)                                            | 7 single-entity update actions                                              | Op is an absolute patch that can commute with a reorder  | same file                                                                                      | Never commutes                           |
| `REISSUED_REORDER_DELETES` (`reorder-conflict.util.ts:270`)                           | note order (with `deleteNote`), habit order                                 | A crossed reorder is reissued from current state         | same file                                                                                      | Keeps the stop                           |
| `TIMELESS_OPAQUE_TASK_ACTIONS` (`conflict-disjoint-merge.util.ts:423`)                | `planTasksForToday`                                                         | Opaque op is admitted as writing no task time            | same file, `writesNoTaskTime`                                                                  | Whole-entity LWW                         |
| `CAUSALLY_REPLAYABLE_SECTION_ACTIONS` (`superseded-operation-resolver.service.ts:86`) | section order, add task, remove task                                        | Superseded section op is replayed causally               | same file (`:229`, `:645`)                                                                     | Snapshot fallback                        |

**Keyed by field name (9).** Seven are lists of `Task` fields:
`SYNC_TIME_SPENT_FIELDS`, `CROSS_ENTITY_TASK_FIELDS` and `NOISE_FIELDS`
(`conflict-disjoint-merge.util.ts`), `REMINDER_FIELDS`
(`conflict-field-patch.util.ts:54`), `PLAIN_TASK_FIELDS`
(`fold-sync-time-spent.util.ts:89`), `TASK_CONTENT_FIELDS`
(`lww-conflict-summary.util.ts:22`), `OPTIONAL_TASK_FIELDS` with
`OPTIONAL_TASK_FIELDS_AFTER_V19_2` (`time-preserving-task-snapshot.util.ts`).
`SIMPLE_COUNTER_OPTIONAL_FIELDS` is the counter's equivalent. The two
`OPTIONAL_*` lists are already complete by construction: they are written as
`satisfies Record<OptionalKeys<…>, true>`, so a new optional field fails
compilation until it is listed. `LIST_ROUTED_FIELDS` has the runtime
equivalent: `reorder-conflict.util.spec.ts` runs every model field through the
real reducers and fails until a new list-writing field is classified. The
other lists default by omission: a new task field is treated as not
cross-entity, not a reminder field and not time.

#### Classifiers and inline branches

- **Delete wins:** `isProjectDeleteWinsOperation` and
  `isTagDeleteWinsOperation` (`conflict-resolution.util.ts:60–117`), handed to
  the shared planner as `LWW_PLANNING_OPTIONS.isDeleteWinsAction`. Two entity
  types; every other delete resolves by timestamp.
- **Delete payload carries the entity:** a property of the action creators,
  not a constant. `deleteTask` always carries `task`; `deleteNote` and
  `deleteSimpleCounter` carry an optional snapshot; `deleteTasks` an optional
  `tasks`. The deletes of TAG, PROJECT, TASK*REPEAT_CFG, METRIC, ISSUE_PROVIDER,
  SECTION, BOARD and plugin data carry ids only (\_measured* from the
  `*.actions.ts` files). `extractEntityFromPayload` in `sync-core` finds the
  snapshot under the registry's `payloadKey`.
- **Per-type hooks into the shared core:** `toBaseEntity` strips `subTasks`
  from a task and the delete-wins marker from a tag; `applyAdditiveUpdate`
  folds time deltas for a task and replays reducers for a counter
  (`conflict-entity-state.service.ts:183–204`).
- **Inline branches:** the family names 37 of the 147 action types in 94
  places and the literal `'TASK'` in 66 places (_measured_).
  `TASK_SHARED_MOVE_TO_ARCHIVE` and `TIME_TRACKING_SYNC_TIME_SPENT` appear 13
  times each. Five entity types (METRIC, MENU_TREE, WORK_CONTEXT,
  PLUGIN_USER_DATA, PLUGIN_METADATA) are named nowhere in the family.
- **Storage pattern** (adapter 9, singleton 4, map 1, array 4) is a policy
  dimension too, and it already lives in one complete table:
  [`entity-registry.ts`](../../src/app/op-log/core/entity-registry.ts), whose
  spec fails when an entity type has no config.

### Couplings

1. **`RECREATE_FALLBACK` means two things** (documented in its header): the
   backfill on recreate, and admission to field patches. Three fixes in the
   period were shaped by it, each by adding a mechanism next to the table
   instead of an entry: #10452 kept NOTE out and put the whole note in the
   delete payload; #10958 added `MERGED_SNAPSHOT_TYPES` for TASK_REPEAT_CFG
   "because released receivers lack an entry for it"; #11474 and #11504 added
   `wholeEntityKeys` and the replay reducers for SIMPLE_COUNTER. The comment at
   `lww-update.meta-reducer.ts:544` rejects an entry for REMINDER for the same
   reason. The coupling is recorded in prose in three files and in no type.
2. **The stop is defined by exclusion.** `_assertMultiEntityPlansAreSafe`
   (`conflict-resolution-planner.service.ts:500–578`) admits what is in four
   sets plus two inline checks, with different lists for the remote and the
   local side. The class of an action is the first set that names it.
3. **`REORDERS`, `PATCHES`, `REISSUED_REORDER_DELETES` and
   `LIST_ROUTED_FIELDS`** only make sense together, and already sit in one file
   with a spec that classifies fields.
4. **Task field lists overlap without referring to each other:** `dueWithTime`
   is both a reminder field and a cross-entity field; `title` and `notes` are
   both plain and content fields.
5. **The delete-wins marker is known in two places:** the classifier and the
   `toBaseEntity` hook that strips it (#11489).

### What falls through to a default

- **Per entity type** (18): 14 have no `RECREATE_FALLBACK` entry, 17 are not
  merged-snapshot types, 13 have no reorder action, 16 have no delete-wins
  classifier. Only TASK, NOTE and SIMPLE_COUNTER deletes can carry the entity.
- **Per multi-entity action:** 26 production action creators can declare more
  than one entity id (_measured_: `entityIds:` in `*.actions.ts`). 17 have a
  path for at least some crossings: 4 independent deletes, the bulk archive, 2
  scoped plans, 2 ordering-only, round time, 5 reorders, the cross-section
  move and the project move with subtasks. 9 default to the stop:
  `updateTasks`, which has live callers, and 8 for which
  [the 2026-09-26 audit](2026-09-26-sync-remaining-conflict-actions-audit.md)
  found no dispatch route (not re-verified here).
- **Per action type in general:** 110 of 147 are named nowhere in the family
  and take the generic single-entity path.

### Where the fixes went

Of the 34 fixes, 7 edited the members of an existing set or map (_measured_
with `git log -L` on eleven declarations: `REORDERS` three times, `PATCHES`
twice, and one each for `RECREATE_FALLBACK`, `REISSUED_REORDER_DELETES`,
`MERGED_SNAPSHOT_TYPES` and `TIMELESS_OPAQUE_TASK_ACTIONS`; some commits edit
two). The others added procedural code or a new constant. Six constants have
exactly one member: each is a named special case, not a classification.

The delete-versus-update fixes are the task's example of repeated work. They
used three mechanisms, not one (_measured_ from `git show --numstat`,
production lines without specs, E2E and docs):

| Fix    | Type           | Mechanism                                                        | Production | Tests    |
| ------ | -------------- | ---------------------------------------------------------------- | ---------- | -------- |
| #10452 | NOTE           | Delete carries the note; recreate restores list membership       | +62 −3     | +589 −10 |
| #10846 | TASK           | A time delta beats a delete; deltas fold onto the recreated task | +142 −43   | +715 −12 |
| #11474 | SIMPLE_COUNTER | Delete carries the counter; winning updates replay via reducer   | +110 −15   | +534 −91 |
| #11504 | SIMPLE_COUNTER | Whole-entity recreate skips the backfill                         | +89 −21    | +201 −49 |
| #11505 | TAG            | Marked delete wins (as for PROJECT)                              | +182 −23   | +751 −93 |

Tests are four to nine times the production change. A table shortens neither
column: the production lines are mechanism, and the tests are the both-direction
E2E and specs that rule 12 requires for any path.

### What already guards a refactor

- **Specs:** 18 spec files, 31,679 lines, for the family (_measured_).
- **Pinned fuzz traces:** 60 (_measured_). The fuzz intents cover tasks, notes
  and habits only (19 intent kinds in `sync-fuzz-actions.ts`). The entries for
  TAG, PROJECT, TASK_REPEAT_CFG, REMINDER, SECTION, BOARD and ISSUE_PROVIDER
  are therefore guarded by unit specs, integration specs and E2Es, not by
  traces.
- **Stops:** `unsupported-multi-entity-conflict.integration.spec.ts` and
  `reorder-conflict-wedge.integration.spec.ts` pin the stops that remain.
- **Completeness checks that exist today:** the entity registry spec, the
  `satisfies` field lists, the reorder field classification, and the
  `ActionType` member count (`action-types.enum.spec.ts`).

## Options

All options are behaviour-neutral for resolution outcomes and for released
clients, with no wire change and no schema bump, except where (c) says
otherwise.

### (a) Keep the constants; add a completeness test

A spec lists every entity type and every multi-entity action with its class in
each dimension, and fails when one is unclassified.

- **Lines** (_estimated_): 0 production, +120 to +180 spec.
- **Risk:** none for behaviour. The test restates 18 × 6 and 26 × 1
  classifications by hand, so it is a second copy of the constants that must be
  kept in step.
- **Already guarded:** entity types by the registry spec; optional fields by
  `satisfies`; list-routed fields by the reorder spec.
- **Evidence:** it guards against a new key taking a default unnoticed. In the
  period no key was added, so there is no observed instance
  ([hardening needs evidence](../hardening-earns-its-place.md)). Rule 14
  already asks a PR that adds a multi-entity action to name its path. The cases
  that did cause reports (#9405, #7330 recurring on SIMPLE_COUNTER, #10380)
  were existing keys whose known default turned out to matter; a test would
  have recorded that default, not changed it.

### (b) One declarative record per entity type (and per multi-entity action)

A typed record, complete over the 18 entity types by
`satisfies Record<…>`, with one field per dimension. Today's constants are
derived from it under their current names, so no reader changes.

```ts
// Sketch only. Names are not a proposal.
TASK:            { recreate: { defaults, requiredKeys }, updateVsUpdate: 'patch' },
NOTE:            { recreate: null,                       updateVsUpdate: 'whole' },
TASK_REPEAT_CFG: { recreate: null,                       updateVsUpdate: 'merged-snapshot' },
SIMPLE_COUNTER:  { recreate: { … , wholeEntityKeys },    updateVsUpdate: 'patch',
                   snapshotAsPatch: optionalFields, replayReducer },
REMINDER:        { recreate: null, updateVsUpdate: 'whole', arrayRecreate: 'skip' },
```

- **Entity half** (the six entity-keyed constants): _estimated_ +110 lines for
  the record, −40 from the declarations it replaces, +40 spec. Net production
  +70.
- **Action half** (the nine action-keyed constants and the 26 multi-entity
  actions): _estimated_ +140, −50, +60 spec. The four reorder constants would
  move away from the file that explains them.
- **Proof of neutrality:** a spec asserting that each derived constant
  deep-equals today's literal. Readers are untouched, so equal data is equal
  behaviour, for every entity type, including those the fuzz traces do not
  reach.
- **Risk:** low for outcomes. The real risk is in the sketch above:
  `updateVsUpdate: 'patch'` with `recreate: null` must stay unrepresentable or
  rejected by a spec, because the field patch relies on the recreate backfill
  (coupling 1).
- **What it buys:** coupling 1 becomes two fields. A later, separately
  justified fix could give NOTE a backfill without admitting it to patches,
  which today needs a new mechanism each time. It buys nothing for the 66
  `'TASK'` branches or for the task field lists.
- **What it costs:** the engine grows by about 70 lines, and one more file
  must be read before the readers make sense.

### (c) Generic code paths driven by the table

"One delete-versus-update policy per entity type" already exists in part:
`convertLocalDeleteRemoteUpdatesToLww` in `sync-core` is generic, and the
per-type residue is the hooks listed above.

- **Neutral part:** drive `toBaseEntity` (strip `subTasks`, strip the marker)
  and the two delete-wins classifiers from the record. _Estimated_ −30
  production lines. The classifiers differ in a way that matters (the project
  one is gated on a schema version, the tag one deliberately is not), so the
  shared shape is thin.
- **Not neutral:** giving the id-only types the recreate policy needs an
  entity snapshot on eight more delete actions. That is a new optional field
  on persisted actions and a different outcome on every client, for types with
  no report. It fails this evaluation's constraints and rule 15.
- **Not table-shaped:** the three mechanisms in the table above differ in
  what they preserve (list membership, additive time, semantic counter
  updates). A column can name the mechanism; it cannot replace it.

### Comparison

| Aspect                       | (a) Completeness test | (b) Entity record                | (b) Action record        | (c) Generic paths                 |
| ---------------------------- | --------------------- | -------------------------------- | ------------------------ | --------------------------------- |
| Production lines (estimated) | 0                     | +70 net                          | +90 net                  | −30 for the neutral part          |
| Spec lines (estimated)       | +120 to +180          | +40                              | +60                      | existing specs must be re-pointed |
| Behaviour-neutral            | Yes                   | Yes, by equality spec            | Yes, by equality spec    | Only the hook part                |
| Removes a coupling           | No                    | Coupling 1                       | Makes coupling 2 legible | Coupling 5                        |
| Observed instance it answers | None in the period    | 3 fixes routed around coupling 1 | None                     | None for the neutral part         |
| Guarded by the 60 traces     | n/a                   | TASK, NOTE, habit entries only   | Partly                   | Task and note deletes only        |
| Shrinks the engine           | No                    | No                               | No                       | Marginally                        |

## An engine-wide size budget

**Why per-file caps are not enough.** A per-file cap is satisfied by a new
file. That is what happened: the service went from 4,817 to 1,170 lines while
the family grew by 35%. Capping each of the 26 files separately would repeat
it, since a fix of the typical size (+62 to +182 production lines, measured
above) would have to raise a cap or open a new file.

**What to count** (recommended):

- **An explicit file list**, not a name pattern: the 26 family files plus the
  three helpers the pattern misses (29 files).
- **A second, complete assignment** so a new file cannot stay outside: every
  non-spec `.ts` file directly in `src/app/op-log/sync/` is either on the
  engine list or on an "other" list (transport, encryption, import gate), and
  the check fails for a file on neither. The observed instance is the helper
  added by #11474.
- **Non-blank, non-comment lines.** Physical lines (what `max-lines` counts by
  default) would reward deleting comments, and comments are 22% of the family
  (_measured_: 2,745 of 12,537 lines) and the only place the release
  constraints are written down. The starting value would be 9,253
  (_measured_ with a line-prefix classifier; a real implementation should
  state its rule and may differ by a few lines).
- **Not counted:** specs, test helpers, E2E.

**How to ratchet it.**

- A small Node script in `tools/` with its own test, run from `npm run lint`
  next to `lint:css-vars`, which CI already runs. No dependency is added.
- One number in the script's config. The check fails when the count is above
  it, and also when the count is more than 50 lines below it, so a reduction
  is locked in by the PR that makes it.
- **The number may go up, by hand, in the PR that needs it.** This is the one
  place where the budget cannot copy "may only go down": a fix that qualifies
  under rule 15 adds lines, and a budget that forbids it would be bypassed. A
  raise is a one-line diff the reviewer sees, with the reason in the PR body.
  The number is never regenerated by a script
  ([automation can launder a defect into recorded debt](../hardening-earns-its-place.md#the-three-failure-modes-worth-remembering)).
- **Known cost:** two open sync PRs that both grow the engine conflict on that
  one line. With at most five open sync PRs this is a small, real cost; it
  also means each of them restates the total after a rebase.

**What the budget does not do.** It does not say which lines are worth having.
It makes growth a visible, reviewed number instead of a property nobody
measures between architecture reviews.

## Recommendation

1. **Add the engine budget as a tools-only PR**, independent of any fix.
2. **Do the entity half of (b) together with the next fix that would edit an
   entity-keyed constant**, not as a standalone refactor. A standalone PR has
   no trigger under rule 15 and takes one of five PR slots for a change that
   adds lines.
3. **Do not build (a), the action half of (b), or (c).** Record them here as
   considered. If a multi-entity action is added, its PR adds the spec that
   lists the 26 actions with their class, at that point with an instance to
   justify it.
4. **Leave alone:** the reorder constants (cohesive, already
   self-checking), the task field lists (no instance of a new field
   misclassified), the 66 `'TASK'` branches, the `sync-core` option interface,
   and decisions D1 to D11.

### What a first PR would contain and prove

**PR 1, the budget (now).**

- Contains: `tools/check-sync-engine-budget.js`, its test in `test:tools`, the
  two file lists, the starting number, one line in the `lint` script, and two
  sentences in contributor-sync-model.md replacing "its `*.util.ts` helpers
  are uncapped".
- Proves: the check can fail (the test adds a line and a new unlisted file to
  a fixture and expects both failures) and passes on master.
- Touches no file under `src/` or `packages/`.

**PR 2, the entity record (with the next qualifying fix).**

- First commit, behaviour-neutral: the record, the six constants derived from
  it under their current names, and the equality spec. Proven by that spec,
  the unchanged family specs, the 60 pinned traces and
  `npm run sync-fuzz:compare` showing no new signature.
- Second commit: the fix itself, under the usual rules 12 to 16.
- Raises the budget by the measured amount.

### Decisions needed from @johannesjo

| #   | Question                                                               | Default if unanswered                                                                                                   |
| --- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| P1  | Add an engine-wide budget to CI?                                       | Yes, as PR 1                                                                                                            |
| P2  | What does it count?                                                    | Non-blank, non-comment lines of an explicit 29-file list; a new file in the directory must be assigned                  |
| P3  | May the number go up?                                                  | Yes, by hand in the PR that needs it, reason in the PR body; it must be lowered after a reduction of more than 50 lines |
| P4  | Per-entity policy record?                                              | Only with the next fix that edits an entity-keyed constant                                                              |
| P5  | Completeness test or per-action record?                                | No. Revisit when a multi-entity action or an entity type is added                                                       |
| P6  | Generic delete-versus-update for the id-only types?                    | No. Each further type needs its own report (rule 15)                                                                    |
| P7  | Does a behaviour-neutral engine refactor count toward the five-PR cap? | Yes                                                                                                                     |

## Reproducing the numbers

```bash
git fetch --shallow-since=2026-09-20 origin master   # the default clone is 50 commits deep
R=6169df9e9..954256d

# family at a commit: physical, non-blank, non-comment
git ls-tree -r --name-only <commit> -- src/app/op-log/sync \
  src/app/op-log/core/recreate-fallback.const.ts \
  src/app/root-store/meta/task-shared-meta-reducers/lww-update.meta-reducer.ts \
  packages/sync-core/src/conflict-resolution.ts | rg -v '\.spec\.ts$' \
  | rg '(/(conflict-|lww-|superseded-|reorder-|section-conflict-|fold-sync-time-spent|time-preserving-task-snapshot|preserve-partial-bulk-plan|bulk-archive-intent|rejected-ops-handler)|recreate-fallback|sync-core/src/conflict-resolution\.ts)'
# per file: wc -l; rg -c -v '^\s*$'; rg -v '^\s*$' | rg -c -v '^\s*(//|/\*|\*)'

git log --format=%s $R | rg -c '^fix\(sync'                  # 72
git log --format=%s $R -- <family paths> | rg -c '^fix\(sync'  # 34
git diff 6169df9e9 954256d -- src/app/op-log/core/action-types.enum.ts | rg '^[+-]\s+[A-Z]'   # empty
rg -o --no-filename 'ActionType\.[A-Z0-9_]+' <family files> | sort | uniq -c   # 37 distinct, 94 uses
rg -n 'entityIds:' src/app --glob '*actions.ts' --glob '!*.spec.ts'            # 26 declarations
git log --format='%h %s' -L'/export const RECREATE_FALLBACK/,/^};/:src/app/op-log/core/recreate-fallback.const.ts' $R
```

## Missing evidence

- **Whether a table would have shortened any of the 34 fixes.** Only a proxy
  was measured (7 edited an existing set). Nobody has timed a fix or its
  review.
- **A bug caused by coupling 1.** Three fixes were designed around it; none
  was found that tripped over it. That supports "do it with the next fix", not
  "do it now".
- **Release inclusion.** The clone has no tags, so which of the period's
  commits are in v20.0.0 was not checked. Nothing above depends on it.
- **The audit's "no dispatch route" findings** for 8 multi-entity actions are
  taken from the 2026-09-26 audit as written.
- **The task's figures** (7,600 to 10,750; 35 of 91; 28 constants) were not
  reproduced exactly. The method used here is stated next to each number.
- **The line classifier** for non-comment lines is a prefix match and
  miscounts code that shares a line with a block comment. The budget script
  needs a stated rule; the starting number should be taken from it, not from
  this document.
- **How the budget behaves with five open PRs** is argued, not observed.

## Review record

Filled in after the fresh-context challenge (see the end of this document's
history in the PR or commit message).
