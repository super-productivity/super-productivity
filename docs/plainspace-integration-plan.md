# Plainspace Integration Plan

Integrating **Plainspace** (plainspace.org — repo `Johannesjo/spaces`) into Super
Productivity (SP) so that:

1. A project can be made **shared on Plainspace** directly from the project
   create/edit dialog.
2. For such shared projects, SP shows — by **task ownership** (see the model in
   §1):
   - **My list** — tasks assigned to me, as regular, editable SP tasks.
   - **A read‑only claim pool** — unclaimed (unassigned) tasks you can **claim**;
     claiming assigns the task to you in Plainspace and imports it as an SP task.
   - Tasks **assigned to others are not represented in SP** at all.

> **Conceptual note (revised):** an earlier draft mirrored "assigned to others"
> into SP as a standing read-only list. We dropped that — SP is a personal focus
> tool, and a permanent wall of others' non-actionable tasks works against it and
> creates a stale second copy of the Plainspace board. The model is now: **only
> _mine_ + _unclaimed_ appear in SP; claiming is the bridge** that turns shared
> work into your work. See the conversation rationale captured in §7.

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
>   icon. **Only tasks assigned to me** import via the issue→backlog pipeline.
> - §5 — account / identity: `PlainspaceAccountService` (signals: `account`,
>   `isLoggedIn`, `currentUserId`; localStorage-persisted, never synced) with a
>   mock `login`/`logout`. "Mine" comes from the signed-in identity, and the
>   share toggle prompts sign-in if needed.
> - §6 — the "Share on Plainspace" toggle in the create-project dialog, which
>   (after sign-in) provisions a (mock) space and a bound provider via
>   `PlainspaceShareService`.
> - §7 — the read-only **claim pool**: `PlainspaceClaimPoolService` feeds
>   unclaimed tasks (mock) through `project-task-page` → `work-view` into a
>   collapsed-by-default panel (`PlainspaceClaimPoolComponent`). A **Claim**
>   action assigns the task to me and imports it as an SP task. Shows only for
>   shared projects.
>
> **Still design-only:** §8 write-back, and the real HTTP API + real auth (all
> `PlainspaceApiService` calls, the login, and claim are mocked — see §10). The
> claim pool does not yet auto-poll (loads on project open / provider change /
> after a claim).

---

## 1. Guiding decisions (agreed)

| Decision                            | Choice                                                                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Source of truth** for shared data | **Plainspace backend.** SP reads/writes shared tasks via Plainspace's API as a separate channel from SP's own op‑log sync. |
| **Integration shape**               | Model Plainspace as a **regular issue provider** (like Jira/Redmine) "for the most part".                                  |
| **Identity**                        | **Plainspace account login** (token-based). The authenticated account defines "me" — which tasks are mine vs unclaimed.    |
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

This means "Plainspace issues assigned to me" flow through the **existing**
issue→task pipeline with almost no new core code. The only genuinely new surface
is the read-only **claim pool**, because that data is _not_ imported as SP tasks
until claimed.

### The one important nuance

The standard issue-provider flow turns issues **into** SP tasks. We only do that
for tasks **assigned to me**. Unclaimed tasks are _shown_ (a read-only pool) but
**not** auto-imported — claiming is a deliberate act that assigns the task to me
and then imports it. Tasks assigned to others are not represented in SP at all.
(Auto-importing _unclaimed_ work as if it were yours has the same problem as the
old others-list, just subtler: two members connecting the same space would both
"own" the same unclaimed task locally.) See §7 for the full ownership model.

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
   │ PlainspaceCommonInterfacesService  │   │ PlainspaceClaimPoolService         │
   │  implements IssueServiceInterface  │   │  (unclaimed tasks + claim action)  │
   └───────────────┬────────────────────┘   └───────────────┬────────────────────┘
                   │                                          │
   ┌───────────────▼────────────────┐        ┌────────────────▼───────────────────┐
   │ Existing issue→task pipeline    │        │ Read-only claim-pool panel          │
   │ → real SP tasks (assigned to me)│  claim │ in work-view (unclaimed tasks)      │
   └─────────────────────────────────┘◄───────┴─────────────────────────────────────┘
                   │                                          │
                   └──────────────► Project work view ◄───────┘
                         (My list)               (Claim pool)
```

- **Issue-provider channel** = the Jira-like path. Registers a `PLAINSPACE`
  provider, bound per project via `defaultProjectId` (= the SP project the space
  maps to). Imports **assigned-to-me** issues, polls them for freshness.
- **Shared-project channel** = the new bits: account login, the unclaimed claim
  pool (+ claim → import), and creating a space when a project is shared.

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
  token?: string | null; // PAT (pat_…) authorizing this provider's API calls
}
```

