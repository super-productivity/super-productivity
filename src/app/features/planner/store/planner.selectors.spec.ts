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
    icalEvents: ScheduleCalendarMapEntry[],
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

    icalEvents.forEach((icalMapEntry) => {
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
      const icalEvents: ScheduleCalendarMapEntry[] = [
        {
          items: [
            {
              id: 'all-day-1',
              calProviderId: 'provider-1',
              title: 'All Day Event',
              description: 'Full day meeting',
              start: getLocalNoon(2025, 1, 15),
              duration: 0,
              isAllDay: true,
            },
            {
              id: 'timed-1',
              calProviderId: 'provider-1',
              title: 'Timed Event',
              start: getLocalTime(2025, 1, 15, 14),
              duration: 3600000,
            },
          ],
        },
      ];

      const result = getIcalEventsForDay(icalEvents, testDate);

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
      const icalEvents: ScheduleCalendarMapEntry[] = [
        {
          items: [
            {
              id: 'all-day-1',
              calProviderId: 'provider-1',
              title: 'Holiday',
              start: getLocalNoon(2025, 1, 15),
              duration: 86400000,
              isAllDay: true,
            },
            {
              id: 'all-day-2',
              calProviderId: 'provider-2',
              title: 'Conference',
              start: getLocalTime(2025, 1, 15, 9),
              duration: 0,
              isAllDay: true,
            },
          ],
        },
      ];

      const result = getIcalEventsForDay(icalEvents, testDate);

      expect(result.allDayEvents.length).toBe(2);
      expect(result.timedEvents.length).toBe(0);
    });

    it('should handle only timed events', () => {
      const icalEvents: ScheduleCalendarMapEntry[] = [
        {
          items: [
            {
              id: 'timed-1',
              calProviderId: 'provider-1',
              title: 'Meeting 1',
              start: getLocalTime(2025, 1, 15, 9),
              duration: 3600000,
            },
            {
              id: 'timed-2',
              calProviderId: 'provider-1',
              title: 'Meeting 2',
              start: getLocalTime(2025, 1, 15, 14),
              duration: 1800000,
            },
          ],
        },
      ];

      const result = getIcalEventsForDay(icalEvents, testDate);

      expect(result.allDayEvents.length).toBe(0);
      expect(result.timedEvents.length).toBe(2);
    });

    it('should filter events by day', () => {
      const icalEvents: ScheduleCalendarMapEntry[] = [
        {
          items: [
            {
              id: 'today',
              calProviderId: 'provider-1',
              title: 'Today Event',
              start: getLocalTime(2025, 1, 15, 10),
              duration: 3600000,
            },
            {
              id: 'tomorrow',
              calProviderId: 'provider-1',
              title: 'Tomorrow Event',
              start: getLocalTime(2025, 1, 16, 10),
              duration: 3600000,
            },
            {
              id: 'all-day-today',
              calProviderId: 'provider-1',
              title: 'All Day Today',
              start: getLocalNoon(2025, 1, 15),
              duration: 0,
              isAllDay: true,
            },
            {
              id: 'all-day-tomorrow',
              calProviderId: 'provider-1',
              title: 'All Day Tomorrow',
              start: getLocalNoon(2025, 1, 16),
              duration: 0,
              isAllDay: true,
            },
          ],
        },
      ];

      const result = getIcalEventsForDay(icalEvents, testDate);

      expect(result.allDayEvents.length).toBe(1);
      expect(result.allDayEvents[0].id).toBe('all-day-today');

      expect(result.timedEvents.length).toBe(1);
      expect(result.timedEvents[0].id).toBe('today');
    });

    it('should handle empty icalEvents', () => {
      const result = getIcalEventsForDay([], testDate);

      expect(result.allDayEvents.length).toBe(0);
      expect(result.timedEvents.length).toBe(0);
    });

    it('should handle events from multiple providers', () => {
      const icalEvents: ScheduleCalendarMapEntry[] = [
        {
          items: [
            {
              id: 'provider1-allday',
              calProviderId: 'provider-1',
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
              title: 'Provider 2 Timed',
              start: getLocalTime(2025, 1, 15, 11),
              duration: 3600000,
            },
            {
              id: 'provider2-allday',
              calProviderId: 'provider-2',
              title: 'Provider 2 All Day',
              start: getLocalTime(2025, 1, 15, 8),
              duration: 0,
              isAllDay: true,
            },
          ],
        },
      ];

      const result = getIcalEventsForDay(icalEvents, testDate);

      expect(result.allDayEvents.length).toBe(2);
      expect(result.timedEvents.length).toBe(1);
    });

    it('should preserve all event properties for all-day events', () => {
      const eventStart = getLocalNoon(2025, 1, 15);
      const icalEvents: ScheduleCalendarMapEntry[] = [
        {
          items: [
            {
              id: 'all-day-full',
              calProviderId: 'provider-1',
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

      const result = getIcalEventsForDay(icalEvents, testDate);

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
    [appStateFeatureKey]: { todayStr },
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
  });
});
