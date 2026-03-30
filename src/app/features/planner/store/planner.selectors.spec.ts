import {
  ScheduleCalendarMapEntry,
  ScheduleFromCalendarEvent,
} from '../../schedule/schedule.model';
import { ScheduleItemType } from '../planner.model';
import * as fromSelectors from './planner.selectors';
import { plannerFeatureKey, PlannerState } from './planner.reducer';
import { Task, TaskState } from '../../tasks/task.model';
import { TASK_FEATURE_NAME } from '../../tasks/store/task.reducer';
import { appStateFeatureKey } from '../../../root-store/app-state/app-state.reducer';
import { getDbDateStr } from '../../../util/get-db-date-str';

// Helper to test getIcalEventsForDay logic
// Since it's a private function, we test it through selectPlannerDays behavior
// For now, we test the separation logic directly

describe('Planner Selectors - All Day Events', () => {
  // Helper to create a timestamp for a specific day at noon local time
  const getLocalNoon = (year: number, month: number, day: number): number => {
    return new Date(year, month - 1, day, 12, 0, 0, 0).getTime();
  };

  // Helper to create a timestamp for a specific day at a given hour local time
  const getLocalTime = (
    year: number,
    month: number,
    day: number,
    hour: number,
  ): number => {
    return new Date(year, month - 1, day, hour, 0, 0, 0).getTime();
  };

  // Replicate the getIcalEventsForDay logic for testing
  const getIcalEventsForDay = (
    calendarEvents: ScheduleCalendarMapEntry[],
    currentDayDate: Date,
  ): { timedEvents: any[]; allDayEvents: ScheduleFromCalendarEvent[] } => {
    const timedEvents: any[] = [];
    const allDayEvents: ScheduleFromCalendarEvent[] = [];

    const isSameDay = (timestamp: number, date: Date): boolean => {
      const eventDate = new Date(timestamp);
      return (
        eventDate.getFullYear() === date.getFullYear() &&
        eventDate.getMonth() === date.getMonth() &&
        eventDate.getDate() === date.getDate()
      );
    };

    calendarEvents.forEach((icalMapEntry) => {
      icalMapEntry.items.forEach((calEv) => {
        const start = calEv.start;
        if (isSameDay(start, currentDayDate)) {
          if (calEv.isAllDay) {
            // All-day events go to a separate list with full event data
            allDayEvents.push({ ...calEv });
          } else {
            const end = calEv.start + calEv.duration;
            timedEvents.push({
              id: calEv.id,
              type: ScheduleItemType.CalEvent,
              start,
              end,
              calendarEvent: {
                ...calEv,
              },
            });
          }
        }
      });
    });
    return { timedEvents, allDayEvents };
  };

  describe('getIcalEventsForDay', () => {
    // Use local time to avoid timezone issues
    const testDate = new Date(2025, 0, 15, 12, 0, 0, 0); // Jan 15, 2025 at noon local

    it('should separate all-day events from timed events', () => {
      const calendarEvents: ScheduleCalendarMapEntry[] = [
        {
          items: [
            {
              id: 'all-day-1',
              calProviderId: 'provider-1',
              issueProviderKey: 'ICAL',
              title: 'All Day Event',
              description: 'Full day meeting',
              start: getLocalNoon(2025, 1, 15),
              duration: 0,
              isAllDay: true,
            },
            {
              id: 'timed-1',
              calProviderId: 'provider-1',
              issueProviderKey: 'ICAL',
              title: 'Timed Event',
              start: getLocalTime(2025, 1, 15, 14),
              duration: 3600000,
            },
          ],
        },
      ];

      const result = getIcalEventsForDay(calendarEvents, testDate);

      expect(result.allDayEvents.length).toBe(1);
      expect(result.allDayEvents[0].id).toBe('all-day-1');
      expect(result.allDayEvents[0].title).toBe('All Day Event');
      expect(result.allDayEvents[0].description).toBe('Full day meeting');
      expect(result.allDayEvents[0].isAllDay).toBe(true);
      expect(result.allDayEvents[0].calProviderId).toBe('provider-1');

      expect(result.timedEvents.length).toBe(1);
      expect(result.timedEvents[0].id).toBe('timed-1');
      expect(result.timedEvents[0].type).toBe(ScheduleItemType.CalEvent);
    });

    it('should handle multiple all-day events', () => {
      const calendarEvents: ScheduleCalendarMapEntry[] = [
        {
          items: [
            {
              id: 'all-day-1',
              calProviderId: 'provider-1',
              issueProviderKey: 'ICAL',
              title: 'Holiday',
              start: getLocalNoon(2025, 1, 15),
              duration: 86400000,
              isAllDay: true,
            },
            {
              id: 'all-day-2',
              calProviderId: 'provider-2',
              issueProviderKey: 'ICAL',
              title: 'Conference',
              start: getLocalTime(2025, 1, 15, 9),
              duration: 0,
              isAllDay: true,
            },
          ],
        },
      ];

      const result = getIcalEventsForDay(calendarEvents, testDate);

      expect(result.allDayEvents.length).toBe(2);
      expect(result.timedEvents.length).toBe(0);
    });

    it('should handle only timed events', () => {
      const calendarEvents: ScheduleCalendarMapEntry[] = [
        {
          items: [
            {
              id: 'timed-1',
              calProviderId: 'provider-1',
              issueProviderKey: 'ICAL',
              title: 'Meeting 1',
              start: getLocalTime(2025, 1, 15, 9),
              duration: 3600000,
            },
            {
              id: 'timed-2',
              calProviderId: 'provider-1',
              issueProviderKey: 'ICAL',
              title: 'Meeting 2',
              start: getLocalTime(2025, 1, 15, 14),
              duration: 1800000,
            },
          ],
        },
      ];

      const result = getIcalEventsForDay(calendarEvents, testDate);

      expect(result.allDayEvents.length).toBe(0);
      expect(result.timedEvents.length).toBe(2);
    });

    it('should filter events by day', () => {
      const calendarEvents: ScheduleCalendarMapEntry[] = [
        {
          items: [
            {
              id: 'today',
              calProviderId: 'provider-1',
              issueProviderKey: 'ICAL',
              title: 'Today Event',
              start: getLocalTime(2025, 1, 15, 10),
              duration: 3600000,
            },
            {
              id: 'tomorrow',
              calProviderId: 'provider-1',
              issueProviderKey: 'ICAL',
              title: 'Tomorrow Event',
              start: getLocalTime(2025, 1, 16, 10),
              duration: 3600000,
            },
            {
              id: 'all-day-today',
              calProviderId: 'provider-1',
              issueProviderKey: 'ICAL',
              title: 'All Day Today',
              start: getLocalNoon(2025, 1, 15),
              duration: 0,
              isAllDay: true,
            },
            {
              id: 'all-day-tomorrow',
              calProviderId: 'provider-1',
              issueProviderKey: 'ICAL',
              title: 'All Day Tomorrow',
              start: getLocalNoon(2025, 1, 16),
              duration: 0,
              isAllDay: true,
            },
          ],
        },
      ];

      const result = getIcalEventsForDay(calendarEvents, testDate);

      expect(result.allDayEvents.length).toBe(1);
      expect(result.allDayEvents[0].id).toBe('all-day-today');

      expect(result.timedEvents.length).toBe(1);
      expect(result.timedEvents[0].id).toBe('today');
    });

    it('should handle empty calendarEvents', () => {
      const result = getIcalEventsForDay([], testDate);

      expect(result.allDayEvents.length).toBe(0);
      expect(result.timedEvents.length).toBe(0);
    });

    it('should handle events from multiple providers', () => {
      const calendarEvents: ScheduleCalendarMapEntry[] = [
        {
          items: [
            {
              id: 'provider1-allday',
              calProviderId: 'provider-1',
              issueProviderKey: 'ICAL',
              title: 'Provider 1 All Day',
              start: getLocalNoon(2025, 1, 15),
              duration: 0,
              isAllDay: true,
            },
          ],
        },
        {
          items: [
            {
              id: 'provider2-timed',
              calProviderId: 'provider-2',
              issueProviderKey: 'ICAL',
              title: 'Provider 2 Timed',
              start: getLocalTime(2025, 1, 15, 11),
              duration: 3600000,
            },
            {
              id: 'provider2-allday',
              calProviderId: 'provider-2',
              issueProviderKey: 'ICAL',
              title: 'Provider 2 All Day',
              start: getLocalTime(2025, 1, 15, 8),
              duration: 0,
              isAllDay: true,
            },
          ],
        },
      ];

      const result = getIcalEventsForDay(calendarEvents, testDate);

      expect(result.allDayEvents.length).toBe(2);
      expect(result.timedEvents.length).toBe(1);
    });

    it('should preserve all event properties for all-day events', () => {
      const eventStart = getLocalNoon(2025, 1, 15);
      const calendarEvents: ScheduleCalendarMapEntry[] = [
        {
          items: [
            {
              id: 'all-day-full',
              calProviderId: 'provider-1',
              issueProviderKey: 'ICAL',
              title: 'Full Properties Event',
              description: 'Has description',
              start: eventStart,
              duration: 86400000,
              isAllDay: true,
              icon: 'custom-icon',
            },
          ],
        },
      ];

      const result = getIcalEventsForDay(calendarEvents, testDate);

      expect(result.allDayEvents.length).toBe(1);
      const allDayEvent = result.allDayEvents[0];
      expect(allDayEvent.id).toBe('all-day-full');
      expect(allDayEvent.calProviderId).toBe('provider-1');
      expect(allDayEvent.title).toBe('Full Properties Event');
      expect(allDayEvent.description).toBe('Has description');
      expect(allDayEvent.start).toBe(eventStart);
      expect(allDayEvent.duration).toBe(86400000);
      expect(allDayEvent.isAllDay).toBe(true);
      expect(allDayEvent.icon).toBe('custom-icon');
    });
  });
});

