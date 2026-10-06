# List order and membership: options for an order merge (D5)

**Status:** design only, no decision. Queue item 2 of tracker
[#10393](https://github.com/super-productivity/super-productivity/issues/10393),
started as the coordinator's default for its open question 4, not as a
decision by @johannesjo. It answers D5 ("membership is designed with an
order merge") next to [protocol-change-options.md](./protocol-change-options.md).
Measured on master `0bb6d44` (2026-10-06).

**Short answer.** List divergence is the largest remaining fuzz class: 71 of
120 seeds. Most of it is order only, and no user report shows harm from it, so
under rule 15 the recommended outcome is to **build nothing now** and keep this
note as the design to use if a report arrives. The one sub-class that is not
order-only, a Today note listed on one device and not on another (13 seeds), is
already tracked in #10379. Its cheapest fix is a read-side derivation that
needs no wire or model change (option B, below).

## What was measured

`sync-fuzz-signature-report.benchmark.ts`, the standard 120 seeds (mixes all,
noReorder, tasks and replace × seeds 20725000–029, 30 steps, 3 devices),
TZ Europe/Berlin. The run reproduces the 2026-10-06 sweep exactly: 93 seeds
with any signature, and the same list signatures.

| List signature (seeds of 120)    | Seeds |
| -------------------------------- | ----- |
| `tag.entities.*.taskIds` (TODAY) | 37    |
| `note.todayOrder`                | 25    |
| `task.ids`                       | 24    |
| `project.entities.*.taskIds`     | 20    |
| `note.ids`                       | 19    |
| `project.entities.*.noteIds`     | 4     |
| `simpleCounter.ids`              | 2     |
| any of these                     | 71    |
| only these, nothing else         | 25    |

The tracker's per-list figures "37 / 36 / 31 / 24" are the per-_entity_
divergence totals (tag / note / task / project), which also count field
divergence. The per-list figures are the ones above.

**The oracle cannot tell order from membership.** `diffPaths`
(`sync-fuzz-runner.ts`) compares arrays index by index, so `[a,b]` vs `[b,a]`
and `[a,b]` vs `[a,b,c]` give the same signature. It also compares _stored_
lists, including ids the UI filters out. To separate these, a scratch
classifier (not committed; its source is in the PR) ran the same 120 seeds.
For every device it compared three things with a fresh device:

- **Stored:** the persisted list.
- **Visible:** what the view shows. Today tasks are computed as
  `computeOrderedTaskIdsForToday` does. Today notes, project tasks and project
  notes are the stored list filtered to existing entities.
- **Derived:** membership from the child fact alone: `note.isPinnedToToday`,
  or `task.projectId` without `parentId` and not in the backlog.

All other signatures and the executed steps were identical to the unmodified
run (120/120).

| Seeds of 120                                                                        | Count |
| ----------------------------------------------------------------------------------- | ----- |
| any stored list differs                                                             | 71    |
| a visible list differs                                                              | 62    |
| – visible **order only**                                                            | 42    |
| – visible **membership** differs                                                    | 20    |
| stored only (`task.ids`, `note.ids` or stale ids; not a list the classifier models) | 9     |

Visible order, per list: Today tasks 33, Today notes 14, project tasks 19,
project notes 4, habits 2. The 20 membership seeds:

| Visible list  | Seeds | Cause                                                                                                                                                                                                                                           | List mechanism? |
| ------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Today notes   | 13    | `todayOrder` does not follow `isPinnedToToday` under a NOTE LWW Update (below). The pin flag itself converges in 12 of the 13; deriving membership from it would converge them. All 13 are project notes, which stay reachable in their project | **yes**         |
| Today tasks   | 6     | 5 are `task.dueDay` field divergence (membership is already derived), 1 is a task that exists on one device only                                                                                                                                | no              |
| Project tasks | 2     | a task that exists on one device only (#10380/#10381); `projectId` membership diverges the same way                                                                                                                                             | no              |

`today-notes` (13 seeds) is exactly the Today-notes membership row. Restart
(`restart-changed`, 16 seeds) changes a visible list in 10 of them. The
`project.taskIds` and `task.ids` restart losses are the #10381 entity
existence case, not a list mechanism.

## Inventory

Every persisted ordered id list that sync carries. "Declared" is what
`getOpEntityIds` sees. A write to a list that the op does not declare is never
detected as a conflict (`contributor-sync-model.md`, "Undeclared writes").
Paths are relative to `src/app/`.

| List                                                                           | Defined                                       | Writers (main)                                                                                                                                                                                                                                                                                                          | Declared                                                                                | Membership                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------ | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TODAY `tag.taskIds`                                                            | `features/tag/tag.const.ts`                   | `addTask`, `planTasksForToday` (`unique([...new, ...old])`, `task-shared-scheduling.reducer.ts`), schedule/unschedule, planner transfer/plan/move, short syntax, deadline auto-plan, `moveTaskInTodayTagList`, WorkContextMeta moves, TODAY repair effects (`tag.effects.ts`), LWW TASK `syncTodayTagTaskIds` (appends) | TASK or PLANNER; WorkContextMeta declares TAG                                           | **Derived** from `dueWithTime ?? dueDay` (`computeOrderedTaskIdsForToday`, `work-context.selectors.ts`; ADR #2). The list is order only                                                                                                                                                         |
| regular `tag.taskIds`                                                          | `features/work-context/work-context.model.ts` | `addTask`, `updateTask(tagIds)`, deletes, archive, restore, WorkContextMeta moves, `updateTag` (sort, plugin), LWW TASK `syncTagTaskIds` (appends)                                                                                                                                                                      | TASK; TAG for moves                                                                     | **Derived** from `task.tagIds` (`computeOrderedTaskIdsForTag`, `tag.reducer.ts`)                                                                                                                                                                                                                |
| `project.taskIds`                                                              | `features/project/project.model.ts`           | `addTask` (prepend unless `isAddToBottom`), convert to/from subtask, deletes, `updateTask(projectId)`, `moveToOtherProject`, restore, short syntax, batch update, section removal, WorkContextMeta moves, `updateProject` (sort, plugin `reorderTasks`), LWW TASK `syncProjectTaskIds` (appends)                        | TASK (the PROJECT write is undeclared); PROJECT for WorkContextMeta and `updateProject` | **Stored.** The view reads the list (`selectActiveWorkContext`). `task.projectId` exists, but a backlog task has no child fact                                                                                                                                                                  |
| `project.backlogTaskIds`                                                       | same                                          | backlog moves (declare TASK), `scheduleTaskWithTime`, `addTask(isAddToBacklog)`, deletes                                                                                                                                                                                                                                | TASK (undeclared)                                                                       | **Stored**, no child fact                                                                                                                                                                                                                                                                       |
| `project.noteIds`                                                              | same                                          | `addNote` (prepend), `deleteNote`, `updateNoteOrder` (positions only on master, #10407), `moveNoteToOtherProject`, LWW NOTE recreate (appends)                                                                                                                                                                          | NOTE (PROJECT undeclared); the reorder declares all listed NOTE ids                     | **Stored**; `note.projectId` exists                                                                                                                                                                                                                                                             |
| `note.todayOrder`                                                              | `features/note/note.model.ts`                 | `addNote` (prepend if pinned), `updateNote(isPinnedToToday)` (prepend if absent), `deleteNote`, `updateNoteOrder` (positions only on master, #10298), `deleteProject`, LWW NOTE recreate (appends)                                                                                                                      | NOTE                                                                                    | **Stored**; `note.isPinnedToToday` exists. An LWW Update of an existing note does not sync the list (`lww-update.meta-reducer.ts` only re-lists a recreated note)                                                                                                                               |
| `task.subTaskIds`                                                              | `features/tasks/task.model.ts`                | `addSubTask`, `moveSubTask` (writes both parents, declares the child), up/down/top/bottom, convert, deletes, restore, batch, LWW TASK `syncParentSubTaskIds`                                                                                                                                                            | the child TASK only                                                                     | **Stored**; `task.parentId` exists                                                                                                                                                                                                                                                              |
| `section.taskIds`                                                              | `features/section/section.model.ts`           | add/remove task to section, section cleanups on task delete/move/archive, LWW SECTION                                                                                                                                                                                                                                   | SECTION (cleanups undeclared)                                                           | **Stored**, no child fact (`section-conflict-replay.md`)                                                                                                                                                                                                                                        |
| `planner.days[day]`                                                            | `features/planner/store/planner.reducer.ts`   | planner transfer/plan/move (index-based `moveInList`), `addTask`, `updateTask(dueDay)`, scheduling                                                                                                                                                                                                                      | PLANNER                                                                                 | **Stored** for future days; `task.dueDay` exists                                                                                                                                                                                                                                                |
| `boardPanel.taskIds`                                                           | `features/boards/boards.model.ts`             | `updatePanelCfgTaskIds` (full replace), `updateBoard`                                                                                                                                                                                                                                                                   | BOARD (entity id = panel id)                                                            | **Derived** from panel filters; the list is order only                                                                                                                                                                                                                                          |
| `menuTree` project/tag trees                                                   | `features/menu-tree/store/menu-tree.model.ts` | whole-tree updates, folder edits, undeclared writes from project/tag add and delete                                                                                                                                                                                                                                     | MENU_TREE singleton                                                                     | Partly derived (the view appends missing projects and tags)                                                                                                                                                                                                                                     |
| adapter `ids`: task, note, simpleCounter, issueProvider, section, project, tag | each `*.reducer.ts` (no `sortComparer`)       | adds append (`note` prepends), `[SimpleCounter] Update SimpleCounter Order`, `sortIssueProvidersFirst`, `updateSectionOrder`                                                                                                                                                                                            | the entity type                                                                         | Order only. Habits, issue providers and sections display this order. `task.ids` order reaches lists built from all tasks (overdue, deadlines; not measured here), and `Object.keys(entities)` order decides where an _unlisted_ Today or tag member goes. No view of `note.ids` order was found |

The plugin API exposes `Project.taskIds`, `backlogTaskIds`, `noteIds`,
`Tag.taskIds` and `Task.subTaskIds` (`packages/plugin-api/src/types.ts`), and
`reorderTasks(taskIds, contextId, 'project' | 'task')` replaces a whole list
(`plugin-bridge.service.ts`). `updateProject` and `updateTag` accept list
fields.

### How the lists diverge

Three mechanisms, each read on a real trace with the device op logs dumped
(`runFuzz({ debug: true })`):

1. **Author and receivers use different insertion rules.** On
   `tasks:20725000` (no reorder intent at all), device B tracks unscheduled
   task t3, and `planTasksForToday` puts t3 _first_ in TODAY. The server
   rejects that op as concurrent with C's edit of t3. The fact reaches every
   other device as a `[TASK] LWW Update`, whose `syncTodayTagTaskIds` puts t3
   _last_. B ends `[t3,t2,t1]`, everyone else `[t2,t1,t3]`, for good. The same
   split exists for `project.taskIds` (prepending `addTask` vs appending
   `syncProjectTaskIds`) and for notes (prepend vs the recreate's append). In
   18 of the 33 Today-task seeds, one task is first on one device and last on
   the other.
2. **Insertion depends on apply order.** `addTask`, `addNote` and a pin
   prepend relative to the list the device holds when it applies the op. Two
   concurrent adds end in a different order on the devices that applied them
   in a different order (e.g. `noReorder:20725001`, project tasks `[t13,t11,t14,…]`
   vs `[t14,t13,t11,…]`; read from the lists, not dumped). The unordered tail of a derived list follows
   `Object.keys(entities)` order, which is each device's own insertion order.
3. **The list does not follow the fact (status-blind).** On
   `noReorder:20725006` and `all:20725010`, a `[NOTE] LWW Update` row changes
   `isPinnedToToday` on an existing note. `lwwUpdateMetaReducer` does not touch
   `todayOrder` for it, so devices that had applied the pin keep the note in
   Today while others don't. This is #10379's "Today note order" part,
   confirmed there in a browser.

**Released clients add a fourth, which the harness cannot show.** v18.15.0
and v19.1.0 apply `updateNoteOrder` as a whole-list replace (`todayOrder: ids`
in `note.reducer.ts`, `noteIds: ids` in `project.reducer.ts`). Master keeps
membership (#10298, #10407), which is unreleased: `git tag --contains
9498efc77` is empty. So a released receiver drops a note pinned concurrently
with a reorder, and a current one keeps it.

**Order stops are a separate, kept class.** 10 seeds stop on a remote habit
order, and 2 on a local note order (`SYNC_MULTI_ENTITY_UNSUPPORTED`). #10407
kept them on purpose. A reorder is a multi-entity op because the list lives
on the parent, while the ids it moves are the children.

## Rule 15: evidence of harm

Searched in user wording (order, sort, sorted differently, Today list, notes
order, missing from list, duplicate) on 2026-10-06:

- **#8462** "Sort order inside lists does not sync between devices"
  (v18.9/v18.10, WebDAV): the user's _view sort setting_ is not synced. A
  contributor reports it partly fixed in v19.1.0 when saved as the default.
  It is a different cause, as #10382 already notes.
- **#7458** "Phantom duplicated tasks" (v18.2.5, after setting up a new
  device): subtasks shown twice. It is unreproduced on v18.19.0, and no data
  was captured.
- No report matches mechanisms 1–3.

`contributor-sync-model.md` § Fix intake says: "Order-only differences, and
disagreement that the next sync repairs, do not qualify." So:

- **Order (42 visible seeds, plus the invisible ones):** does not qualify.
  This note is design-only, and **building nothing is a valid outcome**.
- **Today-note membership (13 seeds, #10379):** the note itself, its content
  and its pin flag converge. Only whether Today lists it differs, and it stays
  in its project. Whether that counts as "permanent content divergence" is a
  judgment call (decision O1 below). The default reading here is no.
- **Order stops (12 seeds):** a sync stop qualifies by the letter, but #10407
  kept these stops by decision. No user has reported one.

## Options

What every option must cope with:

- **Released clients v18.15–v19.1** ignore unknown fields (typia
  `createValidate`, `updateOne` keeps unknown keys; ADR #8) and keep running
  their own reducers. A new rule for applying an op is an apply-time change:
  old and new devices apply the same op differently (`protocol-change-options.md`).
- **File providers** run the same reducers on the same ops, but every device
  resolves, with no server referee (D7).

### (A) Do nothing beyond D6

Keep the lists as they are. Record order and Today-note membership as rule 15
residue, and fix only when a report arrives.

### (B) Derived membership plus a deterministic read-side order

Extend ADR #2 to the lists that have a complete child fact. The stored list is
an order _hint_ only. The view computes `[listed members in list order] +
[unlisted members by a fixed key]`. The key is a child fact present on every
device, e.g. `created` descending and then id. It replaces today's
`Object.keys(entities)` tail.

- **Implicit writers stop inserting.** Add, plan, LWW sync and repair effects
  only remove ids; removals commute. Only an explicit user reorder writes
  positions.
- **Phase 1:** Today tasks, which are already derived, and Today notes, from
  `isPinnedToToday`. Regular tags also qualify.
- **Not reachable without a new child fact:** project tasks (backlog has no
  fact), sections, and future planner days. Project notes qualify only once
  every view and plugin reads `note.projectId`, not `noteIds`.

### (C) Position on the child

Each child carries its own sort key per list, e.g. an optional
`orderKeys?: Record<contextId, string>` of fractional-index strings, written
by an in-repo helper (no new dependency). The list order is "sort members by
(key, id)". A reorder is a single-entity write of the moved child's key.
Membership is derived as in (B). The stored list stays for released clients
and plugins, written as a dual field (ADR #8).

### (D) A list CRDT (RGA-style sequence)

Each list becomes a sequence of elements with unique insert ids, anchors and
tombstones. Ops are "insert after X" and "remove". Concurrent inserts at one
anchor are ordered by insert id, so any apply order converges.

Considered and folded in: **a deterministic post-merge repair** that rewrites
a list after each sync. It converges only if its output is a function of
state that all devices share. That is (B)'s read-side order, done at read time
without a write. A repair that _writes_ a list emits an op on every device
after each sync (churn, and a crossing with every reorder), and on file
providers nothing serializes the competing repairs.

### Comparison

|                                                         | (A) Nothing                      | (B) Derived + read-side order                                                                                                                                                                                                                                                                                                                                                                                             | (C) Key on the child                                                                                                                                                                                                                                                                                                                                                                                                   | (D) Sequence CRDT                                                                                                                               |
| ------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Same ops, any order → same list**                     | No (mechanisms 1–3)              | Yes for adds, plans, LWW rows and pins: the view is a function of the converged child facts and of a list only explicit reorders write. Concurrent explicit reorders stay as today, either whole-list LWW or anchor moves, apply-order dependent. The fuzz has no task-move intent, so they are unmeasured                                                                                                                | Yes wherever the child's key converges (entity LWW, the field patch for TASK since #10448). Two devices that pick the same key fall back to the id order. Concurrent moves of _different_ items both survive                                                                                                                                                                                                           | Yes, by construction, including concurrent moves                                                                                                |
| **Replay determinism / restart**                        | Restart changes order (10 seeds) | Deterministic: no hidden state; the key is a persisted child field                                                                                                                                                                                                                                                                                                                                                        | Deterministic                                                                                                                                                                                                                                                                                                                                                                                                          | Deterministic, if tombstones survive compaction and snapshots                                                                                   |
| **Released clients (mixed fleet)**                      | Unchanged                        | Old devices keep their own insertion rules, so they keep diverging among themselves, as today. New devices converge among themselves. They apply a released resolver's TAG or NOTE snapshot like any other row. Order between old and new devices differs: order only, D6. No released client misapplies a new op, since no new op exists                                                                                 | Old devices never write keys. Their reorders and adds change only the list, so a new device must turn an old device's list write into keys (re-derive keys from the list it receives). Two new devices can re-derive from different local lists, so mixed-fleet convergence needs the floor (#10397), which file providers cannot get (`client-version-floor.md` item 8). Old devices still send multi-entity reorders | Old devices cannot apply sequence ops. Needs a new op type plus a compatibility path, or the floor. Old devices' list writes must be translated |
| **Wire**                                                | None                             | None                                                                                                                                                                                                                                                                                                                                                                                                                      | An optional key field in existing payloads (TASK/NOTE/habit updates, `addTask`). Reorder ops change shape: new single-entity key writes beside the legacy multi-entity reorders                                                                                                                                                                                                                                        | New op types and payloads; entity registry entries; `action-types.enum.ts` strings are permanent                                                |
| **Persisted model**                                     | None                             | None: the lists stay; an optional placement key could reuse `created`                                                                                                                                                                                                                                                                                                                                                     | New optional field on TASK, NOTE and habit; per-context keys mean one map per child (rule 11: optional plus runtime default)                                                                                                                                                                                                                                                                                           | New persisted structure per list (elements, tombstones), plus compaction/GC                                                                     |
| **Plugin API**                                          | None                             | `Project.taskIds` etc. unchanged. `Tag.taskIds` already "order only"; documented semantics for Today notes change                                                                                                                                                                                                                                                                                                         | `reorderTasks` must write keys; `*.taskIds` become derived, read-only in practice; `updateProject({taskIds})` needs translating                                                                                                                                                                                                                                                                                        | as (C), larger                                                                                                                                  |
| **File providers (D7)**                                 | None                             | No format change. It is an apply-time change, but it only stops writes and adds a read-side rule, so old and new readers of one file differ in order only                                                                                                                                                                                                                                                                 | Additive fields, no format change, but an apply-time change: per D7, planned with the file format; mixed old/new readers diverge                                                                                                                                                                                                                                                                                       | Format change: new op types in the file log; D7 applies in full                                                                                 |
| **Fuzz seeds plausibly fixed** (stored-list signatures) | 0                                | Today tasks 37 stored / 33 visible, if `planTasksForToday`, `addTask` and LWW stop inserting into TODAY. Today-note membership 12 of 13, and plausibly the `todayOrder` seeds without an explicit Today note reorder (24 of 25), if Today notes are derived. Not project lists, `task.ids` or `note.ids`. The oracle would have to compare visible order for derived lists, since stored hints may then differ harmlessly | All visible list classes, once every writer uses keys: Today tasks and notes, project tasks and notes, habits. Also plausibly the 12 order stops, since a reorder no longer spans several entities. Not `task.ids`/`note.ids` (invisible), and only among new clients                                                                                                                                                  | As (C), plus concurrent moves                                                                                                                   |
| **Special-case code deleted**                           | None                             | TODAY parts of `syncTodayTagTaskIds` and the insertion branches of `planTasksForToday`, `addTask`, planner and short syntax for TODAY. `repairTodayTagConsistency$` and `preventParentAndSubTaskInTodayList$` become moot for order. #10379's missing NOTE list sync never needs writing. Roughly a few hundred lines, not measured                                                                                       | After the floor: `reorder-conflict.util.ts` (563 lines) and the reissue path (`reissueCrossedPendingReorders` in `remote-ops-processing.service.ts`/`operation-log-upload.service.ts`), most of the list compensation in `lww-update.meta-reducer.ts` (≈430 lines, lines 43–473), the rule 13 recreate exceptions. Before the floor: nothing, since released clients still send list writes                            | As (C) after the floor, but adds a CRDT implementation                                                                                          |
| **Code added**                                          | None                             | Small: a shared placement rule for the derived selectors; removing the implicit inserts; a move must write the _visible_ order, because `moveItemAfterAnchor` appends when the anchor is unlisted (`work-context-meta.helper.ts`)                                                                                                                                                                                         | Large: key helper, a key write in every list writer (about 34 files read or write the lists, `protocol-change-options.md`), translation of legacy list writes, dual-field writes                                                                                                                                                                                                                                       | Largest                                                                                                                                         |
| **UX risk**                                             | None                             | Where an unlisted member lands changes: today "add to top/bottom" and "plan puts it first" are insertion rules. A fixed key must reproduce "new on top", and `isAddToBottom` either stays an explicit list write (apply-order dependent again for concurrent adds) or is dropped                                                                                                                                          | None visible, once correct                                                                                                                                                                                                                                                                                                                                                                                             | None visible                                                                                                                                    |

## Recommendation

1. **Build nothing now (A).** Order is the bulk of the class, and rule 15
   excludes it. No report matches it, and #8462 has a different cause. Keep
   this note and the classifier recipe, so a report can be measured against
   the same seeds.
2. **If a report arrives about Today, use (B), phase 1 only:** Today tasks
   and Today notes. It needs no wire key, no persisted field and no plugin
   change, and it converges new devices without the floor. Old devices are no
   worse than today. Its cost is a UX decision about where an unlisted member
   lands (O3).
3. **Do not start (C) or (D) without the floor (#10397).** In a mixed fleet,
   neither removes code, and both need released clients gone to converge. (C)
   is the one to revisit when the floor is enforced: it is the only option
   that also retires the reorder special cases (`reorder-conflict.util.ts`,
   the reissue path, the 12 kept order stops) and rule 13's recreate
   exceptions. (D) costs more than (C) for one extra property, concurrent
   moves of the same item, which no seed or report shows.
4. **Do not derive project membership** before a backlog child fact exists.
   Membership and order stay together for project lists, as D5 asks.

### Decisions needed from @johannesjo

Each has the default this note proposes. None is decided.

| #   | Question                                                                                | Default                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1  | Is a Today note listed on one device and not another (#10379's note part) rule 15 harm? | No: the note, its content and its pin flag converge, and it stays in its project. It stays recorded residue in #10379                             |
| O2  | Build an order merge now?                                                               | No (A). Revisit (B) phase 1 on a user report about Today order or Today notes; revisit (C) once the floor is enforced                             |
| O3  | If (B) is built: where does an unlisted member land?                                    | First, newest `created` first, then id: closest to today's "new and planned tasks go on top". `isAddToBottom` stays an explicit list write        |
| O4  | If (B) is built: should the fuzz oracle compare _visible_ order for derived lists?      | Yes, for TODAY, regular tags and Today notes only. Stored hints may then differ without harm, and the stored comparison would keep reporting them |
| O5  | Does D7 (file format with apply-time changes) apply to (B)?                             | No: (B) changes no format and only stops writes, so old and new readers of one file differ in order only. D7 applies to (C) and (D)               |

### What a first PR would contain and prove (only after O2 changes)

Scope: (B) phase 1 for Today tasks. Today notes follow in a second PR, so each
PR can be reverted on its own.

- **Code:**
  - one placement rule shared by `computeOrderedTaskIdsForToday` and
    `computeOrderedTaskIdsForTag`;
  - `planTasksForToday`, `addTask` (unless `isAddToBottom`), the planner,
    short syntax and `syncTodayTagTaskIds` stop inserting into TODAY;
  - Today moves write the visible order.
- **E2E first, red on master, on SuperSync and WebDAV:**
  - The mechanism-1 shape, from `tasks:20725000`: A and B track the same
    unscheduled task while offline, then each syncs. Run it in both upload
    orders. Assert the same Today order on both devices, on a fresh third
    client, and after reloading each device (the restart check).
  - The mechanism-2 shape: two devices each add a task to Today offline. Run
    both directions.
  - A run against the unmodified v19.1.0 bundle, as #10407 did. It shows that
    released devices are no worse and that nothing stops.
- **Fuzz:** run `npm run sync-fuzz:compare` and judge each newly failing
  entry on its original seed. Expect TODAY `tag.taskIds` to drop from 37
  seeds, and nothing to be newly failing. Today-order restart changes (3
  seeds) should go.
- **Unit:** the selector's placement against unlisted members in two different
  `Object.keys` orders.

## Reproducing the numbers

- The standard report: `npm run test:file
src/app/op-log/testing/integration/sync-fuzz/sync-fuzz-signature-report.benchmark.ts`.
  Its expected non-zero exit carries the JSON between `SYNC_FUZZ_REPORT_START`
  and `SYNC_FUZZ_REPORT_END`.
- The classifier is a scratch patch to `sync-fuzz-runner.ts` and the report
  benchmark, given in full in the PR that added this note. Apply it in a
  worktree and run the same command. It adds `ord-stored:*`, `ord-visible:*`,
  `ord-derived:*`, `ordself:*` and `rord-*` signatures, and leaves every other
  signature unchanged.
- Op-log dumps: `runFuzz({ steps, debug: true })` with the seed's executed
  steps (as `sync-fuzz-seeds.benchmark.ts`'s `DEBUG_TRACES` does).

## Missing evidence

- Concurrent _explicit_ task moves: the fuzz has no task-move intent, so no
  number covers the case that separates (B) from (C) and (D).
- Released clients in the harness: mechanism 4 and every mixed-fleet row above
  are from code reading.
- File providers: the harness models SuperSync only. Every device resolves
  there, so mechanism 1 plausibly occurs there too. Unmeasured.
- The size of (B)'s deletions: the branch counts above are from reading the
  code, not from a diff.
