# Jira: Log from Any Task + Assign as Subtask — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow any task (e.g. a Google Calendar import) to either log its tracked time to an arbitrary Jira ticket (one-time), or be permanently assigned as a subtask of a Jira issue (importing the Jira issue on the fly).

**Architecture:** A shared `DialogJiraIssuePickerComponent` handles Jira issue search for both features. Feature 1 adds `openWorklogDialogForExternalTask()` to the existing `JiraWorklogService` and surfaces it from the context menu and duration dialog. Feature 2 adds a new `convertToSubTask` NgRx action (in `task-shared.actions.ts`) handled by the existing `taskSharedCrudMetaReducer`, and surfaces the full flow (pick → import issue → reparent) from the context menu.

**Tech Stack:** Angular 18+ (standalone components, signals), NgRx, Angular Material, Jasmine/Karma, TypeScript strict

---

## File Map

### New files

| File                                                                                                        | Purpose                                                                |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/app/features/issue/providers/jira/dialog-jira-issue-picker/dialog-jira-issue-picker.model.ts`          | `JiraIssuePickerData` input type + `JiraIssuePickerResult` return type |
| `src/app/features/issue/providers/jira/dialog-jira-issue-picker/dialog-jira-issue-picker.component.ts`      | Standalone dialog: debounced Jira search → pick result                 |
| `src/app/features/issue/providers/jira/dialog-jira-issue-picker/dialog-jira-issue-picker.component.html`    | Template for the picker dialog                                         |
| `src/app/features/issue/providers/jira/dialog-jira-issue-picker/dialog-jira-issue-picker.component.spec.ts` | Unit spec for the picker                                               |

### Modified files

| File                                                                                                      | Change                                                              |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `src/assets/i18n/en.json`                                                                                 | +2 translation strings                                              |
| `src/app/t.const.ts`                                                                                      | +2 `T` constant paths                                               |
| `src/app/root-store/meta/task-shared.actions.ts`                                                          | Add `convertToSubTask` action                                       |
| `src/app/root-store/meta/task-shared-meta-reducers/task-shared-crud.reducer.ts`                           | Add `handleConvertToSubTask` + wire into meta-reducer               |
| `src/app/root-store/meta/task-shared-meta-reducers/task-shared-crud.reducer.spec.ts`                      | Tests for `convertToSubTask`                                        |
| `src/app/features/issue/providers/jira/jira-worklog.service.ts`                                           | Add `openWorklogDialogForExternalTask()`                            |
| `src/app/features/tasks/task-context-menu/task-context-menu-inner/task-context-menu-inner.component.ts`   | +2 methods: `logTimeToJiraTicket()`, `assignAsSubtaskOfJiraIssue()` |
| `src/app/features/tasks/task-context-menu/task-context-menu-inner/task-context-menu-inner.component.html` | +2 menu items after the existing `LOG_WORK_TO_JIRA` button          |
| `src/app/features/tasks/dialog-time-estimate/dialog-time-estimate.component.ts`                           | Add `logToJiraTicket()` method                                      |
| `src/app/features/tasks/dialog-time-estimate/dialog-time-estimate.component.html`                         | Add "Log to Jira ticket…" button                                    |

---

## Task 1: Translations

**Files:**

- Modify: `src/assets/i18n/en.json`
- Modify: `src/app/t.const.ts`

- [ ] **Step 1: Add keys to `en.json`**

  Open `src/assets/i18n/en.json`. Find the `F.TASK.CMP` object (search for `"LOG_WORK_TO_JIRA"`). Add two keys right after it:

  ```json
  "LOG_TIME_TO_JIRA_TICKET": "Log time to Jira ticket…",
  "ASSIGN_AS_SUBTASK_OF_JIRA": "Assign as subtask of Jira issue…"
  ```

- [ ] **Step 2: Add paths to `t.const.ts`**

  Open `src/app/t.const.ts`. Find the `F.TASK.CMP` object (search for `LOG_WORK_TO_JIRA`). Add two entries right after it:

  ```ts
  LOG_TIME_TO_JIRA_TICKET: 'F.TASK.CMP.LOG_TIME_TO_JIRA_TICKET',
  ASSIGN_AS_SUBTASK_OF_JIRA: 'F.TASK.CMP.ASSIGN_AS_SUBTASK_OF_JIRA',
  ```

- [ ] **Step 3: Lint check**

  ```bash
  npm run checkFile src/assets/i18n/en.json
  npm run checkFile src/app/t.const.ts
  ```

  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add src/assets/i18n/en.json src/app/t.const.ts
  git commit -m "feat(jira): add i18n keys for log-from-any-task and assign-as-subtask"
  ```

---

## Task 2: `convertToSubTask` action + meta-reducer (TDD)

**Files:**

- Modify: `src/app/root-store/meta/task-shared.actions.ts`
- Modify: `src/app/root-store/meta/task-shared-meta-reducers/task-shared-crud.reducer.ts`
- Modify: `src/app/root-store/meta/task-shared-meta-reducers/task-shared-crud.reducer.spec.ts`