describe('Planner Selectors - selectPlannerDays', () => {
  const today = getDbDateStr();

  const createMockTask = (overrides: Partial<Task> & { id: string }): Task => {
    const { id, ...rest } = overrides;
    return {
      id,
      title: `Task ${id}`,
      created: Date.now(),
      isDone: false,
      subTaskIds: [],
      tagIds: [],
      projectId: 'project1',
      timeSpentOnDay: {},
      timeEstimate: 0,
      timeSpent: 0,
      attachments: [],
      ...rest,
    };
  };

  const emptyTaskState: TaskState = {
    ids: [],
    entities: {},
    currentTaskId: null,
    selectedTaskId: null,
    lastCurrentTaskId: null,
    isDataLoaded: true,
    taskDetailTargetPanel: null,
  };

  const emptyPlannerState: PlannerState = {
    days: {},
    addPlannedTasksDialogLastShown: undefined,
  };

  const defaultScheduleConfig = {
    isWorkStartEndEnabled: false,
    workStart: '09:00',
    workEnd: '17:00',
    isLunchBreakEnabled: false,
    lunchBreakStart: '12:00',
    lunchBreakEnd: '13:00',
  };

  // The factory returns a selector; test its projector directly
  const createPlannerDaysSelector = (
    dayDates: string[] = [today],
    todayStr: string = today,
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  ) => fromSelectors.selectPlannerDays(dayDates, [], [], [], [], todayStr);

  it('should return a PlannerDay for each day date', () => {
    const selector = createPlannerDaysSelector([today]);
    const result = selector.projector(
      emptyTaskState,
      emptyPlannerState,
      defaultScheduleConfig,
      0,
    );

    expect(result.length).toBe(1);
    expect(result[0].dayDate).toBe(today);
    expect(result[0].isToday).toBe(true);
  });

  it('should include tasks from planner state for a non-today day', () => {
    const tomorrow = getDbDateStr(new Date(Date.now() + 86400000));
    const task = createMockTask({ id: 't1', title: 'Plan task' });
    const taskState: TaskState = {
      ...emptyTaskState,
      ids: ['t1'],
      entities: { t1: task },
    };
    const plannerState: PlannerState = {
      ...emptyPlannerState,
      days: { [tomorrow]: ['t1'] },
    };

    const selector = fromSelectors.selectPlannerDays([tomorrow], [], [], [], [], today);
    const result = selector.projector(taskState, plannerState, defaultScheduleConfig, 0);

    expect(result[0].tasks.length).toBe(1);
    expect(result[0].tasks[0].id).toBe('t1');
  });

  it('should include unplanned today tasks passed to factory', () => {
    const task = createMockTask({ id: 't1', title: 'Today task' });
    const taskState: TaskState = {
      ...emptyTaskState,
      ids: ['t1'],
      entities: { t1: task },
    };

    // Pass t1 as a todayListTaskId (unplanned since allPlannedTasks is empty)
    const selector = fromSelectors.selectPlannerDays([today], [], ['t1'], [], [], today);
    const result = selector.projector(
      taskState,
      emptyPlannerState,
      defaultScheduleConfig,
      0,
    );

    expect(result[0].tasks.length).toBe(1);
    expect(result[0].tasks[0].id).toBe('t1');
  });

  it('should compute availableHours when schedule config is enabled', () => {
    const scheduleConfig = {
      isWorkStartEndEnabled: true,
      workStart: '09:00',
      workEnd: '17:00',
      isLunchBreakEnabled: false,
      lunchBreakStart: '12:00',
      lunchBreakEnd: '13:00',
    };
    const selector = createPlannerDaysSelector([today]);
    const result = selector.projector(
      emptyTaskState,
      emptyPlannerState,
      scheduleConfig,
      0,
    );

    // 8 hours = 28800000 ms
    expect(result[0].availableHours).toBe(28800000);
    expect(result[0].progressPercentage).toBe(0);
  });

  it('should not set availableHours when schedule is disabled', () => {
    const selector = createPlannerDaysSelector([today]);
    const result = selector.projector(
      emptyTaskState,
      emptyPlannerState,
      defaultScheduleConfig,
      0,
    );

    expect(result[0].availableHours).toBeUndefined();
    expect(result[0].progressPercentage).toBeUndefined();
  });

  it('should include additional days from planner state not in dayDates', () => {
    const tomorrow = getDbDateStr(new Date(Date.now() + 86400000));
    const task = createMockTask({ id: 't1' });
    const taskState: TaskState = {
      ...emptyTaskState,
      ids: ['t1'],
      entities: { t1: task },
    };
    const plannerState: PlannerState = {
      ...emptyPlannerState,
      days: { [tomorrow]: ['t1'] },
    };

    const selector = createPlannerDaysSelector([today]);
    const result = selector.projector(taskState, plannerState, defaultScheduleConfig, 0);

    // Should include both today (from dayDates) and tomorrow (from planner state)
    expect(result.length).toBe(2);
    const dayDates = result.map((d) => d.dayDate);
    expect(dayDates).toContain(today);
    expect(dayDates).toContain(tomorrow);
  });

  it('should filter out deleted tasks from planner days', () => {
    const plannerState: PlannerState = {
      ...emptyPlannerState,
      days: { [today]: ['deleted-task'] },
    };

    const selector = createPlannerDaysSelector([today]);
    const result = selector.projector(
      emptyTaskState,
      plannerState,
      defaultScheduleConfig,
      0,
    );

    expect(result[0].tasks.length).toBe(0);
  });
});

