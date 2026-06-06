import { TestBed } from '@angular/core/testing';
import { CdkDragRelease } from '@angular/cdk/drag-drop';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { ScheduleWeekDragService } from './schedule-week-drag.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { TaskReminderOptionId } from '../../tasks/task.model';
import { DEFAULT_GLOBAL_CONFIG } from '../../config/default-global-config.const';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { signal } from '@angular/core';
import { GlobalConfigState } from '../../config/global-config.model';
import { ScheduleEvent } from '../schedule.model';
import { FH, SVEType, T_ID_PREFIX } from '../schedule.const';
import { PlannerActions } from '../../planner/store/planner.actions';

const ONE_HOUR_MS = 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const TEN_MINUTES_MS = 10 * 60 * 1000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;

describe('ScheduleWeekDragService', () => {
  let service: ScheduleWeekDragService;
  let store: MockStore;
  let dispatchSpy: jasmine.Spy;

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
          provide: GlobalConfigService,
          useValue: createMockGlobalConfigService(defaultTaskRemindOption),
        },
      ],
    });

    service = TestBed.inject(ScheduleWeekDragService);
    store = TestBed.inject(MockStore);
    dispatchSpy = spyOn(store, 'dispatch').and.callThrough();
  };

  afterEach(() => {
    TestBed.resetTestingModule();
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