- [ ] **Step 1: Write the failing tests**

  Open `src/app/root-store/meta/task-shared-meta-reducers/task-shared-crud.reducer.spec.ts`.
  Add a new `describe` block at the end of the file:

  ```typescript
  describe('convertToSubTask action', () => {
    let state: RootState;
    let task1: Task;
    let jiraTask: Task;

    beforeEach(() => {
      // Build base state then manually add both tasks + update project/tag taskIds
      const base = createBaseState();

      task1 = createMockTask({
        id: 'task1',
        projectId: 'project1',
        tagIds: ['tag1'],
      });
      jiraTask = createMockTask({
        id: 'jiraTask',
        projectId: 'project1',
        tagIds: [],
        subTaskIds: [],
      });

      const tasksWithBoth = taskAdapter.addMany(
        [task1, jiraTask],
        base[TASK_FEATURE_NAME],
      );
      const projectWithBoth = projectAdapter.updateOne(
        { id: 'project1', changes: { taskIds: ['task1', 'jiraTask'] } },
        base[PROJECT_FEATURE_NAME],
      );
      const tagWithTask1 = tagAdapter.updateOne(
        { id: 'tag1', changes: { taskIds: ['task1'] } },
        base[TAG_FEATURE_NAME],
      );

      state = {
        ...base,
        [TASK_FEATURE_NAME]: tasksWithBoth,
        [PROJECT_FEATURE_NAME]: projectWithBoth,
        [TAG_FEATURE_NAME]: tagWithTask1,
      };
    });

    it('should set parentId on the converted task', () => {
      const action = TaskSharedActions.convertToSubTask({
        task: task1,
        parentId: 'jiraTask',
      });
      const result = metaReducer(state, action);

      expect(result[TASK_FEATURE_NAME].entities['task1']!.parentId).toBe('jiraTask');
    });

    it('should append task to parent subTaskIds', () => {
      const action = TaskSharedActions.convertToSubTask({
        task: task1,
        parentId: 'jiraTask',
      });
      const result = metaReducer(state, action);

      expect(result[TASK_FEATURE_NAME].entities['jiraTask']!.subTaskIds).toContain(
        'task1',
      );
    });

    it('should clear tagIds on the converted task', () => {
      const action = TaskSharedActions.convertToSubTask({
        task: task1,
        parentId: 'jiraTask',
      });
      const result = metaReducer(state, action);

      expect(result[TASK_FEATURE_NAME].entities['task1']!.tagIds).toEqual([]);
    });

    it('should remove task from project taskIds', () => {
      const action = TaskSharedActions.convertToSubTask({
        task: task1,
        parentId: 'jiraTask',
      });
      const result = metaReducer(state, action);

      expect(result[PROJECT_FEATURE_NAME].entities['project1']!.taskIds).not.toContain(
        'task1',
      );
    });

    it('should remove task from tag taskIds', () => {
      const action = TaskSharedActions.convertToSubTask({
        task: task1,
        parentId: 'jiraTask',
      });
      const result = metaReducer(state, action);

      expect(result[TAG_FEATURE_NAME].entities['tag1']!.taskIds).not.toContain('task1');
    });

    it('should be a no-op if task does not exist', () => {
      const action = TaskSharedActions.convertToSubTask({
        task: createMockTask({ id: 'nonexistent' }),
        parentId: 'jiraTask',
      });
      const result = metaReducer(state, action);

      // State unchanged
      expect(result[TASK_FEATURE_NAME].ids).toEqual(state[TASK_FEATURE_NAME].ids);
    });

    it('should be a no-op if parent does not exist', () => {
      const action = TaskSharedActions.convertToSubTask({
        task: task1,
        parentId: 'noSuchParent',
      });
      const result = metaReducer(state, action);

      expect(result[TASK_FEATURE_NAME].entities['task1']!.parentId).toBeUndefined();
    });
  });
  ```

  The test needs these additional imports at the top of the spec file (add alongside existing imports):

  ```typescript
  import {
    projectAdapter,
    PROJECT_FEATURE_NAME,
  } from '../../../features/project/store/project.reducer';
  import { tagAdapter } from '../../../features/tag/store/tag.reducer';
  import { taskAdapter } from '../../../features/tasks/store/task.reducer';
  ```

- [ ] **Step 2: Run test to confirm it fails**

  ```bash
  npm run test:file src/app/root-store/meta/task-shared-meta-reducers/task-shared-crud.reducer.spec.ts
  ```

  Expected: FAIL — `TaskSharedActions.convertToSubTask is not a function` (or similar).

