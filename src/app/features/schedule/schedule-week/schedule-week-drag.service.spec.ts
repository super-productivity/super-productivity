import { TestBed } from '@angular/core/testing';
import { CdkDragRelease } from '@angular/cdk/drag-drop';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { ScheduleWeekDragService } from './schedule-week-drag.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { TaskCopy, TaskReminderOptionId } from '../../tasks/task.model';
import { DEFAULT_GLOBAL_CONFIG } from '../../config/default-global-config.const';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { signal } from '@angular/core';
import { GlobalConfigState } from '../../config/global-config.model';
import { ScheduleEvent } from '../schedule.model';
import { FH, SVEType, T_ID_PREFIX } from '../schedule.const';
import { PlannerActions } from '../../planner/store/planner.actions';
import { CalendarEventActionsService } from '../../calendar-integration/calendar-event-actions.service';
import { DateService } from '../../../core/date/date.service';

const ONE_HOUR_MS = 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const TEN_MINUTES_MS = 10 * 60 * 1000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;

describe('ScheduleWeekDragService', () => {
  let service: ScheduleWeekDragService;
  let store: MockStore;
  let dispatchSpy: jasmine.Spy;
  let calendarEventActionsSpy: jasmine.SpyObj<CalendarEventActionsService>;

  const createMockGlobalConfigService = (
    defaultTaskRemindOption: TaskReminderOptionId = TaskReminderOptionId.AtStart,
  ): Partial<GlobalConfigService> => {
    const mockCfg = {
      ...DEFAULT_GLOBAL_CONFIG,
      reminder: {
        ...DEFAULT_GLOBAL_CONFIG.reminder,
        defaultTaskRemindOption,
      },
    } as GlobalConfigState;

    return {
      cfg: signal(mockCfg),
    };
  };

  const setupTestBed = (
    defaultTaskRemindOption: TaskReminderOptionId = TaskReminderOptionId.AtStart,
  ): void => {
    TestBed.configureTestingModule({
      providers: [
        ScheduleWeekDragService,
        provideMockStore(),
        {
          provide: CalendarEventActionsService,
          useValue: jasmine.createSpyObj<CalendarEventActionsService>(
            'CalendarEventActionsService',
            ['canMoveEvent', 'moveToStartTime'],
          ),
        },
        {
          provide: GlobalConfigService,
          useValue: createMockGlobalConfigService(defaultTaskRemindOption),
        },
        {
          provide: DateService,
          useValue: { todayStr: () => '2026-03-20' },
        },
      ],
    });

    service = TestBed.inject(ScheduleWeekDragService);
    store = TestBed.inject(MockStore);
    calendarEventActionsSpy = TestBed.inject(
      CalendarEventActionsService,
    ) as jasmine.SpyObj<CalendarEventActionsService>;
    calendarEventActionsSpy.canMoveEvent.and.returnValue(true);
    calendarEventActionsSpy.moveToStartTime.and.resolveTo(true);
    dispatchSpy = spyOn(store, 'dispatch').and.callThrough();
  };

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('captures today when unscheduling a timed task but leaving it in Today', () => {
    setupTestBed();
    const sourceEvent = createTaskEvent({ id: 'task-1', dueWithTime: Date.now() });

    (
      service as unknown as {
        _handleUnschedule: (task: TaskCopy, sourceEvent: ScheduleEvent) => void;
      }
    )._handleUnschedule(sourceEvent.data as TaskCopy, sourceEvent);

    expect(dispatchSpy).toHaveBeenCalledWith(
      TaskSharedActions.unscheduleTask({
        id: 'task-1',
        isLeaveInToday: true,
        today: '2026-03-20',
      }),
    );
  });

  const createTaskEvent = (
    task: Partial<{ id: string; title: string; dueWithTime: number }> = {},
  ): ScheduleEvent =>
    ({
      id: task.id ?? 'task-1',
      type: SVEType.ScheduledTask,
      style: '',
      startHours: 10,
      timeLeftInHours: 0.5,
      data: {
        id: task.id ?? 'task-1',
        title: task.title ?? 'Test Task',
        timeEstimate: THIRTY_MINUTES_MS,
        dueWithTime: task.dueWithTime,
      },
    }) as ScheduleEvent;

  describe('drag release reorder behavior', () => {
    const createReleaseEvent = (
      sourceEvent: ScheduleEvent,
      sourceEl: HTMLElement,
    ): CdkDragRelease<ScheduleEvent> =>
      ({
        source: {
          data: sourceEvent,
          element: {
            nativeElement: sourceEl,
          },
          reset: jasmine.createSpy('reset'),
        },
        event: new MouseEvent('mouseup', { clientX: 10, clientY: 120 }),
      }) as unknown as CdkDragRelease<ScheduleEvent>;

    const createScheduleEventElement = (
      taskId: string,
      className = SVEType.TaskPlannedForDay,
    ): HTMLElement => {
      const el = document.createElement('schedule-event');
      el.id = `${T_ID_PREFIX}${taskId}`;
      el.classList.add(className);
      return el;
    };

    beforeEach(() => {
      setupTestBed();
    });

    it('should still reorder when shift-dropping over a normal schedule task', () => {
      const sourceEl = createScheduleEventElement('source', SVEType.ScheduledTask);
      const targetEl = createScheduleEventElement('target');
      spyOn(document, 'elementsFromPoint').and.returnValue([targetEl]);

      service.setShiftMode(true);
      service.handleDragReleased(
        createReleaseEvent(createTaskEvent({ id: 'source' }), sourceEl),
      );

      expect(dispatchSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: PlannerActions.moveBeforeTask.type,
          toTaskId: 'target',
        }),
      );
    });
  });

  describe('calendar event drag release', () => {
    const createReleaseEvent = (
      sourceEvent: ScheduleEvent,
      sourceEl: HTMLElement,
    ): CdkDragRelease<ScheduleEvent> =>
      ({
        source: {
          data: sourceEvent,
          element: {
            nativeElement: sourceEl,
          },
          reset: jasmine.createSpy('reset'),
        },
        event: new MouseEvent('mouseup', { clientX: 125, clientY: 120 }),
      }) as unknown as CdkDragRelease<ScheduleEvent>;

    const createCalendarEvent = (): ScheduleEvent =>
      ({
        id: 'calendar-1::event-1',
        type: SVEType.CalendarEvent,
        style: '',
        startHours: 10,
        timeLeftInHours: 0.5,
        data: {
          id: 'calendar-1::event-1',
          calProviderId: 'provider-1',
          issueProviderKey: 'plugin:google-calendar-provider',
          title: 'Meeting',
          start: new Date('2026-03-20T10:00:00Z').getTime(),
          duration: THIRTY_MINUTES_MS,
          icon: 'event',
        },
      }) as ScheduleEvent;

    beforeEach(() => {
      setupTestBed();
    });

    const setupCalendarGrid = (): void => {
      const columnEl = document.createElement('div');
      columnEl.classList.add('col');
      columnEl.setAttribute('data-day', '2026-03-20');
      spyOn(document, 'elementsFromPoint').and.returnValue([columnEl]);

      service.setGridContainer(() => {
        const gridEl = document.createElement('div');
        spyOn(gridEl, 'getBoundingClientRect').and.returnValue({
          top: 0,
          bottom: 24 * FH,
          left: 0,
          right: 200,
          width: 200,
          height: 24 * FH,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect);
        return gridEl;
      });
      service.setDaysToShowAccessor(() => ['2026-03-20']);
    };

    it('moves plugin calendar events via the calendar action service when dropped on a time column', () => {
      const sourceEl = document.createElement('schedule-event');
      setupCalendarGrid();
      service.handleDragStarted({
        source: {
          data: createCalendarEvent(),
          element: { nativeElement: sourceEl },
        },
      } as unknown as any);
      service.handleDragMoved({
        source: {
          data: createCalendarEvent(),
          element: { nativeElement: sourceEl },
        },
        pointerPosition: { x: 125, y: 120 },
      } as unknown as any);
      service.handleDragReleased(createReleaseEvent(createCalendarEvent(), sourceEl));

      expect(calendarEventActionsSpy.moveToStartTime).toHaveBeenCalledTimes(1);
      const [calendarEvent, startMs] =
        calendarEventActionsSpy.moveToStartTime.calls.mostRecent().args;
      expect(calendarEvent.id).toBe('calendar-1::event-1');
      expect(startMs).toEqual(jasmine.any(Number));
    });

    it('treats shift-drop on a calendar event as a normal timed move', () => {
      const sourceEl = document.createElement('schedule-event');
      setupCalendarGrid();

      service.setShiftMode(true);
      service.handleDragStarted({
        source: {
          data: createCalendarEvent(),
          element: { nativeElement: sourceEl },
        },
      } as unknown as any);
      service.handleDragMoved({
        source: {
          data: createCalendarEvent(),
          element: { nativeElement: sourceEl },
        },
        pointerPosition: { x: 125, y: 120 },
      } as unknown as any);
      service.handleDragReleased(createReleaseEvent(createCalendarEvent(), sourceEl));

      expect(calendarEventActionsSpy.moveToStartTime).toHaveBeenCalledTimes(1);
    });

    it('resets the dragged calendar event after the provider write resolves', async () => {
      const sourceEl = document.createElement('schedule-event');
      setupCalendarGrid();
      const releaseEvent = createReleaseEvent(createCalendarEvent(), sourceEl);

      service.handleDragStarted({
        source: {
          data: createCalendarEvent(),
          element: { nativeElement: sourceEl },
        },
      } as unknown as any);
      service.handleDragMoved({
        source: {
          data: createCalendarEvent(),
          element: { nativeElement: sourceEl },
        },
        pointerPosition: { x: 125, y: 120 },
      } as unknown as any);
      service.handleDragReleased(releaseEvent);

      expect(releaseEvent.source.reset).not.toHaveBeenCalled();
      expect(sourceEl.style.pointerEvents).toBe('none');
      await Promise.resolve();

      expect(releaseEvent.source.reset).toHaveBeenCalled();
      expect(sourceEl.style.transform).toBe('translate3d(0px, 0px, 0px)');
      expect(sourceEl.style.pointerEvents).toBe('');
    });

    it('suppresses the unschedule preview when dragging a calendar event outside the grid', () => {
      const sourceEl = document.createElement('schedule-event');
      setupCalendarGrid();

      service.handleDragStarted({
        source: {
          data: createCalendarEvent(),
          element: { nativeElement: sourceEl },
        },
      } as unknown as any);
      service.handleDragMoved({
        source: {
          data: createCalendarEvent(),
          element: { nativeElement: sourceEl },
        },
        pointerPosition: { x: 125, y: 5000 },
      } as unknown as any);

      expect(service.dragPreviewContext()).toBeNull();
    });

    it('does not move calendar events when the provider is read-only', () => {
      calendarEventActionsSpy.canMoveEvent.and.returnValue(false);
      const sourceEl = document.createElement('schedule-event');
      const columnEl = document.createElement('div');
      columnEl.classList.add('col');
      columnEl.setAttribute('data-day', '2026-03-20');
      spyOn(document, 'elementsFromPoint').and.returnValue([columnEl]);

      service.setGridContainer(() => {
        const gridEl = document.createElement('div');
        spyOn(gridEl, 'getBoundingClientRect').and.returnValue({
          top: 0,
          bottom: 24 * FH,
          left: 0,
          right: 200,
          width: 200,
          height: 24 * FH,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect);
        return gridEl;
      });
      service.setDaysToShowAccessor(() => ['2026-03-20']);

      const event = createCalendarEvent();
      service.handleDragStarted({
        source: {
          data: event,
          element: { nativeElement: sourceEl },
        },
      } as unknown as any);
      service.handleDragMoved({
        source: {
          data: event,
          element: { nativeElement: sourceEl },
        },
        pointerPosition: { x: 125, y: 120 },
      } as unknown as any);
      service.handleDragReleased(createReleaseEvent(event, sourceEl));

      expect(calendarEventActionsSpy.moveToStartTime).not.toHaveBeenCalled();
    });
  });

  describe('drag preview sizing', () => {
    beforeEach(() => {
      setupTestBed();
    });

    it('should use the full remaining task time for clipped beyond-budget events', () => {
      const event = createTaskEvent();
      event.isBeyondBudget = true;
      event.timeLeftInHours = 0.25;
      event.data = {
        ...event.data,
        subTaskIds: [],
        timeEstimate: TWO_HOURS_MS,
        timeSpent: THIRTY_MINUTES_MS,
      } as ScheduleEvent['data'];

      expect((service as any)._calculateRowSpan(event)).toBe(1.5 * FH);
    });
  });

  describe('_scheduleTask reminder behavior (via scheduleTaskWithTime action)', () => {
    const baseTask = {
      id: 'task-1',
      title: 'Test Task',
      timeEstimate: THIRTY_MINUTES_MS,
      dueWithTime: undefined as number | undefined,
      reminderId: undefined as string | undefined,
    };

    it('should use default reminder option "AtStart" when scheduling new task', () => {
      setupTestBed(TaskReminderOptionId.AtStart);

      const task = { ...baseTask };
      const scheduleTime = Date.now() + ONE_HOUR_MS;

      // Access private method via any cast for testing
      (service as any)._scheduleTask(task, scheduleTime);

      expect(dispatchSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: TaskSharedActions.scheduleTaskWithTime.type,
        }),
      );

      const dispatchedAction = dispatchSpy.calls.mostRecent().args[0];
      // AtStart means remindAt equals scheduleTime
      expect(dispatchedAction.remindAt).toBe(scheduleTime);
    });

    it('should use configured default reminder option "m10" (10 minutes before) when scheduling new task', () => {
      setupTestBed(TaskReminderOptionId.m10);

      const task = { ...baseTask };
      const scheduleTime = Date.now() + ONE_HOUR_MS;

      (service as any)._scheduleTask(task, scheduleTime);

      expect(dispatchSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: TaskSharedActions.scheduleTaskWithTime.type,
        }),
      );

      const dispatchedAction = dispatchSpy.calls.mostRecent().args[0];
      // m10 means remindAt is 10 minutes before scheduleTime
      expect(dispatchedAction.remindAt).toBe(scheduleTime - TEN_MINUTES_MS);
    });

    it('should use configured default reminder option "m30" (30 minutes before) when scheduling new task', () => {
      setupTestBed(TaskReminderOptionId.m30);

      const task = { ...baseTask };
      const scheduleTime = Date.now() + ONE_HOUR_MS;

      (service as any)._scheduleTask(task, scheduleTime);

      const dispatchedAction = dispatchSpy.calls.mostRecent().args[0];
      expect(dispatchedAction.remindAt).toBe(scheduleTime - THIRTY_MINUTES_MS);
    });

    it('should use configured default reminder option "h1" (1 hour before) when scheduling new task', () => {
      setupTestBed(TaskReminderOptionId.h1);

      const task = { ...baseTask };
      const scheduleTime = Date.now() + TWO_HOURS_MS;

      (service as any)._scheduleTask(task, scheduleTime);

      const dispatchedAction = dispatchSpy.calls.mostRecent().args[0];
      expect(dispatchedAction.remindAt).toBe(scheduleTime - ONE_HOUR_MS);
    });

    it('should not set reminder when configured default is "DoNotRemind"', () => {
      setupTestBed(TaskReminderOptionId.DoNotRemind);

      const task = { ...baseTask };
      const scheduleTime = Date.now() + ONE_HOUR_MS;

      (service as any)._scheduleTask(task, scheduleTime);

      const dispatchedAction = dispatchSpy.calls.mostRecent().args[0];
      // DoNotRemind returns undefined from remindOptionToMilliseconds
      expect(dispatchedAction.remindAt).toBeUndefined();
    });

    it('should update existing reminder time when task already has a reminder', () => {
      setupTestBed(TaskReminderOptionId.m30);

      const task = {
        ...baseTask,
        dueWithTime: Date.now(),
        reminderId: 'existing-reminder-id',
      };
      const newScheduleTime = Date.now() + ONE_HOUR_MS;

      (service as any)._scheduleTask(task, newScheduleTime);

      expect(dispatchSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: TaskSharedActions.reScheduleTaskWithTime.type,
        }),
      );

      const dispatchedAction = dispatchSpy.calls.mostRecent().args[0];
      // When task already has a reminder, it updates to the new schedule time directly
      expect(dispatchedAction.remindAt).toBe(newScheduleTime);
    });

    it('should not add reminder when task already has schedule but no reminder', () => {
      setupTestBed(TaskReminderOptionId.m30);

      const task = {
        ...baseTask,
        dueWithTime: Date.now(),
        reminderId: undefined,
      };
      const newScheduleTime = Date.now() + ONE_HOUR_MS;

      (service as any)._scheduleTask(task, newScheduleTime);

      expect(dispatchSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: TaskSharedActions.reScheduleTaskWithTime.type,
        }),
      );

      const dispatchedAction = dispatchSpy.calls.mostRecent().args[0];
      // Task had schedule but no reminder, so remindAt should be undefined
      expect(dispatchedAction.remindAt).toBeUndefined();
    });
  });
});
