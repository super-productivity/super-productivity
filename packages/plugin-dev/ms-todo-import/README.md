# Microsoft To Do import plugin

This bundled, one-time importer adds Microsoft To Do data to Super
Productivity. It is additive: it never replaces existing app data and is not a
live Microsoft To Do integration.

## Data and privacy boundary

- The user signs in with Microsoft (OAuth 2.0 authorization code + PKCE via
  `PluginAPI.startOAuthFlow`, public client, no secret) and grants only the
  delegated `Tasks.Read` scope. No `offline_access`: there is no refresh token.
- The plugin reads `https://graph.microsoft.com/v1.0/me/todo/lists` and each
  list's tasks with `$expand=checklistItems`, following `@odata.nextLink`
  only while it stays on `graph.microsoft.com`.
- The token is cleared right after loading. The manifest therefore declares
  `http` and exactly `allowedHosts: ["graph.microsoft.com"]`; the token
  exchange with `login.microsoftonline.com` is done by the host.
- The client ID in `src/ui/oauth-config.ts` belongs to the Super Productivity
  Entra app registration (personal + work accounts, public client flows on,
  delegated `Tasks.Read`). Its redirect URIs: `http://127.0.0.1` under "Mobile
  and desktop" (Electron loopback; Microsoft ignores the port) and one
  `<web origin>/assets/oauth-callback.html` per deployed web origin
  under "Single-page application" (web). Native apps are not supported:
  Microsoft rejects the token request from a WebView with an `Origin` header
  for a custom-scheme redirect, so the settings button is hidden there.
- Microsoft's API terms want a public privacy statement (with consent
  revocation links) and a Microsoft no-warranty notice reachable in the app.
  Both live in the `#privacy` section of `docs/wiki/2.27-Import-from-Microsoft-To-Do.md`,
  published at <https://super-productivity.com/docs/how-to/import-from-microsoft-to-do/#privacy>,
  which the sign-in screen links. The Entra registration's privacy statement
  URL should point there too (set in the Azure portal).
- The import is list-by-list and is not transactional. A failure can leave the
  current project partial; the result tells the user which project to delete
  before retrying.

## Mapping and deliberate losses

Each list becomes a project (the default list is renamed
"`<name>` (Microsoft To Do)", duplicate names get a ` (2)` suffix). Open tasks
become tasks by default; completed tasks are opt-in.
Steps become sub-tasks, checked steps done. Notes (HTML reduced
to text), due days, categories (as tags) and, on opt-in, an `important` tag for
starred tasks carry over. The flagged-email list is unselected by default.

Repeats (`src/parse/map-recurrence.ts`) map to repeat configs when Super
Productivity can express them: daily/weekly/monthly/yearly intervals, weekday
sets, monthly on the due day, yearly on the due date, first–fourth weekday of
the month, and an end date. Anything else — a monthly day other than the due
day, "last weekday", a fixed number of occurrences, or a repeat the app rejects
— keeps the next due date and the rule text in the notes.

Reminders, file attachments, folder groups, My Day and linked emails/files
are not imported; the preview lists the counts. Collision detection sees
active projects only, so an archived prior import may not be recognized.

## Batch invariants

`src/map/plan-import.ts` and `src/map/run-import.ts` deliberately:

- send at most 50 operations per awaited `batchUpdateForProject` call;
- create parents before children;
- use `temp-`-prefixed IDs for unresolved parents; and
- replace parent temp IDs with returned real IDs before a later batch call.

Changing any of these can orphan and delete imported subtasks or collapse many
dispatches into one event-loop turn. The batch result is not authoritative, so
the importer re-reads tasks and compares landed counts with the plan.

Due dates, tags and repeats are follow-up `updateTask` calls because
the batch-create contract does not carry them. `TODAY` is virtual and must never
be written to `task.tagIds`.

## Development

```bash
cd packages/plugin-dev/ms-todo-import
npm test
npm run build
```

Pure parsing, mapping, lossy-summary, localization, and executor behavior are
covered by colocated Jest specs. Also run `npm run plugins:build` from the
repository root after packaging changes.
