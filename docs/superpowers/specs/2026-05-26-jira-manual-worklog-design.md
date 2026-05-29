# Jira Manual Worklog — Design Spec

**Date:** 2026-05-26  
**Status:** Approved

## Problem

The Jira worklog dialog only fires when a task is marked as done. Users who work on a Jira ticket over multiple sessions without completing it cannot log time to Jira from within Super Productivity. Additionally, there is no local record of how much time has already been logged to Jira, making it impossible to know the outstanding unlogged balance without opening the dialog and making an API call.

## Goal

1. Add two manual entry points for the worklog dialog (context menu + duration dialog).
2. Track `timeLoggedToJira` locally on the task so the unlogged delta is always available.
3. Show an unlogged-time badge on Jira-linked task rows.
4. Show a "Jira pending" section in the daily summary with one-click log buttons.

---

## Why the existing `AllTimeMinusLogged` mode is insufficient

`AllTimeMinusLogged` computes `max(0, task.timeSpent_in_SP − issue.timespent_from_Jira)`. If the Jira issue already has pre-existing worklogs (e.g. 20h logged before SP was used), the delta is negative and clamps to 0 — showing nothing to log even though SP has tracked new time. Local tracking solves this regardless of pre-existing Jira state.

---

## Architecture

### 1. New field: `timeLoggedToJira` on the task model

**File:** `src/app/features/tasks/task.model.ts`

Add to `TaskCopy`:

```ts
timeLoggedToJira?: number;  // milliseconds, undefined treated as 0
```

After each successful worklog submission, `DialogTrackTimeComponent`'s `onSubmit` callback increments this field by the submitted `timeSpent` via the standard `updateTask` action. No new actions or op-log changes required.

The unlogged delta used everywhere:
```ts
const unloggedMs = Math.max(0, task.timeSpent - (task.timeLoggedToJira ?? 0));
```

---

### 2. New service: `JiraWorklogService`

**File:** `src/app/features/issue/providers/jira/jira-worklog.service.ts`

Single injectable with one public method:

```ts
openWorklogDialogForTask(task: Task): void
```

**Internals:**
- Guard: return early if `task.issueType !== JIRA_TYPE` or `issueId`/`issueProviderId` missing.
- Look up config: `IssueProviderService.getCfgOnce$(task.issueProviderId, 'JIRA')`.
- Fetch issue: `JiraApiService.getReducedIssueById$(issueId, cfg)`.
- Open `DialogTrackTimeComponent` with the same data shape as today, except `timeLogged` is sourced from `task.timeLoggedToJira ?? 0` (local, no extra API field needed for pre-fill) and `defaultTime` defaults to `AllTimeMinusLogged` (which now correctly uses the local delta).
- On successful submit: call `TaskService.update(task.id, { timeLoggedToJira: (task.timeLoggedToJira ?? 0) + params.timeSpent })`.

**Dependencies injected:** `JiraApiService`, `IssueProviderService`, `MatDialog`, `TaskService`.

`JiraIssueEffects` is updated to inject `JiraWorklogService` and delegate its existing `_openWorklogDialog` calls to it. The private method is removed from the effects class.

---

### 3. Task context menu

**Files:**
- `src/app/features/tasks/task-context-menu/task-context-menu-inner/task-context-menu-inner.component.ts`
- `src/app/features/tasks/task-context-menu/task-context-menu-inner/task-context-menu-inner.component.html`

**Component:** Inject `JiraWorklogService`. Add:

```ts
logWorkToJira(): void {
  this._jiraWorklogService.openWorklogDialogForTask(this.task);
}
```

**Template:** After the existing "Update issue data" button:

```html
@if (task.issueId && task.issueType === JIRA_TYPE) {
  <button (click)="logWorkToJira()" mat-menu-item>
    <mat-icon [svgIcon]="task.issueType | issueIcon"></mat-icon>
    {{ T.F.TASK.CMP.LOG_WORK_TO_JIRA | translate }}
  </button>
}
```

`JIRA_TYPE` is already imported in this component.

---

### 4. Duration dialog ("Save & log to Jira" button)

**Files:**
- `src/app/features/tasks/dialog-time-estimate/dialog-time-estimate.component.ts`
- `src/app/features/tasks/dialog-time-estimate/dialog-time-estimate.component.html`

**Component:** Inject `JiraWorklogService`. Add:

```ts
submitAndLogToJira(): void {
  this.submit();
  this._jiraWorklogService.openWorklogDialogForTask(this.task);
}
```

