import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Observable, of } from 'rxjs';
import { PluginHooksEffects } from './plugin-hooks.effects';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { PluginService } from './plugin.service';
import { TaskSharedActions } from '../root-store/meta/task-shared.actions';
import { PlannerActions } from '../features/planner/store/planner.actions';
import { Task, TaskCopy } from '../features/tasks/task.model';
import { PluginHooks } from './plugin-api.model';
import { selectTaskById } from '../features/tasks/store/task.selectors';

describe('PluginHooksEffects', () => {
  let effects: PluginHooksEffects;
  let actions$: Observable<any>;
  let pluginServiceMock: jasmine.SpyObj<PluginService>;
  let store: MockStore;

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
    }) as Task;

  let mockTask: Task;

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

    it('should dispatch TASK_UPDATE hook on planTaskForDay action', (done) => {
      const day = '2024-01-15';
      actions$ = of(
        PlannerActions.planTaskForDay({
          task: mockTask as TaskCopy,
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
          task: mockTask as TaskCopy,
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
});
