# Jira: Log Time / Assign as Subtask from Any Task — Design Spec

**Date:** 2026-05-27  
**Status:** Approved  
**Branch:** `feat/jira-manual-worklog`

---

## Problem

The existing "Log work to Jira" and "Save & log to Jira" entry points are gated behind
`task.issueType === JIRA_TYPE`. A task imported from Google Calendar (or any non-Jira task)
that has tracked time cannot log that time to a Jira ticket, and cannot be structurally
assigned as a subtask of a Jira issue.

---

## Goal

1. Let any task with tracked time perform a **one-time worklog** to an arbitrary Jira ticket.
2. Let any root, non-Jira task be **permanently assigned as a subtask** of a Jira issue
   (importing the issue into SP on the fly if not already present).

---

## Shared: `DialogJiraIssuePickerComponent`

**File:** `src/app/features/issue/providers/jira/dialog-jira-issue-picker/dialog-jira-issue-picker.component.ts`

A new standalone, lazy-loaded dialog used by both features.

### Inputs (via `MAT_DIALOG_DATA`)

```ts
interface DialogJiraIssuePickerData {
  issueProviderId?: string; // pre-select a provider; show selector if omitted
}
```

### Behaviour

- If the user has multiple Jira providers configured (`IssueProviderService.getProviders$('JIRA')`),
  a provider selector is shown first.
- A debounced (300 ms) text input calls `JiraApiService.search$(term, cfg)` and shows results
  as `[KEY] Summary` rows.
- Selecting a row closes the dialog.

### Return type (MatDialogRef result)

```ts
interface JiraIssuePickerResult {
  issueId: string;
  issueProviderId: string;
  issueKey: string;
  issueSummary: string;
}
// undefined when cancelled
```

**Why not `AddTaskBarIssueSearchService`?** That service mixes all providers and creates tasks
as a side effect. Here we only want to pick — no task creation, no mixing.

---

## Feature 1 — "Log time to Jira ticket…" (one-time)

### Visibility

Shown in **context menu** when: `task.timeSpent > 0 && task.issueType !== JIRA_TYPE`

Shown in **duration dialog** as a second action button alongside the existing
"Save & log to Jira" (which remains for Jira-linked tasks), visible under the same condition.

### Flow

```
User clicks "Log time to Jira ticket…"
  └─► DialogJiraIssuePickerComponent opens
        └─► User picks issue → { issueId, issueProviderId, issueKey, issueSummary }
              └─► JiraWorklogService.openWorklogDialogForExternalTask(
                    task, issueId, issueProviderId, issueLabel
                  )
                    ├─► IssueProviderService.getCfgOnce$(issueProviderId, 'JIRA') → JiraCfg
                    ├─► JiraApiService.getReducedIssueById$(issueId, cfg) → JiraIssueReduced
                    └─► MatDialog.open(DialogTrackTimeComponent, { ... onSubmit: addWorklog$ })
                          └─► on success: JiraApiService.addWorklog$(...) only
                                          NO timeLoggedToJira update (task stays unlinked)
```

### `JiraWorklogService` extension

Add a new public method (the existing `openWorklogDialogForTask` is unchanged):

```ts
openWorklogDialogForExternalTask(
  task: Task,
  issueId: string,
  issueProviderId: string,
  issueLabel: string,
): void
```

Internally calls `_openDialog` with a synthetic issue object rather than fetching from the
API (or re-uses `_openDialog` with the known IDs). No guard on `issueType`. No
`timeLoggedToJira` update in the `onSubmit` callback.

### Files changed

| File                                         | Change                                            |
| -------------------------------------------- | ------------------------------------------------- |
| `jira-worklog.service.ts`                    | Add `openWorklogDialogForExternalTask()`          |
| `task-context-menu-inner.component.ts/.html` | New menu item + method                            |
| `dialog-time-estimate.component.ts/.html`    | New button + method                               |
| `en.json` + `t.const.ts`                     | New i18n key `F.TASK.CMP.LOG_TIME_TO_JIRA_TICKET` |

---

## Feature 2 — "Assign as subtask of Jira issue…" (permanent)

### Visibility

Shown in **context menu** when: `!task.parentId && task.issueType !== JIRA_TYPE`

### Flow

```
User clicks "Assign as subtask of Jira issue…"
  └─► DialogJiraIssuePickerComponent opens
        └─► User picks issue → { issueId, issueProviderId, issueKey, issueSummary }
              └─► IssueService.addTaskFromIssue({
                    issueDataReduced: { id: issueId, ... },
                    issueProviderId,
                    issueProviderKey: 'JIRA',
                  }) → jiraTaskId  (deduplicates if already imported)
                    └─► store.dispatch(convertToSubTask({
                          taskId: task.id,
                          parentId: jiraTaskId,
                        }))
```

### New NgRx action: `convertToSubTask`

**File:** `src/app/features/tasks/store/task.actions.ts`

```ts
convertToSubTask = createAction(
  '[Task] Convert to sub task',
  props<{ taskId: string; parentId: string }>(),
);
```

**Reducer side-effects** (in `task.reducer.ts` + `task-shared-meta-reducers/`):

1. Set `tasks[taskId].parentId = parentId`
2. Append `taskId` to `tasks[parentId].subTaskIds`
3. Clear `tasks[taskId].tagIds = []` (subtasks don't carry tags — existing invariant)
4. Remove `taskId` from the project's root `taskIds` array and from any tag's `taskIds`
5. This is a **persistent op-logged action** (same pattern as `addSubTask`, `moveSubTask`)

After dispatch, all existing machinery applies to the Jira parent task:

- Unlogged badge (based on parent's `timeSpent` roll-up)
- Daily summary "Jira — unlogged work" section
- "Log work to Jira" context menu item

### Files changed

| File                                         | Change                                              |
| -------------------------------------------- | --------------------------------------------------- |
| `task.actions.ts`                            | Add `convertToSubTask` action                       |
| `task.reducer.ts`                            | Handle `convertToSubTask`                           |
| `task-shared-meta-reducers/`                 | Handle project/tag `taskIds` cleanup                |
| `task-context-menu-inner.component.ts/.html` | New menu item + method                              |
| `en.json` + `t.const.ts`                     | New i18n key `F.TASK.CMP.ASSIGN_AS_SUBTASK_OF_JIRA` |

---

## Translations

New keys in `src/assets/i18n/en.json` only:

| Key path                               | Value                                |
| -------------------------------------- | ------------------------------------ |
| `F.TASK.CMP.LOG_TIME_TO_JIRA_TICKET`   | `"Log time to Jira ticket…"`         |
| `F.TASK.CMP.ASSIGN_AS_SUBTASK_OF_JIRA` | `"Assign as subtask of Jira issue…"` |

---

## Out of scope

- GitLab or other issue providers (different dialog, not requested).
- Surfacing one-time logs in the unlogged badge or daily summary (task stays unlinked).
- Dragging the task to a Jira parent in the task list (drag-and-drop already works if the
  parent is visible; this feature covers the case where the parent doesn't exist yet).
- Unit tests for `DialogJiraIssuePickerComponent` beyond the standard spec stub.
