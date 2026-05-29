# Jira Manual Worklog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to manually log work to Jira for in-progress tasks, track how much time has been logged locally, and surface unlogged time in the task row and daily summary.

**Architecture:** Extract dialog-opening logic into a new `JiraWorklogService`; wire it to the task context menu, duration dialog, task row badge, and a new daily-summary component. Add `timeLoggedToJira` to the task model and increment it on successful submission.

**Tech Stack:** Angular 17+ (signals, standalone components), NgRx, Angular Material, ngx-translate, RxJS

---

## File Map

| Action | Path |
|---|---|
| **Modify** | `src/app/features/tasks/task.model.ts` |
| **Create** | `src/app/features/issue/providers/jira/jira-worklog.service.ts` |
| **Create** | `src/app/features/issue/providers/jira/jira-worklog.service.spec.ts` |
| **Modify** | `src/app/features/issue/providers/jira/jira-issue.effects.ts` |
| **Modify** | `src/assets/i18n/en.json` |
| **Modify** | `src/app/t.const.ts` |
| **Modify** | `src/app/features/tasks/task-context-menu/task-context-menu-inner/task-context-menu-inner.component.ts` |
| **Modify** | `src/app/features/tasks/task-context-menu/task-context-menu-inner/task-context-menu-inner.component.html` |
| **Modify** | `src/app/features/tasks/dialog-time-estimate/dialog-time-estimate.component.ts` |
| **Modify** | `src/app/features/tasks/dialog-time-estimate/dialog-time-estimate.component.html` |
| **Modify** | `src/app/features/tasks/task/task.component.ts` |
| **Modify** | `src/app/features/tasks/task/task.component.html` |
| **Modify** | `src/app/features/tasks/task/task.component.scss` |
| **Create** | `src/app/features/issue/providers/jira/jira-unlogged-summary/jira-unlogged-summary.component.ts` |
| **Create** | `src/app/features/issue/providers/jira/jira-unlogged-summary/jira-unlogged-summary.component.html` |
| **Create** | `src/app/features/issue/providers/jira/jira-unlogged-summary/jira-unlogged-summary.component.scss` |
| **Create** | `src/app/features/issue/providers/jira/jira-unlogged-summary/jira-unlogged-summary.component.spec.ts` |
| **Modify** | `src/app/pages/daily-summary/daily-summary.component.ts` |
| **Modify** | `src/app/pages/daily-summary/daily-summary.component.html` |

---

## Task 1: Add `timeLoggedToJira` to the task model

**Files:**
- Modify: `src/app/features/tasks/task.model.ts`

- [ ] **Step 1: Add the field to `TaskCopy`**

Find the `IssueFieldsForTask` interface (around line 59) and add the field there since it's issue-specific:

```ts
export interface IssueFieldsForTask {
  issueId?: string;
  issueProviderId?: string;
  issueType?: IssueProviderKey;
  issueWasUpdated?: boolean;
  issueLastUpdated?: number | null;
  issueAttachmentNr?: number;
  issueTimeTracked?: IssueTaskTimeTracked;
  issuePoints?: number;
  issueLastSyncedValues?: Record<string, unknown>;
  timeLoggedToJira?: number; // ms logged to Jira via SP; undefined = 0
}
```

- [ ] **Step 2: Lint and type-check**

```bash
npm run checkFile src/app/features/tasks/task.model.ts
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/features/tasks/task.model.ts
git commit -m "feat(tasks): add timeLoggedToJira field to task model"
```

---

## Task 2: Add i18n translations

**Files:**
- Modify: `src/assets/i18n/en.json`
- Modify: `src/app/t.const.ts`

- [ ] **Step 1: Add keys to `en.json`**

In `en.json`, find `"CMP"` under `"TASK"` (around line 1651). Add `LOG_WORK_TO_JIRA` after `UPDATE_ISSUE_DATA`:

```json
"UPDATE_ISSUE_DATA": "Update issue data",
"LOG_WORK_TO_JIRA": "Log work to Jira"
```

Find `"D_TIME"` under `"TASK"` (around line 1767). Add `SAVE_AND_LOG_TO_JIRA` after `TITLE`:

```json
"TITLE": "Duration",
"SAVE_AND_LOG_TO_JIRA": "Save & log to Jira"
```

Find the `"JIRA"` section. Inside it, after the last top-level key (e.g. `"STEPPER"`), add:

```json
"UNLOGGED_SUMMARY": {
  "TITLE": "Jira — unlogged work",
  "LOG_WORK_BTN": "Log work",
  "UNLOGGED_TIME": "Unlogged: {{time}}"
}
```

- [ ] **Step 2: Add keys to `t.const.ts`**

In `t.const.ts`, find the `CMP` block under `TASK` (line ~1689). Add after `UPDATE_ISSUE_DATA`:

```ts
UPDATE_ISSUE_DATA: 'F.TASK.CMP.UPDATE_ISSUE_DATA',
LOG_WORK_TO_JIRA: 'F.TASK.CMP.LOG_WORK_TO_JIRA'
```

Find the `D_TIME` block under `TASK` (line ~1767). Add after `TITLE`:

```ts
TITLE: 'F.TASK.D_TIME.TITLE',
SAVE_AND_LOG_TO_JIRA: 'F.TASK.D_TIME.SAVE_AND_LOG_TO_JIRA'
```

Find the `JIRA` block (line ~532). Add after the `STEPPER` entry, before the closing `}`:

```ts
UNLOGGED_SUMMARY: {
  TITLE: 'F.JIRA.UNLOGGED_SUMMARY.TITLE',
  LOG_WORK_BTN: 'F.JIRA.UNLOGGED_SUMMARY.LOG_WORK_BTN',
  UNLOGGED_TIME: 'F.JIRA.UNLOGGED_SUMMARY.UNLOGGED_TIME'
},
```

- [ ] **Step 3: Lint**

```bash
npm run checkFile src/assets/i18n/en.json
npm run checkFile src/app/t.const.ts
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/assets/i18n/en.json src/app/t.const.ts
git commit -m "feat(jira): add i18n keys for manual worklog feature"
```

---

## Task 3: Create `JiraWorklogService`

**Files:**
- Create: `src/app/features/issue/providers/jira/jira-worklog.service.ts`
- Create: `src/app/features/issue/providers/jira/jira-worklog.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/features/issue/providers/jira/jira-worklog.service.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { JiraWorklogService } from './jira-worklog.service';
import { JiraApiService } from './jira-api.service';
import { IssueProviderService } from '../../issue-provider.service';
import { MatDialog } from '@angular/material/dialog';
import { TaskService } from '../../../tasks/task.service';
import { JIRA_TYPE } from '../../issue.const';
import { Task } from '../../../tasks/task.model';

describe('JiraWorklogService', () => {
  let service: JiraWorklogService;
  let matDialog: jasmine.SpyObj<MatDialog>;

  const mockTask = (overrides: Partial<Task> = {}): Task =>
    ({
      id: 'task1',
      issueType: JIRA_TYPE,
      issueId: 'PROJ-123',
      issueProviderId: 'provider1',
      timeSpent: 3600000,
      timeLoggedToJira: 0,
      ...overrides,
    } as Task);

  beforeEach(() => {
    matDialog = jasmine.createSpyObj('MatDialog', ['open']);

    TestBed.configureTestingModule({
      providers: [
        JiraWorklogService,
        { provide: JiraApiService, useValue: jasmine.createSpyObj('JiraApiService', ['getReducedIssueById$', 'addWorklog$']) },
        { provide: IssueProviderService, useValue: jasmine.createSpyObj('IssueProviderService', ['getCfgOnce$']) },
        { provide: MatDialog, useValue: matDialog },
        { provide: TaskService, useValue: jasmine.createSpyObj('TaskService', ['update']) },
      ],
    });
    service = TestBed.inject(JiraWorklogService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should return early if task has no issueId', () => {
    service.openWorklogDialogForTask(mockTask({ issueId: undefined }));
    expect(matDialog.open).not.toHaveBeenCalled();
  });

  it('should return early if task has no issueProviderId', () => {
    service.openWorklogDialogForTask(mockTask({ issueProviderId: undefined }));
    expect(matDialog.open).not.toHaveBeenCalled();
  });

  it('should return early if task is not JIRA type', () => {
    service.openWorklogDialogForTask(mockTask({ issueType: 'GITHUB' as any }));
    expect(matDialog.open).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm run test:file src/app/features/issue/providers/jira/jira-worklog.service.spec.ts
```
Expected: FAIL — `JiraWorklogService` not found.

