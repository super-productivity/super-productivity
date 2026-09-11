# Todoist import plugin

This bundled, one-time importer adds active Todoist data to Super Productivity.
It is additive: it never replaces existing app data and is not a live Todoist
integration.

## Data and privacy boundary

- The plugin requests Todoist unified Sync API v1 at
  `https://api.todoist.com/api/v1/sync`, first with `sync_token=*` and then with
  the returned token so changes during a delayed snapshot are included.
- The personal API token exists only in iframe memory for the import session. It
  is sent only to `api.todoist.com` and is never stored, synced, or logged.
- The manifest therefore declares `http` and exactly
  `allowedHosts: ["api.todoist.com"]`.
- The import is project-by-project and is not transactional. A failure can leave
  the current project partial; the result tells the user which project to delete
  before retrying.

## Mapping and deliberate losses

The importer handles active projects, top-level tasks, two levels of subtasks,
notes/comments, labels on top-level tasks, due dates/times, and minute-based time
estimates.

Current limitations are surfaced in preview and summary:

- nested projects are flattened and sections are not imported;
- deeper subtasks are re-parented to the top-level ancestor;
- subtask labels and priorities are omitted because SP subtasks cannot hold tags;
- recurrence keeps the next due date and appends the Todoist recurrence text to
  notes; no `TaskRepeatCfg` is created;
- day-based durations, assignees, file attachments, completed history, and
  reminders are not imported; and
- collision detection sees active SP projects only, so an archived prior import
  may not be recognized.

## Batch invariants

`src/map/plan-import.ts` and `src/map/run-import.ts` deliberately:

- send at most 50 operations per awaited `batchUpdateForProject` call;
- create parents before children;
- use `temp-`-prefixed IDs for unresolved parents; and
- replace parent temp IDs with returned real IDs before a later batch call.

Changing any of these can orphan and delete imported subtasks or collapse many
dispatches into one event-loop turn. The batch result is not authoritative, so
the importer re-reads tasks and compares landed counts with the plan.

Due dates, timed due values, and tags are follow-up `updateTask` calls because
the batch-create contract does not carry them. `TODAY` is virtual and must never
be written to `task.tagIds`.

## Development

```bash
cd packages/plugin-dev/todoist-import
npm test
npm run build
```

Pure parsing, mapping, lossy-summary, localization, and executor behavior are
covered by colocated Jest specs. Also run `npm run plugins:build` from the
repository root after packaging changes.