- [ ] **Step 3: Add the action to `task-shared.actions.ts`**

  Open `src/app/root-store/meta/task-shared.actions.ts`. Find `convertToMainTask` and add `convertToSubTask` immediately after it, following the exact same pattern:

  ```typescript
  convertToSubTask: createActionGroup.event === undefined;
  ```

  Wait — check the file: if it uses `createActionGroup`, use that pattern; if it uses individual `createAction` calls, use this:

  ```typescript
  convertToSubTask: createAction(
    '[Task] Convert to sub task',
    (taskProps: { task: Task; parentId: string }) => ({
      ...taskProps,
      meta: {
        isPersistent: true,
        entityType: 'TASK' as const,
        entityId: taskProps.task.id,
        opType: OpType.Update,
      } satisfies PersistentActionMeta,
    }),
  ),
  ```

  `Task`, `OpType`, and `PersistentActionMeta` are already imported in this file (they're used by `convertToMainTask`). If the file uses a `createActionGroup` pattern, adapt accordingly — look at the `convertToMainTask` entry and copy its shape exactly.

- [ ] **Step 4: Add the handler function to `task-shared-crud.reducer.ts`**

  Open `src/app/root-store/meta/task-shared-meta-reducers/task-shared-crud.reducer.ts`. Add the following handler function just before (or after) `handleConvertToMainTask`:

  ```typescript
  const handleConvertToSubTask = (
    state: RootState,
    task: Task,
    parentId: string,
  ): RootState => {
    const parentTask = state[TASK_FEATURE_NAME].entities[parentId] as Task | undefined;
    if (!parentTask) {
      return state; // no-op — parent not found
    }

    // 1. Update task entity (set parentId, clear tagIds) and parent (append to subTaskIds)
    const updatedTaskState = taskAdapter.updateMany(
      [
        {
          id: task.id,
          changes: {
            parentId,
            tagIds: [],
            modified: Date.now(),
          },
        },
        {
          id: parentId,
          changes: {
            subTaskIds: parentTask.subTaskIds.includes(task.id)
              ? parentTask.subTaskIds
              : [...parentTask.subTaskIds, task.id],
          },
        },
      ],
      state[TASK_FEATURE_NAME],
    );

    let updatedState: RootState = {
      ...state,
      [TASK_FEATURE_NAME]: updatedTaskState,
    };

    // 2. Remove from project.taskIds
    if (task.projectId && state[PROJECT_FEATURE_NAME].entities[task.projectId]) {
      const project = getProject(updatedState, task.projectId);
      updatedState = updateProject(updatedState, task.projectId, {
        taskIds: project.taskIds.filter((id) => id !== task.id),
        backlogTaskIds: project.backlogTaskIds
          ? project.backlogTaskIds.filter((id) => id !== task.id)
          : undefined,
      });
    }

    // 3. Remove from each tag.taskIds
    const tagUpdates = task.tagIds
      .filter((tagId) => state[TAG_FEATURE_NAME].entities[tagId])
      .map((tagId) => ({
        id: tagId,
        changes: {
          taskIds: getTag(updatedState, tagId).taskIds.filter((id) => id !== task.id),
        },
      }));

    if (tagUpdates.length > 0) {
      updatedState = updateTags(updatedState, tagUpdates);
    }

    return updatedState;
  };
  ```

- [ ] **Step 5: Wire handler into the meta-reducer**

  Still in `task-shared-crud.reducer.ts`, find where `handleConvertToMainTask` is invoked inside the meta-reducer function (look for a `switch` statement or handler map keyed on `TaskSharedActions.convertToMainTask.type`). Add a matching case for `convertToSubTask` immediately after it:

  ```typescript
  // Inside the switch (or handler map):
  case TaskSharedActions.convertToSubTask.type: {
    const typedAction = action as ReturnType<
      typeof TaskSharedActions.convertToSubTask
    >;
    const task =
      nextState[TASK_FEATURE_NAME].entities[typedAction.task.id] as
        | Task
        | undefined;
    if (!task) {
      return nextState;
    }
    return handleConvertToSubTask(
      nextState,
      task,
      typedAction.parentId,
    ) as S;
  }
  ```

- [ ] **Step 6: Run tests to confirm they pass**

  ```bash
  npm run test:file src/app/root-store/meta/task-shared-meta-reducers/task-shared-crud.reducer.spec.ts
  ```

  Expected: all `convertToSubTask` tests PASS.

- [ ] **Step 7: Lint both files**

  ```bash
  npm run checkFile src/app/root-store/meta/task-shared.actions.ts
  npm run checkFile src/app/root-store/meta/task-shared-meta-reducers/task-shared-crud.reducer.ts
  npm run checkFile src/app/root-store/meta/task-shared-meta-reducers/task-shared-crud.reducer.spec.ts
  ```

- [ ] **Step 8: Commit**

  ```bash
  git add src/app/root-store/meta/task-shared.actions.ts \
    src/app/root-store/meta/task-shared-meta-reducers/task-shared-crud.reducer.ts \
    src/app/root-store/meta/task-shared-meta-reducers/task-shared-crud.reducer.spec.ts
  git commit -m "feat(tasks): add convertToSubTask NgRx action and meta-reducer handler"
  ```

---

## Task 3: `DialogJiraIssuePickerComponent`

**Files:**

- Create: `src/app/features/issue/providers/jira/dialog-jira-issue-picker/dialog-jira-issue-picker.model.ts`
- Create: `src/app/features/issue/providers/jira/dialog-jira-issue-picker/dialog-jira-issue-picker.component.ts`
- Create: `src/app/features/issue/providers/jira/dialog-jira-issue-picker/dialog-jira-issue-picker.component.html`
- Create: `src/app/features/issue/providers/jira/dialog-jira-issue-picker/dialog-jira-issue-picker.component.spec.ts`

- [ ] **Step 1: Create the model file**

  ```typescript
  // dialog-jira-issue-picker.model.ts
  export interface DialogJiraIssuePickerData {
    /** Pre-selects a provider; shows selector dropdown if omitted and multiple providers configured. */
    issueProviderId?: string;
  }

  export interface JiraIssuePickerResult {
    issueId: string;
    issueProviderId: string;
    issueKey: string;
    issueSummary: string;
  }
  ```

- [ ] **Step 2: Write the failing spec**

  ```typescript
  // dialog-jira-issue-picker.component.spec.ts
  import { ComponentFixture, TestBed } from '@angular/core/testing';
  import { DialogJiraIssuePickerComponent } from './dialog-jira-issue-picker.component';
  import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
  import { provideMockStore } from '@ngrx/store/testing';
  import { TranslateModule } from '@ngx-translate/core';
  import { NoopAnimationsModule } from '@angular/platform-browser/animations';
  import { JiraApiService } from '../jira-api.service';
  import { IssueProviderService } from '../../../issue-provider.service';
  import { of } from 'rxjs';

  describe('DialogJiraIssuePickerComponent', () => {
    let component: DialogJiraIssuePickerComponent;
    let fixture: ComponentFixture<DialogJiraIssuePickerComponent>;
    let mockDialogRef: jasmine.SpyObj<MatDialogRef<DialogJiraIssuePickerComponent>>;
    let mockJiraApiService: jasmine.SpyObj<JiraApiService>;
    let mockIssueProviderService: jasmine.SpyObj<IssueProviderService>;

    beforeEach(async () => {
      mockDialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
      mockJiraApiService = jasmine.createSpyObj('JiraApiService', ['search$']);
      mockJiraApiService.search$.and.returnValue(of([]));
      mockIssueProviderService = jasmine.createSpyObj('IssueProviderService', [
        'getCfgOnce$',
      ]);
      mockIssueProviderService.getCfgOnce$.and.returnValue(of({} as any));

      await TestBed.configureTestingModule({
        imports: [
          DialogJiraIssuePickerComponent,
          TranslateModule.forRoot(),
          NoopAnimationsModule,
        ],
        providers: [
          provideMockStore({
            initialState: {
              issueProvider: { ids: [], entities: {} },
            },
          }),
          { provide: MatDialogRef, useValue: mockDialogRef },
          { provide: MAT_DIALOG_DATA, useValue: {} },
          { provide: JiraApiService, useValue: mockJiraApiService },
          { provide: IssueProviderService, useValue: mockIssueProviderService },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(DialogJiraIssuePickerComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should close dialog with result when select() is called', () => {
      (component as any).selectedProviderId.set('prov1');
      component.select({ id: '10001', key: 'PROJ-1', summary: 'Test issue' } as any);
      expect(mockDialogRef.close).toHaveBeenCalledWith({
        issueId: '10001',
        issueProviderId: 'prov1',
        issueKey: 'PROJ-1',
        issueSummary: 'Test issue',
      });
    });
  });
  ```

- [ ] **Step 3: Run spec to confirm it fails**

  ```bash
  npm run test:file src/app/features/issue/providers/jira/dialog-jira-issue-picker/dialog-jira-issue-picker.component.spec.ts
  ```

  Expected: FAIL — component file does not exist yet.

- [ ] **Step 4: Create the component**

  ```typescript
  // dialog-jira-issue-picker.component.ts
  import {
    ChangeDetectionStrategy,
    Component,
    inject,
    OnDestroy,
    signal,
  } from '@angular/core';
  import {
    MAT_DIALOG_DATA,
    MatDialogModule,
    MatDialogRef,
  } from '@angular/material/dialog';
  import { FormsModule } from '@angular/forms';
  import { AsyncPipe } from '@angular/common';
  import { MatButtonModule } from '@angular/material/button';
  import { MatFormFieldModule } from '@angular/material/form-field';
  import { MatInputModule } from '@angular/material/input';
  import { MatListModule } from '@angular/material/list';
  import { MatSelectModule } from '@angular/material/select';
  import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
  import { TranslateModule } from '@ngx-translate/core';
  import { Store } from '@ngrx/store';
  import {
    Subject,
    switchMap,
    debounceTime,
    distinctUntilChanged,
    takeUntil,
    of,
  } from 'rxjs';
  import { map, tap, catchError } from 'rxjs/operators';
  import { JiraApiService } from '../jira-api.service';
  import { IssueProviderService } from '../../../issue-provider.service';
  import { selectEnabledIssueProviders } from '../../../store/issue-provider.selectors';
  import { JIRA_TYPE } from '../../../issue.const';
  import {
    DialogJiraIssuePickerData,
    JiraIssuePickerResult,
  } from './dialog-jira-issue-picker.model';
  import { SearchResultItem } from '../jira-api.model';
  import { IssueProviderJira } from '../../../issue.model';

  @Component({
    selector: 'app-dialog-jira-issue-picker',
    templateUrl: './dialog-jira-issue-picker.component.html',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
      AsyncPipe,
      FormsModule,
      MatButtonModule,
      MatDialogModule,
      MatFormFieldModule,
      MatInputModule,
      MatListModule,
      MatProgressSpinnerModule,
      MatSelectModule,
      TranslateModule,
    ],
  })
  export class DialogJiraIssuePickerComponent implements OnDestroy {
    private readonly _store = inject(Store);
    private readonly _jiraApiService = inject(JiraApiService);
    private readonly _issueProviderService = inject(IssueProviderService);
    private readonly _dialogRef =
      inject<MatDialogRef<DialogJiraIssuePickerComponent>>(MatDialogRef);
    private readonly _data = inject<DialogJiraIssuePickerData>(MAT_DIALOG_DATA);
    private readonly _destroy$ = new Subject<void>();
    private readonly _searchInput$ = new Subject<string>();

    readonly selectedProviderId = signal<string | null>(
      this._data.issueProviderId ?? null,
    );
    readonly results = signal<SearchResultItem[]>([]);
    readonly isLoading = signal(false);

    readonly jiraProviders$ = this._store
      .select(selectEnabledIssueProviders)
      .pipe(
        map((providers) => providers.filter((p) => p.issueProviderKey === JIRA_TYPE)),
      );

    constructor() {
      // Auto-select first provider if none specified
      this.jiraProviders$.pipe(takeUntil(this._destroy$)).subscribe((providers) => {
        if (!this.selectedProviderId() && providers.length > 0) {
          this.selectedProviderId.set(providers[0].id);
        }
      });

      // Wire up search input → debounce → API call
      this._searchInput$
        .pipe(
          debounceTime(300),
          distinctUntilChanged(),
          tap(() => this.isLoading.set(true)),
          switchMap((term) => {
            const providerId = this.selectedProviderId();
            if (!term.trim() || !providerId) {
              return of([]);
            }
            return this._issueProviderService.getCfgOnce$(providerId, 'JIRA').pipe(
              switchMap((cfg) => {
                const jql = `text ~ "${term.replace(/"/g, '')}" ORDER BY updated DESC`;
                return this._jiraApiService
                  .search$(jql, cfg as IssueProviderJira)
                  .pipe(catchError(() => of([])));
              }),
            );
          }),
          tap(() => this.isLoading.set(false)),
          takeUntil(this._destroy$),
        )
        .subscribe((res) => this.results.set(res));
    }

    onSearchInput(term: string): void {
      this._searchInput$.next(term);
    }

    select(result: SearchResultItem): void {
      const providerId = this.selectedProviderId();
      if (!providerId) return;
      this._dialogRef.close({
        issueId: String(result.id),
        issueProviderId: providerId,
        issueKey: result.key,
        issueSummary: result.summary,
      } satisfies JiraIssuePickerResult);
    }

    ngOnDestroy(): void {
      this._destroy$.next();
      this._destroy$.complete();
    }
  }
  ```

  > **Note on `SearchResultItem`:** Import it from `../jira-api.model`. Check that file for the exact field names (`id`, `key`, `summary`). If the type uses different names, adjust `select()` accordingly.

- [ ] **Step 5: Create the template**

  ```html
  <!-- dialog-jira-issue-picker.component.html -->
  <h2 mat-dialog-title>Log to Jira issue</h2>

  <mat-dialog-content>
    @if (jiraProviders$ | async; as providers) { @if (providers.length > 1) {
    <mat-form-field
      appearance="outline"
      class="full-width"
    >
      <mat-label>Jira provider</mat-label>
      <mat-select
        [value]="selectedProviderId()"
        (valueChange)="selectedProviderId.set($event)"
      >
        @for (p of providers; track p.id) {
        <mat-option [value]="p.id">{{ p.title }}</mat-option>
        }
      </mat-select>
    </mat-form-field>
    } }

    <mat-form-field
      appearance="outline"
      class="full-width"
    >
      <mat-label>Search Jira issues</mat-label>
      <input
        matInput
        autofocus
        placeholder="e.g. PROJ-123 or login page"
        (input)="onSearchInput($any($event.target).value)"
      />
    </mat-form-field>

    @if (isLoading()) {
    <mat-spinner diameter="24" />
    }

    <mat-list>
      @for (r of results(); track r.id) {
      <mat-list-item
        class="picker-item"
        (click)="select(r)"
      >
        <span matListItemTitle>{{ r.key }} &mdash; {{ r.summary }}</span>
      </mat-list-item>
      }
    </mat-list>
  </mat-dialog-content>

  <mat-dialog-actions align="end">
    <button
      mat-button
      mat-dialog-close
    >
      Cancel
    </button>
  </mat-dialog-actions>
  ```

- [ ] **Step 6: Run spec to confirm it passes**

  ```bash
  npm run test:file src/app/features/issue/providers/jira/dialog-jira-issue-picker/dialog-jira-issue-picker.component.spec.ts
  ```

  Expected: PASS.

- [ ] **Step 7: Lint all new files**

  ```bash
  npm run checkFile src/app/features/issue/providers/jira/dialog-jira-issue-picker/dialog-jira-issue-picker.model.ts
  npm run checkFile src/app/features/issue/providers/jira/dialog-jira-issue-picker/dialog-jira-issue-picker.component.ts
  npm run checkFile src/app/features/issue/providers/jira/dialog-jira-issue-picker/dialog-jira-issue-picker.component.spec.ts
  ```

- [ ] **Step 8: Commit**

  ```bash
  git add src/app/features/issue/providers/jira/dialog-jira-issue-picker/
  git commit -m "feat(jira): add DialogJiraIssuePickerComponent for Jira issue search"
  ```

---

## Task 4: `JiraWorklogService` — `openWorklogDialogForExternalTask()` (TDD)

**Files:**

- Modify: `src/app/features/issue/providers/jira/jira-worklog.service.ts`
- Modify: `src/app/features/issue/providers/jira/jira-worklog.service.spec.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

  Open (or create) `jira-worklog.service.spec.ts`:

  ```typescript
  import { TestBed } from '@angular/core/testing';
  import { JiraWorklogService } from './jira-worklog.service';
  import { JiraApiService } from './jira-api.service';
  import { IssueProviderService } from '../../issue-provider.service';
  import { MatDialog } from '@angular/material/dialog';
  import { TaskService } from '../../../tasks/task.service';
  import { of } from 'rxjs';
  import { DEFAULT_TASK } from '../../../tasks/task.model';

  describe('JiraWorklogService', () => {
    let service: JiraWorklogService;
    let mockJiraApiService: jasmine.SpyObj<JiraApiService>;
    let mockIssueProviderService: jasmine.SpyObj<IssueProviderService>;
    let mockMatDialog: jasmine.SpyObj<MatDialog>;
    let mockTaskService: jasmine.SpyObj<TaskService>;

    beforeEach(() => {
      mockJiraApiService = jasmine.createSpyObj('JiraApiService', [
        'getReducedIssueById$',
        'addWorklog$',
      ]);
      mockIssueProviderService = jasmine.createSpyObj('IssueProviderService', [
        'getCfgOnce$',
      ]);
      mockMatDialog = jasmine.createSpyObj('MatDialog', ['open']);
      mockTaskService = jasmine.createSpyObj('TaskService', ['update']);

      mockIssueProviderService.getCfgOnce$.and.returnValue(of({ id: 'prov1' } as any));
      mockJiraApiService.getReducedIssueById$.and.returnValue(
        of({ id: 'ISS-1', key: 'PROJ-1', summary: 'Test issue' } as any),
      );
      mockMatDialog.open.and.returnValue({ afterClosed: () => of(null) } as any);

      TestBed.configureTestingModule({
        providers: [
          JiraWorklogService,
          { provide: JiraApiService, useValue: mockJiraApiService },
          { provide: IssueProviderService, useValue: mockIssueProviderService },
          { provide: MatDialog, useValue: mockMatDialog },
          { provide: TaskService, useValue: mockTaskService },
        ],
      });
      service = TestBed.inject(JiraWorklogService);
    });

    describe('openWorklogDialogForExternalTask', () => {
      it('should call getCfgOnce$ with the given issueProviderId', () => {
        const task = { ...DEFAULT_TASK, id: 't1', timeSpent: 3600000 };
        service.openWorklogDialogForExternalTask(task, 'ISS-1', 'prov1', 'PROJ-1 Test');
        expect(mockIssueProviderService.getCfgOnce$).toHaveBeenCalledWith(
          'prov1',
          'JIRA',
        );
      });

      it('should call getReducedIssueById$ with the given issueId', () => {
        const task = { ...DEFAULT_TASK, id: 't1', timeSpent: 3600000 };
        service.openWorklogDialogForExternalTask(task, 'ISS-1', 'prov1', 'PROJ-1 Test');
        expect(mockJiraApiService.getReducedIssueById$).toHaveBeenCalledWith(
          'ISS-1',
          jasmine.any(Object),
        );
      });

      it('should open the worklog dialog', () => {
        const task = { ...DEFAULT_TASK, id: 't1', timeSpent: 3600000 };
        service.openWorklogDialogForExternalTask(task, 'ISS-1', 'prov1', 'PROJ-1 Test');
        expect(mockMatDialog.open).toHaveBeenCalled();
      });

      it('should NOT call TaskService.update (no timeLoggedToJira tracking)', async () => {
        const task = { ...DEFAULT_TASK, id: 't1', timeSpent: 3600000 };
        // Simulate submit callback firing
        mockMatDialog.open.and.callFake((_comp, config: any) => {
          // Trigger onSubmit immediately to check if update is called
          config.data
            .onSubmit({ timeSpent: 3600000, started: '', comment: '' })
            .subscribe();
          return { afterClosed: () => of(null) } as any;
        });
        mockJiraApiService.addWorklog$.and.returnValue(of({}));

        service.openWorklogDialogForExternalTask(task, 'ISS-1', 'prov1', 'PROJ-1 Test');

        // Wait one tick for observables to resolve
        await new Promise((r) => setTimeout(r, 0));
        expect(mockTaskService.update).not.toHaveBeenCalled();
      });
    });
  });
  ```

