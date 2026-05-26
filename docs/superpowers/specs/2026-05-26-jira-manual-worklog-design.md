# Jira Manual Worklog — Design Spec

**Date:** 2026-05-26  
**Status:** Approved

## Problem

The Jira worklog dialog only fires when a task is marked as done. Users who work on a Jira ticket over multiple sessions without completing it cannot log time to Jira from within Super Productivity.

## Goal

Add two manual entry points for the existing worklog dialog:
1. A "Log work to Jira" item in the task context menu (right-click menu).
2. A "Save & log to Jira" button in the Duration dialog (time estimate / time spent editor).

Both entry points are only visible for tasks with `issueType === 'JIRA'`.

---

## Architecture

### New file: `JiraWorklogService`

**Path:** `src/app/features/issue/providers/jira/jira-worklog.service.ts`

Single injectable service with one public method:

```ts
openWorklogDialogForTask(task: Task): void
```

**Responsibility:**
- Guard: return early if `task.issueType !== JIRA_TYPE` or `task.issueId` / `task.issueProviderId` are missing.
- Look up the Jira provider config via `IssueProviderService.getCfgOnce$(task.issueProviderId, 'JIRA')`.
- Fetch the reduced Jira issue via `JiraApiService.getReducedIssueById$`.
- Open `DialogTrackTimeComponent` with the same data shape used today in `JiraIssueEffects._openWorklogDialog`.

**Dependencies injected:** `JiraApiService`, `IssueProviderService`, `MatDialog`.

`JiraIssueEffects` is updated to inject `JiraWorklogService` and delegate its existing `_openWorklogDialog` calls to it. The private method is removed from the effects class.

---

### Change 1: Task context menu

**Files:**
- `src/app/features/tasks/task-context-menu/task-context-menu-inner/task-context-menu-inner.component.ts`
- `src/app/features/tasks/task-context-menu/task-context-menu-inner/task-context-menu-inner.component.html`

**Component change:** Inject `JiraWorklogService`. Add method:

```ts
logWorkToJira(): void {
  this._jiraWorklogService.openWorklogDialogForTask(this.task);
}
```

**Template change:** Add after the existing "Update issue data" button (both guarded by `task.issueId && task.issueType !== ICAL_TYPE`):

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

### Change 2: Duration dialog

**Files:**
- `src/app/features/tasks/dialog-time-estimate/dialog-time-estimate.component.ts`
- `src/app/features/tasks/dialog-time-estimate/dialog-time-estimate.component.html`

**Component change:** Inject `JiraWorklogService`. Add method:

```ts
submitAndLogToJira(): void {
  this.submit();
  this._jiraWorklogService.openWorklogDialogForTask(this.task);
}
```

`submit()` saves the updated time to the task store before the worklog dialog opens, so the pre-filled duration reflects the just-entered value.

**Template change:** Add a second action button inside `<mat-dialog-actions>`, rendered only when the task is Jira-linked:

```html
@if (task.issueType === JIRA_TYPE) {
  <button (click)="submitAndLogToJira()" color="primary" mat-stroked-button type="button">
    <mat-icon svgIcon="jira"></mat-icon>
    {{ T.F.TASK.D_TIME.SAVE_AND_LOG_TO_JIRA | translate }}
  </button>
}
```

`JIRA_TYPE` must be imported. `task` is already available as `this.task` (set from `this.data.task` in the constructor).

---

## Translations

Two new keys added to `src/assets/i18n/en.json` only (per project rules):

| Key path | Value |
|---|---|
| `F.TASK.CMP.LOG_WORK_TO_JIRA` | `"Log work to Jira"` |
| `F.TASK.D_TIME.SAVE_AND_LOG_TO_JIRA` | `"Save & log to Jira"` |

Corresponding entries added to `src/app/t.const.ts`:
- `T.F.TASK.CMP.LOG_WORK_TO_JIRA`
- `T.F.TASK.D_TIME.SAVE_AND_LOG_TO_JIRA`

---

## Data flow

```
User clicks "Log work to Jira" (context menu)
  └─► TaskContextMenuInnerComponent.logWorkToJira()
        └─► JiraWorklogService.openWorklogDialogForTask(task)
              ├─► IssueProviderService.getCfgOnce$(issueProviderId, 'JIRA') → JiraCfg
              ├─► JiraApiService.getReducedIssueById$(issueId, cfg) → JiraIssueReduced
              └─► MatDialog.open(DialogTrackTimeComponent, { onSubmit: addWorklog$ })

User clicks "Save & log to Jira" (Duration dialog)
  └─► DialogTimeEstimateComponent.submitAndLogToJira()
        ├─► submit()  ← saves timeSpentOnDay + timeEstimate to store
        └─► JiraWorklogService.openWorklogDialogForTask(task)
              └─► (same flow as above)
```

---

## Out of scope

- GitLab worklog (separate provider with its own dialog; not requested).
- Automatic sync without user confirmation.
- Any changes to the NgRx state shape or op-log.
