import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { BehaviorSubject, Subject } from 'rxjs';
import { TaskInternalEffects } from './task-internal.effects';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { setCurrentTask, toggleStart, unsetCurrentTask } from './task.actions';
import { selectTaskFeatureState } from './task.selectors';
import {
  selectConfigFeatureState,
  selectTasksConfig,
} from '../../config/store/global-config.reducer';
import { DEFAULT_TASK, Task, TaskState } from '../task.model';
import { WorkContextService } from '../../work-context/work-context.service';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { DEFAULT_GLOBAL_CONFIG } from '../../config/default-global-config.const';
import { GlobalConfigState, TasksConfig } from '../../config/global-config.model';
import { WorkContextType } from '../../work-context/work-context.model';

describe('TaskInternalEffects', () => {
  let effects: TaskInternalEffects;
  let actions$: Subject<any>;
  let store: MockStore;
  let mainListTaskIds$: BehaviorSubject<string[]>;

  const createTask = (id: string, partial: Partial<Task> = {}): Task => ({
    ...DEFAULT_TASK,
    id,
    title: `Task ${id}`,
    projectId: 'project-1',
    created: Date.now(),
    ...partial,
  });

  const createTaskState = (
    tasks: Task[],
    currentTaskId: string | null = null,
  ): TaskState => {
    const entities: { [id: string]: Task } = {};
    const ids: string[] = [];
    for (const task of tasks) {
      entities[task.id] = task;
      ids.push(task.id);
    }
    return {
      ids,
      entities,
      currentTaskId,
      selectedTaskId: null,
      taskDetailTargetPanel: null,
      lastCurrentTaskId: null,
      isDataLoaded: true,
    };
  };

  const createConfigState = (
    partial: Partial<GlobalConfigState> = {},
  ): GlobalConfigState => ({
    ...DEFAULT_GLOBAL_CONFIG,
    ...partial,
  });

  const createTasksConfig = (partial: Partial<TasksConfig> = {}): TasksConfig => ({
    ...DEFAULT_GLOBAL_CONFIG.tasks,
    ...partial,
  });

  const createAddTaskAction = (
    task: Task,
  ): ReturnType<typeof TaskSharedActions.addTask> =>
    TaskSharedActions.addTask({
      task,
      workContextId: 'project-1',
      workContextType: WorkContextType.PROJECT,
      isAddToBacklog: false,
      isAddToBottom: false,
    });

  beforeEach(() => {
    actions$ = new Subject<any>();
    mainListTaskIds$ = new BehaviorSubject<string[]>([]);

    const workContextServiceMock = {
      mainListTaskIds$,
    };

    TestBed.configureTestingModule({
      providers: [
        TaskInternalEffects,
        provideMockActions(() => actions$),
        provideMockStore({
          selectors: [
            {
              selector: selectTasksConfig,
              value: createTasksConfig({ isAutoMarkParentAsDone: true }),
            },
            { selector: selectTaskFeatureState, value: createTaskState([]) },
            { selector: selectConfigFeatureState, value: createConfigState() },
          ],
        }),
        { provide: WorkContextService, useValue: workContextServiceMock },
        { provide: LOCAL_ACTIONS, useValue: actions$ },
      ],
    });

    effects = TestBed.inject(TaskInternalEffects);
    store = TestBed.inject(MockStore);
  });

  afterEach(() => {
    store.resetSelectors();
  });

  describe('onAllSubTasksDone$', () => {
    it('should mark parent as done when all subtasks are done and config enabled', (done) => {
      const parentTask = createTask('parent', {
        subTaskIds: ['sub1', 'sub2'],
        isDone: false,
      });
      const subTask1 = createTask('sub1', {
        parentId: 'parent',
        isDone: true,
      });
      // Note: State must reflect the RESULT of the action (sub2 is already done)
      // because withLatestFrom gets state AFTER reducer processes the action
      const subTask2 = createTask('sub2', {
        parentId: 'parent',
        isDone: true, // Already done in state when effect runs
      });

      store.overrideSelector(
        selectTasksConfig,
        createTasksConfig({ isAutoMarkParentAsDone: true }),
      );
      store.overrideSelector(
        selectTaskFeatureState,
        createTaskState([parentTask, subTask1, subTask2]),
      );
      store.refreshState();

      effects.onAllSubTasksDone$.subscribe((action) => {
        expect(action.type).toBe(TaskSharedActions.updateTask.type);
        expect((action as any).task.id).toBe('parent');
        expect((action as any).task.changes.isDone).toBe(true);
        done();
      });

      // The action triggers the effect - state already has sub2 as done
      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'sub2', changes: { isDone: true } },
        }),
      );
    });

    it('should NOT mark parent as done when config is disabled', (done) => {
      const parentTask = createTask('parent', {
        subTaskIds: ['sub1'],
        isDone: false,
      });
      const subTask1 = createTask('sub1', {
        parentId: 'parent',
        isDone: false,
      });

      store.overrideSelector(
        selectTasksConfig,
        createTasksConfig({ isAutoMarkParentAsDone: false }),
      );
      store.overrideSelector(
        selectTaskFeatureState,
        createTaskState([parentTask, subTask1]),
      );
      store.refreshState();

      let emitted = false;
      effects.onAllSubTasksDone$.subscribe(() => {
        emitted = true;
      });

      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'sub1', changes: { isDone: true } },
        }),
      );

      setTimeout(() => {
        expect(emitted).toBe(false);
        done();
      }, 50);
    });

    it('should NOT mark parent as done when not all subtasks are done', (done) => {
      const parentTask = createTask('parent', {
        subTaskIds: ['sub1', 'sub2'],
        isDone: false,
      });
      const subTask1 = createTask('sub1', {
        parentId: 'parent',
        isDone: false,
      });
      const subTask2 = createTask('sub2', {
        parentId: 'parent',
        isDone: false,
      });

      store.overrideSelector(
        selectTasksConfig,
        createTasksConfig({ isAutoMarkParentAsDone: true }),
      );
      store.overrideSelector(
        selectTaskFeatureState,
        createTaskState([parentTask, subTask1, subTask2]),
      );
      store.refreshState();

      let emitted = false;
      effects.onAllSubTasksDone$.subscribe(() => {
        emitted = true;
      });

      // Mark only one subtask as done
      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'sub1', changes: { isDone: true } },
        }),
      );

      setTimeout(() => {
        expect(emitted).toBe(false);
        done();
      }, 50);
    });
  });

  describe('setDefaultEstimateIfNonGiven$', () => {
    it('should set default estimate for new task without estimate', (done) => {
      const newTask = createTask('new-task', { timeEstimate: 0 });
      const configState = createConfigState({
        timeTracking: {
          ...DEFAULT_GLOBAL_CONFIG.timeTracking,
          defaultEstimate: 3600000, // 1 hour
          defaultEstimateSubTasks: 1800000, // 30 min
        },
      });

      store.overrideSelector(selectConfigFeatureState, configState);
      store.refreshState();

      effects.setDefaultEstimateIfNonGiven$.subscribe((action) => {
        expect(action.type).toBe(TaskSharedActions.updateTask.type);
        expect((action as any).task.id).toBe('new-task');
        expect((action as any).task.changes.timeEstimate).toBe(3600000);
        done();
      });

      actions$.next(createAddTaskAction(newTask));
    });

    it('should set subtask-specific default estimate for new subtask', (done) => {
      const newSubTask = createTask('new-subtask', {
        timeEstimate: 0,
        parentId: 'parent',
      });
      const configState = createConfigState({
        timeTracking: {
          ...DEFAULT_GLOBAL_CONFIG.timeTracking,
          defaultEstimate: 3600000, // 1 hour
          defaultEstimateSubTasks: 1800000, // 30 min
        },
      });

      store.overrideSelector(selectConfigFeatureState, configState);
      store.refreshState();

      effects.setDefaultEstimateIfNonGiven$.subscribe((action) => {
        expect(action.type).toBe(TaskSharedActions.updateTask.type);
        expect((action as any).task.id).toBe('new-subtask');
        expect((action as any).task.changes.timeEstimate).toBe(1800000);
        done();
      });

      actions$.next(createAddTaskAction(newSubTask));
    });

    it('should NOT set default estimate when task already has estimate', (done) => {
      const newTask = createTask('new-task', { timeEstimate: 7200000 }); // 2 hours
      const configState = createConfigState({
        timeTracking: {
          ...DEFAULT_GLOBAL_CONFIG.timeTracking,
          defaultEstimate: 3600000,
        },
      });

      store.overrideSelector(selectConfigFeatureState, configState);
      store.refreshState();

      let emitted = false;
      effects.setDefaultEstimateIfNonGiven$.subscribe(() => {
        emitted = true;
      });

      actions$.next(createAddTaskAction(newTask));

      setTimeout(() => {
        expect(emitted).toBe(false);
        done();
      }, 50);
    });

    it('should NOT set default estimate when default is 0', (done) => {
      const newTask = createTask('new-task', { timeEstimate: 0 });
      const configState = createConfigState({
        timeTracking: {
          ...DEFAULT_GLOBAL_CONFIG.timeTracking,
          defaultEstimate: 0,
        },
      });

      store.overrideSelector(selectConfigFeatureState, configState);
      store.refreshState();

      let emitted = false;
      effects.setDefaultEstimateIfNonGiven$.subscribe(() => {
        emitted = true;
      });

      actions$.next(createAddTaskAction(newTask));

      setTimeout(() => {
        expect(emitted).toBe(false);
        done();
      }, 50);
    });
  });

  describe('autoSetNextTask$', () => {
    it('should find next task on toggleStart when no current task', (done) => {
      const task1 = createTask('task1', { isDone: false });
      const task2 = createTask('task2', { isDone: false });
      const taskState = createTaskState([task1, task2], null);

      store.overrideSelector(selectTaskFeatureState, taskState);
      store.overrideSelector(selectConfigFeatureState, createConfigState());
      mainListTaskIds$.next(['task1', 'task2']);
      store.refreshState();

      effects.autoSetNextTask$.subscribe((action) => {
        expect(action.type).toBe(setCurrentTask.type);
        expect((action as any).id).toBe('task1');
        done();
      });

      actions$.next(toggleStart());
    });

    it('should unset current task on toggleStart when there is a current task', (done) => {
      const task1 = createTask('task1', { isDone: false });
      const taskState = createTaskState([task1], 'task1');

      store.overrideSelector(selectTaskFeatureState, taskState);
      store.overrideSelector(selectConfigFeatureState, createConfigState());
      store.refreshState();

      effects.autoSetNextTask$.subscribe((action) => {
        expect(action.type).toBe(unsetCurrentTask.type);
        done();
      });

      actions$.next(toggleStart());
    });

    it('should select next task when current task is marked done with autoStart enabled', (done) => {
      const task1 = createTask('task1', { isDone: true });
      const task2 = createTask('task2', { isDone: false });
      const taskState = createTaskState([task1, task2], 'task1');

      const configState = createConfigState({
        timeTracking: {
          ...DEFAULT_GLOBAL_CONFIG.timeTracking,
          isAutoStartNextTask: true,
        },
      });

      store.overrideSelector(selectTaskFeatureState, taskState);
      store.overrideSelector(selectConfigFeatureState, configState);
      mainListTaskIds$.next(['task1', 'task2']);
      store.refreshState();

      effects.autoSetNextTask$.subscribe((action) => {
        expect(action.type).toBe(setCurrentTask.type);
        expect((action as any).id).toBe('task2');
        done();
      });

      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task1', changes: { isDone: true } },
        }),
      );
    });

    it('should unset current task when task is marked done without autoStart', (done) => {
      const task1 = createTask('task1', { isDone: true });
      const task2 = createTask('task2', { isDone: false });
      const taskState = createTaskState([task1, task2], 'task1');

      const configState = createConfigState({
        timeTracking: {
          ...DEFAULT_GLOBAL_CONFIG.timeTracking,
          isAutoStartNextTask: false,
        },
      });

      store.overrideSelector(selectTaskFeatureState, taskState);
      store.overrideSelector(selectConfigFeatureState, configState);
      store.refreshState();

      effects.autoSetNextTask$.subscribe((action) => {
        expect(action.type).toBe(unsetCurrentTask.type);
        done();
      });

      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task1', changes: { isDone: true } },
        }),
      );
    });
  });
});