- [ ] **Step 3: Implement `JiraWorklogService`**

Create `src/app/features/issue/providers/jira/jira-worklog.service.ts`:

```ts
import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { take, tap } from 'rxjs/operators';
import { JiraApiService } from './jira-api.service';
import { IssueProviderService } from '../../issue-provider.service';
import { TaskService } from '../../../tasks/task.service';
import { Task } from '../../../tasks/task.model';
import { JIRA_TYPE } from '../../issue.const';
import { T } from '../../../../t.const';
import { TrackTimeSubmitParams } from '../../shared/dialog-track-time/track-time-dialog.model';
import { IssueProviderJira } from '../../issue.model';
import { JiraWorklogExportDefaultTime } from './jira.model';

@Injectable({ providedIn: 'root' })
export class JiraWorklogService {
  private readonly _jiraApiService = inject(JiraApiService);
  private readonly _issueProviderService = inject(IssueProviderService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _taskService = inject(TaskService);

  openWorklogDialogForTask(task: Task): void {
    if (task.issueType !== JIRA_TYPE || !task.issueId || !task.issueProviderId) {
      return;
    }
    this._issueProviderService
      .getCfgOnce$(task.issueProviderId, 'JIRA')
      .pipe(take(1))
      .subscribe((jiraCfg) => this._openDialog(task, jiraCfg));
  }

  private _openDialog(task: Task, jiraCfg: IssueProviderJira): void {
    this._jiraApiService
      .getReducedIssueById$(task.issueId as string, jiraCfg)
      .pipe(take(1))
      .subscribe(async (issue) => {
        const { DialogTrackTimeComponent } = await import(
          '../../shared/dialog-track-time/dialog-track-time.component'
        );
        const timeLoggedToJira = task.timeLoggedToJira ?? 0;
        this._matDialog.open(DialogTrackTimeComponent, {
          restoreFocus: true,
          data: {
            task,
            issueIcon: 'jira',
            issueLabel: `${issue.key} ${issue.summary}`,
            timeLogged: timeLoggedToJira,
            defaultTime:
              jiraCfg.worklogDialogDefaultTime ??
              JiraWorklogExportDefaultTime.AllTimeMinusLogged,
            configTimeKey: 'worklogDialogDefaultTime',
            onSubmit: (params: TrackTimeSubmitParams) =>
              this._jiraApiService
                .addWorklog$({
                  issueId: issue.id,
                  started: params.started,
                  timeSpent: params.timeSpent,
                  comment: params.comment,
                  cfg: jiraCfg,
                })
                .pipe(
                  tap(() =>
                    this._taskService.update(task.id, {
                      timeLoggedToJira: timeLoggedToJira + params.timeSpent,
                    }),
                  ),
                ),
            successMsg: T.F.JIRA.S.ADDED_WORKLOG_FOR,
            successTranslateParams: { issueKey: issue.key },
            t: {
              title: T.F.JIRA.DIALOG_WORKLOG.TITLE,
              submitFor: T.F.JIRA.DIALOG_WORKLOG.SUBMIT_WORKLOG_FOR,
              currentlyLogged: T.F.JIRA.DIALOG_WORKLOG.CURRENTLY_LOGGED,
              submit: T.F.JIRA.DIALOG_WORKLOG.SAVE_WORKLOG,
              timeSpent: T.F.JIRA.DIALOG_WORKLOG.TIME_SPENT,
              timeSpentTooltip: T.F.JIRA.DIALOG_WORKLOG.TIME_SPENT_TOOLTIP,
              started: T.F.JIRA.DIALOG_WORKLOG.STARTED,
              invalidDate: T.F.JIRA.DIALOG_WORKLOG.INVALID_DATE,
              comment: T.G.COMMENT,
            },
          },
        });
      });
  }
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
npm run test:file src/app/features/issue/providers/jira/jira-worklog.service.spec.ts
```
Expected: 4 specs, 0 failures.

