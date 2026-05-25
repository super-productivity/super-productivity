import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { EMPTY, Observable, of } from 'rxjs';
import { PluginHooksEffects } from './plugin-hooks.effects';
import { WorkContextService } from '../features/work-context/work-context.service';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { PluginService } from './plugin.service';
import { TaskSharedActions } from '../root-store/meta/task-shared.actions';
import { PlannerActions } from '../features/planner/store/planner.actions';
import { TaskWithSubTasks } from '../features/tasks/task.model';
import { PluginHooks } from './plugin-api.model';
import {
  selectCurrentTask,
  selectTaskById,
} from '../features/tasks/store/task.selectors';

describe('PluginHooksEffects', () => {
  let effects: PluginHooksEffects;
  let actions$: Observable<any>;
  let pluginServiceMock: jasmine.SpyObj<PluginService>;
  let store: MockStore;

  const createMockTask = (overrides: Partial<TaskWithSubTasks> = {}): TaskWithSubTasks =>
    ({
      id: 'task-123',
      title: 'Test Task',
      projectId: null,
      tagIds: [],
      subTaskIds: [],
      subTasks: [],
      parentId: null,
      timeSpentOnDay: {},
      timeSpent: 0,
      timeEstimate: 0,
      isDone: false,
      notes: '',
      doneOn: undefined,
      dueWithTime: undefined,
      dueDay: undefined,
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
      _showSubTasksMode: 2,
      ...overrides,
    }) as TaskWithSubTasks;

  let mockTask: TaskWithSubTasks;

  beforeEach(() => {
    mockTask = createMockTask();
    pluginServiceMock = jasmine.createSpyObj('PluginService', ['dispatchHook']);

    TestBed.configureTestingModule({
      providers: [
        PluginHooksEffects,
        provideMockActions(() => actions$),
        provideMockStore({
          initialState: {
            globalConfig: {
              localization: {
                lng: 'en',
                dateTimeLocale: undefined,
                firstDayOfWeek: undefined,
              },
            },
          },
        }),
        { provide: PluginService, useValue: pluginServiceMock },
        // workContextChange$ reads activeWorkContext$ at construction; an
        // empty stream keeps that effect inert for the other effects' tests.
        { provide: WorkContextService, useValue: { activeWorkContext$: EMPTY } },
      ],
    });

    effects = TestBed.inject(PluginHooksEffects);
    store = TestBed.inject(MockStore);

    // Override selector to return our mock task
    store.overrideSelector(selectTaskById, mockTask);
  });

  afterEach(() => {
    store.resetSelectors();
  });

  describe('taskUpdate$', () => {
    it('should dispatch TASK_UPDATE hook on updateTask action', (done) => {
      const changes = { title: 'Updated Title' };
      actions$ = of(
        TaskSharedActions.updateTask({
          task: { id: mockTask.id, changes },
        }),
      );

      effects.taskUpdate$.subscribe(() => {
        expect(pluginServiceMock.dispatchHook).toHaveBeenCalledWith(
          PluginHooks.TASK_UPDATE,
          jasmine.objectContaining({
            taskId: mockTask.id,
            changes,
          }),
        );
        done();
      });
    });

    it('should dispatch TASK_UPDATE hook on scheduleTaskWithTime action', (done) => {
      const dueWithTime = Date.now() + 3600000;
      actions$ = of(
        TaskSharedActions.scheduleTaskWithTime({
          task: mockTask,
          dueWithTime,
          isMoveToBacklog: false,
        }),
      );

      effects.taskUpdate$.subscribe(() => {
        expect(pluginServiceMock.dispatchHook).toHaveBeenCalledWith(
          PluginHooks.TASK_UPDATE,
          jasmine.objectContaining({
            taskId: mockTask.id,
            changes: { dueWithTime, dueDay: undefined },
          }),
        );
        done();
      });
    });

    it('should dispatch TASK_UPDATE hook on reScheduleTaskWithTime action', (done) => {
      const dueWithTime = Date.now() + 7200000;
      actions$ = of(
        TaskSharedActions.reScheduleTaskWithTime({
          task: mockTask,
          dueWithTime,
          isMoveToBacklog: false,
        }),
      );

      effects.taskUpdate$.subscribe(() => {
        expect(pluginServiceMock.dispatchHook).toHaveBeenCalledWith(
          PluginHooks.TASK_UPDATE,
          jasmine.objectContaining({
            taskId: mockTask.id,
            changes: { dueWithTime, dueDay: undefined },
          }),
        );
        done();
      });
    });

    it('should dispatch TASK_UPDATE hook on unscheduleTask action', (done) => {
      actions$ = of(
        TaskSharedActions.unscheduleTask({
          id: mockTask.id,
        }),
      );

      effects.taskUpdate$.subscribe(() => {
        expect(pluginServiceMock.dispatchHook).toHaveBeenCalledWith(
          PluginHooks.TASK_UPDATE,
          jasmine.objectContaining({
            taskId: mockTask.id,
            changes: { dueWithTime: undefined, reminderId: undefined },
          }),
        );
        done();
      });
    });

    it('should dispatch TASK_UPDATE hook on moveToOtherProject action', (done) => {
      const targetProjectId = 'project-456';
      actions$ = of(
        TaskSharedActions.moveToOtherProject({
          task: mockTask,
          targetProjectId,
        }),
      );

      effects.taskUpdate$.subscribe(() => {
        expect(pluginServiceMock.dispatchHook).toHaveBeenCalledWith(
          PluginHooks.TASK_UPDATE,
          jasmine.objectContaining({
            taskId: mockTask.id,
            changes: { projectId: targetProjectId },
          }),
        );
        done();
      });
    });

    it('should dispatch TASK_UPDATE hook on planTaskForDay action', (done) => {
      const day = '2024-01-15';
      actions$ = of(
        PlannerActions.planTaskForDay({
          task: mockTask,
          day,
        }),
      );

      effects.taskUpdate$.subscribe(() => {
        expect(pluginServiceMock.dispatchHook).toHaveBeenCalledWith(
          PluginHooks.TASK_UPDATE,
          jasmine.objectContaining({
            taskId: mockTask.id,
            changes: { dueDay: day, dueWithTime: undefined },
          }),
        );
        done();
      });
    });

    it('should dispatch TASK_UPDATE hook on transferTask action', (done) => {
      const newDay = '2024-01-16';
      actions$ = of(
        PlannerActions.transferTask({
          task: mockTask,
          prevDay: '2024-01-15',
          newDay,
          targetIndex: 0,
          today: '2024-01-14',
        }),
      );

      effects.taskUpdate$.subscribe(() => {
        expect(pluginServiceMock.dispatchHook).toHaveBeenCalledWith(
          PluginHooks.TASK_UPDATE,
          jasmine.objectContaining({
            taskId: mockTask.id,
            changes: { dueDay: newDay },
          }),
        );
        done();
      });
    });
  });

  describe('onCurrentTaskChange$', () => {
    it('should dispatch CURRENT_TASK_CHANGE with { current, previous: null } when a task becomes active from idle', (done) => {
      store.overrideSelector(selectCurrentTask, null);
      actions$ = of();

      const sub = effects.onCurrentTaskChange$.subscribe();
      store.overrideSelector(selectCurrentTask, mockTask);
      store.refreshState();

      // give microtasks a tick to flush
      setTimeout(() => {
        expect(pluginServiceMock.dispatchHook).toHaveBeenCalledWith(
          PluginHooks.CURRENT_TASK_CHANGE,
          { current: mockTask, previous: null },
        );
        sub.unsubscribe();
        done();
      }, 0);
    });

    it('should dispatch CURRENT_TASK_CHANGE with { current: null, previous } when the active task is stopped', (done) => {
      store.overrideSelector(selectCurrentTask, mockTask);
      actions$ = of();

      const sub = effects.onCurrentTaskChange$.subscribe();
      store.overrideSelector(selectCurrentTask, null);
      store.refreshState();

      setTimeout(() => {
        expect(pluginServiceMock.dispatchHook).toHaveBeenCalledWith(
          PluginHooks.CURRENT_TASK_CHANGE,
          { current: null, previous: mockTask },
        );
        sub.unsubscribe();
        done();
      }, 0);
    });

    it('should emit both previous and current when switching between tasks', (done) => {
      const otherTask = createMockTask({ id: 'task-other', title: 'Other Task' });
      store.overrideSelector(selectCurrentTask, mockTask);
      actions$ = of();

      const sub = effects.onCurrentTaskChange$.subscribe();
      store.overrideSelector(selectCurrentTask, otherTask);
      store.refreshState();

      setTimeout(() => {
        expect(pluginServiceMock.dispatchHook).toHaveBeenCalledWith(
          PluginHooks.CURRENT_TASK_CHANGE,
          { current: otherTask, previous: mockTask },
        );
        sub.unsubscribe();
        done();
      }, 0);
    });

    it('should not re-emit when the same task is updated in place', (done) => {
      store.overrideSelector(selectCurrentTask, null);
      actions$ = of();

      const sub = effects.onCurrentTaskChange$.subscribe();
      store.overrideSelector(selectCurrentTask, mockTask);
      store.refreshState();
      // Same id, different object reference (e.g. title change while running).
      store.overrideSelector(selectCurrentTask, { ...mockTask, title: 'Renamed' });
      store.refreshState();

      setTimeout(() => {
        expect(pluginServiceMock.dispatchHook).toHaveBeenCalledTimes(1);
        expect(pluginServiceMock.dispatchHook).toHaveBeenCalledWith(
          PluginHooks.CURRENT_TASK_CHANGE,
          { current: mockTask, previous: null },
        );
        sub.unsubscribe();
        done();
      }, 0);
    });

    it('should carry the latest snapshot of the running task into the stop event', (done) => {
      // Simulates: start task → plugin mutates task (addTag) → stop. The stop
      // payload's `previous` must reflect the post-mutation task state so a
      // taskStopped handler can read the freshly-added field.
      store.overrideSelector(selectCurrentTask, mockTask);
      actions$ = of();

      const sub = effects.onCurrentTaskChange$.subscribe();

      const mutatedTask = createMockTask({ ...mockTask, tagIds: ['in-progress'] });
      store.overrideSelector(selectCurrentTask, mutatedTask);
      store.refreshState();
      store.overrideSelector(selectCurrentTask, null);
      store.refreshState();

      setTimeout(() => {
        expect(pluginServiceMock.dispatchHook).toHaveBeenCalledWith(
          PluginHooks.CURRENT_TASK_CHANGE,
          { current: null, previous: mutatedTask },
        );
        sub.unsubscribe();
        done();
      }, 0);
    });
  });
});