`submit()` saves the updated time to the store before the worklog dialog opens, so the pre-filled duration reflects the just-entered value. `JIRA_TYPE` must be imported.

**Template:** Inside `<mat-dialog-actions>`:

```html
@if (task.issueType === JIRA_TYPE) {
  <button (click)="submitAndLogToJira()" color="primary" mat-stroked-button type="button">
    <mat-icon svgIcon="jira"></mat-icon>
    {{ T.F.TASK.D_TIME.SAVE_AND_LOG_TO_JIRA | translate }}
  </button>
}
```

---

### 5. Unlogged badge on the task row

**Files:**
- `src/app/features/tasks/task/task.component.ts`
- `src/app/features/tasks/task/task.component.html`

**Component:** Add a `computed()` signal:

```ts
unloggedMs = computed(() =>
  Math.max(0, this.task().timeSpent - (this.task().timeLoggedToJira ?? 0))
);
```

**Template:** Inside `.time-wrapper`, after the existing time display, shown only for Jira tasks with outstanding time:

```html
@if (t.issueType === JIRA_TYPE && unloggedMs() > 0) {
  <div
    class="jira-unlogged"
    [matTooltip]="'Unlogged to Jira: ' + (unloggedMs() | msToString)"
  >
    <mat-icon svgIcon="jira" inline="true"></mat-icon>
    {{ unloggedMs() | msToString }}
  </div>
}
```

Styling: small, muted — same visual weight as the existing time figures. `JIRA_TYPE` imported via the existing issue const.

---

### 6. Daily summary — Jira pending section

**File:** `src/app/features/issue/providers/jira/jira-unlogged-summary/jira-unlogged-summary.component.ts` (new standalone component)

Receives `flatTasks: Task[]` as input. Filters for `issueType === JIRA_TYPE && timeSpent > (timeLoggedToJira ?? 0)`. Hidden when the filtered list is empty.

Renders a list of pending tasks, each with:
- Task title
- Unlogged delta (`timeSpent − timeLoggedToJira`) formatted via `msToString`
- "Log work" button → `JiraWorklogService.openWorklogDialogForTask(task)`

**Placement:** In `daily-summary.component.html`, inside the "Review tasks" tab, below `<task-summary-tables>`:

```html
<jira-unlogged-summary [flatTasks]="tasks"></jira-unlogged-summary>
```

---

## Translations

Four new keys in `src/assets/i18n/en.json` only:

| Key path | Value |
|---|---|
| `F.TASK.CMP.LOG_WORK_TO_JIRA` | `"Log work to Jira"` |
| `F.TASK.D_TIME.SAVE_AND_LOG_TO_JIRA` | `"Save & log to Jira"` |
| `F.TASK.CMP.JIRA_UNLOGGED_TOOLTIP` | `"Unlogged to Jira: {{time}}"` |
| `F.JIRA.UNLOGGED_SUMMARY.TITLE` | `"Jira — unlogged work"` |

Corresponding entries added to `src/app/t.const.ts`.

---

## Data flow

```
User clicks "Log work to Jira" (context menu or daily summary)
  └─► JiraWorklogService.openWorklogDialogForTask(task)
        ├─► IssueProviderService.getCfgOnce$(issueProviderId, 'JIRA') → JiraCfg
        ├─► JiraApiService.getReducedIssueById$(issueId, cfg) → JiraIssueReduced
        ├─► MatDialog.open(DialogTrackTimeComponent, {
        │     timeLogged: task.timeLoggedToJira ?? 0,   ← local, no extra API call
        │     defaultTime: AllTimeMinusLogged,
        │     onSubmit: (params) => addWorklog$(...) + updateTask(timeLoggedToJira += params.timeSpent)
        │   })
        └─► on success: task.timeLoggedToJira updated in store

User clicks "Save & log to Jira" (Duration dialog)
  └─► submit()  ← saves timeSpentOnDay + timeEstimate to store first
  └─► JiraWorklogService.openWorklogDialogForTask(task)
        └─► (same flow as above)

Badge (task row)
  └─► computed: max(0, task.timeSpent − (task.timeLoggedToJira ?? 0))
  └─► shown inline when > 0

Daily summary pending list
  └─► flatTasks filtered by issueType === JIRA_TYPE && unlogged > 0
  └─► "Log work" per row → JiraWorklogService.openWorklogDialogForTask(task)
```

---

## Out of scope

- GitLab worklog (separate provider with its own dialog; not requested).
- Automatic sync without user confirmation.
- Any changes to the NgRx op-log shape.
- Surfacing `timeLoggedToJira` in the worklog export view.