- [ ] **Step 5: Lint**

```bash
npm run checkFile src/app/features/issue/providers/jira/jira-worklog.service.ts
npm run checkFile src/app/features/issue/providers/jira/jira-worklog.service.spec.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/app/features/issue/providers/jira/jira-worklog.service.ts \
        src/app/features/issue/providers/jira/jira-worklog.service.spec.ts
git commit -m "feat(jira): add JiraWorklogService for manual worklog dialog"
```

---

## Task 4: Refactor `JiraIssueEffects` to use `JiraWorklogService`

**Files:**
- Modify: `src/app/features/issue/providers/jira/jira-issue.effects.ts`

- [ ] **Step 1: Inject `JiraWorklogService` and remove `_openWorklogDialog`**

In `jira-issue.effects.ts`:

1. Add import:
```ts
import { JiraWorklogService } from './jira-worklog.service';
```

2. Add injection (alongside the other injects at the top of the class):
```ts
private readonly _jiraWorklogService = inject(JiraWorklogService);
```

3. In the `addWorkLog$` effect, replace both `this._openWorklogDialog(...)` calls with `this._jiraWorklogService.openWorklogDialogForTask(...)`. The first call passes `subTask`, the second passes `mainTask` — both are `Task` objects, which is exactly what `openWorklogDialogForTask` expects.

Replace:
```ts
this._openWorklogDialog(
  subTask,
  assertTruthy(mainTask.issueId),
  jiraCfg,
);
```
With:
```ts
this._jiraWorklogService.openWorklogDialogForTask(subTask);
```

Replace:
```ts
this._openWorklogDialog(
  mainTask,
  mainTask.issueId as string,
  jiraCfg,
);
```
With:
```ts
this._jiraWorklogService.openWorklogDialogForTask(mainTask);
```

4. Delete the entire `private _openWorklogDialog(...)` method (lines ~344–389).

5. Remove the now-unused imports: `TrackTimeSubmitParams`, `assertTruthy` (check if still used elsewhere in the file first — `assertTruthy` may be used in `checkForReassignment`).

- [ ] **Step 2: Lint**

```bash
npm run checkFile src/app/features/issue/providers/jira/jira-issue.effects.ts
```
Expected: no errors.

- [ ] **Step 3: Run unit tests**

```bash
npm test
```
Expected: all tests pass (no regression).

- [ ] **Step 4: Commit**

```bash
git add src/app/features/issue/providers/jira/jira-issue.effects.ts
git commit -m "refactor(jira): delegate worklog dialog to JiraWorklogService"
```

---

## Task 5: Add "Log work to Jira" to the task context menu

**Files:**
- Modify: `src/app/features/tasks/task-context-menu/task-context-menu-inner/task-context-menu-inner.component.ts`
- Modify: `src/app/features/tasks/task-context-menu/task-context-menu-inner/task-context-menu-inner.component.html`

- [ ] **Step 1: Update the component**

In `task-context-menu-inner.component.ts`:

1. Add import:
```ts
import { JiraWorklogService } from '../../../issue/providers/jira/jira-worklog.service';
import { JIRA_TYPE } from '../../../issue/issue.const';
```

2. Add injection:
```ts
private readonly _jiraWorklogService = inject(JiraWorklogService);
```

3. Add method (near the `updateIssueData` method):
```ts
logWorkToJira(): void {
  this._jiraWorklogService.openWorklogDialogForTask(this.task);
}
```

4. Expose `JIRA_TYPE` as a protected property at the bottom of the class:
```ts
protected readonly JIRA_TYPE = JIRA_TYPE;
```

- [ ] **Step 2: Update the template**

In `task-context-menu-inner.component.html`, after the `updateIssueData` button block (around line 208–216), add:

```html
@if (task.issueId && task.issueType === JIRA_TYPE) {
  <button
    (click)="logWorkToJira()"
    mat-menu-item
  >
    <mat-icon [svgIcon]="task.issueType | issueIcon"></mat-icon>
    {{ T.F.TASK.CMP.LOG_WORK_TO_JIRA | translate }}
  </button>
}
```

- [ ] **Step 3: Lint**

```bash
npm run checkFile src/app/features/tasks/task-context-menu/task-context-menu-inner/task-context-menu-inner.component.ts
npm run checkFile src/app/features/tasks/task-context-menu/task-context-menu-inner/task-context-menu-inner.component.html
```

- [ ] **Step 4: Commit**

```bash
git add src/app/features/tasks/task-context-menu/task-context-menu-inner/task-context-menu-inner.component.ts \
        src/app/features/tasks/task-context-menu/task-context-menu-inner/task-context-menu-inner.component.html
git commit -m "feat(jira): add Log work to Jira item to task context menu"
```

---

## Task 6: Add "Save & log to Jira" to the Duration dialog

**Files:**
- Modify: `src/app/features/tasks/dialog-time-estimate/dialog-time-estimate.component.ts`
- Modify: `src/app/features/tasks/dialog-time-estimate/dialog-time-estimate.component.html`

- [ ] **Step 1: Update the component**

In `dialog-time-estimate.component.ts`:

1. Add imports:
```ts
import { JiraWorklogService } from '../../issue/providers/jira/jira-worklog.service';
import { JIRA_TYPE } from '../../issue/issue.const';
```

2. Add injection:
```ts
private readonly _jiraWorklogService = inject(JiraWorklogService);
```

3. Add method (after `submit()`):
```ts
submitAndLogToJira(): void {
  this.submit();
  this._jiraWorklogService.openWorklogDialogForTask(this.task);
}
```

4. Expose `JIRA_TYPE`:
```ts
protected readonly JIRA_TYPE = JIRA_TYPE;
```

- [ ] **Step 2: Update the template**

In `dialog-time-estimate.component.html`, inside `<mat-dialog-actions align="end">`, add before the existing Save button:

```html
@if (task.issueType === JIRA_TYPE) {
  <button
    (click)="submitAndLogToJira()"
    color="primary"
    mat-stroked-button
    type="button"
  >
    <mat-icon svgIcon="jira"></mat-icon>
    {{ T.F.TASK.D_TIME.SAVE_AND_LOG_TO_JIRA | translate }}
  </button>
}
```

Note: `T` is already available in the component template via the component class.

- [ ] **Step 3: Lint**

```bash
npm run checkFile src/app/features/tasks/dialog-time-estimate/dialog-time-estimate.component.ts
npm run checkFile src/app/features/tasks/dialog-time-estimate/dialog-time-estimate.component.html
```

- [ ] **Step 4: Commit**

```bash
git add src/app/features/tasks/dialog-time-estimate/dialog-time-estimate.component.ts \
        src/app/features/tasks/dialog-time-estimate/dialog-time-estimate.component.html
git commit -m "feat(jira): add Save & log to Jira button to duration dialog"
```

---

