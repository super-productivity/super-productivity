import { TaskContextMenuInnerComponent } from './task-context-menu-inner.component';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { TaskService } from '../../task.service';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { TaskRepeatCfgService } from '../../../task-repeat-cfg/task-repeat-cfg.service';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { IssueService } from '../../../issue/issue.service';
import { SnackService } from '../../../../core/snack/snack.service';
import { ProjectService } from '../../../project/project.service';
import { GlobalConfigService } from '../../../config/global-config.service';
import { TagService } from '../../../tag/tag.service';
import { TranslateModule } from '@ngx-translate/core';
import { WorkContextService } from '../../../work-context/work-context.service';
import { TaskFocusService } from '../../task-focus.service';
import { LocaleDatePipe } from 'src/app/ui/pipes/locale-date.pipe';
import { DateAdapter } from '@angular/material/core';
import { of } from 'rxjs';
import {
  selectTaskByIdWithSubTaskData,
  selectAllTasks,
} from '../../store/task.selectors';
import { addSubTask } from '../../store/task.actions';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { JiraApiService } from '../../../issue/providers/jira/jira-api.service';
import { IssueProviderService } from '../../../issue/issue-provider.service';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import type { JiraIssuePickerResult } from '../../../issue/providers/jira/dialog-jira-issue-picker/dialog-jira-issue-picker.model';

