/* eslint-disable @typescript-eslint/explicit-function-return-type,@typescript-eslint/naming-convention */
import { taskSharedSchedulingMetaReducer } from './task-shared-scheduling.reducer';
import { TaskSharedActions } from '../task-shared.actions';
import { RootState } from '../../root-state';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
import { Task } from '../../../features/tasks/task.model';
import { Action, ActionReducer } from '@ngrx/store';
import {
  createBaseState,
  createMockTask,
  createStateWithExistingTasks,
  expectStateUpdate,
  expectTagUpdate,
  expectTaskUpdate,
} from './test-utils';
import { getDbDateStr } from '../../../util/get-db-date-str';

describe('taskSharedSchedulingMetaReducer', () => {
  let mockReducer: jasmine.Spy;
  let metaReducer: ActionReducer<any, Action>;
  let baseState: RootState;

  // Fixed time at noon to avoid midnight boundary issues (issue #5609)
  const MOCK_TIME = new Date(2024, 5, 15, 12, 0, 0, 0);

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(MOCK_TIME);
    mockReducer = jasmine.createSpy('reducer').and.callFake((state, action) => state);
    metaReducer = taskSharedSchedulingMetaReducer(mockReducer);
    baseState = createBaseState();
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  describe('scheduleTaskWithTime action', () => {
    const createScheduleAction = (
      taskOverrides: Partial<Task> = {},
      dueWithTime: number,
    ) =>
      TaskSharedActions.scheduleTaskWithTime({
        task: createMockTask(taskOverrides),
        dueWithTime,
        isMoveToBacklog: false,
      });

    it('should add task to Today tag when scheduled for today', () => {
      const testState = createStateWithExistingTasks(['task1'], [], ['task1'], []);
      const action = createScheduleAction({}, Date.now());

      metaReducer(testState, action);
      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['task1'] }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should remove task from Today tag when scheduled for different day', () => {
      const testState = createStateWithExistingTasks([], [], [], ['task1']);
      // eslint-disable-next-line no-mixed-operators
      const tomorrowTimestamp = Date.now() + 24 * 60 * 60 * 1000;
      const action = createScheduleAction({}, tomorrowTimestamp);

      metaReducer(testState, action);
      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: [] }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should not change state when task is already correctly scheduled', () => {
      const now = Date.now();
      const testState = createStateWithExistingTasks([], [], [], ['task1']);
      // Update the task to already have the correct dueWithTime and dueDay
      const task1 = testState[TASK_FEATURE_NAME].entities.task1 as Task;
      testState[TASK_FEATURE_NAME].entities.task1 = {
        ...task1,
        dueWithTime: now,
        dueDay: getDbDateStr(),
      } as Task;
      const action = createScheduleAction({}, now);

      metaReducer(testState, action);
      expect(mockReducer).toHaveBeenCalledWith(testState, action);
    });

    it('should set dueDay to today when scheduling for today', () => {
      const now = Date.now();
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const action = createScheduleAction({}, now);

      metaReducer(testState, action);
      expectStateUpdate(
        expectTaskUpdate('task1', { dueWithTime: now, dueDay: getDbDateStr() }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should set dueDay to undefined when scheduling for a different day', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], ['task1']);
      // eslint-disable-next-line no-mixed-operators
      const tomorrowTimestamp = Date.now() + 24 * 60 * 60 * 1000;
      const action = createScheduleAction({}, tomorrowTimestamp);

      metaReducer(testState, action);
      expectStateUpdate(
        expectTaskUpdate('task1', { dueWithTime: tomorrowTimestamp, dueDay: undefined }),
        action,
        mockReducer,
        testState,
      );
    });
  });

  describe('unScheduleTask action', () => {
    it('should remove task from Today tag when task is in Today', () => {
      const testState = createStateWithExistingTasks([], [], [], ['task1', 'other-task']);
      const action = TaskSharedActions.unscheduleTask({ id: 'task1' });

      metaReducer(testState, action);
      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['other-task'] }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should not change state when task is not in Today tag', () => {
      const action = TaskSharedActions.unscheduleTask({ id: 'task1' });

      metaReducer(baseState, action);
      expect(mockReducer).toHaveBeenCalledWith(baseState, action);
    });

    it('should set dueDay when leaving task in Today list', () => {
      const testState = createStateWithExistingTasks([], [], [], ['task1']);
      testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
        id: 'task1',
        dueWithTime: Date.now(),
        dueDay: undefined,
      });
      const action = TaskSharedActions.unscheduleTask({
        id: 'task1',
        isLeaveInToday: true,
      });

      metaReducer(testState, action);
      expectStateUpdate(
        expectTaskUpdate('task1', { dueDay: getDbDateStr(), dueWithTime: undefined }),
        action,
        mockReducer,
        testState,
      );
    });
  });

  describe('planTasksForToday action', () => {
    it('should add new tasks to the top of Today tag', () => {
      const testState = createStateWithExistingTasks([], [], [], ['existing-task']);
      const action = TaskSharedActions.planTasksForToday({
        taskIds: ['task1', 'task2'],
        parentTaskMap: {},
      });

      metaReducer(testState, action);
      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['task1', 'task2', 'existing-task'] }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should not add tasks that are already in Today tag', () => {
      const testState = createStateWithExistingTasks(
        [],
        [],
        [],
        ['task1', 'existing-task'],
      );
      const action = TaskSharedActions.planTasksForToday({
        taskIds: ['task1', 'task2'],
        parentTaskMap: {},
      });

      metaReducer(testState, action);
      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['task2', 'task1', 'existing-task'] }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should handle parentTaskMap filtering', () => {
      const testState = createStateWithExistingTasks([], [], [], ['parent-task']);
      const action = TaskSharedActions.planTasksForToday({
        taskIds: ['subtask1', 'task2'],
        parentTaskMap: { subtask1: 'parent-task' },
      });

      metaReducer(testState, action);
      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['task2', 'parent-task'] }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should add subtask when parent is NOT in Today', () => {
      const testState = createStateWithExistingTasks([], [], [], []);
      // Create parent and subtask entities
      testState[TASK_FEATURE_NAME].entities['parent-task'] = createMockTask({
        id: 'parent-task',
      });
      testState[TASK_FEATURE_NAME].entities['subtask1'] = createMockTask({
        id: 'subtask1',
        parentId: 'parent-task',
      });
      testState[TASK_FEATURE_NAME].ids.push('parent-task', 'subtask1');

      const action = TaskSharedActions.planTasksForToday({
        taskIds: ['subtask1'],
        parentTaskMap: { subtask1: 'parent-task' },
      });

      metaReducer(testState, action);
      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['subtask1'] }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should NOT add subtask when parent is already in Today', () => {
      const testState = createStateWithExistingTasks([], [], [], ['parent-task']);
      // Create parent and subtask entities
      testState[TASK_FEATURE_NAME].entities['parent-task'] = createMockTask({
        id: 'parent-task',
      });
      testState[TASK_FEATURE_NAME].entities['subtask1'] = createMockTask({
        id: 'subtask1',
        parentId: 'parent-task',
      });
      testState[TASK_FEATURE_NAME].ids.push('parent-task', 'subtask1');

      const action = TaskSharedActions.planTasksForToday({
        taskIds: ['subtask1'],
        parentTaskMap: { subtask1: 'parent-task' },
      });

      metaReducer(testState, action);
      // Subtask should NOT be added, Today tag should remain unchanged (only parent-task)
      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['parent-task'] }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should handle multiple subtasks with different parent states', () => {
      const testState = createStateWithExistingTasks([], [], [], ['parent1']);
      // Create parent tasks and subtasks
      testState[TASK_FEATURE_NAME].entities['parent1'] = createMockTask({
        id: 'parent1',
      });
      testState[TASK_FEATURE_NAME].entities['parent2'] = createMockTask({
        id: 'parent2',
      });
      testState[TASK_FEATURE_NAME].entities['subtask1'] = createMockTask({
        id: 'subtask1',
        parentId: 'parent1',
      });
      testState[TASK_FEATURE_NAME].entities['subtask2'] = createMockTask({
        id: 'subtask2',
        parentId: 'parent2',
      });
      testState[TASK_FEATURE_NAME].ids.push('parent1', 'parent2', 'subtask1', 'subtask2');

      const action = TaskSharedActions.planTasksForToday({
        taskIds: ['subtask1', 'subtask2'],
        parentTaskMap: { subtask1: 'parent1', subtask2: 'parent2' },
      });

      metaReducer(testState, action);
      // subtask1 should NOT be added (parent1 is in Today)
      // subtask2 SHOULD be added (parent2 is not in Today)
      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['subtask2', 'parent1'] }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should set dueDay on subtask when added to Today', () => {
      const testState = createStateWithExistingTasks([], [], [], []);
      testState[TASK_FEATURE_NAME].entities['subtask1'] = createMockTask({
        id: 'subtask1',
        parentId: 'parent-task',
        dueDay: undefined,
      });
      testState[TASK_FEATURE_NAME].ids.push('subtask1');

      const action = TaskSharedActions.planTasksForToday({
        taskIds: ['subtask1'],
        parentTaskMap: { subtask1: 'parent-task' },
      });

      metaReducer(testState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];
      const updatedSubtask = updatedState[TASK_FEATURE_NAME].entities.subtask1;

      expect(updatedSubtask.dueDay).toBe(getDbDateStr());
    });

    it('should remove tasks from planner days when adding to Today', () => {
      const testState = {
        ...createStateWithExistingTasks([], [], [], []),
        planner: {
          ...createStateWithExistingTasks([], [], [], []).planner,
          days: {
            '2024-01-01': ['task1', 'task2', 'keep-task'],
            '2024-01-02': ['task2', 'other-task'],
          },
        },
      };
      const action = TaskSharedActions.planTasksForToday({
        taskIds: ['task1', 'task2'],
        parentTaskMap: {},
      });

      metaReducer(testState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];

      expect(updatedState.planner.days['2024-01-01']).toEqual(['keep-task']);
      expect(updatedState.planner.days['2024-01-02']).toEqual(['other-task']);
    });

    it('should preserve dueWithTime but clear remindAt when task is scheduled for today', () => {
      const now = Date.now();
      const testState = createStateWithExistingTasks([], [], [], []);
      // Create task with dueWithTime and remindAt for today
      testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
        id: 'task1',
        dueWithTime: now,
        remindAt: now,
      });
      testState[TASK_FEATURE_NAME].ids.push('task1');

      const action = TaskSharedActions.planTasksForToday({
        taskIds: ['task1'],
        parentTaskMap: {},
      });

      metaReducer(testState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];
      const updatedTask = updatedState[TASK_FEATURE_NAME].entities.task1;

      expect(updatedTask.dueWithTime).toBe(now);
      expect(updatedTask.remindAt).toBeUndefined();
      expect(updatedTask.dueDay).toBeDefined();
    });

    it('should clear dueWithTime when task is scheduled for a different day', () => {
      // eslint-disable-next-line no-mixed-operators
      const tomorrow = Date.now() + 24 * 60 * 60 * 1000;
      const testState = createStateWithExistingTasks([], [], [], []);
      // Create task with dueWithTime for tomorrow
      testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
        id: 'task1',
        dueWithTime: tomorrow,
      });
      testState[TASK_FEATURE_NAME].ids.push('task1');

      const action = TaskSharedActions.planTasksForToday({
        taskIds: ['task1'],
        parentTaskMap: {},
      });

      metaReducer(testState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];
      const updatedTask = updatedState[TASK_FEATURE_NAME].entities.task1;

      expect(updatedTask.dueWithTime).toBeUndefined();
      expect(updatedTask.dueDay).toBeDefined();
    });

    it('should handle tasks without dueWithTime (backward compatibility)', () => {
      const testState = createStateWithExistingTasks([], [], [], []);
      testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
        id: 'task1',
        dueWithTime: undefined,
        dueDay: undefined,
      });
      testState[TASK_FEATURE_NAME].ids.push('task1');

      const action = TaskSharedActions.planTasksForToday({
        taskIds: ['task1'],
        parentTaskMap: {},
      });

      metaReducer(testState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];
      const updatedTask = updatedState[TASK_FEATURE_NAME].entities.task1;

      expect(updatedTask.dueWithTime).toBeUndefined();
      expect(updatedTask.dueDay).toBeDefined();
    });

    it('should return unchanged state when task is already in today tag AND has dueDay set to today', () => {
      const today = getDbDateStr();
      const testState = createStateWithExistingTasks([], [], [], ['task1']);
      // Task is already in today tag AND has dueDay === today
      testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
        id: 'task1',
        dueDay: today,
        dueWithTime: undefined,
      });

      const action = TaskSharedActions.planTasksForToday({
        taskIds: ['task1'],
        parentTaskMap: {},
      });

      metaReducer(testState, action);
      // Should pass unchanged state to reducer (no modifications)
      expect(mockReducer).toHaveBeenCalledWith(testState, action);
    });

    it('should update dueDay when task is in today tag but dueDay is not set', () => {
      const testState = createStateWithExistingTasks([], [], [], ['task1']);
      // Task is in today tag but dueDay is NOT set
      testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
        id: 'task1',
        dueDay: undefined,
        dueWithTime: undefined,
      });

      const action = TaskSharedActions.planTasksForToday({
        taskIds: ['task1'],
        parentTaskMap: {},
      });

      metaReducer(testState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];
      const updatedTask = updatedState[TASK_FEATURE_NAME].entities.task1;

      // Should update dueDay even though task is already in today tag
      expect(updatedTask.dueDay).toBe(getDbDateStr());
    });

    it('should update dueDay when task is in today tag but dueDay is different', () => {
      const testState = createStateWithExistingTasks([], [], [], ['task1']);
      // Task is in today tag but dueDay is set to a different day
      testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
        id: 'task1',
        dueDay: '2024-01-01', // Different day
        dueWithTime: undefined,
      });

      const action = TaskSharedActions.planTasksForToday({
        taskIds: ['task1'],
        parentTaskMap: {},
      });

      metaReducer(testState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];
      const updatedTask = updatedState[TASK_FEATURE_NAME].entities.task1;

      // Should update dueDay to today
      expect(updatedTask.dueDay).toBe(getDbDateStr());
    });

    it('should preserve dueWithTime for multiple tasks scheduled for today', () => {
      const now = Date.now();
      const testState = createStateWithExistingTasks([], [], [], []);
      // Create multiple tasks with dueWithTime for today
      testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
        id: 'task1',
        dueWithTime: now,
      });
      testState[TASK_FEATURE_NAME].entities.task2 = createMockTask({
        id: 'task2',
        // eslint-disable-next-line no-mixed-operators
        dueWithTime: now + 60 * 60 * 1000, // 1 hour later
      });
      testState[TASK_FEATURE_NAME].ids.push('task1', 'task2');

      const action = TaskSharedActions.planTasksForToday({
        taskIds: ['task1', 'task2'],
        parentTaskMap: {},
      });

      metaReducer(testState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];
      const updatedTask1 = updatedState[TASK_FEATURE_NAME].entities.task1;
      const updatedTask2 = updatedState[TASK_FEATURE_NAME].entities.task2;

      expect(updatedTask1.dueWithTime).toBe(now);
      // eslint-disable-next-line no-mixed-operators
      expect(updatedTask2.dueWithTime).toBe(now + 60 * 60 * 1000);
    });
  });

  describe('removeTasksFromTodayTag action', () => {
    it('should remove specified tasks from Today tag', () => {
      const testState = createStateWithExistingTasks(
        [],
        [],
        [],
        ['task1', 'task2', 'keep-task'],
      );
      const action = TaskSharedActions.removeTasksFromTodayTag({
        taskIds: ['task1', 'task2'],
      });

      metaReducer(testState, action);
      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['keep-task'] }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should handle empty taskIds array', () => {
      const testState = createStateWithExistingTasks([], [], [], ['task1', 'task2']);
      const action = TaskSharedActions.removeTasksFromTodayTag({ taskIds: [] });

      metaReducer(testState, action);
      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['task1', 'task2'] }),
        action,
        mockReducer,
        testState,
      );
    });
  });

  describe('TaskSharedActions.moveTaskInTodayTagList action', () => {
    const createMoveTaskInTodayTagListAction = (toTaskId: string, fromTaskId: string) =>
      TaskSharedActions.moveTaskInTodayTagList({
        toTaskId,
        fromTaskId,
      });

    it('should move task before target task in Today tag', () => {
      const testState = createStateWithExistingTasks(
        [],
        [],
        [],
        ['first-task', 'move-task', 'middle-task', 'target-task', 'last-task'],
      );
      const action = createMoveTaskInTodayTagListAction('target-task', 'move-task');

      metaReducer(testState, action);
      expectStateUpdate(
        expectTagUpdate('TODAY', {
          taskIds: ['first-task', 'middle-task', 'move-task', 'target-task', 'last-task'],
        }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should handle moving task to beginning of list', () => {
      const testState = createStateWithExistingTasks(
        [],
        [],
        [],
        ['first-task', 'move-task', 'last-task'],
      );
      const action = createMoveTaskInTodayTagListAction('first-task', 'move-task');

      metaReducer(testState, action);
      expectStateUpdate(
        expectTagUpdate('TODAY', {
          taskIds: ['move-task', 'first-task', 'last-task'],
        }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should handle moving task to end of list', () => {
      const testState = createStateWithExistingTasks(
        [],
        [],
        [],
        ['move-task', 'middle-task', 'last-task'],
      );
      const action = createMoveTaskInTodayTagListAction('last-task', 'move-task');

      metaReducer(testState, action);
      expectStateUpdate(
        expectTagUpdate('TODAY', {
          taskIds: ['middle-task', 'move-task', 'last-task'],
        }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should handle single task in Today list', () => {
      const testState = createStateWithExistingTasks([], [], [], ['only-task']);
      const action = createMoveTaskInTodayTagListAction('only-task', 'only-task');

      metaReducer(testState, action);
      expectStateUpdate(
        expectTagUpdate('TODAY', {
          taskIds: ['only-task'],
        }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should handle empty Today list gracefully', () => {
      const testState = createStateWithExistingTasks([], [], [], []);
      const action = createMoveTaskInTodayTagListAction('target-task', 'move-task');

      metaReducer(testState, action);
      expectStateUpdate(
        expectTagUpdate('TODAY', {
          taskIds: [],
        }),
        action,
        mockReducer,
        testState,
      );
    });
  });

  describe('other actions', () => {
    it('should pass through other actions to the reducer', () => {
      const action = { type: 'SOME_OTHER_ACTION' };
      metaReducer(baseState, action);

      expect(mockReducer).toHaveBeenCalledWith(baseState, action);
    });
  });
});