## Task 7: Add unlogged-time badge to the task row

**Files:**
- Modify: `src/app/features/tasks/task/task.component.ts`
- Modify: `src/app/features/tasks/task/task.component.html`
- Modify: `src/app/features/tasks/task/task.component.scss`

- [ ] **Step 1: Add the computed signal**

In `task.component.ts`:

1. Add import:
```ts
import { JIRA_TYPE } from '../../issue/issue.const';
```

2. Add the computed signal near the other computed signals (around line 165):
```ts
unloggedToJiraMs = computed(() => {
  const t = this.task();
  if (t.issueType !== JIRA_TYPE) return 0;
  return Math.max(0, t.timeSpent - (t.timeLoggedToJira ?? 0));
});
```

3. Expose `JIRA_TYPE` as a class member:
```ts
protected readonly JIRA_TYPE = JIRA_TYPE;
```

- [ ] **Step 2: Add the badge to the template**

In `task.component.html`, inside the `.time-wrapper` div, after the closing `}` of the `@if (t.subTasks?.length)` block (around line 95), add:

```html
@if (t.issueType === JIRA_TYPE && unloggedToJiraMs() > 0) {
  <div
    class="jira-unlogged-badge"
    [matTooltip]="(T.F.JIRA.UNLOGGED_SUMMARY.UNLOGGED_TIME | translate: { time: (unloggedToJiraMs() | msToString) })"
  >
    <mat-icon
      svgIcon="jira"
      inline="true"
    ></mat-icon>
    {{ unloggedToJiraMs() | msToString }}
  </div>
}
```

Ensure `MatTooltip` and `MsToStringPipe` are in the component's `imports` array — check the existing array in `task.component.ts` and add them if missing.

- [ ] **Step 3: Add minimal styles**

In `task.component.scss`, add at the end:

```scss
.jira-unlogged-badge {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 11px;
  opacity: 0.7;
  color: var(--c-accent);
  margin-left: 4px;

  mat-icon {
    font-size: 12px;
    width: 12px;
    height: 12px;
  }
}
```

- [ ] **Step 4: Lint**

```bash
npm run checkFile src/app/features/tasks/task/task.component.ts
npm run checkFile src/app/features/tasks/task/task.component.html
npm run checkFile src/app/features/tasks/task/task.component.scss
```

- [ ] **Step 5: Commit**

```bash
git add src/app/features/tasks/task/task.component.ts \
        src/app/features/tasks/task/task.component.html \
        src/app/features/tasks/task/task.component.scss
git commit -m "feat(jira): show unlogged time badge on Jira task rows"
```

---

## Task 8: Create `JiraUnloggedSummaryComponent`

