# Plainspace Integration Plan

Integrating **Plainspace** (plainspace.org — repo `Johannesjo/spaces`) into Super
Productivity (SP) so that:

1. A project can be made **shared on Plainspace** directly from the project
   create/edit dialog.
2. For such shared projects the work view shows **two task lists**:
   - **My list** — unassigned tasks + tasks assigned to the current user, rendered
     by the regular SP task list (these are real, editable SP tasks).
   - **Assigned to others** — a new, mostly read‑only component showing tasks
     other members own.

> Status: planning + prototype. The Plainspace HTTP API contract is not yet
> pinned down in this document (see [Open questions](#10-open-questions--blocking-decisions));
> the prototype is built against an **assumed contract** isolated behind a single
> API service so it can be corrected in one place once the real API is known.
>
> **Implemented today (mock-backed):**
>
> - §4 — the `PLAINSPACE` issue provider (`providers/plainspace/`): config form,
>   `PlainspaceApiService` (mock mode via `PLAINSPACE_USE_MOCK`),
>   `PlainspaceCommonInterfacesService` implementing `IssueServiceInterface`,
>   registered in `issue.model.ts` / `issue.const.ts` / `issue.service.ts` +
>   icon. Mine/unassigned tasks import via the normal issue→backlog pipeline.
> - §6 — the "Share on Plainspace" toggle in the create-project dialog, which
>   provisions a (mock) space and a bound provider via `PlainspaceShareService`.
> - §9 — the "Assigned to others" UI panel (hard-coded sample data).
>
> **Still design-only:** §5 account login / real identity, §7.2 live
> `PlainspaceSharedTasksService` wiring for the panel, §8 write-back, and the
> real HTTP API (all `PlainspaceApiService` calls are mocked — see §10).

---

## 1. Guiding decisions (agreed)

| Decision                            | Choice                                                                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Source of truth** for shared data | **Plainspace backend.** SP reads/writes shared tasks via Plainspace's API as a separate channel from SP's own op‑log sync. |
| **Integration shape**               | Model Plainspace as a **regular issue provider** (like Jira/Redmine) "for the most part".                                  |
| **Identity**                        | **Plainspace account login** (token-based). The authenticated account defines "me" for the assigned/unassigned split.      |
| **v1 scope**                        | Plan the full feature; build a working **prototype** (UI + provider scaffold against an assumed/mock API).                 |

### Why "issue provider" is the right host

SP already has a mature, well-factored issue-provider system (Jira, GitLab,
CalDAV, OpenProject, Trello, Redmine, Azure DevOps, Nextcloud Deck). It gives us,
for free:

- Per-provider config + Formly config form, stored in the issue-provider NgRx
  store and bindable to a specific project via `defaultProjectId`.
- Search in the add-task bar, "add issue as task", attachments mapping.
- **Auto-import to backlog** (`getNewIssuesToAddToBacklog`) and **polling for
  fresh data** (`getFreshDataForIssueTask`) with a configurable `pollInterval`.
- A clean single interface to implement: `IssueServiceInterface`.

This means "Plainspace issues assigned to me" can flow through the **existing**
issue→task pipeline with almost no new core code. The only genuinely new surface
is the **"assigned to others"** read-only list, because that data is _not_
imported as SP tasks.

### The one important nuance

The standard issue-provider flow turns issues **into** SP tasks. We only want to
do that for **my / unassigned** items. Tasks **assigned to others** must be
_shown_ but **not** imported as editable SP tasks (they are not my work, and
importing them would pollute counts, scheduling, time tracking, and sync). So the
design is a **hybrid**:

- **Mine / unassigned** → imported as real SP tasks via the issue-provider
  pipeline → appear in the normal list.
- **Assigned to others** → fetched directly from Plainspace and rendered
  read-only by a new component → never enter the SP task store.

---

## 2. Architecture overview

```
                    ┌─────────────────────────────────────────────┐
                    │                Plainspace API                │
                    │  spaces (projects) · tasks · members · auth  │
                    └───────────────┬───────────────┬─────────────┘
                                    │               │
                 (issue-provider channel)     (shared-project channel)
                                    │               │
   ┌────────────────────────────────▼──┐   ┌────────▼───────────────────────────┐
   │ PlainspaceApiService (HTTP)        │   │ PlainspaceAccountService (auth/me) │
   │ PlainspaceCommonInterfacesService  │   │ PlainspaceSharedTasksService/Store │
   │  implements IssueServiceInterface  │   │  (others' tasks, members)          │
   └───────────────┬────────────────────┘   └───────────────┬────────────────────┘
                   │                                          │
   ┌───────────────▼────────────────┐        ┌────────────────▼───────────────────┐
   │ Existing issue→task pipeline    │        │ NEW "Assigned to others" panel      │
   │ → real SP tasks (mine/unassigned)│       │ in work-view (read-only task cards) │
   └─────────────────────────────────┘        └─────────────────────────────────────┘
                   │                                          │
                   └──────────────► Project work view ◄───────┘
                         (My list)            (Assigned-to-others list)
```

- **Issue-provider channel** = the Jira-like path. Registers a `PLAINSPACE`
  provider, bound per project via `defaultProjectId` (= the SP project the space
  maps to). Imports my/unassigned issues, polls them for freshness.
- **Shared-project channel** = the new bits: account login, fetching members and
  others' tasks, and creating a space when a project is shared.

SP's own op-log/vector-clock sync is **untouched**: shared data does not flow
through it. (Doing so would mean teaching the single-user op-log to carry
multi-user ops — explicitly rejected as too risky.)

---

## 3. Data model changes

### 3.1 New issue-provider config (`PlainspaceCfg`)

New folder `src/app/features/issue/providers/plainspace/`. Config interface (mirrors
`RedmineCfg`):

```ts
export interface PlainspaceCfg extends BaseIssueProviderCfg {
  host: string | null; // plainspace.org or self-hosted base URL
  spaceId: string | null; // the Plainspace "space" this provider is bound to
  // auth token is NOT stored here; it lives with the account (see 3.3) so a
  // single login covers all spaces. host+spaceId identify the remote project.
}
```

### 3.2 Plainspace issue/task shapes (assumed — single source to fix later)

```ts
// src/app/features/issue/providers/plainspace/plainspace-issue.model.ts
export interface PlainspaceMember {
  id: string;
  name: string;
  avatarUrl?: string;
}

export interface PlainspaceIssue {
  id: string;
  title: string;
  isDone: boolean;
  assigneeId: string | null; // null = unassigned
  assignee?: PlainspaceMember | null;
  updatedAt: string; // ISO
  url?: string;
  // ...extend once the real API is known
}
```

### 3.3 Account / identity (new, small store)

```ts
// src/app/features/plainspace/plainspace-account.model.ts
export interface PlainspaceAccount {
  host: string; // which plainspace instance
  userId: string; // "me"
  displayName: string;
  token: string; // bearer token (stored like other provider creds)
}
```

Stored per SP profile alongside other credentials (same mechanism existing
providers use for secrets). One account → many spaces.

### 3.4 No change to the SP `Task` model in v1

- "Mine/unassigned" tasks are normal SP tasks; their Plainspace origin is already
  captured by the existing `issueId` / `issueProviderId` / `issueType` fields.
- "Assigned to others" tasks are **not** SP tasks, so they need no `Task` field.
  An `assignee` field on SP tasks is **explicitly deferred** (would touch the
  hot-path task component and sync) — see [Future work](#11-future-work).

### 3.5 Project ↔ space link

The link is expressed entirely through the issue-provider instance:
`IssueProviderPlainspace.defaultProjectId` = SP project id, and
`PlainspaceCfg.spaceId` = remote space id. No new field on `Project` is strictly
required. (Optional convenience flag `Project.isSharedOnPlainspace` could be added
later for menu/badge rendering, but is not needed for correctness.)

---

## 4. Phase 1 — Plainspace issue provider scaffold

Goal: `PLAINSPACE` exists as a first-class issue provider; my/unassigned issues
import as tasks and poll. Pattern reference: **Redmine** (simplest built-in).

### 4.1 Central registration (4 edits)

- `src/app/features/issue/issue.model.ts`
  - add `'PLAINSPACE'` to `BuiltInIssueProviderKey` + `BUILT_IN_KEYS`
  - add `PlainspaceCfg` to `IssueIntegrationCfg` union and
    `IssueIntegrationCfgs` map
  - add issue type to `IssueData` / `IssueDataReduced` (+ `IssueDataReducedMap`)
  - add `IssueProviderPlainspace extends IssueProviderBase, PlainspaceCfg`
    (`issueProviderKey: 'PLAINSPACE'`) and add it to the `IssueProvider` union and
    `IssueProviderTypeMap`.
- `src/app/features/issue/issue.const.ts`
  - `PLAINSPACE_TYPE`, add to `ISSUE_PROVIDER_TYPES`,
    `ISSUE_PROVIDER_ICON_MAP`, `ISSUE_PROVIDER_HUMANIZED`,
    `DEFAULT_ISSUE_PROVIDER_CFGS`, `ISSUE_PROVIDER_FORM_CFGS_MAP`, `ISSUE_STR_MAP`.
- `src/app/features/issue/issue.service.ts`
  - import + inject `PlainspaceCommonInterfacesService`, add to
    `ISSUE_SERVICE_MAP`.
- Provider icon: add `src/assets/icons/plainspace.svg` **and** register it in
  `GlobalThemeService` (`_initIcons()`, the `addSvgIcon(...)` block) — the
  `ISSUE_PROVIDER_ICON_MAP` value only names the icon, it does not register it.
  Note `ISSUE_PROVIDER_HUMANIZED` is a plain string ('Plainspace'), not a `T`
  key, so no translation entry is needed for the provider name itself.

> Not strictly 4 files: adding `'PLAINSPACE'` to `BuiltInIssueProviderKey` also
> widens `IssueProviderKey`, so the existing `Task.issueType` field gains
> `'PLAINSPACE'` as a valid value. No new `Task` field, but it is a (safe,
> additive) type-surface change to be aware of.

### 4.2 New provider files (`providers/plainspace/`)

| File                                      | Responsibility                                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `plainspace.model.ts`                     | `PlainspaceCfg`                                                                                           |
| `plainspace-issue.model.ts`               | `PlainspaceIssue`, `PlainspaceMember`                                                                     |
| `plainspace.const.ts`                     | `DEFAULT_PLAINSPACE_CFG`, `PLAINSPACE_POLL_INTERVAL`                                                      |
| `plainspace-cfg-form.const.ts`            | Formly config form + `..._CONFIG_FORM_SECTION` (host, advanced common fields)                             |
| `plainspace-api.service.ts`               | All HTTP: `searchIssues$`, `getById$`, `getTasksForSpace$`, `getMembers$`, `createSpace$`, plus mock mode |
| `plainspace-common-interfaces.service.ts` | implements `IssueServiceInterface` (extends `BaseIssueProviderService`)                                   |
| `plainspace-issue-map.util.ts`            | `PlainspaceIssue → SearchResultItem` and `→ getAddTaskData`                                               |

### 4.3 `IssueServiceInterface` implementation notes

- `isEnabled(cfg)` → `cfg.isEnabled && !!cfg.host && !!cfg.spaceId` and an account
  token present.
- `getAddTaskData(issue)` → `{ title, isDone, issuePoints? }`. **Filter at the
  source**: only my/unassigned issues are ever offered to this path (see 4.4).
- `getNewIssuesToAddToBacklog(providerId, existingIds)` → fetch space tasks
  where `assigneeId === me || assigneeId == null`, minus `existingIds`.
- `getFreshDataForIssueTask(task)` → re-fetch by id, return `isDone`/title
  changes (never overwrite user scheduling).
- `pollInterval` → `PLAINSPACE_POLL_INTERVAL` (e.g. 5 min). Reuses existing
  `poll-issue-updates.effects.ts` and `poll-to-backlog.effects.ts`.

### 4.4 The mine/unassigned filter

Centralize in `plainspace-api.service` (`getMyAndUnassignedTasks$`) so both the
backlog import and the search path only ever see items that are valid to import.
"Assigned to others" is fetched by a sibling method and never reaches the issue
pipeline.

---

## 5. Phase 2 — Account login / identity

Goal: establish "me" so the assigned/unassigned split is meaningful.

- `src/app/features/plainspace/plainspace-account.service.ts` — login (token
  exchange), store/clear account, expose `me$` (signal) and `currentUserId`.
- Login UI: a button in the Plainspace provider config form (`testConnection`
  doubles as "verify login"), and/or a small dialog. Token persisted via the same
  secret-storage path other providers use.
- `isEnabled` and the shared-tasks fetch both depend on a valid account; surface a
  clear "not logged in" state.

Auth mechanism (token vs OAuth redirect) depends on what Plainspace exposes — see
[Open questions](#10-open-questions--blocking-decisions). If OAuth is required,
reuse the existing `src/app/plugins/oauth/` helpers.

---

## 6. Phase 3 — "Share on Plainspace" in the project create/edit dialog

Goal: a toggle in `dialog-create-project` that provisions a Plainspace space and
wires up the provider binding.

- **Form**: add an `isShareOnPlainspace` checkbox to
  `CREATE_PROJECT_BASIC_CONFIG_FORM_CONFIG`
  (`src/app/features/project/project-form-cfg.const.ts`). Gate it behind "account
  logged in" (show a login affordance if not).
- **On submit** (in `dialog-create-project.component.ts`), after the project is
  created via `projectService.add()`:
  1. If `isShareOnPlainspace` and logged in → `PlainspaceApiService.createSpace$(
{ title })` → returns `spaceId`.
  2. Create a `PLAINSPACE` issue-provider instance with
     `{ host, spaceId, isEnabled: true, defaultProjectId: <newProjectId>,
isAutoAddToBacklog: true }` via the issue-provider store.
- **Edit mode**: same toggle reflects whether a bound Plainspace provider exists;
  turning it on later provisions the space + provider; turning it off should
  prompt (unlink vs delete remote) — keep v1 to **unlink only** (disable provider,
  leave remote space intact) to avoid destructive surprises.
- **i18n**: new strings via `T`/`en.json` only.

---

## 7. Phase 4 — Dual-list work view ("Assigned to others")

Goal: for shared projects, render a second list below the normal one.

Reference pattern: the **backlog** split pane
(`work-view.component.html` `@if (isShowBacklog())` → `split` + `backlog` →
`task-list`) and the `collapsible` panels (overdue/done).

### 7.1 New read-only component

`src/app/features/plainspace/assigned-to-others/assigned-to-others.component.ts`

- Input: `tasks: PlainspaceIssue[]` (others' tasks) — **not** SP `TaskWithSubTasks`.
- Renders simple read-only rows: title, assignee (name + avatar), done state, link
  to open in Plainspace. **No** drag/drop, scheduling, time tracking, or task
  store interaction.
- Grouped/sorted by assignee. Reuses `collapsible` for the section wrapper.

> Deliberately a **new lightweight component**, not the hot-path
> `task.component`. Reusing `task-list`/`task` here would drag in editing,
> selection, DnD, and sync semantics we explicitly don't want for foreign tasks,
> and would risk the documented task-component performance constraints.

### 7.2 Data flow

- `PlainspaceSharedTasksService` exposes `othersTasksForProject$(projectId)`
  (polls `getTasksForSpace$` filtered to `assigneeId !== me && assigneeId != null`).
- `project-task-page.component.ts` already computes `currentProject`; add
  `assignedToOthersTasks = toSignal(...)`, gated on "project is shared on
  Plainspace" (a bound enabled `PLAINSPACE` provider exists).
- Pass into `work-view` as a new optional input
  `assignedToOthersTasks = input<PlainspaceIssue[]>([])` and
  `isShowAssignedToOthers = input(false)`.

### 7.3 Layout

Add, after the done/later-today panels and before/after the backlog split, a
conditional `collapsible` section (mirrors overdue/done panels):

```html
@if (isShowAssignedToOthers()) {
<collapsible
  [title]="...assignedToOthers (n)"
  [isGroup]="true"
  ...
>
  <plainspace-assigned-to-others [tasks]="assignedToOthersTasks()" />
</collapsible>
}
```

Collapsed state persisted in `localStorage` like the existing `isDoneHidden` /
`isLaterTodayHidden` signals.

---

## 8. Phase 5 — Polling, refresh & write-back

- **Reads**: reuse issue polling for my tasks; add a light timer in
  `PlainspaceSharedTasksService` for others' tasks (same interval), only while the
  shared project is open.
- **Writes (mine)**: completing/editing a _my_ imported task should optionally
  push back to Plainspace via `updateIssueFromTask` (the optional interface hook).
  Start **read-mostly**: import + status sync for done-state only; expand later.
- **Writes (others')**: none — read-only.
- **Offline**: all Plainspace calls must fail soft (empty lists, cached last
  values) and never block the SP UI; SP remains fully usable offline.

---

## 9. Prototype scope (this iteration)

A runnable prototype that demonstrates the UX end-to-end against a **mock**
Plainspace backend (toggled by a flag in `PlainspaceApiService`), so it works with
no live server and is trivially swapped for the real API:

1. `PLAINSPACE` provider registered + config form (Phase 1 skeleton).
2. `PlainspaceApiService` with a **mock mode** returning canned spaces, members,
   and tasks (mix of mine / unassigned / others).
3. "Share on Plainspace" toggle in the create dialog that, in mock mode, fakes
   space creation and provisions the provider binding (Phase 3).
4. The **"Assigned to others"** read-only panel wired into the work view for
   shared projects (Phase 4) — the visually novel part.
5. My/unassigned issues importing into the normal list via the issue pipeline.

Out of prototype scope: real auth handshake, write-back, attachments, subtasks,
production error/empty states polish.

---

## 10. Open questions / blocking decisions

These need answers (ideally the Plainspace API docs / the `Johannesjo/spaces`
repo, which I could not access from this environment) to move the prototype onto
the real backend:

1. **Auth**: token/API-key, or OAuth redirect flow? Endpoint(s)? How is "me"
   (current user id) returned?
2. **Spaces API**: create space (`POST`?), list spaces, get members of a space.
3. **Tasks API**: list/get tasks for a space; fields available (esp. `assigneeId`,
   done state, ordering); search; pagination.
4. **Write-back**: can SP create/update tasks and assignments? Required for the
   "share" flow to push SP tasks up, vs. pull-only.
5. **Hosting**: is it always plainspace.org, or self-hostable (host field needed)?
6. **CORS/Electron**: does the API allow browser-origin calls, or must requests go
   through the Electron main process (like some providers do)?

## 11. Future work

- Optional `Project.isSharedOnPlainspace` flag for menu badges.
- A real `assignee` concept on SP tasks (hot-path + sync implications — separate
  design).
- Reassign-from-SP, presence/avatars, comments, two-way task creation.

## 12. Risks

- **Sync correctness**: keep shared data **out** of the op-log; never route
  Plainspace fetches through NgRx persisted actions. Imported "my" tasks follow
  the existing, already-correct issue-task path.
- **Hot path**: the "assigned to others" list is a new lightweight component, not
  `task.component`; verify against large lists.
- **API assumptions**: all isolated in `PlainspaceApiService` +
  `plainspace-issue.model.ts` so the real contract changes one layer.
- **Privacy**: tokens stored locally like other provider secrets; no analytics;
  log only ids (`Log.log({ id })`).

```

```