describe('Planner Selectors - selectAllTasksDueToday', () => {
  const today = getDbDateStr();
  const yesterday = getDbDateStr(new Date(Date.now() - 86400000));
  const tomorrow = getDbDateStr(new Date(Date.now() + 86400000));

  // Helper to create a timestamp for today at a specific hour
  const getTodayAtHour = (hour: number): number => {
    const d = new Date();
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
  };

  // Helper to create a timestamp for tomorrow
  const getTomorrowAtHour = (hour: number): number => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
  };

  const createMockTask = (overrides: Partial<Task> & { id: string }): Task => {
    const { id, title, ...rest } = overrides;
    return {
      id,
      title: title || `Task ${id}`,
      created: Date.now(),
      isDone: false,
      subTaskIds: [],
      tagIds: [],
      projectId: 'project1',
      timeSpentOnDay: {},
      timeEstimate: 0,
      timeSpent: 0,
      attachments: [],
      ...rest,
    };
  };

  const mockTasks: { [id: string]: Task } = {
    taskDueToday: createMockTask({
      id: 'taskDueToday',
      title: 'Due Today',
      dueDay: today,
    }),
    taskDueTomorrow: createMockTask({
      id: 'taskDueTomorrow',
      title: 'Due Tomorrow',
      dueDay: tomorrow,
    }),
    taskOverdue: createMockTask({
      id: 'taskOverdue',
      title: 'Overdue',
      dueDay: yesterday,
    }),
    taskWithTimeToday: createMockTask({
      id: 'taskWithTimeToday',
      title: 'With Time Today',
      dueWithTime: getTodayAtHour(14),
    }),
    taskWithTimeTomorrow: createMockTask({
      id: 'taskWithTimeTomorrow',
      title: 'With Time Tomorrow',
      dueWithTime: getTomorrowAtHour(10),
    }),
    taskNoDue: createMockTask({ id: 'taskNoDue', title: 'No Due' }),
    taskOnPlannerOnly: createMockTask({
      id: 'taskOnPlannerOnly',
      title: 'On Planner Only',
    }),
  };

  const mockTaskState: TaskState = {
    ids: Object.keys(mockTasks),
    entities: mockTasks,
    currentTaskId: null,
    selectedTaskId: null,
    lastCurrentTaskId: null,
    isDataLoaded: true,
    taskDetailTargetPanel: null,
  };

  const mockPlannerState: PlannerState = {
    days: {
      [today]: ['taskOnPlannerOnly'], // Only this task is in planner for today
    },
    addPlannedTasksDialogLastShown: undefined,
  };

  const createMockState = (
    taskState: Partial<TaskState> = {},
    plannerState: Partial<PlannerState> = {},
    todayStr: string = today,
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  ) => ({
    [appStateFeatureKey]: { todayStr, startOfNextDayDiffMs: 0 },
    [TASK_FEATURE_NAME]: { ...mockTaskState, ...taskState },
    [plannerFeatureKey]: { ...mockPlannerState, ...plannerState },
  });

  describe('selectAllTasksDueToday', () => {
    it('should return tasks with dueDay equal to today', () => {
      const mockState = createMockState();
      const result = fromSelectors.selectAllTasksDueToday(mockState);

      const ids = result.map((t) => t.id);
      expect(ids).toContain('taskDueToday');
    });

    it('should return tasks with dueWithTime for today', () => {
      const mockState = createMockState();
      const result = fromSelectors.selectAllTasksDueToday(mockState);

      const ids = result.map((t) => t.id);
      expect(ids).toContain('taskWithTimeToday');
    });

    it('should include tasks from planner state for today', () => {
      const mockState = createMockState();
      const result = fromSelectors.selectAllTasksDueToday(mockState);

      const ids = result.map((t) => t.id);
      expect(ids).toContain('taskOnPlannerOnly');
    });

    it('should NOT include tasks due tomorrow', () => {
      const mockState = createMockState();
      const result = fromSelectors.selectAllTasksDueToday(mockState);

      const ids = result.map((t) => t.id);
      expect(ids).not.toContain('taskDueTomorrow');
      expect(ids).not.toContain('taskWithTimeTomorrow');
    });

    it('should NOT include overdue tasks (dueDay in past)', () => {
      const mockState = createMockState();
      const result = fromSelectors.selectAllTasksDueToday(mockState);

      const ids = result.map((t) => t.id);
      expect(ids).not.toContain('taskOverdue');
    });

    it('should NOT include tasks without due date', () => {
      const mockState = createMockState();
      const result = fromSelectors.selectAllTasksDueToday(mockState);

      const ids = result.map((t) => t.id);
      expect(ids).not.toContain('taskNoDue');
    });

    it('should deduplicate tasks that appear in both planner and have dueDay', () => {
      // Task is both in planner AND has dueDay = today
      const taskInBoth = createMockTask({
        id: 'taskInBoth',
        title: 'In Both',
        dueDay: today,
      });

      const mockState = createMockState(
        {
          ids: [...mockTaskState.ids, 'taskInBoth'],
          entities: { ...mockTasks, taskInBoth },
        },
        {
          days: { [today]: ['taskInBoth'] },
        },
      );

      const result = fromSelectors.selectAllTasksDueToday(mockState);
      const matchingTasks = result.filter((t) => t.id === 'taskInBoth');

      expect(matchingTasks.length).toBe(1); // Should only appear once
    });

    it('should handle empty planner state', () => {
      const mockState = createMockState({}, { days: {} });
      const result = fromSelectors.selectAllTasksDueToday(mockState);

      const ids = result.map((t) => t.id);
      // Should still find tasks with dueDay = today
      expect(ids).toContain('taskDueToday');
      expect(ids).toContain('taskWithTimeToday');
    });

    it('should handle empty task state', () => {
      const mockState = createMockState({ ids: [], entities: {} });
      const result = fromSelectors.selectAllTasksDueToday(mockState);

      expect(result.length).toBe(0);
    });

    it('should handle missing entity references in planner gracefully', () => {
      // Planner references a task that doesn't exist in taskState
      const mockState = createMockState(
        {
          ids: ['taskDueToday'],
          entities: { taskDueToday: mockTasks.taskDueToday },
        },
        {
          days: { [today]: ['nonExistentTask', 'taskDueToday'] },
        },
      );

      const result = fromSelectors.selectAllTasksDueToday(mockState);

      expect(result.length).toBe(1);
      expect(result[0].id).toBe('taskDueToday');
    });

    it('should handle missing entity references in taskState.ids gracefully', () => {
      const mockState = createMockState(
        {
          ids: ['taskDueToday', 'nonExistentTask'],
          entities: { taskDueToday: mockTasks.taskDueToday },
        },
        { days: {} },
      );

      const result = fromSelectors.selectAllTasksDueToday(mockState);

      expect(result.length).toBe(1);
      expect(result[0].id).toBe('taskDueToday');
    });

    it('should return correct count when combining planner and due tasks', () => {
      const mockState = createMockState();
      const result = fromSelectors.selectAllTasksDueToday(mockState);

      // Expected: taskOnPlannerOnly (from planner), taskDueToday (dueDay), taskWithTimeToday (dueWithTime)
      expect(result.length).toBe(3);
    });

    it('should include task with both dueDay and dueWithTime set to today', () => {
      const taskWithBoth = createMockTask({
        id: 'taskWithBoth',
        title: 'Both Due Day and Time',
        dueDay: today,
        dueWithTime: getTodayAtHour(15),
      });

      const mockState = createMockState(
        {
          ids: ['taskWithBoth'],
          entities: { taskWithBoth },
        },
        { days: {} },
      );

      const result = fromSelectors.selectAllTasksDueToday(mockState);

      expect(result.length).toBe(1);
      expect(result[0].id).toBe('taskWithBoth');
    });

    it('should work with different todayStr values', () => {
      // Use tomorrow as "today"
      const mockState = createMockState({}, {}, tomorrow);
      const result = fromSelectors.selectAllTasksDueToday(mockState);

      const ids = result.map((t) => t.id);
      expect(ids).toContain('taskDueTomorrow');
      expect(ids).not.toContain('taskDueToday');
    });

    describe('with startOfNextDayDiff offset', () => {
      const FOUR_HOURS_MS = 4 * 3600000;
      const offsetTodayStr = '2026-02-15';

      // Helper to create a local timestamp for a specific date and time
      const getLocalTimestamp = (
        year: number,
        month: number,
        day: number,
        hour: number,
        minute: number = 0,
      ): number => {
        return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
      };

      const createOffsetState = (
        tasks: { [id: string]: Task },
        startOfNextDayDiffMs: number = FOUR_HOURS_MS,
        todayStr: string = offsetTodayStr,
        plannerDays: { [day: string]: string[] } = {},
        // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
      ) => ({
        [appStateFeatureKey]: { todayStr, startOfNextDayDiffMs },
        [TASK_FEATURE_NAME]: {
          ...mockTaskState,
          ids: Object.keys(tasks),
          entities: tasks,
        },
        [plannerFeatureKey]: {
          ...mockPlannerState,
          days: plannerDays,
        },
      });

      it('should include dueWithTime task at 2 AM next day when offset extends today', () => {
        // 2 AM Feb 16 minus 4h offset => Feb 15 22:00 => dateStr "2026-02-15" === todayStr
        const task = createMockTask({
          id: 'task2am',
          title: 'Due at 2 AM Feb 16',
          dueWithTime: getLocalTimestamp(2026, 2, 16, 2),
        });

        const mockState = createOffsetState({ task2am: task });
        const result = fromSelectors.selectAllTasksDueToday(mockState);

        const ids = result.map((t) => t.id);
        expect(ids).toContain('task2am');
      });

      it('should NOT include dueWithTime task at 5 AM next day when offset is 4 hours', () => {
        // 5 AM Feb 16 minus 4h offset => Feb 16 01:00 => dateStr "2026-02-16" !== todayStr
        const task = createMockTask({
          id: 'task5am',
          title: 'Due at 5 AM Feb 16',
          dueWithTime: getLocalTimestamp(2026, 2, 16, 5),
        });

        const mockState = createOffsetState({ task5am: task });
        const result = fromSelectors.selectAllTasksDueToday(mockState);

        const ids = result.map((t) => t.id);
        expect(ids).not.toContain('task5am');
      });

      it('should include task with dueDay matching todayStr regardless of offset', () => {
        // dueDay comparison is a simple string match, unaffected by offset
        const task = createMockTask({
          id: 'taskDueDay',
          title: 'Due Day Feb 15',
          dueDay: '2026-02-15',
        });

        const mockState = createOffsetState({ taskDueDay: task });
        const result = fromSelectors.selectAllTasksDueToday(mockState);

        const ids = result.map((t) => t.id);
        expect(ids).toContain('taskDueDay');
      });

      it('should include dueWithTime task at 3:59 AM next day (boundary, just before offset)', () => {
        // 3:59 AM Feb 16 minus 4h => Feb 15 23:59 => dateStr "2026-02-15" === todayStr
        const task = createMockTask({
          id: 'task359am',
          title: 'Due at 3:59 AM Feb 16',
          dueWithTime: getLocalTimestamp(2026, 2, 16, 3, 59),
        });

        const mockState = createOffsetState({ task359am: task });
        const result = fromSelectors.selectAllTasksDueToday(mockState);

        const ids = result.map((t) => t.id);
        expect(ids).toContain('task359am');
      });

      it('should NOT include dueWithTime task at 4:00 AM next day (boundary, exactly at offset)', () => {
        // 4:00 AM Feb 16 minus 4h => Feb 16 00:00 => dateStr "2026-02-16" !== todayStr
        const task = createMockTask({
          id: 'task400am',
          title: 'Due at 4:00 AM Feb 16',
          dueWithTime: getLocalTimestamp(2026, 2, 16, 4, 0),
        });

        const mockState = createOffsetState({ task400am: task });
        const result = fromSelectors.selectAllTasksDueToday(mockState);

        const ids = result.map((t) => t.id);
        expect(ids).not.toContain('task400am');
      });
    });
  });
});