**Files:**
- Create: `src/app/features/issue/providers/jira/jira-unlogged-summary/jira-unlogged-summary.component.ts`
- Create: `src/app/features/issue/providers/jira/jira-unlogged-summary/jira-unlogged-summary.component.html`
- Create: `src/app/features/issue/providers/jira/jira-unlogged-summary/jira-unlogged-summary.component.scss`
- Create: `src/app/features/issue/providers/jira/jira-unlogged-summary/jira-unlogged-summary.component.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `jira-unlogged-summary.component.spec.ts`:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { JiraUnloggedSummaryComponent } from './jira-unlogged-summary.component';
import { JiraWorklogService } from '../jira-worklog.service';
import { Task } from '../../../../tasks/task.model';
import { JIRA_TYPE } from '../../../issue.const';

describe('JiraUnloggedSummaryComponent', () => {
  let component: JiraUnloggedSummaryComponent;
  let fixture: ComponentFixture<JiraUnloggedSummaryComponent>;

  const makeTask = (overrides: Partial<Task> = {}): Task =>
    ({
      id: 'task1',
      title: 'Test Task',
      issueType: JIRA_TYPE,
      issueId: 'PROJ-1',
      issueProviderId: 'p1',
      timeSpent: 3600000,
      timeLoggedToJira: 0,
      ...overrides,
    } as Task);

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [JiraUnloggedSummaryComponent],
      providers: [
        { provide: JiraWorklogService, useValue: jasmine.createSpyObj('JiraWorklogService', ['openWorklogDialogForTask']) },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(JiraUnloggedSummaryComponent);
    component = fixture.componentInstance;
  });

  it('should show nothing when no tasks have unlogged time', () => {
    fixture.componentRef.setInput('flatTasks', [
      makeTask({ timeLoggedToJira: 3600000 }), // fully logged
    ]);
    fixture.detectChanges();
    expect(component.pendingTasks().length).toBe(0);
  });

  it('should show tasks with unlogged time', () => {
    fixture.componentRef.setInput('flatTasks', [
      makeTask({ timeSpent: 7200000, timeLoggedToJira: 3600000 }), // 1h unlogged
      makeTask({ id: 'task2', issueType: 'GITHUB' as any }), // non-Jira, excluded
    ]);
    fixture.detectChanges();
    expect(component.pendingTasks().length).toBe(1);
  });

  it('should exclude tasks where timeSpent <= timeLoggedToJira', () => {
    fixture.componentRef.setInput('flatTasks', [
      makeTask({ timeSpent: 0, timeLoggedToJira: 0 }),
    ]);
    fixture.detectChanges();
    expect(component.pendingTasks().length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm run test:file "src/app/features/issue/providers/jira/jira-unlogged-summary/jira-unlogged-summary.component.spec.ts"
```
Expected: FAIL — component not found.

- [ ] **Step 3: Implement the component TS**

Create `jira-unlogged-summary.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Task } from '../../../../tasks/task.model';
import { JIRA_TYPE } from '../../../issue.const';
import { JiraWorklogService } from '../jira-worklog.service';
import { MsToStringPipe } from '../../../../../ui/duration/ms-to-string.pipe';
import { TranslateModule } from '@ngx-translate/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { T } from '../../../../../t.const';

@Component({
  selector: 'jira-unlogged-summary',
  templateUrl: './jira-unlogged-summary.component.html',
  styleUrls: ['./jira-unlogged-summary.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [MsToStringPipe, TranslateModule, MatButton, MatIcon],
})
export class JiraUnloggedSummaryComponent {
  private readonly _jiraWorklogService = inject(JiraWorklogService);
  protected readonly T = T;

  flatTasks = input<Task[]>([]);

  pendingTasks = computed(() =>
    this.flatTasks().filter(
      (t) =>
        t.issueType === JIRA_TYPE &&
        t.timeSpent > (t.timeLoggedToJira ?? 0),
    ),
  );

  unloggedMs(task: Task): number {
    return Math.max(0, task.timeSpent - (task.timeLoggedToJira ?? 0));
  }

  logWork(task: Task): void {
    this._jiraWorklogService.openWorklogDialogForTask(task);
  }
}
```

- [ ] **Step 4: Implement the template**

Create `jira-unlogged-summary.component.html`:

```html
@if (pendingTasks().length > 0) {
  <section class="jira-unlogged-summary">
    <h3 class="title">{{ T.F.JIRA.UNLOGGED_SUMMARY.TITLE | translate }}</h3>
    @for (task of pendingTasks(); track task.id) {
      <div class="summary-row">
        <span class="task-title">{{ task.title }}</span>
        <span class="unlogged-time">
          {{ T.F.JIRA.UNLOGGED_SUMMARY.UNLOGGED_TIME | translate: { time: (unloggedMs(task) | msToString) } }}
        </span>
        <button
          mat-stroked-button
          color="primary"
          (click)="logWork(task)"
        >
          <mat-icon svgIcon="jira"></mat-icon>
          {{ T.F.JIRA.UNLOGGED_SUMMARY.LOG_WORK_BTN | translate }}
        </button>
      </div>
    }
  </section>
}
```

