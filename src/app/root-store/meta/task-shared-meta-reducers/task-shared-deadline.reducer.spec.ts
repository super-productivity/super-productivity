import { taskSharedDeadlineMetaReducer } from './task-shared-deadline.reducer';
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
  expectTaskUpdate,
} from './test-utils';

describe('taskSharedDeadlineMetaReducer', () => {
  let mockReducer: jasmine.Spy;
  let metaReducer: ActionReducer<any, Action>;
  let baseState: RootState;

  beforeEach(() => {
    mockReducer = jasmine.createSpy('reducer').and.callFake((state, _action) => state);
    metaReducer = taskSharedDeadlineMetaReducer(mockReducer);
    baseState = createBaseState();
  });

  describe('setDeadline action', () => {
    it('should set deadlineDay and clear deadlineWithTime when only deadlineDay is provided', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const action = TaskSharedActions.setDeadline({
        taskId: 'task1',
        deadlineDay: '2024-06-20',
      });

      metaReducer(testState, action);
      expectStateUpdate(
        expectTaskUpdate('task1', {
          deadlineDay: '2024-06-20',
          deadlineWithTime: undefined,
        }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should set deadlineWithTime and clear deadlineDay when only deadlineWithTime is provided', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const timestamp = new Date(2024, 5, 20, 14, 30).getTime();
      const action = TaskSharedActions.setDeadline({
        taskId: 'task1',
        deadlineWithTime: timestamp,
      });

      metaReducer(testState, action);
      expectStateUpdate(
        expectTaskUpdate('task1', {
          deadlineWithTime: timestamp,
          deadlineDay: undefined,
        }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should store deadlineRemindAt when provided with deadlineDay', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const remindTimestamp = new Date(2024, 5, 20, 9, 0).getTime();
      const action = TaskSharedActions.setDeadline({
        taskId: 'task1',
        deadlineDay: '2024-06-20',
        deadlineRemindAt: remindTimestamp,
      });

      metaReducer(testState, action);
      expectStateUpdate(
        expectTaskUpdate('task1', {
          deadlineDay: '2024-06-20',
          deadlineRemindAt: remindTimestamp,
        }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should store deadlineRemindAt when provided with deadlineWithTime', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const deadlineTimestamp = new Date(2024, 5, 20, 14, 30).getTime();
      const remindTimestamp = new Date(2024, 5, 20, 14, 0).getTime();
      const action = TaskSharedActions.setDeadline({
        taskId: 'task1',
        deadlineWithTime: deadlineTimestamp,
        deadlineRemindAt: remindTimestamp,
      });

      metaReducer(testState, action);
      expectStateUpdate(
        expectTaskUpdate('task1', {
          deadlineWithTime: deadlineTimestamp,
          deadlineRemindAt: remindTimestamp,
        }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should return state unchanged when deadlineDay format is invalid', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const action = TaskSharedActions.setDeadline({
        taskId: 'task1',
        deadlineDay: 'not-a-date',
      });

      metaReducer(testState, action);
      expect(mockReducer).toHaveBeenCalledWith(testState, action);
    });

    it('should return state unchanged when deadlineDay has wrong format (slash separator)', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const action = TaskSharedActions.setDeadline({
        taskId: 'task1',
        deadlineDay: '2024/06/20',
      });

      metaReducer(testState, action);
      expect(mockReducer).toHaveBeenCalledWith(testState, action);
    });

    it('should return state unchanged when deadlineWithTime is NaN', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const action = TaskSharedActions.setDeadline({
        taskId: 'task1',
        deadlineWithTime: NaN,
      });

      metaReducer(testState, action);
      expect(mockReducer).toHaveBeenCalledWith(testState, action);
    });

    it('should return state unchanged when deadlineWithTime is Infinity', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const action = TaskSharedActions.setDeadline({
        taskId: 'task1',
        deadlineWithTime: Infinity,
      });

      metaReducer(testState, action);
      expect(mockReducer).toHaveBeenCalledWith(testState, action);
    });

    it('should return state unchanged when deadlineWithTime is negative Infinity', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const action = TaskSharedActions.setDeadline({
        taskId: 'task1',
        deadlineWithTime: -Infinity,
      });

      metaReducer(testState, action);
      expect(mockReducer).toHaveBeenCalledWith(testState, action);
    });

    it('should return state unchanged when deadlineRemindAt is NaN', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const action = TaskSharedActions.setDeadline({
        taskId: 'task1',
        deadlineDay: '2024-06-20',
        deadlineRemindAt: NaN,
      });

      metaReducer(testState, action);
      expect(mockReducer).toHaveBeenCalledWith(testState, action);
    });

    it('should return state unchanged when deadlineRemindAt is Infinity', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const action = TaskSharedActions.setDeadline({
        taskId: 'task1',
        deadlineDay: '2024-06-20',
        deadlineRemindAt: Infinity,
      });

      metaReducer(testState, action);
      expect(mockReducer).toHaveBeenCalledWith(testState, action);
    });

    it('should return state unchanged when task does not exist', () => {
      const action = TaskSharedActions.setDeadline({
        taskId: 'non-existent-task',
        deadlineDay: '2024-06-20',
      });

      metaReducer(baseState, action);
      expect(mockReducer).toHaveBeenCalledWith(baseState, action);
    });

    it('should enforce mutual exclusivity when both deadlineDay and deadlineWithTime are provided', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const timestamp = new Date(2024, 5, 20, 14, 30).getTime();
      const action = TaskSharedActions.setDeadline({
        taskId: 'task1',
        deadlineDay: '2024-06-20',
        deadlineWithTime: timestamp,
      });

      metaReducer(testState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];
      const updatedTask = updatedState[TASK_FEATURE_NAME].entities.task1;

      // When both are provided: deadlineWithTime clears deadlineDay, deadlineDay clears deadlineWithTime
      // The logic is: deadlineDay = deadlineWithTime ? undefined : deadlineDay
      //               deadlineWithTime = deadlineDay ? undefined : deadlineWithTime
      // With both truthy, both get cleared to undefined
      expect(updatedTask.deadlineDay).toBeUndefined();
      expect(updatedTask.deadlineWithTime).toBeUndefined();
    });

    it('should overwrite existing deadline fields when setting new ones', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const oldTimestamp = new Date(2024, 5, 15, 10, 0).getTime();
      testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
        id: 'task1',
        deadlineWithTime: oldTimestamp,
        deadlineRemindAt: oldTimestamp,
      });

      const action = TaskSharedActions.setDeadline({
        taskId: 'task1',
        deadlineDay: '2024-06-25',
      });

      metaReducer(testState, action);
      expectStateUpdate(
        expectTaskUpdate('task1', {
          deadlineDay: '2024-06-25',
          deadlineWithTime: undefined,
        }),
        action,
        mockReducer,
        testState,
      );
    });

    describe('auto-planning when deadline is today', () => {
      const todayStr = '2024-05-18';
      const autoPlanContext = {
        autoPlanToday: todayStr,
        autoPlanStartOfNextDayDiffMs: 0,
      };

      it('should add to Today and set dueDay if not scheduled', () => {
        const testState = createStateWithExistingTasks(['task1'], [], [], []);

        const action = TaskSharedActions.setDeadline({
          taskId: 'task1',
          deadlineDay: todayStr,
          ...autoPlanContext,
        });

        metaReducer(testState, action);
        const updatedState = mockReducer.calls.mostRecent().args[0];
        const updatedTask = updatedState[TASK_FEATURE_NAME].entities.task1 as Task;
        const todayTag = updatedState.tag.entities['TODAY'];

        expect(updatedTask.dueDay).toBe(todayStr);
        expect(todayTag.taskIds).toContain('task1');
      });

      it('should not auto-plan legacy actions without persisted auto-plan context', () => {
        const testState = createStateWithExistingTasks(['task1'], [], [], []);

        const action = TaskSharedActions.setDeadline({
          taskId: 'task1',
          deadlineDay: todayStr,
        });

        metaReducer(testState, action);
        const updatedState = mockReducer.calls.mostRecent().args[0];
        const updatedTask = updatedState[TASK_FEATURE_NAME].entities.task1 as Task;
        const todayTag = updatedState.tag.entities['TODAY'];

        expect(updatedTask.deadlineDay).toBe(todayStr);
        expect(updatedTask.dueDay).toBeUndefined();
        expect(todayTag.taskIds).not.toContain('task1');
      });

      it('should add to Today and keep schedule if already scheduled for today', () => {
        const testState = createStateWithExistingTasks(['task1'], [], [], []);
        testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
          id: 'task1',
          dueDay: todayStr,
        });

        const action = TaskSharedActions.setDeadline({
          taskId: 'task1',
          deadlineDay: todayStr,
          ...autoPlanContext,
        });

        metaReducer(testState, action);
        const updatedState = mockReducer.calls.mostRecent().args[0];
        const updatedTask = updatedState[TASK_FEATURE_NAME].entities.task1 as Task;
        const todayTag = updatedState.tag.entities['TODAY'];

        expect(updatedTask.dueDay).toBe(todayStr);
        expect(todayTag.taskIds).toContain('task1');
      });

      it('should preserve dueWithTime and remindAt if already scheduled with time today', () => {
        const testState = createStateWithExistingTasks(['task1'], [], [], []);
        const dueWithTime = new Date(2024, 4, 18, 12).getTime();
        const remindAt = new Date(2024, 4, 18, 11).getTime();
        testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
          id: 'task1',
          dueWithTime,
          remindAt,
        });

        const action = TaskSharedActions.setDeadline({
          taskId: 'task1',
          deadlineDay: todayStr,
          ...autoPlanContext,
        });

        metaReducer(testState, action);
        const updatedState = mockReducer.calls.mostRecent().args[0];
        const updatedTask = updatedState[TASK_FEATURE_NAME].entities.task1 as Task;
        const todayTag = updatedState.tag.entities['TODAY'];

        expect(updatedTask.dueWithTime).toBe(dueWithTime);
        expect(updatedTask.dueDay).toBeUndefined();
        expect(updatedTask.remindAt).toBe(remindAt);
        expect(todayTag.taskIds).toContain('task1');
      });

      it('should clear dueWithTime, remindAt, set dueDay, and add to Today if overdue', () => {
        const testState = createStateWithExistingTasks(['task1'], [], [], []);
        const pastTimestamp = new Date(2024, 0, 1, 10).getTime();
        testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
          id: 'task1',
          dueWithTime: pastTimestamp,
          remindAt: pastTimestamp, // orphaned once dueWithTime cleared -> must clear
        });

        const action = TaskSharedActions.setDeadline({
          taskId: 'task1',
          deadlineDay: todayStr,
          ...autoPlanContext,
        });

        metaReducer(testState, action);
        const updatedState = mockReducer.calls.mostRecent().args[0];
        const updatedTask = updatedState[TASK_FEATURE_NAME].entities.task1 as Task;
        const todayTag = updatedState.tag.entities['TODAY'];

        expect(updatedTask.dueDay).toBe(todayStr);
        expect(updatedTask.dueWithTime).toBeUndefined();
        expect(updatedTask.remindAt).toBeUndefined();
        expect(todayTag.taskIds).toContain('task1');
      });

      it('should SKIP auto-planning if task is scheduled for a FUTURE day/time', () => {
        const testState = createStateWithExistingTasks(['task1'], [], [], []);

        // Future schedule
        const futureStr = '2025-01-01';
        testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
          id: 'task1',
          dueDay: futureStr,
        });

        const action = TaskSharedActions.setDeadline({
          taskId: 'task1',
          deadlineDay: todayStr,
          ...autoPlanContext,
        });

        metaReducer(testState, action);
        const updatedState = mockReducer.calls.mostRecent().args[0];
        const updatedTask = updatedState[TASK_FEATURE_NAME].entities.task1 as Task;
        const todayTag = updatedState.tag.entities['TODAY'];

        // Should not have auto-planned (dueDay stays future, not in TODAY)
        expect(updatedTask.dueDay).toBe(futureStr);
        expect(todayTag?.taskIds || []).not.toContain('task1');
      });

      it('should skip done tasks', () => {
        const testState = createStateWithExistingTasks(['task1'], [], [], []);
        testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
          id: 'task1',
          isDone: true,
        });

        const action = TaskSharedActions.setDeadline({
          taskId: 'task1',
          deadlineDay: todayStr,
          ...autoPlanContext,
        });

        metaReducer(testState, action);
        const updatedState = mockReducer.calls.mostRecent().args[0];
        const updatedTask = updatedState[TASK_FEATURE_NAME].entities.task1 as Task;
        const todayTag = updatedState.tag.entities['TODAY'];

        expect(updatedTask.dueDay).toBeUndefined();
        expect(todayTag.taskIds).not.toContain('task1');
      });

      it('should skip subtasks when their parent is due today', () => {
        const testState = createStateWithExistingTasks(['parent', 'sub'], [], [], []);
        testState[TASK_FEATURE_NAME].entities.parent = createMockTask({
          id: 'parent',
          dueDay: todayStr,
        });
        testState[TASK_FEATURE_NAME].entities.sub = createMockTask({
          id: 'sub',
          parentId: 'parent',
        });

        const action = TaskSharedActions.setDeadline({
          taskId: 'sub',
          deadlineDay: todayStr,
          ...autoPlanContext,
        });

        metaReducer(testState, action);
        const updatedState = mockReducer.calls.mostRecent().args[0];
        const updatedTask = updatedState[TASK_FEATURE_NAME].entities.sub as Task;
        const todayTag = updatedState.tag.entities['TODAY'];

        expect(updatedTask.dueDay).toBeUndefined();
        expect(todayTag.taskIds).not.toContain('sub');
      });
    });
  });

  describe('planDeadlineTasksForToday action', () => {
    const todayStr = '2024-05-18';
    const createAction = (
      taskIds: string[],
    ): ReturnType<typeof TaskSharedActions.planDeadlineTasksForToday> =>
      TaskSharedActions.planDeadlineTasksForToday({
        taskIds,
        today: todayStr,
        startOfNextDayDiffMs: 0,
      });

    it('should atomically plan unscheduled tasks with deadline today', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
        id: 'task1',
        deadlineDay: todayStr,
      });

      const action = createAction(['task1']);

      metaReducer(testState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];
      const updatedTask = updatedState[TASK_FEATURE_NAME].entities.task1 as Task;
      const todayTag = updatedState.tag.entities['TODAY'];

      expect(updatedTask.dueDay).toBe(todayStr);
      expect(todayTag.taskIds).toContain('task1');
    });

    it('should skip future-scheduled tasks', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
        id: 'task1',
        deadlineDay: todayStr,
        dueDay: '2024-06-01',
      });

      const action = createAction(['task1']);

      metaReducer(testState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];
      const updatedTask = updatedState[TASK_FEATURE_NAME].entities.task1 as Task;
      const todayTag = updatedState.tag.entities['TODAY'];

      expect(updatedTask.dueDay).toBe('2024-06-01');
      expect(todayTag.taskIds).not.toContain('task1');
    });

    it('should process parents before subtasks', () => {
      const testState = createStateWithExistingTasks(['parent', 'sub'], [], [], []);
      testState[TASK_FEATURE_NAME].entities.parent = createMockTask({
        id: 'parent',
        deadlineDay: todayStr,
      });
      testState[TASK_FEATURE_NAME].entities.sub = createMockTask({
        id: 'sub',
        parentId: 'parent',
        deadlineDay: todayStr,
      });

      const action = createAction(['sub', 'parent']);

      metaReducer(testState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];
      const parent = updatedState[TASK_FEATURE_NAME].entities.parent as Task;
      const sub = updatedState[TASK_FEATURE_NAME].entities.sub as Task;
      const todayTag = updatedState.tag.entities['TODAY'];

      expect(parent.dueDay).toBe(todayStr);
      expect(sub.dueDay).toBeUndefined();
      expect(todayTag.taskIds).toContain('parent');
      expect(todayTag.taskIds).not.toContain('sub');
    });
  });

  describe('removeDeadline action', () => {
    it('should clear all deadline fields', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const timestamp = new Date(2024, 5, 20, 14, 30).getTime();
      testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
        id: 'task1',
        deadlineDay: '2024-06-20',
        deadlineWithTime: timestamp,
        deadlineRemindAt: timestamp,
      });

      const action = TaskSharedActions.removeDeadline({ taskId: 'task1' });

      metaReducer(testState, action);
      expectStateUpdate(
        expectTaskUpdate('task1', {
          deadlineDay: undefined,
          deadlineWithTime: undefined,
          deadlineRemindAt: undefined,
        }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should clear fields even when only deadlineDay is set', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
        id: 'task1',
        deadlineDay: '2024-06-20',
      });

      const action = TaskSharedActions.removeDeadline({ taskId: 'task1' });

      metaReducer(testState, action);
      expectStateUpdate(
        expectTaskUpdate('task1', {
          deadlineDay: undefined,
          deadlineWithTime: undefined,
          deadlineRemindAt: undefined,
        }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should return state unchanged when task does not exist', () => {
      const action = TaskSharedActions.removeDeadline({ taskId: 'non-existent-task' });

      metaReducer(baseState, action);
      expect(mockReducer).toHaveBeenCalledWith(baseState, action);
    });
  });

  describe('clearDeadlineReminder action', () => {
    it('should clear only deadlineRemindAt and preserve deadlineDay', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const remindTimestamp = new Date(2024, 5, 20, 9, 0).getTime();
      testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
        id: 'task1',
        deadlineDay: '2024-06-20',
        deadlineRemindAt: remindTimestamp,
      });

      const action = TaskSharedActions.clearDeadlineReminder({ taskId: 'task1' });

      metaReducer(testState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];
      const updatedTask = updatedState[TASK_FEATURE_NAME].entities.task1 as Task;

      expect(updatedTask.deadlineRemindAt).toBeUndefined();
      expect(updatedTask.deadlineDay).toBe('2024-06-20');
    });

    it('should clear only deadlineRemindAt and preserve deadlineWithTime', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const deadlineTimestamp = new Date(2024, 5, 20, 14, 30).getTime();
      const remindTimestamp = new Date(2024, 5, 20, 14, 0).getTime();
      testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
        id: 'task1',
        deadlineWithTime: deadlineTimestamp,
        deadlineRemindAt: remindTimestamp,
      });

      const action = TaskSharedActions.clearDeadlineReminder({ taskId: 'task1' });

      metaReducer(testState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];
      const updatedTask = updatedState[TASK_FEATURE_NAME].entities.task1 as Task;

      expect(updatedTask.deadlineRemindAt).toBeUndefined();
      expect(updatedTask.deadlineWithTime).toBe(deadlineTimestamp);
    });

    it('should return state unchanged when task does not exist', () => {
      const action = TaskSharedActions.clearDeadlineReminder({
        taskId: 'non-existent-task',
      });

      metaReducer(baseState, action);
      expect(mockReducer).toHaveBeenCalledWith(baseState, action);
    });
  });

  describe('other actions', () => {
    it('should pass through unrelated actions to the inner reducer', () => {
      const action = { type: 'SOME_OTHER_ACTION' };
      metaReducer(baseState, action);

      expect(mockReducer).toHaveBeenCalledWith(baseState, action);
    });
  });
});
