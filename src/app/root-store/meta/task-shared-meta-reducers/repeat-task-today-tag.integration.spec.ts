/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * Integration test for recurring task + TODAY_TAG behavior across day boundaries.
 *
 * Tests the exact sequence of meta-reducer actions that occur when:
 * 1. A daily recurring task with startTime is created
 * 2. The day changes
 * 3. Synced operations from another device are applied
 *
 * Uses the full combined meta-reducer chain to catch interactions between
 * the CRUD, scheduling, and tag meta-reducers.
 *
 * Related: https://github.com/johannesjo/super-productivity/issues/6269
 */
import { Action, ActionReducer } from '@ngrx/store';
import { createCombinedTaskSharedMetaReducer, updateTaskEntity } from './test-helpers';
import {
  createBaseState,
  createMockTask,
  createStateWithExistingTasks,
} from './test-utils';
import { TaskSharedActions } from '../task-shared.actions';
import { RootState } from '../../root-state';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
import { TAG_FEATURE_NAME } from '../../../features/tag/store/tag.reducer';
import { Task } from '../../../features/tasks/task.model';
import { Tag } from '../../../features/tag/tag.model';
import { WorkContextType } from '../../../features/work-context/work-context.model';
import { getRepeatableTaskId } from '../../../features/task-repeat-cfg/get-repeatable-task-id.util';
import { appStateFeatureKey } from '../../../root-store/app-state/app-state.reducer';
import { getDbDateStr } from '../../../util/get-db-date-str';