> **Where the token lives (as built).** The PAT is stored on `PlainspaceCfg.token`
> and authorizes every `PlainspaceApiService` call — exactly like Jira's
> `password` or CalDAV's `password`, and like them it is part of synced
> issue-provider state and is included in plaintext backups/exports. This is a
> deliberate parity choice (a provider works on a fresh device after sync without
> re-pasting), and is the accepted secret-handling posture for issue providers.
> The account store (§3.3, local-only `localStorage`) holds a token **too**, but
> only to bootstrap the "Share on Plainspace" flow, which needs a token *before*
> any provider exists; the provider runtime reads only `cfg.token`. An earlier
> draft said the token was not stored in the cfg — that was never the case in the
> shipped code.

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

## 7. Ownership model & the claim pool (revised)

**The conceptual question that reshaped this feature:** _which tasks from a
shared space should appear in a personal focus app at all?_ Answer — by
ownership state:

| Plainspace state     | In SP?              | Treatment                                                     |
| -------------------- | ------------------- | ------------------------------------------------------------- |
| Assigned to me       | Yes — the point     | First-class SP tasks: schedule, time-track, complete.         |
| Unclaimed            | As a pool, not list | Read-only "claim pool"; **Claim** → assign-to-self → SP task. |
| Assigned to others   | No                  | Not represented in SP (Plainspace board is the team view).    |
| Done (others/unass.) | No                  | Irrelevant to the individual.                                 |

**Claiming is the bridge** between the collective space and the personal app:
the only way unclaimed work becomes yours. This avoids mirroring a stale,
non-actionable copy of other people's tasks into a focus tool. (We also skip
per-task assignee badges: with only _mine_ + _unclaimed_ shown, ownership is
implicit, and SP already shows a provider icon on issue-linked tasks.)

### 7.1 Read-only claim-pool component

`src/app/features/plainspace/claim-pool/claim-pool.component.ts`

- Input: `tasks: PlainspaceSharedTask[]` (unclaimed) + `projectId`.
- Flat read-only rows: title, "open in Plainspace" link, **Claim** button. No
  drag/drop, scheduling, time tracking, or task-store interaction.

> Deliberately a **lightweight standalone component**, not the hot-path
> `task.component` — these are foreign tasks until claimed.

### 7.2 Data flow

- `PlainspaceClaimPoolService.unclaimedTasksForProject$(projectId)` finds the
  bound enabled `PLAINSPACE` provider and returns its unclaimed tasks
  (`assigneeId === null && !isDone`), refreshing after a claim.
- `claim(projectId, taskId)` → `PlainspaceApiService.claimTask$` (assign-to-me)
  → `IssueService.addTaskFromIssue(... isAddToBacklog)` → pool refreshes.
- `project-task-page` derives `unclaimedTasks` and passes it (+ `projectId`)
  into `work-view`.

### 7.3 Layout

A `collapsible` section (mirrors overdue/done panels), **collapsed by default**
(it's a pool you reach for, not your active work); state persisted in
`localStorage` (`LS.PLAINSPACE_CLAIM_POOL_HIDDEN`).

---

## 8. Phase 5 — Polling, refresh & write-back

- **Reads**: reuse issue polling for my tasks; add a light timer in
  `PlainspaceClaimPoolService` to refresh the claim pool (same interval), only
  while the shared project is open. Today it refreshes on project open / provider
  change / after a claim — no timer yet.
- **Writes (mine)**: completing/editing a _my_ imported task should optionally
  push back to Plainspace via `updateIssueFromTask` (the optional interface hook).
  Start **read-mostly**: import + status sync for done-state only; expand later.
- **Claim**: the one write already implemented — assign an unclaimed task to me
  (`claimTask$`), then import it. Real mode would POST the assignment.
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

- **Cross-client forward-compat (rollout-gating).** Adding `'PLAINSPACE'` to the
  built-in `IssueProviderKey` union widens a **synced, typia-validated** type
  (`issueProvider` state, and `task.issueType`). A client built before this change
  has an AOT-baked validator that does not know the `'PLAINSPACE'` literal, so
  when a newer client creates a Plainspace provider and syncs it, the older client
  will reject the incoming model as corrupt (the documented "typia rejects unknown
  union members" failure → false data-corruption dialog / rejected sync). This is
  inherent to adding any new built-in provider key, and the mitigation is
  **release sequencing**: the validator-aware build must reach the fleet **before**
  any client can emit a `PLAINSPACE` provider. Do not back-port the ability to
  create a Plainspace provider to a client that can't validate the key. (The
  alternative — modelling Plainspace as a `plugin:`-style opaque key, which the
  validator already accepts — is forward-compatible but is a larger change and is
  the wrong shape for a built-in provider; revisit only if simultaneous rollout
  can't be guaranteed.)
- **Sync correctness**: keep shared data **out** of the op-log; never route
  Plainspace fetches through NgRx persisted actions. Imported "my" tasks follow
  the existing, already-correct issue-task path.
- **Hot path**: the claim pool is a new lightweight component, not
  `task.component`; verify against large lists.
- **API assumptions**: all isolated in `PlainspaceApiService` +
  `plainspace-issue.model.ts` so the real contract changes one layer.
- **Privacy**: the PAT is stored in synced provider cfg like other provider
  secrets (see §3.1); no analytics; log only ids (`Log.log({ id })`).

```

```
