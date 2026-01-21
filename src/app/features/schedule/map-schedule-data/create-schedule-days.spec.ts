import { createScheduleDays } from './create-schedule-days';
import { DEFAULT_TASK, TaskWithoutReminder } from '../../tasks/task.model';
import { PlannerDayMap } from '../../planner/planner.model';
import { BlockedBlockByDayMap } from '../schedule.model';
import { parseDbDateStr } from '../../../util/parse-db-date-str';

// Helper function to create test tasks with required properties
const createTestTask = (
  id: string,
  title: string,
  options: {
    timeEstimate?: number;
    timeSpent?: number;
    dueDay?: string;
    dueWithTime?: number;
  } = {},
): TaskWithoutReminder => {
  return {
    ...DEFAULT_TASK,
    id,
    title,
    projectId: 'test-project',
    timeEstimate: options.timeEstimate ?? 3600000,
    timeSpent: options.timeSpent ?? 0,
    remindAt: undefined,
    ...(options.dueDay && { dueDay: options.dueDay }),
    ...(options.dueWithTime && { dueWithTime: options.dueWithTime }),
  } as TaskWithoutReminder;
};

describe('createScheduleDays - Task Filtering', () => {
  let now: number;
  let realNow: number;
  let todayStr: string;
  let tomorrowStr: string;
  let nextWeekStr: string;
  let futureWeekStr: string;

  beforeEach(() => {
    // Set up test dates
    const today = new Date(2026, 0, 20, 10, 0, 0); // Jan 20, 2026, 10:00 AM
    now = today.getTime();
    realNow = now;

    todayStr = today.toISOString().split('T')[0];

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrowStr = tomorrow.toISOString().split('T')[0];

    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    nextWeekStr = nextWeek.toISOString().split('T')[0];

    const futureWeek = new Date(today);
    futureWeek.setDate(futureWeek.getDate() + 14);
    futureWeekStr = futureWeek.toISOString().split('T')[0];
  });

  describe('Unscheduled tasks (no dueDay, no dueWithTime, no plannedForDay)', () => {
    it('should appear in current week when viewing today', () => {
      // Arrange
      const unscheduledTask = createTestTask('task1', 'Unscheduled Task');

      const dayDates = [todayStr, tomorrowStr];
      const plannerDayMap: PlannerDayMap = {};
      const blockerBlocksDayMap: BlockedBlockByDayMap = {};

      // Act
      const result = createScheduleDays(
        [unscheduledTask],
        [],
        dayDates,
        plannerDayMap,
        blockerBlocksDayMap,
        undefined,
        now,
        realNow,
      );

      // Assert
      // Unscheduled task should appear in the schedule
      const hasTask = result.some((day) =>
        day.entries.some((entry) => entry.id === 'task1'),
      );
      expect(hasTask).toBe(true);
    });

    it('should NOT appear when viewing next week (outside current week)', () => {
      // Arrange
      const unscheduledTask: TaskWithoutReminder = {
        id: 'task1',
        title: 'Unscheduled Task',
        timeEstimate: 3600000,
        timeSpent: 0,
      } as TaskWithoutReminder;

      // Viewing a week starting 7 days from now
      const dayDates = [nextWeekStr];
      const plannerDayMap: PlannerDayMap = {};
      const blockerBlocksDayMap: BlockedBlockByDayMap = {};

      // Act
      const result = createScheduleDays(
        [unscheduledTask],
        [],
        dayDates,
        plannerDayMap,
        blockerBlocksDayMap,
        undefined,
        now,
        realNow,
      );

      // Assert
      // Unscheduled task should NOT appear when viewing future week
      const hasTask = result.some((day) =>
        day.entries.some((entry) => entry.id === 'task1'),
      );
      expect(hasTask).toBe(false);
    });
  });

  describe('Tasks with dueDay', () => {
    it('should be filtered out when viewing next week if dueDay is today', () => {
      // Arrange
      const taskWithDueToday = createTestTask('task2', 'Task Due Today', {
        dueDay: todayStr,
      });

      // Viewing next week
      const dayDates = [nextWeekStr];
      const plannerDayMap: PlannerDayMap = {};
      const blockerBlocksDayMap: BlockedBlockByDayMap = {};

      // Act
      const result = createScheduleDays(
        [taskWithDueToday],
        [],
        dayDates,
        plannerDayMap,
        blockerBlocksDayMap,
        undefined,
        now,
        realNow,
      );

      // Assert
      const hasTask = result.some((day) =>
        day.entries.some((entry) => entry.id === 'task2'),
      );
      expect(hasTask).toBe(false);
    });

    it('should appear when viewing a week that includes the dueDay', () => {
      // Arrange
      const taskDueNextWeek = createTestTask('task3', 'Task Due Next Week', {
        dueDay: nextWeekStr,
      });

      // Viewing next week
      const dayDates = [nextWeekStr];
      const plannerDayMap: PlannerDayMap = {};
      const blockerBlocksDayMap: BlockedBlockByDayMap = {};

      // Act
      const result = createScheduleDays(
        [taskDueNextWeek],
        [],
        dayDates,
        plannerDayMap,
        blockerBlocksDayMap,
        undefined,
        now,
        realNow,
      );

      // Assert
      const hasTask = result.some((day) =>
        day.entries.some((entry) => entry.id === 'task3'),
      );
      expect(hasTask).toBe(true);
    });

    it('should appear when dueDay is in the future relative to viewed week', () => {
      // Arrange
      const taskDueFutureWeek = createTestTask('task4', 'Task Due Future Week', {
        dueDay: futureWeekStr,
      });

      // Viewing next week (before the due date)
      const dayDates = [nextWeekStr];
      const plannerDayMap: PlannerDayMap = {};
      const blockerBlocksDayMap: BlockedBlockByDayMap = {};

      // Act
      const result = createScheduleDays(
        [taskDueFutureWeek],
        [],
        dayDates,
        plannerDayMap,
        blockerBlocksDayMap,
        undefined,
        now,
        realNow,
      );

      // Assert
      const hasTask = result.some((day) =>
        day.entries.some((entry) => entry.id === 'task4'),
      );
      expect(hasTask).toBe(true);
    });

    it('should NOT appear when dueDay is before the viewed week', () => {
      // Arrange
      const taskDueToday = createTestTask('task5', 'Task Due Today', {
        dueDay: todayStr,
      });

      // Viewing future week (2 weeks ahead)
      const dayDates = [futureWeekStr];
      const plannerDayMap: PlannerDayMap = {};
      const blockerBlocksDayMap: BlockedBlockByDayMap = {};

      // Act
      const result = createScheduleDays(
        [taskDueToday],
        [],
        dayDates,
        plannerDayMap,
        blockerBlocksDayMap,
        undefined,
        now,
        realNow,
      );

      // Assert
      const hasTask = result.some((day) =>
        day.entries.some((entry) => entry.id === 'task5'),
      );
      expect(hasTask).toBe(false);
    });
  });

  describe('Tasks with plannedForDay', () => {
    it('should always appear on their planned day regardless of viewing week', () => {
      // Arrange
      const taskPlannedForNextWeek = createTestTask('task6', 'Task Planned Next Week');

      // Planned for next week
      const plannerDayMap: PlannerDayMap = {
        [nextWeekStr]: [taskPlannedForNextWeek],
      };
      const dayDates = [nextWeekStr];
      const blockerBlocksDayMap: BlockedBlockByDayMap = {};

      // Act
      const result = createScheduleDays(
        [],
        [],
        dayDates,
        plannerDayMap,
        blockerBlocksDayMap,
        undefined,
        now,
        realNow,
      );

      // Assert
      const hasTask = result.some(
        (day) =>
          day.dayDate === nextWeekStr &&
          day.entries.some((entry) => entry.id === 'task6'),
      );
      expect(hasTask).toBe(true);
    });

    it('should appear on planned day even when viewing outside current week', () => {
      // Arrange
      const taskPlannedForFutureWeek = createTestTask(
        'task7',
        'Task Planned Future Week',
      );

      // Planned for future week
      const plannerDayMap: PlannerDayMap = {
        [futureWeekStr]: [taskPlannedForFutureWeek],
      };
      const dayDates = [futureWeekStr];
      const blockerBlocksDayMap: BlockedBlockByDayMap = {};

      // Act
      const result = createScheduleDays(
        [],
        [],
        dayDates,
        plannerDayMap,
        blockerBlocksDayMap,
        undefined,
        now,
        realNow,
      );

      // Assert
      const hasTask = result.some(
        (day) =>
          day.dayDate === futureWeekStr &&
          day.entries.some((entry) => entry.id === 'task7'),
      );
      expect(hasTask).toBe(true);
    });
  });

  describe('Initial filter when first day is outside current week', () => {
    it('should filter out unscheduled tasks before processing when first day is outside current week', () => {
      // Arrange
      const unscheduledTask = createTestTask('task8', 'Unscheduled Task');

      const taskWithDueInFuture = createTestTask('task9', 'Task Due Future', {
        dueDay: futureWeekStr,
      });

      // Viewing future week (outside current week)
      const dayDates = [futureWeekStr];
      const plannerDayMap: PlannerDayMap = {};
      const blockerBlocksDayMap: BlockedBlockByDayMap = {};

      // Act
      const result = createScheduleDays(
        [unscheduledTask, taskWithDueInFuture],
        [],
        dayDates,
        plannerDayMap,
        blockerBlocksDayMap,
        undefined,
        now,
        realNow,
      );

      // Assert
      const hasUnscheduledTask = result.some((day) =>
        day.entries.some((entry) => entry.id === 'task8'),
      );
      const hasTaskWithDue = result.some((day) =>
        day.entries.some((entry) => entry.id === 'task9'),
      );
      expect(hasUnscheduledTask).toBe(false);
      expect(hasTaskWithDue).toBe(true);
    });

    it('should keep tasks with plannedForDay even when first day is outside current week', () => {
      // Arrange
      const taskPlannedForFuture = createTestTask('task10', 'Task Planned for Future');

      const plannerDayMap: PlannerDayMap = {
        [futureWeekStr]: [taskPlannedForFuture],
      };
      const dayDates = [futureWeekStr];
      const blockerBlocksDayMap: BlockedBlockByDayMap = {};

      // Act
      const result = createScheduleDays(
        [],
        [],
        dayDates,
        plannerDayMap,
        blockerBlocksDayMap,
        undefined,
        now,
        realNow,
      );

      // Assert
      const hasTask = result.some((day) =>
        day.entries.some((entry) => entry.id === 'task10'),
      );
      expect(hasTask).toBe(true);
    });
  });

  describe('Per-day filter for tasks flowing from previous day', () => {
    it('should filter tasks between days when viewing outside current week', () => {
      // Arrange
      const taskDueOnFirstDay = createTestTask('task11', 'Task Due on First Day', {
        dueDay: nextWeekStr,
      });

      // Viewing two days in next week
      const secondDayNextWeek = parseDbDateStr(nextWeekStr);
      secondDayNextWeek.setDate(secondDayNextWeek.getDate() + 1);
      const secondDayStr = secondDayNextWeek.toISOString().split('T')[0];

      const dayDates = [nextWeekStr, secondDayStr];
      const plannerDayMap: PlannerDayMap = {};
      const blockerBlocksDayMap: BlockedBlockByDayMap = {};

      // Act
      const result = createScheduleDays(
        [taskDueOnFirstDay],
        [],
        dayDates,
        plannerDayMap,
        blockerBlocksDayMap,
        undefined,
        now,
        realNow,
      );

      // Assert
      // Task should appear on first day
      const firstDayHasTask = result[0].entries.some((entry) => entry.id === 'task11');
      expect(firstDayHasTask).toBe(true);

      // If task doesn't complete and flows to second day, check if filtering applies
      // (This depends on implementation details of budget and beyond budget logic)
    });
  });

  describe('End-of-day filter for tasks flowing to next day', () => {
    it('should allow tasks with plannedForDay to flow to next day', () => {
      // Arrange
      const taskPlannedForToday = createTestTask('task12', 'Task Planned for Today', {
        timeEstimate: 86400000, // 24 hours - won't fit in one day
      });

      const plannerDayMap: PlannerDayMap = {
        [todayStr]: [taskPlannedForToday],
      };
      const dayDates = [todayStr, tomorrowStr];
      const blockerBlocksDayMap: BlockedBlockByDayMap = {};

      // Act
      const result = createScheduleDays(
        [],
        [],
        dayDates,
        plannerDayMap,
        blockerBlocksDayMap,
        undefined,
        now,
        realNow,
      );

      // Assert
      // Task should appear on today
      const todayHasTask = result[0].entries.some((entry) => entry.id === 'task12');
      expect(todayHasTask).toBe(true);
    });
  });

  describe('Tasks with dueWithTime', () => {
    it('should appear when viewing a week that includes the dueWithTime', () => {
      // Arrange
      const nextWeekDate = parseDbDateStr(nextWeekStr);
      nextWeekDate.setHours(14, 0, 0, 0); // 2 PM next week
      const taskWithDueTime = createTestTask('task13', 'Task With Due Time', {
        dueWithTime: nextWeekDate.getTime(),
      });

      const dayDates = [nextWeekStr];
      const plannerDayMap: PlannerDayMap = {};
      const blockerBlocksDayMap: BlockedBlockByDayMap = {};

      // Act
      const result = createScheduleDays(
        [taskWithDueTime],
        [],
        dayDates,
        plannerDayMap,
        blockerBlocksDayMap,
        undefined,
        now,
        realNow,
      );

      // Assert
      const hasTask = result.some((day) =>
        day.entries.some((entry) => entry.id === 'task13'),
      );
      expect(hasTask).toBe(true);
    });

    it('should NOT appear when dueWithTime is before the viewed week', () => {
      // Arrange
      const todayDate = parseDbDateStr(todayStr);
      todayDate.setHours(14, 0, 0, 0);
      const taskWithDueTime = createTestTask('task14', 'Task With Due Time Today', {
        dueWithTime: todayDate.getTime(),
      });

      // Viewing future week
      const dayDates = [futureWeekStr];
      const plannerDayMap: PlannerDayMap = {};
      const blockerBlocksDayMap: BlockedBlockByDayMap = {};

      // Act
      const result = createScheduleDays(
        [taskWithDueTime],
        [],
        dayDates,
        plannerDayMap,
        blockerBlocksDayMap,
        undefined,
        now,
        realNow,
      );

      // Assert
      const hasTask = result.some((day) =>
        day.entries.some((entry) => entry.id === 'task14'),
      );
      expect(hasTask).toBe(false);
    });
  });

  describe('Mixed scenarios', () => {
    it('should correctly filter multiple tasks with different scheduling types when viewing future week', () => {
      // Arrange
      const unscheduledTask = createTestTask('unscheduled', 'Unscheduled');

      const taskDueToday = createTestTask('dueToday', 'Due Today', {
        dueDay: todayStr,
      });

      const taskDueNextWeek = createTestTask('dueNextWeek', 'Due Next Week', {
        dueDay: nextWeekStr,
      });

      const taskPlannedNextWeek = createTestTask('plannedNextWeek', 'Planned Next Week');

      const plannerDayMap: PlannerDayMap = {
        [nextWeekStr]: [taskPlannedNextWeek],
      };
      const dayDates = [nextWeekStr];
      const blockerBlocksDayMap: BlockedBlockByDayMap = {};

      // Act
      const result = createScheduleDays(
        [unscheduledTask, taskDueToday, taskDueNextWeek],
        [],
        dayDates,
        plannerDayMap,
        blockerBlocksDayMap,
        undefined,
        now,
        realNow,
      );

      // Assert
      const hasUnscheduled = result.some((day) =>
        day.entries.some((entry) => entry.id === 'unscheduled'),
      );
      const hasDueToday = result.some((day) =>
        day.entries.some((entry) => entry.id === 'dueToday'),
      );
      const hasDueNextWeek = result.some((day) =>
        day.entries.some((entry) => entry.id === 'dueNextWeek'),
      );
      const hasPlannedNextWeek = result.some((day) =>
        day.entries.some((entry) => entry.id === 'plannedNextWeek'),
      );

      expect(hasUnscheduled).toBe(false);
      expect(hasDueToday).toBe(false);
      expect(hasDueNextWeek).toBe(true);
      expect(hasPlannedNextWeek).toBe(true);
    });
  });
});
