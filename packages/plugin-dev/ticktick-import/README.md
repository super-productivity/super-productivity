# TickTick import plugin

This bundled, one-time importer adds open TickTick tasks from a TickTick CSV
backup to Super Productivity. It is additive: it never replaces existing app
data and is not a live TickTick integration.

## Data and privacy boundary

- The user picks the backup file (TickTick web → Settings → Backup → Generate
  backup); it is read with `File.text()` inside the iframe and never uploaded.
- The manifest therefore declares no `http` permission and no `allowedHosts`.
  TickTick's Open API was not used: it needs an OAuth client secret and a
  redirect flow, which a bundled offline plugin cannot hold.
- The import is project-by-project and is not transactional. A failure can leave
  the current project partial; the result tells the user which project to delete
  before retrying.

## Backup format

TickTick does not document the CSV. `src/parse/` follows real exports as
handled by other importers (e.g. Vikunja's TickTick migrator):

- a few `Date:` / `Version:` / `Status:` preamble lines precede the header, so
  the parser locates the header row instead of skipping a fixed count;
- instants are `2023-12-20T10:00:00+0000`; all-day dates are midnight in the
  row's `Timezone`, stored as UTC;
- `Status` 0 = open; 1, 2 and -1 (completed, archived, won't do) are skipped;
- checklist items are `Content` lines prefixed `▫` (open) or `▪` (checked);
- `taskId` / `parentId` link sub-tasks; older exports without them fall back
  to row ids.

## Mapping and deliberate losses

The importer handles lists (as projects), open tasks, two levels of sub-tasks,
checklist items (as sub-tasks of top-level tasks, done items stay done), notes,
tags on top-level tasks, due dates/times and optional priority tags.

Current limitations are surfaced in preview and summary:

- folders are flattened; same-named lists become `Folder / List`; kanban
  columns are dropped;
- deeper sub-tasks are re-parented to the top-level ancestor; checklists on
  sub-tasks stay as a markdown checklist in notes;
- sub-task tags and priorities are omitted because SP sub-tasks cannot hold tags;
- recurrence keeps the next due date and appends the RRULE to notes; no
  `TaskRepeatCfg` is created;
- reminders and completed, archived or won't-do tasks are not imported.

## Batch invariants

`src/map/plan-import.ts` and `src/map/run-import.ts` follow the same rules as
the Todoist importer (`run-import.ts` is a copy of it — keep fixes in sync):

- send at most 50 operations per awaited `batchUpdateForProject` call;
- create parents before children;
- use `temp-`-prefixed IDs for unresolved parents; and
- replace parent temp IDs with returned real IDs before a later batch call.

Due dates and tags are follow-up `updateTask` calls because the batch-create
contract does not carry them. `TODAY` is virtual and must never be written to
`task.tagIds`.

## Development

```bash
cd packages/plugin-dev/ticktick-import
npm test
npm run build
```
