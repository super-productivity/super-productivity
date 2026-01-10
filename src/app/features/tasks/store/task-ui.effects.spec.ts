import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Observable, of } from 'rxjs';
import { TaskUiEffects } from './task-ui.effects';
import { provideMockStore } from '@ngrx/store/testing';
import { TaskService } from '../task.service';
import { SnackService } from '../../../core/snack/snack.service';
import { SnackParams } from '../../../core/snack/snack.model';
import { WorkContextService } from '../../work-context/work-context.service';
import { NavigateToTaskService } from '../../../core-ui/navigate-to-task/navigate-to-task.service';
import { NotifyService } from '../../../core/notify/notify.service';
import { BannerService } from '../../../core/banner/banner.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { Router } from '@angular/router';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { T } from '../../../t.const';
import { Task } from '../task.model';
import { WorkContextType } from '../../work-context/work-context.model';
import { selectProjectById } from '../../project/store/project.selectors';

describe('TaskUiEffects', () => {
  let effects: TaskUiEffects;
  let actions$: Observable<any>;
  let snackServiceMock: jasmine.SpyObj<SnackService>;
  let taskServiceMock: jasmine.SpyObj<TaskService>;
  let navigateToTaskServiceMock: jasmine.SpyObj<NavigateToTaskService>;

  const createMockTask = (overrides: Partial<Task> = {}): Task =>
    ({
      id: 'task-123',
      title: 'Test Task',
      projectId: null,
      tagIds: [],
      subTaskIds: [],
      parentId: null,
      timeSpentOnDay: {},
      timeSpent: 0,
      timeEstimate: 0,
      isDone: false,
      notes: '',
      doneOn: null,
      plannedAt: null,
      reminderId: null,
      repeatCfgId: null,
      issueId: null,
      issueType: null,
      issueProviderId: null,
      issueWasUpdated: false,
      issueLastUpdated: null,
      issueTimeTracked: null,
      attachments: [],
      created: Date.now(),
      ...overrides,
    }) as Task;

  const createAddTaskAction = (
    task: Task,
  ): ReturnType<typeof TaskSharedActions.addTask> =>
    TaskSharedActions.addTask({
      task,
      workContextId: 'ctx-1',
      workContextType: WorkContextType.PROJECT,
      isAddToBacklog: false,
      isAddToBottom: false,
    });

  describe('taskCreatedSnack$ with visible task', () => {
    beforeEach(() => {
      snackServiceMock = jasmine.createSpyObj('SnackService', ['open']);
      taskServiceMock = jasmine.createSpyObj('TaskService', ['setSelectedId']);
      navigateToTaskServiceMock = jasmine.createSpyObj('NavigateToTaskService', [
        'navigate',
      ]);

      const workContextServiceMock = {
        mainListTaskIds$: of(['existing-task-1', 'existing-task-2']),
      };

      TestBed.configureTestingModule({
        providers: [
          TaskUiEffects,
          provideMockActions(() => actions$),
          provideMockStore({
            initialState: {},
            selectors: [{ selector: selectProjectById, value: null }],
          }),
          { provide: SnackService, useValue: snackServiceMock },
          { provide: TaskService, useValue: taskServiceMock },
          { provide: NavigateToTaskService, useValue: navigateToTaskServiceMock },
          { provide: WorkContextService, useValue: workContextServiceMock },
          {
            provide: NotifyService,
            useValue: jasmine.createSpyObj('NotifyService', ['notify']),
          },
          {
            provide: BannerService,
            useValue: jasmine.createSpyObj('BannerService', ['open', 'dismiss']),
          },
          {
            provide: GlobalConfigService,
            useValue: { sound$: of({ doneSound: null }) },
          },
          { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
        ],
      });

      effects = TestBed.inject(TaskUiEffects);
    });

    it('should show snack with action button when task is visible on current page', (done) => {
      const task = createMockTask({ id: 'existing-task-1' });
      actions$ = of(createAddTaskAction(task));

      effects.taskCreatedSnack$.subscribe(() => {
        expect(snackServiceMock.open).toHaveBeenCalled();
        const snackParams = snackServiceMock.open.calls.mostRecent()
          .args[0] as SnackParams;
        expect(snackParams.actionStr).toBe(T.F.TASK.S.GO_TO_TASK);
        expect(snackParams.actionFn).toBeDefined();
        done();
      });
    });

    it('should call taskService.setSelectedId when action clicked for visible task', (done) => {
      const task = createMockTask({ id: 'existing-task-1' });
      actions$ = of(createAddTaskAction(task));

      effects.taskCreatedSnack$.subscribe(() => {
        const snackParams = snackServiceMock.open.calls.mostRecent()
          .args[0] as SnackParams;
        snackParams.actionFn!();
        expect(taskServiceMock.setSelectedId).toHaveBeenCalledWith('existing-task-1');
        expect(navigateToTaskServiceMock.navigate).not.toHaveBeenCalled();
        done();
      });
    });

    it('should show TASK_CREATED message for task visible on current page', (done) => {
      const task = createMockTask({ id: 'existing-task-1' });
      actions$ = of(createAddTaskAction(task));

      effects.taskCreatedSnack$.subscribe(() => {
        const snackParams = snackServiceMock.open.calls.mostRecent()
          .args[0] as SnackParams;
        expect(snackParams.msg).toBe(T.F.TASK.S.TASK_CREATED);
        done();
      });
    });
  });

  describe('taskCreatedSnack$ with non-visible task', () => {
    beforeEach(() => {
      snackServiceMock = jasmine.createSpyObj('SnackService', ['open']);
      taskServiceMock = jasmine.createSpyObj('TaskService', ['setSelectedId']);
      navigateToTaskServiceMock = jasmine.createSpyObj('NavigateToTaskService', [
        'navigate',
      ]);

      const workContextServiceMock = {
        mainListTaskIds$: of(['existing-task-1', 'existing-task-2']),
      };

      TestBed.configureTestingModule({
        providers: [
          TaskUiEffects,
          provideMockActions(() => actions$),
          provideMockStore({
            initialState: {},
            selectors: [
              {
                selector: selectProjectById,
                value: { id: 'project-1', title: 'Test Project' },
              },
            ],
          }),
          { provide: SnackService, useValue: snackServiceMock },
          { provide: TaskService, useValue: taskServiceMock },
          { provide: NavigateToTaskService, useValue: navigateToTaskServiceMock },
          { provide: WorkContextService, useValue: workContextServiceMock },
          {
            provide: NotifyService,
            useValue: jasmine.createSpyObj('NotifyService', ['notify']),
          },
          {
            provide: BannerService,
            useValue: jasmine.createSpyObj('BannerService', ['open', 'dismiss']),
          },
          {
            provide: GlobalConfigService,
            useValue: { sound$: of({ doneSound: null }) },
          },
          { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
        ],
      });

      effects = TestBed.inject(TaskUiEffects);
    });

    it('should show snack with action button when task is NOT visible on current page', (done) => {
      const task = createMockTask({ id: 'new-task-456', projectId: 'project-1' });
      actions$ = of(createAddTaskAction(task));

      effects.taskCreatedSnack$.subscribe(() => {
        expect(snackServiceMock.open).toHaveBeenCalled();
        const snackParams = snackServiceMock.open.calls.mostRecent()
          .args[0] as SnackParams;
        expect(snackParams.actionStr).toBe(T.F.TASK.S.GO_TO_TASK);
        expect(snackParams.actionFn).toBeDefined();
        done();
      });
    });

    it('should call navigateToTaskService.navigate when action clicked for non-visible task', (done) => {
      const task = createMockTask({ id: 'new-task-456', projectId: 'project-1' });
      actions$ = of(createAddTaskAction(task));

      effects.taskCreatedSnack$.subscribe(() => {
        const snackParams = snackServiceMock.open.calls.mostRecent()
          .args[0] as SnackParams;
        snackParams.actionFn!();
        expect(navigateToTaskServiceMock.navigate).toHaveBeenCalledWith(
          'new-task-456',
          false,
        );
        expect(taskServiceMock.setSelectedId).not.toHaveBeenCalled();
        done();
      });
    });

    it('should show CREATED_FOR_PROJECT message for task in different project', (done) => {
      const task = createMockTask({ id: 'new-task-456', projectId: 'project-1' });
      actions$ = of(createAddTaskAction(task));

      effects.taskCreatedSnack$.subscribe(() => {
        const snackParams = snackServiceMock.open.calls.mostRecent()
          .args[0] as SnackParams;
        expect(snackParams.msg).toBe(T.F.TASK.S.CREATED_FOR_PROJECT);
        done();
      });
    });
  });
});