- [ ] **Step 5: Add minimal styles**

Create `jira-unlogged-summary.component.scss`:

```scss
.jira-unlogged-summary {
  margin-top: 24px;
}

.title {
  font-weight: bold;
  margin-bottom: 8px;
}

.summary-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--separator-color, rgba(0, 0, 0, 0.1));

  .task-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .unlogged-time {
    font-size: 0.85em;
    opacity: 0.7;
    white-space: nowrap;
  }
}
```

- [ ] **Step 6: Run tests**

```bash
npm run test:file "src/app/features/issue/providers/jira/jira-unlogged-summary/jira-unlogged-summary.component.spec.ts"
```
Expected: 3 specs, 0 failures.

- [ ] **Step 7: Lint all new files**

```bash
npm run checkFile src/app/features/issue/providers/jira/jira-unlogged-summary/jira-unlogged-summary.component.ts
npm run checkFile src/app/features/issue/providers/jira/jira-unlogged-summary/jira-unlogged-summary.component.html
npm run checkFile src/app/features/issue/providers/jira/jira-unlogged-summary/jira-unlogged-summary.component.scss
npm run checkFile src/app/features/issue/providers/jira/jira-unlogged-summary/jira-unlogged-summary.component.spec.ts
```

- [ ] **Step 8: Commit**

```bash
git add src/app/features/issue/providers/jira/jira-unlogged-summary/
git commit -m "feat(jira): add JiraUnloggedSummaryComponent for daily summary"
```

---

## Task 9: Wire `JiraUnloggedSummaryComponent` into the daily summary

**Files:**
- Modify: `src/app/pages/daily-summary/daily-summary.component.ts`
- Modify: `src/app/pages/daily-summary/daily-summary.component.html`

- [ ] **Step 1: Import the component**

In `daily-summary.component.ts`, add to the imports:

```ts
import { JiraUnloggedSummaryComponent } from '../../features/issue/providers/jira/jira-unlogged-summary/jira-unlogged-summary.component';
```

Add `JiraUnloggedSummaryComponent` to the component's `imports` array.

- [ ] **Step 2: Add to the template**

In `daily-summary.component.html`, in the "Review tasks" tab, after the `<task-summary-tables>` block (around line 167), add:

```html
@if (tasks?.length) {
  <jira-unlogged-summary [flatTasks]="tasks"></jira-unlogged-summary>
}
```

Place this inside the existing `@if (tasksWorkedOnOrDoneOrRepeatableFlat$ | async; as tasks)` block, after `<tasks-by-tag>`.

- [ ] **Step 3: Lint**

```bash
npm run checkFile src/app/pages/daily-summary/daily-summary.component.ts
npm run checkFile src/app/pages/daily-summary/daily-summary.component.html
```

- [ ] **Step 4: Run full test suite**

```bash
npm test
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/pages/daily-summary/daily-summary.component.ts \
        src/app/pages/daily-summary/daily-summary.component.html
git commit -m "feat(jira): show unlogged Jira work section in daily summary"
```

---

## Verification

After all tasks are complete:

1. **Start the app:** `ng serve` or `npm start`
2. **Add a Jira-linked task** (requires a configured Jira provider in settings).
3. **Track some time** on the task using the timer — the task row should show the Jira unlogged badge.
4. **Right-click the task** — "Log work to Jira" should appear in the context menu. Click it; the worklog dialog should open pre-filled with the tracked time.
5. **Submit the worklog** — the badge time should decrease (or disappear if fully logged).
6. **Open the Duration dialog** (click the time area) — "Save & log to Jira" button should appear. Changing the time and clicking it should save the time then open the worklog dialog.
7. **Open the daily summary** (`/daily-summary`) — a "Jira — unlogged work" section should appear listing tasks with outstanding time, each with a "Log work" button.
8. **Run the full test suite:** `npm test` — all tests pass.