describe('TaskContextMenuInnerComponent', () => {
  let component: TaskContextMenuInnerComponent;
  let fixture: ComponentFixture<TaskContextMenuInnerComponent>;
  let taskService: jasmine.SpyObj<TaskService>;
  let store: MockStore;
  let matDialog: jasmine.SpyObj<MatDialog>;
  let issueService: jasmine.SpyObj<IssueService>;
  let jiraApiService: jasmine.SpyObj<JiraApiService>;
  let issueProviderService: jasmine.SpyObj<IssueProviderService>;
  let snackService: jasmine.SpyObj<SnackService>;

  beforeEach(async () => {
    taskService = jasmine.createSpyObj('TaskService', [
      'add',
      'createNewTaskWithDefaults',
      'currentTaskId',
    ]);
    taskService.currentTaskId.and.returnValue('some-id');

    matDialog = jasmine.createSpyObj('MatDialog', ['open']);
    matDialog.open.and.returnValue({
      afterClosed: () => of(undefined),
    } as unknown as MatDialogRef<unknown>);

    issueService = jasmine.createSpyObj('IssueService', [
      'issueLink',
      'addTaskFromIssue',
      'refreshIssueTask',
    ]);
    issueService.issueLink.and.resolveTo('');
    issueService.addTaskFromIssue.and.resolveTo(undefined);

    jiraApiService = jasmine.createSpyObj('JiraApiService', ['getReducedIssueById$']);
    jiraApiService.getReducedIssueById$.and.returnValue(of({ id: 'JIRA-123' } as any));

    issueProviderService = jasmine.createSpyObj('IssueProviderService', ['getCfgOnce$']);
    issueProviderService.getCfgOnce$.and.returnValue(
      of({ host: 'https://jira.example.com' } as any),
    );

    snackService = jasmine.createSpyObj('SnackService', ['open']);

    await TestBed.configureTestingModule({
      imports: [
        TaskContextMenuInnerComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        provideMockStore(),
        { provide: TaskService, useValue: taskService },
        {
          provide: TaskRepeatCfgService,
          useValue: { getTaskRepeatCfgById$: () => of(null) },
        },
        { provide: MatDialog, useValue: matDialog },
        { provide: IssueService, useValue: issueService },
        { provide: SnackService, useValue: snackService },
        {
          provide: ProjectService,
          useValue: {
            getProjectsWithoutIdSorted$: () => of([]),
            getByIdOnce$: () => of({}),
          },
        },
        {
          provide: GlobalConfigService,
          useValue: {
            appFeatures: () => ({}),
            cfg: () => ({ reminder: {}, tasks: {} }),
          },
        },
        { provide: TagService, useValue: { tagsNoMyDayAndNoListSorted: of([]) } },
        { provide: WorkContextService, useValue: { activeWorkContext$: of({}) } },
        {
          provide: TaskFocusService,
          useValue: {
            focusedTaskId: { set: () => {} },
            isTaskContextMenuOpen: { set: () => {} },
          },
        },
        { provide: LocaleDatePipe, useValue: {} },
        { provide: DateAdapter, useValue: { getFirstDayOfWeek: () => 0 } },
        { provide: JiraApiService, useValue: jiraApiService },
        { provide: IssueProviderService, useValue: issueProviderService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TaskContextMenuInnerComponent);
    component = fixture.componentInstance;
    store = TestBed.inject(MockStore);
  });

  afterEach(() => {
    selectTaskByIdWithSubTaskData.release();
    store.resetSelectors();
  });

  describe('duplicate()', () => {
    it('should duplicate subtasks with timeEstimate and notes', fakeAsync(() => {
      const mockTask = {
        id: 'PARENT_ID',
        title: 'Parent Task',
        projectId: 'P1',
        tagIds: [],
        subTaskIds: ['SUB_ID'],
      } as any;

      const mockSubTask = {
        id: 'SUB_ID',
        title: 'Sub Task',
        isDone: true,
        projectId: 'P1',
        timeEstimate: 3600000,
        notes: 'Some notes',
      };

      const mockTaskWithSubTasks = {
        ...mockTask,
        subTasks: [mockSubTask],
      };

      component.task = mockTask;
      taskService.add.and.returnValue('NEW_PARENT_ID');
      taskService.createNewTaskWithDefaults.and.returnValue({
        id: 'NEW_SUB_ID',
      } as any);

      store.overrideSelector(selectTaskByIdWithSubTaskData, mockTaskWithSubTasks);
      spyOn(store, 'dispatch');

      component.duplicate();
      tick(50); // for the delay(50) in _getTaskWithSubtasks

      expect(taskService.add).toHaveBeenCalledWith(
        'Parent Task (copy)',
        false,
        jasmine.objectContaining({ projectId: 'P1' }),
        false,
      );

      expect(taskService.createNewTaskWithDefaults).toHaveBeenCalledWith(
        jasmine.objectContaining({
          title: 'Sub Task',
          additional: jasmine.objectContaining({
            timeEstimate: 3600000,
            notes: 'Some notes',
            isDone: true,
            projectId: 'P1',
          }),
        }),
      );

      expect(store.dispatch).toHaveBeenCalledWith(
        addSubTask({
          task: { id: 'NEW_SUB_ID' } as any,
          parentId: 'NEW_PARENT_ID',
        }),
      );
    }));

    it('should duplicate parent task with notes', fakeAsync(() => {
      const mockTask = {
        id: 'PARENT_ID',
        title: 'Parent Task',
        projectId: 'P1',
        tagIds: [],
        subTaskIds: [],
        notes: 'My important notes',
      } as any;

      component.task = mockTask;
      taskService.add.and.returnValue('NEW_PARENT_ID');

      component.duplicate();
      tick(50);

      expect(taskService.add).toHaveBeenCalledWith(
        'Parent Task (copy)',
        false,
        jasmine.objectContaining({ notes: 'My important notes' }),
        false,
      );
    }));

    it('should not include notes when parent task has no notes', fakeAsync(() => {
      const mockTask = {
        id: 'PARENT_ID',
        title: 'Parent Task',
        projectId: 'P1',
        tagIds: [],
        subTaskIds: [],
        notes: '',
      } as any;

      component.task = mockTask;
      taskService.add.and.returnValue('NEW_PARENT_ID');

      component.duplicate();
      tick(50);

      const callArgs = taskService.add.calls.mostRecent().args[2] as any;
      expect(callArgs.notes).toBeUndefined();
    }));
  });

  describe('getElementById for task ID lookup', () => {
    it('should use getElementById for task ID in focusRelatedTaskOrNext', fakeAsync(() => {
      component.task = {
        id: 'task-with-{special}-chars',
        title: 'Test',
        projectId: 'P1',
        tagIds: [],
        subTaskIds: [],
      } as any;

      const getByIdSpy = spyOn(document, 'getElementById').and.returnValue(null);

      component.focusRelatedTaskOrNext();
      tick(100);

      expect(getByIdSpy).toHaveBeenCalledWith('t-task-with-{special}-chars');
    }));
  });

  describe('assignAsSubtaskOfJiraIssue()', () => {
    const mockTask = {
      id: 'TASK_ID',
      title: 'My Task',
      projectId: 'P1',
      tagIds: [],
      subTaskIds: [],
      issueId: null,
      issueProviderId: null,
    } as any;

    const mockPickerResult: JiraIssuePickerResult = {
      issueId: 'JIRA-123',
      issueProviderId: 'provider-1',
      issueKey: 'PROJ-123',
      issueSummary: 'Fix the bug',
    };

    const mockCfg = { host: 'https://jira.example.com' } as any;

    const setupDialogWithPickerResult = (
      pickerResult: JiraIssuePickerResult | undefined,
    ): void => {
      matDialog.open.and.returnValue({
        afterClosed: () => of(pickerResult),
      } as unknown as MatDialogRef<unknown>);
    };

    beforeEach(() => {
      component.task = mockTask;
      // Reset call counts between tests
      matDialog.open.calls.reset();
      issueProviderService.getCfgOnce$.calls.reset();
      jiraApiService.getReducedIssueById$.calls.reset();
      issueService.addTaskFromIssue.calls.reset();
      snackService.open.calls.reset();

      // Default happy-path dialog: returns a picker result
      setupDialogWithPickerResult(mockPickerResult);
      // Default: addTaskFromIssue succeeds
      issueService.addTaskFromIssue.and.resolveTo('JIRA_TASK_ID');
    });

    const waitForAsyncOperations = async (): Promise<void> => {
      // Allow dynamic import to resolve, then drain promise/microtask queues
      // Multiple macrotask yields are needed for the async chain:
      // dynamic import → afterClosed subscribe → _assignAsSubtask awaits
      // → getCfgOnce$ firstValueFrom → getReducedIssueById$ firstValueFrom
      // → addTaskFromIssue → selectAllTasks firstValueFrom → snackService.open
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 0));
        fixture.detectChanges();
      }
    };

    it('should open MatDialog when called', async () => {
      component.assignAsSubtaskOfJiraIssue();
      await waitForAsyncOperations();

      expect(matDialog.open).toHaveBeenCalled();
    });

    it('should call IssueProviderService.getCfgOnce$ with issueProviderId and JIRA when picker returns a result', async () => {
      component.assignAsSubtaskOfJiraIssue();
      await waitForAsyncOperations();

      expect(issueProviderService.getCfgOnce$).toHaveBeenCalledWith(
        mockPickerResult.issueProviderId,
        'JIRA',
      );
    });

    it('should call JiraApiService.getReducedIssueById$ with issueId after picker result', async () => {
      component.assignAsSubtaskOfJiraIssue();
      await waitForAsyncOperations();

      expect(jiraApiService.getReducedIssueById$).toHaveBeenCalledWith(
        mockPickerResult.issueId,
        mockCfg,
      );
    });

    it('should dispatch convertToSubTask when addTaskFromIssue returns a task ID', async () => {
      issueService.addTaskFromIssue.and.resolveTo('JIRA_TASK_ID');
      spyOn(store, 'dispatch');

      component.assignAsSubtaskOfJiraIssue();
      await waitForAsyncOperations();

      expect(store.dispatch).toHaveBeenCalledWith(
        TaskSharedActions.convertToSubTask({
          task: mockTask,
          parentId: 'JIRA_TASK_ID',
        }),
      );
    });

    it('should fall back to selectAllTasks scan and dispatch convertToSubTask when addTaskFromIssue returns undefined', async () => {
      issueService.addTaskFromIssue.and.resolveTo(undefined);
      const existingJiraTask = {
        id: 'EXISTING_JIRA_TASK_ID',
        issueId: mockPickerResult.issueId,
        issueProviderId: mockPickerResult.issueProviderId,
      } as any;
      store.overrideSelector(selectAllTasks, [existingJiraTask]);
      store.refreshState();
      spyOn(store, 'dispatch');

      component.assignAsSubtaskOfJiraIssue();
      await waitForAsyncOperations();

      expect(store.dispatch).toHaveBeenCalledWith(
        TaskSharedActions.convertToSubTask({
          task: mockTask,
          parentId: 'EXISTING_JIRA_TASK_ID',
        }),
      );
    });

    it('should show error snack and not dispatch when jiraTaskId cannot be found', async () => {
      issueService.addTaskFromIssue.and.resolveTo(undefined);
      store.overrideSelector(selectAllTasks, []);
      store.refreshState();
      spyOn(store, 'dispatch');

      component.assignAsSubtaskOfJiraIssue();
      await waitForAsyncOperations();

      expect(snackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: 'ERROR' }),
      );
      expect(store.dispatch).not.toHaveBeenCalled();
    });

    it('should not call getCfgOnce$ when picker is cancelled (returns undefined)', async () => {
      setupDialogWithPickerResult(undefined);

      component.assignAsSubtaskOfJiraIssue();
      await waitForAsyncOperations();

      expect(issueProviderService.getCfgOnce$).not.toHaveBeenCalled();
    });
  });
});
