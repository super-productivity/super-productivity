import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, of, Subject } from 'rxjs';
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
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { LS } from '../../../core/persistence/storage-keys.const';
import { Action } from '@ngrx/store';
import { LayoutService } from '../../../core-ui/layout/layout.service';

describe('TaskUiEffects', () => {
  let effects: TaskUiEffects;
  let actions$: Subject<Action>;
  let snackServiceMock: jasmine.SpyObj<SnackService>;
  let taskServiceMock: jasmine.SpyObj<TaskService>;
  let navigateToTaskServiceMock: jasmine.SpyObj<NavigateToTaskService>;
  let layoutServiceMock: jasmine.SpyObj<LayoutService>;

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
      actions$ = new Subject<Action>();
      snackServiceMock = jasmine.createSpyObj('SnackService', ['open']);
      taskServiceMock = jasmine.createSpyObj('TaskService', ['setSelectedId']);
      navigateToTaskServiceMock = jasmine.createSpyObj('NavigateToTaskService', [
        'navigate',
      ]);
      layoutServiceMock = jasmine.createSpyObj('LayoutService', ['hideAddTaskBar']);

      const workContextServiceMock = {
        mainListTaskIds$: of(['existing-task-1', 'existing-task-2']),
      };

      TestBed.configureTestingModule({
        providers: [
          TaskUiEffects,
          { provide: LOCAL_ACTIONS, useValue: actions$ },
          provideMockStore({
            initialState: {},
            selectors: [{ selector: selectProjectById, value: null }],
          }),
          { provide: SnackService, useValue: snackServiceMock },
          { provide: TaskService, useValue: taskServiceMock },
          { provide: NavigateToTaskService, useValue: navigateToTaskServiceMock },
          { provide: LayoutService, useValue: layoutServiceMock },
          { provide: WorkContextService, useValue: workContextServiceMock },
          {
            provide: NotifyService,
            useValue: jasmine.createSpyObj('NotifyService', ['notify', 'notifyDesktop']),
          },
          {
            provide: BannerService,
            useValue: jasmine.createSpyObj('BannerService', ['open', 'dismiss']),
          },
          {
            provide: GlobalConfigService,
            useValue: {
              sound$: of({ doneSound: null }),
              tasks$: of({ isNotifyOnTaskDone: false }),
            },
          },
          { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
        ],
      });

      effects = TestBed.inject(TaskUiEffects);
    });

    it('should NOT show snack when task is visible on current page', (done) => {
      const task = createMockTask({ id: 'existing-task-1' });

      effects.taskCreatedSnack$.subscribe(() => {
        expect(snackServiceMock.open).not.toHaveBeenCalled();
        done();
      });

      actions$.next(createAddTaskAction(task));
    });
  });

  describe('taskCreatedSnack$ with non-visible task', () => {
    beforeEach(() => {
      localStorage.setItem(LS.ONBOARDING_HINTS_DONE, 'true');
      actions$ = new Subject<Action>();
      snackServiceMock = jasmine.createSpyObj('SnackService', ['open']);
      taskServiceMock = jasmine.createSpyObj('TaskService', ['setSelectedId']);
      navigateToTaskServiceMock = jasmine.createSpyObj('NavigateToTaskService', [
        'navigate',
      ]);
      layoutServiceMock = jasmine.createSpyObj('LayoutService', ['hideAddTaskBar']);

      const workContextServiceMock = {
        mainListTaskIds$: of(['existing-task-1', 'existing-task-2']),
      };

      TestBed.configureTestingModule({
        providers: [
          TaskUiEffects,
          { provide: LOCAL_ACTIONS, useValue: actions$ },
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
          { provide: LayoutService, useValue: layoutServiceMock },
          { provide: WorkContextService, useValue: workContextServiceMock },
          {
            provide: NotifyService,
            useValue: jasmine.createSpyObj('NotifyService', ['notify', 'notifyDesktop']),
          },
          {
            provide: BannerService,
            useValue: jasmine.createSpyObj('BannerService', ['open', 'dismiss']),
          },
          {
            provide: GlobalConfigService,
            useValue: {
              sound$: of({ doneSound: null }),
              tasks$: of({ isNotifyOnTaskDone: false }),
            },
          },
          { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
        ],
      });

      effects = TestBed.inject(TaskUiEffects);
    });

    it('should show snack with action button when task is NOT visible on current page', (done) => {
      const task = createMockTask({ id: 'new-task-456', projectId: 'project-1' });

      effects.taskCreatedSnack$.subscribe(() => {
        expect(snackServiceMock.open).toHaveBeenCalled();
        const snackParams = snackServiceMock.open.calls.mostRecent()
          .args[0] as SnackParams;
        expect(snackParams.actionStr).toBe(T.F.TASK.S.GO_TO_TASK);
        expect(snackParams.actionFn).toBeDefined();
        done();
      });

      actions$.next(createAddTaskAction(task));
    });

    it('should call navigateToTaskService.navigate when action clicked for non-visible task', (done) => {
      const task = createMockTask({ id: 'new-task-456', projectId: 'project-1' });

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

      actions$.next(createAddTaskAction(task));
    });

    it('should show CREATED_FOR_PROJECT message for task in different project', (done) => {
      const task = createMockTask({ id: 'new-task-456', projectId: 'project-1' });

      effects.taskCreatedSnack$.subscribe(() => {
        const snackParams = snackServiceMock.open.calls.mostRecent()
          .args[0] as SnackParams;
        expect(snackParams.msg).toBe(T.F.TASK.S.CREATED_FOR_PROJECT);
        done();
      });

      actions$.next(createAddTaskAction(task));
    });

    it('should close add task bar when Go to task action is clicked', (done) => {
      const task = createMockTask({ id: 'new-task-456', projectId: 'project-1' });

      effects.taskCreatedSnack$.subscribe(() => {
        const snackParams = snackServiceMock.open.calls.mostRecent()
          .args[0] as SnackParams;
        snackParams.actionFn!();
        expect(layoutServiceMock.hideAddTaskBar).toHaveBeenCalled();
        done();
      });

      actions$.next(createAddTaskAction(task));
    });

    afterEach(() => {
      localStorage.removeItem(LS.ONBOARDING_HINTS_DONE);
    });
  });

  describe('taskDoneNotification$', () => {
    let notifyServiceMock: jasmine.SpyObj<NotifyService>;
    let sound$: BehaviorSubject<{ doneSound: string | null }>;
    let tasks$: BehaviorSubject<{ isNotifyOnTaskDone: boolean }>;

    beforeEach(() => {
      actions$ = new Subject<Action>();
      sound$ = new BehaviorSubject<{ doneSound: string | null }>({
        doneSound: 'ding-small-bell.mp3',
      });
      tasks$ = new BehaviorSubject<{ isNotifyOnTaskDone: boolean }>({
        isNotifyOnTaskDone: true,
      });
      snackServiceMock = jasmine.createSpyObj('SnackService', ['open']);
      taskServiceMock = jasmine.createSpyObj('TaskService', ['setSelectedId']);
      navigateToTaskServiceMock = jasmine.createSpyObj('NavigateToTaskService', [
        'navigate',
      ]);
      layoutServiceMock = jasmine.createSpyObj('LayoutService', ['hideAddTaskBar']);
      notifyServiceMock = jasmine.createSpyObj('NotifyService', [
        'notify',
        'notifyDesktop',
      ]);

      const workContextServiceMock = {
        mainListTaskIds$: of([]),
        flatDoneTodayNr$: of(0),
      };

      TestBed.configureTestingModule({
        providers: [
          TaskUiEffects,
          { provide: LOCAL_ACTIONS, useValue: actions$ },
          provideMockStore({
            initialState: {},
            selectors: [{ selector: selectProjectById, value: null }],
          }),
          { provide: SnackService, useValue: snackServiceMock },
          { provide: TaskService, useValue: taskServiceMock },
          { provide: NavigateToTaskService, useValue: navigateToTaskServiceMock },
          { provide: LayoutService, useValue: layoutServiceMock },
          { provide: WorkContextService, useValue: workContextServiceMock },
          { provide: NotifyService, useValue: notifyServiceMock },
          {
            provide: BannerService,
            useValue: jasmine.createSpyObj('BannerService', ['open', 'dismiss']),
          },
          {
            provide: GlobalConfigService,
            useValue: { sound$, tasks$ },
          },
          { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
        ],
      });

      effects = TestBed.inject(TaskUiEffects);
    });

    it('should show a desktop notification when a task is marked done', (done) => {
      effects.taskDoneNotification$.subscribe(() => {
        expect(notifyServiceMock.notifyDesktop).toHaveBeenCalledWith(
          jasmine.objectContaining({
            tag: 'TASK_DONE_task-123',
            title: T.NOTIFICATION.TASK_MARKED_DONE,
          }),
        );
        done();
      });

      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-123', changes: { isDone: true } },
        }),
      );
    });

    it('should show a desktop notification even when the done sound is disabled', (done) => {
      sound$.next({ doneSound: null });
      effects.taskDoneNotification$.subscribe(() => {
        expect(notifyServiceMock.notifyDesktop).toHaveBeenCalledWith(
          jasmine.objectContaining({
            tag: 'TASK_DONE_task-123',
            title: T.NOTIFICATION.TASK_MARKED_DONE,
          }),
        );
        done();
      });

      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-123', changes: { isDone: true } },
        }),
      );
    });

    it('should not show a desktop notification when task done notifications are disabled', (done) => {
      tasks$.next({ isNotifyOnTaskDone: false });
      effects.taskDoneNotification$.subscribe();

      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-123', changes: { isDone: true } },
        }),
      );

      setTimeout(() => {
        expect(notifyServiceMock.notifyDesktop).not.toHaveBeenCalled();
        done();
      }, 0);
    });

    it('should not show a desktop notification for issue refreshes', (done) => {
      effects.taskDoneNotification$.subscribe();

      actions$.next(
        TaskSharedActions.updateTask({
          task: {
            id: 'task-123',
            changes: { isDone: true, issueWasUpdated: true },
          },
        }),
      );

      setTimeout(() => {
        expect(notifyServiceMock.notifyDesktop).not.toHaveBeenCalled();
        done();
      }, 0);
    });

    it('should not show a desktop notification when a task is marked not done', (done) => {
      effects.taskDoneNotification$.subscribe();

      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-123', changes: { isDone: false } },
        }),
      );

      setTimeout(() => {
        expect(notifyServiceMock.notifyDesktop).not.toHaveBeenCalled();
        done();
      }, 0);
    });
  });
});
