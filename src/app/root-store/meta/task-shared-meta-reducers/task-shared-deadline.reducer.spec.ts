import { taskSharedDeadlineMetaReducer } from './task-shared-deadline.reducer';
import { TaskSharedActions } from '../task-shared.actions';
import { RootState } from '../../root-state';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
import { Task } from '../../../features/tasks/task.model';
import { Action, ActionReducer } from '@ngrx/store';
import { WorkContextType } from '../../../features/work-context/work-context.model';
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
      it('should add to Today and set dueDay if not scheduled', () => {
        const testState = createStateWithExistingTasks(['task1'], [], [], []);
        const todayStr = '2024-05-18';

        const action = TaskSharedActions.setDeadline({
          taskId: 'task1',
          deadlineDay: todayStr,
          autoPlanToday: todayStr,
          autoPlanStartOfNextDayDiffMs: 0,
        });

        metaReducer(testState, action);
        const updatedState = mockReducer.calls.mostRecent().args[0];
        const updatedTask = updatedState[TASK_FEATURE_NAME].entities.task1 as Task;
        const todayTag = updatedState.tag.entities['TODAY'];

        expect(updatedTask.dueDay).toBe(todayStr);
        expect(todayTag.taskIds).toContain('task1');
      });

      it('should add to Today and set dueDay for timed deadlines today', () => {
        const testState = createStateWithExistingTasks(['task1'], [], [], []);
        const todayStr = '2024-05-18';
        const deadlineTimestamp = new Date('2024-05-18T12:00:00').getTime();

        const action = TaskSharedActions.setDeadline({
          taskId: 'task1',
          deadlineWithTime: deadlineTimestamp,
          autoPlanToday: todayStr,
          autoPlanStartOfNextDayDiffMs: 0,
        });

        metaReducer(testState, action);
        const updatedState = mockReducer.calls.mostRecent().args[0];
        const updatedTask = updatedState[TASK_FEATURE_NAME].entities.task1 as Task;
        const todayTag = updatedState.tag.entities['TODAY'];

        expect(updatedTask.deadlineWithTime).toBe(deadlineTimestamp);
        expect(updatedTask.dueDay).toBe(todayStr);
        expect(todayTag.taskIds).toContain('task1');
      });

      it('should add to Today and keep schedule if already scheduled for today', () => {
        const testState = createStateWithExistingTasks(['task1'], [], [], []);
        const todayStr = '2024-05-18';
        testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
          id: 'task1',
          dueDay: todayStr,
        });

        const action = TaskSharedActions.setDeadline({
          taskId: 'task1',
          deadlineDay: todayStr,
          autoPlanToday: todayStr,
          autoPlanStartOfNextDayDiffMs: 0,
        });

        metaReducer(testState, action);
        const updatedState = mockReducer.calls.mostRecent().args[0];
        const updatedTask = updatedState[TASK_FEATURE_NAME].entities.task1 as Task;
        const todayTag = updatedState.tag.entities['TODAY'];

        expect(updatedTask.dueDay).toBe(todayStr);
        expect(todayTag.taskIds).toContain('task1');
      });

      it('should add to Today and preserve dueWithTime/remindAt if already timed for today', () => {
        const testState = createStateWithExistingTasks(['task1'], [], [], []);
        const todayStr = '2024-05-18';
        const dueWithTime = new Date('2024-05-18T09:00:00').getTime();
        const remindAt = new Date('2024-05-18T08:45:00').getTime();
        testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
          id: 'task1',
          dueWithTime,
          remindAt,
        });

        const action = TaskSharedActions.setDeadline({
          taskId: 'task1',
          deadlineDay: todayStr,
          autoPlanToday: todayStr,
          autoPlanStartOfNextDayDiffMs: 0,
        });

        metaReducer(testState, action);
        const updatedState = mockReducer.calls.mostRecent().args[0];
        const updatedTask = updatedState[TASK_FEATURE_NAME].entities.task1 as Task;
        const todayTag = updatedState.tag.entities['TODAY'];

        expect(updatedTask.dueDay).toBeUndefined();
        expect(updatedTask.dueWithTime).toBe(dueWithTime);
        expect(updatedTask.remindAt).toBe(remindAt);
        expect(todayTag.taskIds).toContain('task1');
      });

      it('should clear dueWithTime, set dueDay, and add to Today if overdue', () => {
        const testState = createStateWithExistingTasks(['task1'], [], [], []);
        const todayStr = '2024-05-18';
        const pastTimestamp = new Date('2024-01-01T10:00:00Z').getTime();
        testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
          id: 'task1',
          dueWithTime: pastTimestamp,
          remindAt: pastTimestamp, // should preserve remindAt
        });

        const action = TaskSharedActions.setDeadline({
          taskId: 'task1',
          deadlineDay: todayStr,
          autoPlanToday: todayStr,
          autoPlanStartOfNextDayDiffMs: 0,
        });

        metaReducer(testState, action);
        const updatedState = mockReducer.calls.mostRecent().args[0];
        const updatedTask = updatedState[TASK_FEATURE_NAME].entities.task1 as Task;
        const todayTag = updatedState.tag.entities['TODAY'];

        expect(updatedTask.dueDay).toBe(todayStr);
        expect(updatedTask.dueWithTime).toBeUndefined();
        expect(updatedTask.remindAt).toBe(pastTimestamp);
        expect(todayTag.taskIds).toContain('task1');
      });

      it('should SKIP auto-planning if task is scheduled for a FUTURE day/time', () => {
        const testState = createStateWithExistingTasks(['task1'], [], [], []);
        const todayStr = '2024-05-18';

        // Future schedule
        const futureStr = '2025-01-01';
        testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
          id: 'task1',
          dueDay: futureStr,
        });

        const action = TaskSharedActions.setDeadline({
          taskId: 'task1',
          deadlineDay: todayStr,
          autoPlanToday: todayStr,
          autoPlanStartOfNextDayDiffMs: 0,
        });

        metaReducer(testState, action);
        const updatedState = mockReducer.calls.mostRecent().args[0];
        const updatedTask = updatedState[TASK_FEATURE_NAME].entities.task1 as Task;
        const todayTag = updatedState.tag.entities['TODAY'];

        // Should not have auto-planned (dueDay stays future, not in TODAY)
        expect(updatedTask.dueDay).toBe(futureStr);
        expect(todayTag?.taskIds || []).not.toContain('task1');
      });

      it('should prioritize future dueWithTime over stale overdue dueDay', () => {
        const testState = createStateWithExistingTasks(['task1'], [], [], []);
        const todayStr = '2024-05-18';
        const futureDueWithTime = new Date('2024-05-19T09:00:00').getTime();
        testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
          id: 'task1',
          dueDay: '2024-05-17',
          dueWithTime: futureDueWithTime,
        });

        const action = TaskSharedActions.setDeadline({
          taskId: 'task1',
          deadlineDay: todayStr,
          autoPlanToday: todayStr,
          autoPlanStartOfNextDayDiffMs: 0,
        });

        metaReducer(testState, action);
        const updatedState = mockReducer.calls.mostRecent().args[0];
        const updatedTask = updatedState[TASK_FEATURE_NAME].entities.task1 as Task;
        const todayTag = updatedState.tag.entities['TODAY'];

        expect(updatedTask.dueDay).toBe('2024-05-17');
        expect(updatedTask.dueWithTime).toBe(futureDueWithTime);
        expect(todayTag?.taskIds || []).not.toContain('task1');
      });

      it('should SKIP auto-planning if timed deadline is not today even with stale context', () => {
        const testState = createStateWithExistingTasks(['task1'], [], [], []);
        const todayStr = '2024-05-18';
        const futureDeadlineTimestamp = new Date('2024-05-19T12:00:00').getTime();

        const action = TaskSharedActions.setDeadline({
          taskId: 'task1',
          deadlineWithTime: futureDeadlineTimestamp,
          autoPlanToday: todayStr,
          autoPlanStartOfNextDayDiffMs: 0,
        });

        metaReducer(testState, action);
        const updatedState = mockReducer.calls.mostRecent().args[0];
        const updatedTask = updatedState[TASK_FEATURE_NAME].entities.task1 as Task;
        const todayTag = updatedState.tag.entities['TODAY'];

        expect(updatedTask.deadlineWithTime).toBe(futureDeadlineTimestamp);
        expect(updatedTask.dueDay).toBeUndefined();
        expect(todayTag?.taskIds || []).not.toContain('task1');
      });

      it('should SKIP auto-planning done tasks', () => {
        const testState = createStateWithExistingTasks(['task1'], [], [], []);
        const todayStr = '2024-05-18';
        testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
          id: 'task1',
          isDone: true,
        });

        const action = TaskSharedActions.setDeadline({
          taskId: 'task1',
          deadlineDay: todayStr,
          autoPlanToday: todayStr,
          autoPlanStartOfNextDayDiffMs: 0,
        });

        metaReducer(testState, action);
        const updatedState = mockReducer.calls.mostRecent().args[0];
        const updatedTask = updatedState[TASK_FEATURE_NAME].entities.task1 as Task;
        const todayTag = updatedState.tag.entities['TODAY'];

        expect(updatedTask.deadlineDay).toBe(todayStr);
        expect(updatedTask.dueDay).toBeUndefined();
        expect(todayTag?.taskIds || []).not.toContain('task1');
      });

      it('should SKIP subtasks whose parent is virtually in Today', () => {
        const testState = createStateWithExistingTasks(['parent', 'sub1'], [], [], []);
        const todayStr = '2024-05-18';
        testState[TASK_FEATURE_NAME].entities.parent = createMockTask({
          id: 'parent',
          dueDay: todayStr,
        });
        testState[TASK_FEATURE_NAME].entities.sub1 = createMockTask({
          id: 'sub1',
          parentId: 'parent',
        });

        const action = TaskSharedActions.setDeadline({
          taskId: 'sub1',
          deadlineDay: todayStr,
          autoPlanToday: todayStr,
          autoPlanStartOfNextDayDiffMs: 0,
        });

        metaReducer(testState, action);
        const updatedState = mockReducer.calls.mostRecent().args[0];
        const updatedTask = updatedState[TASK_FEATURE_NAME].entities.sub1 as Task;
        const todayTag = updatedState.tag.entities['TODAY'];

        expect(updatedTask.deadlineDay).toBe(todayStr);
        expect(updatedTask.dueDay).toBeUndefined();
        expect(todayTag?.taskIds || []).not.toContain('sub1');
      });

      it('should use action auto-plan context instead of replaying client appState', () => {
        const testState = createStateWithExistingTasks(['task1'], [], [], []);
        const todayStr = '2024-05-18';
        testState.appState = { todayStr: '2024-05-19', startOfNextDayDiffMs: 0 } as any;

        const action = TaskSharedActions.setDeadline({
          taskId: 'task1',
          deadlineDay: todayStr,
          autoPlanToday: todayStr,
          autoPlanStartOfNextDayDiffMs: 0,
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
        const todayStr = '2024-05-18';
        testState.appState = { todayStr, startOfNextDayDiffMs: 0 } as any;

        const action = TaskSharedActions.setDeadline({
          taskId: 'task1',
          deadlineDay: todayStr,
        });

        metaReducer(testState, action);
        const updatedState = mockReducer.calls.mostRecent().args[0];
        const updatedTask = updatedState[TASK_FEATURE_NAME].entities.task1 as Task;
        const todayTag = updatedState.tag.entities['TODAY'];

        expect(updatedTask.dueDay).toBeUndefined();
        expect(todayTag?.taskIds || []).not.toContain('task1');
      });
    });
  });

  describe('addTask action', () => {
    it('should auto-plan added tasks with a deadline today when the action carries replay context', () => {
      const todayStr = '2024-05-18';
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const task = createMockTask({
        id: 'task1',
        deadlineDay: todayStr,
      });

      const action = TaskSharedActions.addTask({
        task,
        workContextId: 'project1',
        workContextType: WorkContextType.PROJECT,
        isAddToBacklog: false,
        isAddToBottom: false,
        autoPlanToday: todayStr,
        autoPlanStartOfNextDayDiffMs: 0,
      });

      metaReducer(testState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];
      const updatedTask = updatedState[TASK_FEATURE_NAME].entities.task1 as Task;
      const todayTag = updatedState.tag.entities['TODAY'];

      expect(updatedTask.dueDay).toBe(todayStr);
      expect(todayTag.taskIds).toContain('task1');
    });
  });

  describe('planDeadlineTasksForToday action', () => {
    it('should auto-plan deadline tasks for Today without clearing reminders', () => {
      const todayStr = '2024-05-18';
      const remindAt = new Date('2024-05-18T08:45:00').getTime();
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
        id: 'task1',
        deadlineDay: todayStr,
        remindAt,
      });

      const action = TaskSharedActions.planDeadlineTasksForToday({
        taskIds: ['task1'],
        today: todayStr,
        startOfNextDayDiffMs: 0,
      });

      metaReducer(testState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];
      const updatedTask = updatedState[TASK_FEATURE_NAME].entities.task1 as Task;
      const todayTag = updatedState.tag.entities['TODAY'];

      expect(updatedTask.dueDay).toBe(todayStr);
      expect(updatedTask.remindAt).toBe(remindAt);
      expect(todayTag.taskIds).toContain('task1');
    });

    it('should skip future-scheduled deadline tasks on day-boundary auto-plan', () => {
      const todayStr = '2024-05-18';
      const futureDay = '2024-05-20';
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
        id: 'task1',
        deadlineDay: todayStr,
        dueDay: futureDay,
      });

      const action = TaskSharedActions.planDeadlineTasksForToday({
        taskIds: ['task1'],
        today: todayStr,
        startOfNextDayDiffMs: 0,
      });

      metaReducer(testState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];
      const updatedTask = updatedState[TASK_FEATURE_NAME].entities.task1 as Task;
      const todayTag = updatedState.tag.entities['TODAY'];

      expect(updatedTask.dueDay).toBe(futureDay);
      expect(todayTag?.taskIds || []).not.toContain('task1');
    });

    it('should plan parent deadline tasks before evaluating their subtasks', () => {
      const todayStr = '2024-05-18';
      const testState = createStateWithExistingTasks(['parent', 'sub1'], [], [], []);
      testState[TASK_FEATURE_NAME].entities.parent = createMockTask({
        id: 'parent',
        deadlineDay: todayStr,
      });
      testState[TASK_FEATURE_NAME].entities.sub1 = createMockTask({
        id: 'sub1',
        parentId: 'parent',
        deadlineDay: todayStr,
      });

      const action = TaskSharedActions.planDeadlineTasksForToday({
        taskIds: ['sub1', 'parent'],
        today: todayStr,
        startOfNextDayDiffMs: 0,
      });

      metaReducer(testState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];
      const parentTask = updatedState[TASK_FEATURE_NAME].entities.parent as Task;
      const subTask = updatedState[TASK_FEATURE_NAME].entities.sub1 as Task;
      const todayTag = updatedState.tag.entities['TODAY'];

      expect(parentTask.dueDay).toBe(todayStr);
      expect(subTask.dueDay).toBeUndefined();
      expect(todayTag.taskIds).toContain('parent');
      expect(todayTag.taskIds).not.toContain('sub1');
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