- [ ] **Step 2: Run test to confirm it fails**

  ```bash
  npm run test:file src/app/features/issue/providers/jira/jira-worklog.service.spec.ts
  ```

  Expected: FAIL — `openWorklogDialogForExternalTask is not a function`.

- [ ] **Step 3: Add `openWorklogDialogForExternalTask` to the service**

  Open `src/app/features/issue/providers/jira/jira-worklog.service.ts`. Add the new public method and its private helper immediately after the existing `openWorklogDialogForTask` / `_openDialog` pair:

  ```typescript
  openWorklogDialogForExternalTask(
    task: Task,
    issueId: string,
    issueProviderId: string,
    issueLabel: string,
  ): void {
    this._issueProviderService
      .getCfgOnce$(issueProviderId, 'JIRA')
      .pipe(take(1))
      .subscribe((jiraCfg) =>
        this._openDialogForExternalTask(task, issueId, jiraCfg, issueLabel),
      );
  }

  private _openDialogForExternalTask(
    task: Task,
    issueId: string,
    jiraCfg: IssueProviderJira,
    issueLabel: string,
  ): void {
    this._jiraApiService
      .getReducedIssueById$(issueId, jiraCfg)
      .pipe(take(1))
      .subscribe(async (issue) => {
        const { DialogTrackTimeComponent } = await import(
          '../../shared/dialog-track-time/dialog-track-time.component'
        );
        this._matDialog.open(DialogTrackTimeComponent, {
          restoreFocus: true,
          data: {
            task,
            issueIcon: 'jira',
            issueLabel: issueLabel || `${issue.key} ${issue.summary}`,
            timeLogged: 0,
            defaultTime:
              JiraWorklogExportDefaultTime.AllTimeMinusLogged,
            configTimeKey: 'worklogDialogDefaultTime' as const,
            onSubmit: (params: TrackTimeSubmitParams) =>
              this._jiraApiService.addWorklog$({
                issueId: issue.id,
                started: params.started,
                timeSpent: params.timeSpent,
                comment: params.comment,
                cfg: jiraCfg,
              }),
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
  ```

  All types and imports (`Task`, `IssueProviderJira`, `TrackTimeSubmitParams`, `JiraWorklogExportDefaultTime`, `T`) are already in scope from the existing service file.