describe('Recurring task TODAY_TAG integration (#6269)', () => {
  let combinedReducer: ActionReducer<any, Action>;
  let baseState: RootState;

  // Day 1: June 15, 2024 at noon
  const DAY1 = new Date(2024, 5, 15, 12, 0, 0, 0);
  // Day 2: June 16, 2024 at noon
  const DAY2 = new Date(2024, 5, 16, 12, 0, 0, 0);
  // Day 3: June 17, 2024 at noon
  const DAY3 = new Date(2024, 5, 17, 12, 0, 0, 0);

  const REPEAT_CFG_ID = 'daily-standup-cfg';

  const day1Str = '2024-06-15';
  const day2Str = '2024-06-16';
  const day3Str = '2024-06-17';

  // 9:00 AM on each day (for dueWithTime)
  const day1_9am = new Date(2024, 5, 15, 9, 0, 0, 0).getTime();
  const day2_9am = new Date(2024, 5, 16, 9, 0, 0, 0).getTime();
  const day3_9am = new Date(2024, 5, 17, 9, 0, 0, 0).getTime();

  const day1TaskId = getRepeatableTaskId(REPEAT_CFG_ID, day1Str);
  const day2TaskId = getRepeatableTaskId(REPEAT_CFG_ID, day2Str);
  const day3TaskId = getRepeatableTaskId(REPEAT_CFG_ID, day3Str);

  const passthrough = (state: any, _action: Action) => state;

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(DAY1);
    combinedReducer = createCombinedTaskSharedMetaReducer(passthrough);
    baseState = createBaseState();
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  // Helper to advance the day and update appState.todayStr in the state
  const advanceToDay = (state: RootState, date: Date): RootState => {
    jasmine.clock().mockDate(date);
    return {
      ...state,
      [appStateFeatureKey]: {
        ...(state[appStateFeatureKey as keyof RootState] as any),
        todayStr: getDbDateStr(),
      },
    } as RootState;
  };

  // Helpers
  const getTodayTagTaskIds = (state: RootState): string[] => {
    return (state[TAG_FEATURE_NAME].entities['TODAY'] as Tag)?.taskIds || [];
  };

  const getTask = (state: RootState, taskId: string): Task | undefined => {
    return state[TASK_FEATURE_NAME].entities[taskId] as Task | undefined;
  };

  const createAddTaskAction = (taskId: string, dueDay: string) =>
    TaskSharedActions.addTask({
      task: createMockTask({
        id: taskId,
        title: 'Daily Standup',
        dueDay,
        repeatCfgId: REPEAT_CFG_ID,
      }),
      workContextType: WorkContextType.PROJECT,
      workContextId: 'project1',
      isAddToBacklog: false,
      isAddToBottom: false,
    });

  const createScheduleAction = (taskId: string, dueWithTime: number) =>
    TaskSharedActions.scheduleTaskWithTime({
      task: createMockTask({ id: taskId }),
      dueWithTime,
      remindAt: dueWithTime,
      isMoveToBacklog: false,
      isSkipAutoRemoveFromToday: true,
    });

  describe('Day 1: Create recurring task with startTime', () => {
    it('should add task to TODAY_TAG after addTask with dueDay=today', () => {
      const action = createAddTaskAction(day1TaskId, day1Str);
      const state = combinedReducer(baseState, action);

      expect(getTodayTagTaskIds(state)).toContain(day1TaskId);
      const task = getTask(state, day1TaskId);
      expect(task?.dueDay).toBe(day1Str);
    });

    it('should keep task in TODAY_TAG after scheduleTaskWithTime clears dueDay', () => {
      // Step 1: addTask sets dueDay = today → adds to TODAY_TAG
      let state = combinedReducer(baseState, createAddTaskAction(day1TaskId, day1Str));
      expect(getTodayTagTaskIds(state)).toContain(day1TaskId);

      // Step 2: scheduleTaskWithTime sets dueWithTime, clears dueDay
      state = combinedReducer(state, createScheduleAction(day1TaskId, day1_9am));

      // Task should STILL be in TODAY_TAG (dueWithTime is today)
      expect(getTodayTagTaskIds(state)).toContain(day1TaskId);

      // Verify mutual exclusivity: dueDay cleared, dueWithTime set
      const task = getTask(state, day1TaskId);
      expect(task?.dueDay).toBeUndefined();
      expect(task?.dueWithTime).toBe(day1_9am);
    });
  });

  describe('Day 2: Day change with overdue Day 1 task', () => {
    let stateAfterDay1: RootState;

    beforeEach(() => {
      // Set up: Day 1 task exists with dueWithTime, dueDay=undefined
      stateAfterDay1 = combinedReducer(
        baseState,
        createAddTaskAction(day1TaskId, day1Str),
      );
      stateAfterDay1 = combinedReducer(
        stateAfterDay1,
        createScheduleAction(day1TaskId, day1_9am),
      );

      // Now advance to Day 2 (update both clock and appState.todayStr)
      stateAfterDay1 = advanceToDay(stateAfterDay1, DAY2);
    });

    it('should remove Day 1 task from TODAY_TAG via removeTasksFromTodayTag', () => {
      // The removeOverdueFromToday$ effect dispatches this when it detects
      // dueWithTime < todayStart
      const removeAction = TaskSharedActions.removeTasksFromTodayTag({
        taskIds: [day1TaskId],
      });
      const state = combinedReducer(stateAfterDay1, removeAction);

      expect(getTodayTagTaskIds(state)).not.toContain(day1TaskId);
    });

    it('should add Day 2 task to TODAY_TAG via addTask + scheduleTaskWithTime', () => {
      // Remove Day 1's overdue task
      let state = combinedReducer(
        stateAfterDay1,
        TaskSharedActions.removeTasksFromTodayTag({ taskIds: [day1TaskId] }),
      );

      // Create Day 2's task
      state = combinedReducer(state, createAddTaskAction(day2TaskId, day2Str));
      expect(getTodayTagTaskIds(state)).toContain(day2TaskId);

      // Schedule Day 2's task
      state = combinedReducer(state, createScheduleAction(day2TaskId, day2_9am));
      expect(getTodayTagTaskIds(state)).toContain(day2TaskId);

      // Verify Day 2 task has correct state
      const task = getTask(state, day2TaskId);
      expect(task?.dueDay).toBeUndefined();
      expect(task?.dueWithTime).toBe(day2_9am);
    });
  });

  describe('Day 2: Sync replay of Day 1 operations from another device', () => {
    it('should NOT add Day 1 task to Day 2 TODAY_TAG when synced operations replay', () => {
      // Start on Day 2 with empty state
      let state = advanceToDay(baseState, DAY2);

      // Device A's operations arrive via sync: addTask with dueDay = Day 1
      state = combinedReducer(state, createAddTaskAction(day1TaskId, day1Str));

      // Day 1's dueDay !== Day 2's today → should NOT be in TODAY_TAG
      expect(getTodayTagTaskIds(state)).not.toContain(day1TaskId);

      // scheduleTaskWithTime with dueWithTime = Day 1 9am
      state = combinedReducer(state, createScheduleAction(day1TaskId, day1_9am));

      // isToday(day1_9am) on Day 2 → false → should NOT be in TODAY_TAG
      expect(getTodayTagTaskIds(state)).not.toContain(day1TaskId);
    });

    it('should keep Day 2 task in TODAY_TAG even after Day 1 sync operations', () => {
      let state = advanceToDay(baseState, DAY2);

      // First: Day 2's task was already created locally
      state = combinedReducer(state, createAddTaskAction(day2TaskId, day2Str));
      state = combinedReducer(state, createScheduleAction(day2TaskId, day2_9am));
      expect(getTodayTagTaskIds(state)).toContain(day2TaskId);

      // Then: Day 1's operations arrive via sync
      state = combinedReducer(state, createAddTaskAction(day1TaskId, day1Str));
      state = combinedReducer(state, createScheduleAction(day1TaskId, day1_9am));

      // Day 2's task should STILL be in TODAY_TAG
      expect(getTodayTagTaskIds(state)).toContain(day2TaskId);
      // Day 1's task should NOT be in TODAY_TAG
      expect(getTodayTagTaskIds(state)).not.toContain(day1TaskId);
    });
  });

  describe('Day 3: Consecutive day changes', () => {
    it('should correctly manage TODAY_TAG across 3 consecutive days', () => {
      // === Day 1 ===
      jasmine.clock().mockDate(DAY1);
      let state = baseState;
      state = combinedReducer(state, createAddTaskAction(day1TaskId, day1Str));
      state = combinedReducer(state, createScheduleAction(day1TaskId, day1_9am));

      expect(getTodayTagTaskIds(state)).toContain(day1TaskId);

      // === Day 2 ===
      state = advanceToDay(state, DAY2);

      // Remove Day 1's overdue task
      state = combinedReducer(
        state,
        TaskSharedActions.removeTasksFromTodayTag({ taskIds: [day1TaskId] }),
      );
      expect(getTodayTagTaskIds(state)).not.toContain(day1TaskId);

      // Create Day 2's task
      state = combinedReducer(state, createAddTaskAction(day2TaskId, day2Str));
      state = combinedReducer(state, createScheduleAction(day2TaskId, day2_9am));
      expect(getTodayTagTaskIds(state)).toContain(day2TaskId);

      // === Day 3 ===
      state = advanceToDay(state, DAY3);

      // Remove Day 2's overdue task
      state = combinedReducer(
        state,
        TaskSharedActions.removeTasksFromTodayTag({ taskIds: [day2TaskId] }),
      );
      expect(getTodayTagTaskIds(state)).not.toContain(day2TaskId);

      // Create Day 3's task
      state = combinedReducer(state, createAddTaskAction(day3TaskId, day3Str));
      state = combinedReducer(state, createScheduleAction(day3TaskId, day3_9am));
      expect(getTodayTagTaskIds(state)).toContain(day3TaskId);

      // Verify final state: only Day 3 in TODAY
      const todayIds = getTodayTagTaskIds(state);
      expect(todayIds).toContain(day3TaskId);
      expect(todayIds).not.toContain(day1TaskId);
      expect(todayIds).not.toContain(day2TaskId);
    });
  });

  describe('planTasksForToday recovery for tasks with dueWithTime', () => {
    it('should add task with dueWithTime=today to TODAY_TAG via planTasksForToday', () => {
      // Scenario: Task exists with dueWithTime=today but somehow isn't in TODAY_TAG
      // (e.g., after sync replay or race condition)
      jasmine.clock().mockDate(DAY1);
      let state = baseState;

      // Add task via addTask (sets dueDay=today, in TODAY_TAG)
      state = combinedReducer(state, createAddTaskAction(day1TaskId, day1Str));
      // Schedule it (clears dueDay, sets dueWithTime)
      state = combinedReducer(state, createScheduleAction(day1TaskId, day1_9am));
      expect(getTodayTagTaskIds(state)).toContain(day1TaskId);

      // Simulate: task falls out of TODAY_TAG (e.g., due to a bug or sync race)
      state = combinedReducer(
        state,
        TaskSharedActions.removeTasksFromTodayTag({ taskIds: [day1TaskId] }),
      );
      expect(getTodayTagTaskIds(state)).not.toContain(day1TaskId);

      // Verify the task still has dueWithTime set (dueDay is undefined)
      const task = getTask(state, day1TaskId);
      expect(task?.dueWithTime).toBe(day1_9am);
      expect(task?.dueDay).toBeUndefined();

      // Recovery: planTasksForToday should re-add the task
      // This is what ensureTasksDueTodayInTodayTag$ dispatches
      state = combinedReducer(
        state,
        TaskSharedActions.planTasksForToday({
          taskIds: [day1TaskId],
          isSkipRemoveReminder: true,
        }),
      );

      // Task should be back in TODAY_TAG
      expect(getTodayTagTaskIds(state)).toContain(day1TaskId);
      // planTasksForToday sets dueDay=today and preserves dueWithTime if for today
      const recoveredTask = getTask(state, day1TaskId);
      expect(recoveredTask?.dueDay).toBe(day1Str);
    });

    it('should handle task that only has dueWithTime (no dueDay) during recovery', () => {
      // This tests the exact gap that the ensureTasksDueTodayInTodayTag$ fix addresses:
      // A task with dueWithTime=today but dueDay=undefined should be recoverable
      jasmine.clock().mockDate(DAY1);

      // Set up: task exists with dueWithTime only
      let state = createStateWithExistingTasks(['task1'], [], [], []);
      state = updateTaskEntity(state, 'task1', {
        dueWithTime: day1_9am,
        dueDay: undefined,
        remindAt: day1_9am,
      });

      // Task is NOT in TODAY_TAG (simulating the bug)
      expect(getTodayTagTaskIds(state)).not.toContain('task1');

      // Apply planTasksForToday (what ensureTasksDueTodayInTodayTag$ dispatches)
      state = combinedReducer(
        state,
        TaskSharedActions.planTasksForToday({
          taskIds: ['task1'],
          isSkipRemoveReminder: true,
        }),
      );

      // Task should now be in TODAY_TAG
      expect(getTodayTagTaskIds(state)).toContain('task1');
      // And dueDay should be set to today
      const task = getTask(state, 'task1');
      expect(task?.dueDay).toBe(day1Str);
    });
  });

  describe('Selector gap: selectTasksDueForDay misses dueWithTime-only tasks', () => {
    // This documents the root cause of #6269:
    // After scheduleTaskWithTime clears dueDay, the task becomes invisible
    // to selectTasksDueForDay. The ensureTasksDueTodayInTodayTag$ effect
    // (before fix) only used selectTasksDueForDay, so it could never
    // recover tasks that had dueWithTime set but dueDay=undefined.

    it('should demonstrate that scheduled task has dueDay=undefined after scheduling', () => {
      jasmine.clock().mockDate(DAY1);
      let state = baseState;

      // Create and schedule a task (simulates recurring task creation)
      state = combinedReducer(state, createAddTaskAction(day1TaskId, day1Str));
      state = combinedReducer(state, createScheduleAction(day1TaskId, day1_9am));

      const task = getTask(state, day1TaskId);
      // After scheduleTaskWithTime: dueDay is cleared (mutual exclusivity)
      expect(task?.dueDay).toBeUndefined();
      expect(task?.dueWithTime).toBe(day1_9am);
    });

    it('should show selectTasksDueForDay does NOT find dueWithTime-only tasks', () => {
      jasmine.clock().mockDate(DAY1);
      let state = baseState;

      state = combinedReducer(state, createAddTaskAction(day1TaskId, day1Str));
      state = combinedReducer(state, createScheduleAction(day1TaskId, day1_9am));

      // Simulate what selectTasksDueForDay does
      const taskEntities = state[TASK_FEATURE_NAME].entities;
      const allTasks = Object.values(taskEntities).filter(Boolean) as Task[];
      const tasksDueByDay = allTasks.filter((t) => t.dueDay === day1Str);

      // dueDay was cleared by scheduleTaskWithTime → NOT found
      expect(tasksDueByDay.length).toBe(0);
      expect(tasksDueByDay.find((t) => t.id === day1TaskId)).toBeUndefined();
    });

    it('should show selectTasksWithDueTimeForRange DOES find dueWithTime-only tasks', () => {
      jasmine.clock().mockDate(DAY1);
      let state = baseState;

      state = combinedReducer(state, createAddTaskAction(day1TaskId, day1Str));
      state = combinedReducer(state, createScheduleAction(day1TaskId, day1_9am));

      // Simulate what selectTasksWithDueTimeForRange does
      const dayStart = new Date(DAY1);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(DAY1);
      dayEnd.setHours(23, 59, 59, 0);

      const taskEntities = state[TASK_FEATURE_NAME].entities;
      const allTasks = Object.values(taskEntities).filter(Boolean) as Task[];
      const tasksDueByTime = allTasks.filter(
        (t) =>
          typeof t.dueWithTime === 'number' &&
          t.dueWithTime >= dayStart.getTime() &&
          t.dueWithTime <= dayEnd.getTime(),
      );

      // dueWithTime IS set → found by time range selector
      expect(tasksDueByTime.length).toBe(1);
      expect(tasksDueByTime[0].id).toBe(day1TaskId);
    });
  });

  describe('Multi-device sync: operations arrive out of order', () => {
    it('should handle addTask arriving before scheduleTaskWithTime from sync', () => {
      jasmine.clock().mockDate(DAY1);
      let state = baseState;

      // Sync: addTask arrives first (dueDay = today)
      state = combinedReducer(state, createAddTaskAction(day1TaskId, day1Str));
      expect(getTodayTagTaskIds(state)).toContain(day1TaskId);

      // dueDay is set
      expect(getTask(state, day1TaskId)?.dueDay).toBe(day1Str);

      // Sync: scheduleTaskWithTime arrives later
      state = combinedReducer(state, createScheduleAction(day1TaskId, day1_9am));
      expect(getTodayTagTaskIds(state)).toContain(day1TaskId);

      // dueDay cleared (mutual exclusivity), dueWithTime set
      const task = getTask(state, day1TaskId);
      expect(task?.dueDay).toBeUndefined();
      expect(task?.dueWithTime).toBe(day1_9am);
    });

    it('should handle scheduleTaskWithTime for yesterday arriving on today', () => {
      // This is the critical sync scenario: Device A created a task yesterday
      // with dueWithTime = yesterday 9am. Today, Device B receives this operation.
      let state = advanceToDay(baseState, DAY2);

      // Device A's addTask from yesterday arrives (dueDay = yesterday)
      state = combinedReducer(state, createAddTaskAction(day1TaskId, day1Str));
      // dueDay = yesterday !== today → NOT in TODAY_TAG
      expect(getTodayTagTaskIds(state)).not.toContain(day1TaskId);

      // Device A's scheduleTaskWithTime from yesterday arrives
      state = combinedReducer(state, createScheduleAction(day1TaskId, day1_9am));
      // isToday(day1_9am) on Day 2 → false → should NOT add to TODAY_TAG
      expect(getTodayTagTaskIds(state)).not.toContain(day1TaskId);

      // Verify task state
      const task = getTask(state, day1TaskId);
      expect(task?.dueWithTime).toBe(day1_9am);
      expect(task?.dueDay).toBeUndefined();
    });
  });
});
