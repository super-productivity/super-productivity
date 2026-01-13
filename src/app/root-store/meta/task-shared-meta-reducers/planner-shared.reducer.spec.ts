/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { plannerSharedMetaReducer } from './planner-shared.reducer';
import { RootState } from '../../root-state';
import { Task } from '../../../features/tasks/task.model';
import { Action, ActionReducer } from '@ngrx/store';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { PlannerActions } from '../../../features/planner/store/planner.actions';
import {
  createBaseState,
  createMockTask,
  createStateWithExistingTasks,
  expectStateUpdate,
  expectTagUpdate,
  expectTaskUpdate,
} from './test-utils';

describe('plannerSharedMetaReducer', () => {
  let mockReducer: jasmine.Spy;
  let metaReducer: ActionReducer<any, Action>;
  let baseState: RootState;

  beforeEach(() => {
    mockReducer = jasmine.createSpy('reducer').and.callFake((state, action) => state);
    metaReducer = plannerSharedMetaReducer(mockReducer);
    baseState = createBaseState();
  });

  describe('PlannerActions.transferTask action', () => {
    const createTransferTaskAction = (
      task: Task,
      today: string,
      targetIndex: number,
      newDay: string,
      prevDay: string,
      targetTaskId?: string,
    ) =>
      PlannerActions.transferTask({
        task,
        today,
        targetIndex,
        newDay,
        prevDay,
        targetTaskId,
      });

    it('should remove task from Today tag when moving from today to different day', () => {
      const todayStr = getDbDateStr();
      const testState = createStateWithExistingTasks([], [], [], ['task1', 'other-task']);
      const task = createMockTask({ id: 'task1' });
      const action = createTransferTaskAction(task, todayStr, 0, 'tomorrow', todayStr);

      metaReducer(testState, action);
      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['other-task'] }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should remove task from planner.days[today] when moving from today to different day', () => {
      // This test ensures that tasks are removed from planner.days[today] when transferred away,
      // preventing AddTasksForTomorrowService from finding stale tasks and re-adding them to today.
      const todayStr = getDbDateStr();
      const testState = createStateWithExistingTasks([], [], [], ['task1', 'other-task']);
      // Set up planner.days[today] to contain the task
      testState.planner = {
        ...testState.planner,
        days: {
          ...testState.planner.days,
          [todayStr]: ['task1', 'task2'],
        },
      };
      const task = createMockTask({ id: 'task1' });
      const action = createTransferTaskAction(task, todayStr, 0, '2099-12-31', todayStr);

      metaReducer(testState, action);
      const resultState = mockReducer.calls.mostRecent().args[0];

      // task1 should be removed from planner.days[today]
      expect(resultState.planner.days[todayStr]).toEqual(['task2']);
      // task1 should be added to the new day
      expect(resultState.planner.days['2099-12-31']).toContain('task1');
    });

    it('should update task.dueDay when transferring from today to different day', () => {
      const todayStr = getDbDateStr();
      const newDay = '2026-01-15';
      const testState = createStateWithExistingTasks([], [], [], ['task1']);
      testState.planner = {
        ...testState.planner,
        days: { [todayStr]: ['task1'] },
      };
      // Set task's initial dueDay to today
      (testState as any).tasks.entities['task1'] = createMockTask({
        id: 'task1',
        dueDay: todayStr,
      });
      const task = createMockTask({ id: 'task1', dueDay: todayStr });
      const action = createTransferTaskAction(task, todayStr, 0, newDay, todayStr);

      metaReducer(testState, action);
      const resultState = mockReducer.calls.mostRecent().args[0];

      // task.dueDay should be updated to the new day
      expect(resultState.tasks.entities['task1'].dueDay).toBe(newDay);
    });

    it('should handle transfer from today when planner.days[today] does not exist', () => {
      const todayStr = getDbDateStr();
      const testState = createStateWithExistingTasks([], [], [], ['task1']);
      // Do NOT set up planner.days[today] - it doesn't exist
      const task = createMockTask({ id: 'task1' });
      const action = createTransferTaskAction(task, todayStr, 0, '2099-12-31', todayStr);

      // Should not throw
      expect(() => metaReducer(testState, action)).not.toThrow();

      const resultState = mockReducer.calls.mostRecent().args[0];
      // Task should be added to the new day
      expect(resultState.planner.days['2099-12-31']).toContain('task1');
    });

    it('should handle transfer from today when task is not in planner.days[today]', () => {
      const todayStr = getDbDateStr();
      const testState = createStateWithExistingTasks([], [], [], ['task1']);
      // Set up planner.days[today] but WITHOUT the task
      testState.planner = {
        ...testState.planner,
        days: { [todayStr]: ['other-task'] },
      };
      const task = createMockTask({ id: 'task1' });
      const action = createTransferTaskAction(task, todayStr, 0, '2099-12-31', todayStr);

      // Should not throw
      expect(() => metaReducer(testState, action)).not.toThrow();

      const resultState = mockReducer.calls.mostRecent().args[0];
      // other-task should remain in today
      expect(resultState.planner.days[todayStr]).toEqual(['other-task']);
      // Task should be added to the new day
      expect(resultState.planner.days['2099-12-31']).toContain('task1');
    });

    it('should add task to Today tag when moving from different day to today', () => {
      const todayStr = getDbDateStr();
      const testState = createStateWithExistingTasks([], [], [], ['existing-task']);
      const task = createMockTask({ id: 'task1' });
      const action = createTransferTaskAction(task, todayStr, 1, todayStr, 'yesterday');

      metaReducer(testState, action);
      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['existing-task', 'task1'] }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should insert task at specific position when targetTaskId is provided', () => {
      const todayStr = getDbDateStr();
      const testState = createStateWithExistingTasks(
        [],
        [],
        [],
        ['first-task', 'target-task', 'last-task'],
      );
      const task = createMockTask({ id: 'new-task' });
      const action = createTransferTaskAction(
        task,
        todayStr,
        0,
        todayStr,
        'yesterday',
        'target-task',
      );

      metaReducer(testState, action);
      expectStateUpdate(
        expectTagUpdate('TODAY', {
          taskIds: ['first-task', 'new-task', 'target-task', 'last-task'],
        }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should not change state when transferring within same day', () => {
      const todayStr = getDbDateStr();
      const task = createMockTask({ id: 'task1' });
      const action = createTransferTaskAction(task, todayStr, 0, todayStr, todayStr);

      metaReducer(baseState, action);
      expect(mockReducer).toHaveBeenCalledWith(baseState, action);
    });

    it('should handle unique task IDs when adding to Today', () => {
      const todayStr = getDbDateStr();
      const testState = createStateWithExistingTasks([], [], [], ['task1', 'other-task']);
      const task = createMockTask({ id: 'task1' });
      const action = createTransferTaskAction(task, todayStr, 0, todayStr, 'yesterday');

      metaReducer(testState, action);
      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['task1', 'other-task'] }),
        action,
        mockReducer,
        testState,
      );
    });
  });

  describe('PlannerActions.planTaskForDay action', () => {
    const createPlanTaskForDayAction = (
      task: Task,
      day: string,
      isAddToTop: boolean = false,
    ) =>
      PlannerActions.planTaskForDay({
        task,
        day,
        isAddToTop,
      });

    it('should add task to Today tag when planning for today', () => {
      const todayStr = getDbDateStr();
      const testState = createStateWithExistingTasks([], [], [], ['existing-task']);
      const task = createMockTask({ id: 'task1' });
      const action = createPlanTaskForDayAction(task, todayStr, false);

      metaReducer(testState, action);
      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['existing-task', 'task1'] }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should add task to top of Today tag when isAddToTop is true', () => {
      const todayStr = getDbDateStr();
      const testState = createStateWithExistingTasks([], [], [], ['existing-task']);
      const task = createMockTask({ id: 'task1' });
      const action = createPlanTaskForDayAction(task, todayStr, true);

      metaReducer(testState, action);
      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['task1', 'existing-task'] }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should remove task from Today tag when planning for different day', () => {
      const testState = createStateWithExistingTasks([], [], [], ['task1', 'other-task']);
      const task = createMockTask({ id: 'task1' });
      const action = createPlanTaskForDayAction(task, 'tomorrow', false);

      metaReducer(testState, action);
      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['other-task'] }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should not change state when task is already in Today and planned for today', () => {
      const todayStr = getDbDateStr();
      const testState = createStateWithExistingTasks([], [], [], ['task1', 'other-task']);
      // Also set task.tagIds to include TODAY
      (testState as any).tasks.entities['task1'].tagIds = ['TODAY'];
      const task = createMockTask({ id: 'task1', tagIds: ['TODAY'] });
      const action = createPlanTaskForDayAction(task, todayStr, false);

      metaReducer(testState, action);
      // Should still be called but with state that has task reordered to end
      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['other-task', 'task1'] }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should not change state when task is not in Today and not planned for today', () => {
      const testState = createStateWithExistingTasks([], [], [], ['other-task']);
      const task = createMockTask({ id: 'task1' });
      const action = createPlanTaskForDayAction(task, 'tomorrow', false);

      metaReducer(testState, action);
      expect(mockReducer).toHaveBeenCalledWith(testState, action);
    });

    // Virtual tag pattern tests: TODAY_TAG membership is determined by task.dueDay,
    // NOT by task.tagIds. TODAY_TAG should NEVER be in task.tagIds.
    // See: docs/ai/today-tag-architecture.md
    describe('virtual tag pattern: task.tagIds cleanup (TODAY should NEVER be in tagIds)', () => {
      it('should NOT add TODAY to task.tagIds when planning for today (virtual tag pattern)', () => {
        const todayStr = getDbDateStr();
        const testState = createStateWithExistingTasks([], [], [], []);
        // Add a task without TODAY in tagIds
        (testState as any).tasks.ids = ['task1'];
        (testState as any).tasks.entities['task1'] = createMockTask({
          id: 'task1',
          tagIds: ['other-tag'],
        });

        const task = createMockTask({ id: 'task1', tagIds: ['other-tag'] });
        const action = createPlanTaskForDayAction(task, todayStr, false);

        const result = metaReducer(testState, action);
        // Task.tagIds should NOT contain TODAY (virtual tag pattern)
        expect(result.tasks.entities['task1'].tagIds).not.toContain('TODAY');
        expect(result.tasks.entities['task1'].tagIds).toEqual(['other-tag']);
      });

      it('should remove TODAY from task.tagIds when present (cleanup legacy data)', () => {
        const testState = createStateWithExistingTasks([], [], [], ['task1']);
        // Set task.tagIds to include TODAY (legacy data that needs cleanup)
        (testState as any).tasks.entities['task1'].tagIds = ['other-tag', 'TODAY'];

        const task = createMockTask({ id: 'task1', tagIds: ['other-tag', 'TODAY'] });
        const action = createPlanTaskForDayAction(task, 'tomorrow', false);

        metaReducer(testState, action);
        expectStateUpdate(
          expectTaskUpdate('task1', { tagIds: ['other-tag'] }),
          action,
          mockReducer,
          testState,
        );
      });

      it('should clean up TODAY from task.tagIds if present (legacy data cleanup)', () => {
        const todayStr = getDbDateStr();
        const testState = createStateWithExistingTasks([], [], [], []);
        // Add a task with TODAY in tagIds (legacy data that needs cleanup)
        (testState as any).tasks.ids = ['task1'];
        (testState as any).tasks.entities['task1'] = createMockTask({
          id: 'task1',
          tagIds: ['TODAY'],
        });

        const task = createMockTask({ id: 'task1', tagIds: ['TODAY'] });
        const action = createPlanTaskForDayAction(task, todayStr, false);

        const result = metaReducer(testState, action);
        // TODAY should be removed from tagIds (virtual tag pattern)
        expect(result.tasks.entities['task1'].tagIds).not.toContain('TODAY');
      });
    });
  });

  describe('PlannerActions.moveBeforeTask action', () => {
    const createMoveBeforeTaskAction = (fromTask: Task, toTaskId: string) =>
      PlannerActions.moveBeforeTask({
        fromTask,
        toTaskId,
      });

    it('should move task before target task in Today tag', () => {
      const testState = createStateWithExistingTasks(
        [],
        [],
        [],
        ['task1', 'middle-task', 'target-task', 'last-task'],
      );
      const fromTask = createMockTask({ id: 'task1' });
      const action = createMoveBeforeTaskAction(fromTask, 'target-task');

      metaReducer(testState, action);
      expectStateUpdate(
        expectTagUpdate('TODAY', {
          taskIds: ['middle-task', 'task1', 'target-task', 'last-task'],
        }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should remove task from Today when moving to task not in Today', () => {
      const testState = createStateWithExistingTasks([], [], [], ['task1', 'other-task']);
      const fromTask = createMockTask({ id: 'task1' });
      const action = createMoveBeforeTaskAction(fromTask, 'non-today-task');

      metaReducer(testState, action);
      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['other-task'] }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should handle unique task IDs when moving task', () => {
      const testState = createStateWithExistingTasks(
        [],
        [],
        [],
        ['first-task', 'target-task', 'last-task'],
      );
      const fromTask = createMockTask({ id: 'move-task' });
      const action = createMoveBeforeTaskAction(fromTask, 'target-task');

      metaReducer(testState, action);
      expectStateUpdate(
        expectTagUpdate('TODAY', {
          taskIds: ['first-task', 'move-task', 'target-task', 'last-task'],
        }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should not change state when fromTask is not in Today and toTask is not in Today', () => {
      const testState = createStateWithExistingTasks([], [], [], ['other-task']);
      const fromTask = createMockTask({ id: 'not-in-today' });
      const action = createMoveBeforeTaskAction(fromTask, 'also-not-in-today');

      metaReducer(testState, action);
      expect(mockReducer).toHaveBeenCalledWith(testState, action);
    });

    it('should handle moving task before itself (edge case where fromTask.id === toTaskId)', () => {
      // This tests the bounds check fix: when fromTask.id === toTaskId,
      // filtering removes toTaskId from the list, causing indexOf to return -1
      const testState = createStateWithExistingTasks(
        [],
        [],
        [],
        ['first-task', 'same-task', 'last-task'],
      );
      const fromTask = createMockTask({ id: 'same-task' });
      const action = createMoveBeforeTaskAction(fromTask, 'same-task');

      metaReducer(testState, action);
      // Task should be appended to end as fallback when target is not found
      expectStateUpdate(
        expectTagUpdate('TODAY', {
          taskIds: ['first-task', 'last-task', 'same-task'],
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