- [ ] **Step 4: Run tests to confirm they pass**

  ```bash
  npm run test:file src/app/features/issue/providers/jira/jira-worklog.service.spec.ts
  ```

  Expected: PASS.

- [ ] **Step 5: Lint**

  ```bash
  npm run checkFile src/app/features/issue/providers/jira/jira-worklog.service.ts
  npm run checkFile src/app/features/issue/providers/jira/jira-worklog.service.spec.ts
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add src/app/features/issue/providers/jira/jira-worklog.service.ts \
    src/app/features/issue/providers/jira/jira-worklog.service.spec.ts
  git commit -m "feat(jira): add openWorklogDialogForExternalTask to JiraWorklogService"
  ```

---

## Task 5: Context menu — Feature 1 "Log time to Jira ticket…"

**Files:**

- Modify: `src/app/features/tasks/task-context-menu/task-context-menu-inner/task-context-menu-inner.component.ts`
- Modify: `src/app/features/tasks/task-context-menu/task-context-menu-inner/task-context-menu-inner.component.html`

- [ ] **Step 1: Add `logTimeToJiraTicket()` method to the component**

  Open the `.ts` file. Find `logWorkToJira()`. Add a new method directly below it:

  ```typescript
  logTimeToJiraTicket(): void {
    import(
      '../../../../features/issue/providers/jira/dialog-jira-issue-picker/dialog-jira-issue-picker.component'
    ).then(({ DialogJiraIssuePickerComponent }) => {
      this._matDialog
        .open(DialogJiraIssuePickerComponent, {
          restoreFocus: true,
          data: {},
        })
        .afterClosed()
        .pipe(take(1))
        .subscribe((result) => {
          if (!result) return;
          this._jiraWorklogService.openWorklogDialogForExternalTask(
            this.task,
            result.issueId,
            result.issueProviderId,
            `${result.issueKey} ${result.issueSummary}`,
          );
        });
    });
  }
  ```

  `this._matDialog` (`MatDialog`), `this._jiraWorklogService` (`JiraWorklogService`), and `take` are all already imported/injected in this component. If `take` is not imported from `rxjs/operators`, add it.

- [ ] **Step 2: Add the menu item to the template**

  Open the `.html` file. After the closing `}` of the `LOG_WORK_TO_JIRA` button block (line ~225), insert:

  ```html
  @if (task.timeSpent > 0 && task.issueType !== JIRA_TYPE) {
  <button
    (click)="logTimeToJiraTicket()"
    mat-menu-item
  >
    <mat-icon svgIcon="jira"></mat-icon>
    {{ T.F.TASK.CMP.LOG_TIME_TO_JIRA_TICKET | translate }}
  </button>
  }
  ```

  `JIRA_TYPE` is already available in the template (it's used by the `LOG_WORK_TO_JIRA` button).

- [ ] **Step 3: Lint**

  ```bash
  npm run checkFile src/app/features/tasks/task-context-menu/task-context-menu-inner/task-context-menu-inner.component.ts
  npm run checkFile src/app/features/tasks/task-context-menu/task-context-menu-inner/task-context-menu-inner.component.html
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add src/app/features/tasks/task-context-menu/task-context-menu-inner/task-context-menu-inner.component.ts \
    src/app/features/tasks/task-context-menu/task-context-menu-inner/task-context-menu-inner.component.html
  git commit -m "feat(jira): add 'Log time to Jira ticket' context menu item"
  ```

---

## Task 6: Duration dialog — Feature 1 "Log to Jira ticket…" button

**Files:**

- Modify: `src/app/features/tasks/dialog-time-estimate/dialog-time-estimate.component.ts`
- Modify: `src/app/features/tasks/dialog-time-estimate/dialog-time-estimate.component.html`

- [ ] **Step 1: Add method to the component**

  Open the `.ts` file. Find `submitAndLogToJira()`. Add a new method below it:

  ```typescript
  logToJiraTicket(): void {
    this.submit();
    import(
      '../../../features/issue/providers/jira/dialog-jira-issue-picker/dialog-jira-issue-picker.component'
    ).then(({ DialogJiraIssuePickerComponent }) => {
      this._matDialog
        .open(DialogJiraIssuePickerComponent, {
          restoreFocus: true,
          data: {},
        })
        .afterClosed()
        .pipe(take(1))
        .subscribe((result) => {
          if (!result) return;
          this._jiraWorklogService.openWorklogDialogForExternalTask(
            this.task,
            result.issueId,
            result.issueProviderId,
            `${result.issueKey} ${result.issueSummary}`,
          );
        });
    });
  }
  ```

  `this._matDialog` and `this._jiraWorklogService` are already injected (they were added in the earlier branch work for `submitAndLogToJira`). If `take` is not already imported, add it.

  > **Note on import path:** The lazy import path above uses an absolute-style path. Check the import convention in this file (`../../..` vs `src/app/...`) and adjust to match.

- [ ] **Step 2: Add the button to the template**

  Open the `.html` file. Find the existing `@if (task.issueType === JIRA_TYPE)` block that shows the "Save & log to Jira" button. Add a new button immediately after that closing `}`:

  ```html
  @if (task.issueType !== JIRA_TYPE && task.timeSpent > 0) {
  <button
    (click)="logToJiraTicket()"
    color="primary"
    mat-stroked-button
    type="button"
  >
    <mat-icon svgIcon="jira"></mat-icon>
    {{ T.F.TASK.CMP.LOG_TIME_TO_JIRA_TICKET | translate }}
  </button>
  }
  ```

- [ ] **Step 3: Lint**

  ```bash
  npm run checkFile src/app/features/tasks/dialog-time-estimate/dialog-time-estimate.component.ts
  npm run checkFile src/app/features/tasks/dialog-time-estimate/dialog-time-estimate.component.html
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add src/app/features/tasks/dialog-time-estimate/dialog-time-estimate.component.ts \
    src/app/features/tasks/dialog-time-estimate/dialog-time-estimate.component.html
  git commit -m "feat(jira): add 'Log to Jira ticket' button to duration dialog"
  ```

---

## Task 7: Context menu — Feature 2 "Assign as subtask of Jira issue…"

**Files:**

- Modify: `src/app/features/tasks/task-context-menu/task-context-menu-inner/task-context-menu-inner.component.ts`
- Modify: `src/app/features/tasks/task-context-menu/task-context-menu-inner/task-context-menu-inner.component.html`

- [ ] **Step 1: Inject `JiraApiService`, `IssueProviderService`, and `Store` into the context menu component**

  Open the `.ts` file. At the top of the class body (near the other `inject()` calls), add:

  ```typescript
  private readonly _jiraApiService = inject(JiraApiService);
  private readonly _issueProviderService = inject(IssueProviderService);
  private readonly _store = inject(Store);
  ```

  Add the corresponding imports at the top of the file if they are not already present:

  ```typescript
  import { JiraApiService } from '../../../issue/providers/jira/jira-api.service';
  import { IssueProviderService } from '../../../issue/issue-provider.service';
  import { Store } from '@ngrx/store';
  import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions'; // adjust path
  import { firstValueFrom } from 'rxjs';
  import { selectTaskByIssueId } from '../../store/task.selectors';
  ```

  > **Path check:** Verify `TaskSharedActions` import path by looking for it in the existing imports of a nearby file that already uses it (e.g., `task-context-menu-inner.component.ts` may already import from the root store).

- [ ] **Step 2: Add `assignAsSubtaskOfJiraIssue()` method**

  Below `logTimeToJiraTicket()` (added in Task 5), add:

  ```typescript
  assignAsSubtaskOfJiraIssue(): void {
    import(
      '../../../../features/issue/providers/jira/dialog-jira-issue-picker/dialog-jira-issue-picker.component'
    ).then(({ DialogJiraIssuePickerComponent }) => {
      this._matDialog
        .open(DialogJiraIssuePickerComponent, {
          restoreFocus: true,
          data: {},
        })
        .afterClosed()
        .pipe(take(1))
        .subscribe((result) => {
          if (!result) return;
          void this._importAndAssignSubtask(result);
        });
    });
  }

  private async _importAndAssignSubtask(
    result: import(
      '../../../../features/issue/providers/jira/dialog-jira-issue-picker/dialog-jira-issue-picker.model'
    ).JiraIssuePickerResult,
  ): Promise<void> {
    // 1. Get Jira provider config
    const cfg = await firstValueFrom(
      this._issueProviderService.getCfgOnce$(result.issueProviderId, 'JIRA'),
    );

    // 2. Fetch full reduced issue data needed by addTaskFromIssue
    const reducedIssue = await firstValueFrom(
      this._jiraApiService.getReducedIssueById$(result.issueId, cfg as any),
    );

    // 3. Import (or deduplicate) the Jira issue as a task
    let jiraTaskId = await this._issueService.addTaskFromIssue({
      issueDataReduced: reducedIssue,
      issueProviderId: result.issueProviderId,
      issueProviderKey: 'JIRA',
    });

    // 4. If already imported, find the existing task's ID by issueId
    if (!jiraTaskId) {
      const existingTask = await firstValueFrom(
        this._store.select(selectTaskByIssueId).pipe(
          // selectTaskByIssueId takes props — use the selector with props pattern
        ),
      );
      // Fallback: scan all tasks for matching issueId + issueProviderId
      // The selector selectAllTasks is available; filter in the component
      // (see note below)
      jiraTaskId = existingTask?.id;
    }

    if (!jiraTaskId) {
      // Could not find or create the Jira task — abort silently
      return;
    }

    // 5. Reparent this task as a subtask of the Jira task
    this._store.dispatch(
      TaskSharedActions.convertToSubTask({
        task: this.task,
        parentId: jiraTaskId,
      }),
    );
  }
  ```

  > **Note on `selectTaskByIssueId`:** Check `src/app/features/tasks/store/task.selectors.ts` for the exact selector signature. If it uses a props argument (`selectTaskByIssueId({ issueId: ... })`), use that pattern. If it is a factory selector, call it as `selectTaskByIssueId({ issueId: result.issueId })`. Alternatively, use `selectAllTasks` and `.find()`:
  >
  > ```typescript
  > const allTasks = await firstValueFrom(this._store.select(selectAllTasks));
  > jiraTaskId = allTasks.find(
  >   (t) => t.issueId === result.issueId && t.issueProviderId === result.issueProviderId,
  > )?.id;
  > ```

- [ ] **Step 3: Add the menu item to the template**

  Open the `.html` file. After the `logTimeToJiraTicket` button block added in Task 5, insert:

  ```html
  @if (!task.parentId && task.issueType !== JIRA_TYPE) {
  <button
    (click)="assignAsSubtaskOfJiraIssue()"
    mat-menu-item
  >
    <mat-icon svgIcon="jira"></mat-icon>
    {{ T.F.TASK.CMP.ASSIGN_AS_SUBTASK_OF_JIRA | translate }}
  </button>
  }
  ```

- [ ] **Step 4: Lint**

  ```bash
  npm run checkFile src/app/features/tasks/task-context-menu/task-context-menu-inner/task-context-menu-inner.component.ts
  npm run checkFile src/app/features/tasks/task-context-menu/task-context-menu-inner/task-context-menu-inner.component.html
  ```

- [ ] **Step 5: Run full test suite**

  ```bash
  npm test
  ```

  Expected: all tests pass (no regressions).

- [ ] **Step 6: Commit**

  ```bash
  git add src/app/features/tasks/task-context-menu/task-context-menu-inner/task-context-menu-inner.component.ts \
    src/app/features/tasks/task-context-menu/task-context-menu-inner/task-context-menu-inner.component.html
  git commit -m "feat(jira): add 'Assign as subtask of Jira issue' context menu item"
  ```

---

## Verification

1. **Unit tests:** `npm test` — all tests pass with no regressions.
2. **Lint:** `npm run lint` — no new errors.
3. **Manual — Feature 1 (one-time log):**
   - Start dev server: `ng serve`
   - Add a Google Calendar / plain task, log some time on it
   - Right-click → "Log time to Jira ticket…" — picker dialog opens
   - Search for a Jira issue, select one → worklog dialog opens pre-filled with task's time
   - Submit → worklog posted to Jira; task itself is unchanged (no `timeLoggedToJira` update)
   - Also check: same button appears in the duration dialog for non-Jira tasks
4. **Manual — Feature 2 (subtask assignment):**
   - Right-click a plain (non-Jira) root task → "Assign as subtask of Jira issue…" — picker opens
   - Select a Jira issue not yet in SP → Jira task is created as a root task, original task moves under it as a subtask
   - Select a Jira issue already in SP → no duplicate created, original task still moves under the existing Jira task
   - Verify the Jira parent task row shows the unlogged badge and the daily summary section lists it
5. **Edge cases:**
   - Closing the picker without selecting → nothing happens
   - Subtask tasks and Jira tasks themselves do NOT show "Assign as subtask of Jira issue…" (`!task.parentId && task.issueType !== JIRA_TYPE`)
   - Tasks with zero `timeSpent` do NOT show "Log time to Jira ticket…" (`task.timeSpent > 0`)
