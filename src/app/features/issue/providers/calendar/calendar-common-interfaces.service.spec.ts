import { TestBed } from '@angular/core/testing';
import { CalendarCommonInterfacesService } from './calendar-common-interfaces.service';
import { CalendarIntegrationService } from '../../../calendar-integration/calendar-integration.service';
import { IssueProviderService } from '../../issue-provider.service';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { ICalIssueReduced } from './calendar.model';
import { getDbDateStr } from '../../../../util/get-db-date-str';
import { of } from 'rxjs';
import { Task } from '../../../tasks/task.model';
import { CalendarIntegrationEvent } from '../../../calendar-integration/calendar-integration.model';

describe('CalendarCommonInterfacesService', () => {
  let service: CalendarCommonInterfacesService;
  let calendarIntegrationServiceSpy: jasmine.SpyObj<CalendarIntegrationService>;
  let issueProviderServiceSpy: jasmine.SpyObj<IssueProviderService>;

  beforeEach(() => {
    calendarIntegrationServiceSpy = jasmine.createSpyObj('CalendarIntegrationService', [
      'requestEventsForSchedule$',
    ]);
    issueProviderServiceSpy = jasmine.createSpyObj('IssueProviderService', [
      'getCfgOnce$',
    ]);

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        CalendarCommonInterfacesService,
        {
          provide: CalendarIntegrationService,
          useValue: calendarIntegrationServiceSpy,
        },
        {
          provide: IssueProviderService,
          useValue: issueProviderServiceSpy,
        },
      ],
    });
    service = TestBed.inject(CalendarCommonInterfacesService);
  });

  describe('getAddTaskData', () => {
    it('should use dueDay for all-day events', () => {
      const allDayEvent: ICalIssueReduced = {
        id: 'all-day-123',
        calProviderId: 'provider-1',
        title: 'All Day Task',
        description: 'Task description',
        start: new Date('2025-01-15T00:00:00Z').getTime(),
        duration: 0,
        isAllDay: true,
      };

      const result = service.getAddTaskData(allDayEvent);

      expect(result.title).toBe('All Day Task');
      expect(result.dueDay).toBe(getDbDateStr(allDayEvent.start));
      expect(result.dueWithTime).toBeUndefined();
      expect(result.issueType).toBe('ICAL');
    });

    it('should use dueWithTime for timed events', () => {
      const timedEvent: ICalIssueReduced = {
        id: 'timed-123',
        calProviderId: 'provider-1',
        title: 'Timed Task',
        description: 'Task description',
        start: new Date('2025-01-15T14:30:00Z').getTime(),
        duration: 3600000, // 1 hour
        isAllDay: false,
      };

      const result = service.getAddTaskData(timedEvent);

      expect(result.title).toBe('Timed Task');
      expect(result.dueWithTime).toBe(timedEvent.start);
      expect(result.dueDay).toBeUndefined();
      expect(result.timeEstimate).toBe(3600000);
    });

    it('should use dueWithTime when isAllDay is undefined', () => {
      const eventWithoutAllDayFlag: ICalIssueReduced = {
        id: 'event-123',
        calProviderId: 'provider-1',
        title: 'Regular Event',
        start: new Date('2025-01-15T10:00:00Z').getTime(),
        duration: 1800000, // 30 minutes
      };

      const result = service.getAddTaskData(eventWithoutAllDayFlag);

      expect(result.dueWithTime).toBe(eventWithoutAllDayFlag.start);
      expect(result.dueDay).toBeUndefined();
    });

    it('should include common task properties for all-day events', () => {
      const allDayEvent: ICalIssueReduced = {
        id: 'all-day-456',
        calProviderId: 'provider-2',
        title: 'Meeting All Day',
        description: 'Important meeting',
        start: new Date('2025-02-20T00:00:00Z').getTime(),
        duration: 86400000, // 24 hours
        isAllDay: true,
      };

      const result = service.getAddTaskData(allDayEvent);

      expect(result.issueId).toBe('all-day-456');
      expect(result.issueProviderId).toBe('provider-2');
      expect(result.issueType).toBe('ICAL');
      expect(result.notes).toBe('Important meeting');
      expect(result.timeEstimate).toBe(86400000);
      expect(result.issueWasUpdated).toBe(false);
      expect(result.issueLastUpdated).toBeDefined();
    });

    it('should handle empty description', () => {
      const eventWithoutDescription: ICalIssueReduced = {
        id: 'event-789',
        calProviderId: 'provider-1',
        title: 'No Description Event',
        start: new Date('2025-01-15T09:00:00Z').getTime(),
        duration: 3600000,
        isAllDay: true,
      };

      const result = service.getAddTaskData(eventWithoutDescription);

      expect(result.notes).toBe('');
    });
  });

  describe('getFreshDataForIssueTask', () => {
    const mockCalendarCfg = {
      id: 'provider-1',
      isEnabled: true,
      icalUrl: 'https://example.com/calendar.ics',
    };

    const createMockTask = (overrides: Partial<Task> = {}): Task =>
      ({
        id: 'task-1',
        issueId: 'event-123',
        issueProviderId: 'provider-1',
        issueType: 'ICAL',
        title: 'Original Title',
        dueWithTime: new Date('2025-01-15T10:00:00Z').getTime(),
        timeEstimate: 3600000,
        ...overrides,
      }) as Task;

    const createMockCalendarEvent = (
      overrides: Partial<CalendarIntegrationEvent> = {},
    ): CalendarIntegrationEvent => ({
      id: 'event-123',
      calProviderId: 'provider-1',
      title: 'Original Title',
      start: new Date('2025-01-15T10:00:00Z').getTime(),
      duration: 3600000,
      ...overrides,
    });

    it('should return null when task has no issueProviderId', async () => {
      const task = createMockTask({ issueProviderId: undefined });

      const result = await service.getFreshDataForIssueTask(task);

      expect(result).toBeNull();
    });

    it('should return null when task has no issueId', async () => {
      const task = createMockTask({ issueId: undefined });

      const result = await service.getFreshDataForIssueTask(task);

      expect(result).toBeNull();
    });

    it('should return null when provider config is not found', async () => {
      const task = createMockTask();
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(null as any));

      const result = await service.getFreshDataForIssueTask(task);

      expect(result).toBeNull();
    });

    it('should return null when matching event is not found', async () => {
      const task = createMockTask();
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(mockCalendarCfg as any));
      calendarIntegrationServiceSpy.requestEventsForSchedule$.and.returnValue(of([]));

      const result = await service.getFreshDataForIssueTask(task);

      expect(result).toBeNull();
    });

    it('should return null when event has no changes', async () => {
      const task = createMockTask();
      const calendarEvent = createMockCalendarEvent();
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(mockCalendarCfg as any));
      calendarIntegrationServiceSpy.requestEventsForSchedule$.and.returnValue(
        of([calendarEvent]),
      );

      const result = await service.getFreshDataForIssueTask(task);

      expect(result).toBeNull();
    });

    it('should return taskChanges when event time changed', async () => {
      const task = createMockTask();
      const newStartTime = new Date('2025-01-15T14:00:00Z').getTime();
      const calendarEvent = createMockCalendarEvent({ start: newStartTime });
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(mockCalendarCfg as any));
      calendarIntegrationServiceSpy.requestEventsForSchedule$.and.returnValue(
        of([calendarEvent]),
      );

      const result = await service.getFreshDataForIssueTask(task);

      expect(result).not.toBeNull();
      expect(result!.taskChanges.dueWithTime).toBe(newStartTime);
      expect(result!.taskChanges.issueWasUpdated).toBe(true);
      expect(result!.issueTitle).toBe('Original Title');
    });

    it('should return taskChanges when event title changed', async () => {
      const task = createMockTask();
      const calendarEvent = createMockCalendarEvent({ title: 'Updated Title' });
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(mockCalendarCfg as any));
      calendarIntegrationServiceSpy.requestEventsForSchedule$.and.returnValue(
        of([calendarEvent]),
      );

      const result = await service.getFreshDataForIssueTask(task);

      expect(result).not.toBeNull();
      expect(result!.taskChanges.title).toBe('Updated Title');
      expect(result!.issueTitle).toBe('Updated Title');
    });

    it('should return taskChanges when event duration changed', async () => {
      const task = createMockTask();
      const newDuration = 7200000; // 2 hours
      const calendarEvent = createMockCalendarEvent({ duration: newDuration });
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(mockCalendarCfg as any));
      calendarIntegrationServiceSpy.requestEventsForSchedule$.and.returnValue(
        of([calendarEvent]),
      );

      const result = await service.getFreshDataForIssueTask(task);

      expect(result).not.toBeNull();
      expect(result!.taskChanges.timeEstimate).toBe(newDuration);
    });

    it('should match event by legacy ID', async () => {
      const task = createMockTask({ issueId: 'legacy-event-id' });
      const calendarEvent = createMockCalendarEvent({
        id: 'new-event-id',
        legacyIds: ['legacy-event-id'],
        title: 'Updated Title',
      });
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(mockCalendarCfg as any));
      calendarIntegrationServiceSpy.requestEventsForSchedule$.and.returnValue(
        of([calendarEvent]),
      );

      const result = await service.getFreshDataForIssueTask(task);

      expect(result).not.toBeNull();
      expect(result!.taskChanges.title).toBe('Updated Title');
    });

    it('should handle all-day event conversion correctly', async () => {
      const task = createMockTask({ dueWithTime: undefined, dueDay: '2025-01-15' });
      // Use midday (12:00) to ensure date is consistent across all timezones
      const eventStartTime = new Date('2025-01-16T12:00:00Z').getTime();
      const calendarEvent = createMockCalendarEvent({
        isAllDay: true,
        start: eventStartTime,
      });
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(mockCalendarCfg as any));
      calendarIntegrationServiceSpy.requestEventsForSchedule$.and.returnValue(
        of([calendarEvent]),
      );

      const result = await service.getFreshDataForIssueTask(task);

      expect(result).not.toBeNull();
      expect(result!.taskChanges.dueDay).toBe(getDbDateStr(eventStartTime));
      expect(result!.taskChanges.dueWithTime).toBeUndefined();
    });
  });

  describe('getFreshDataForIssueTasks', () => {
    const mockCalendarCfg = {
      id: 'provider-1',
      isEnabled: true,
      icalUrl: 'https://example.com/calendar.ics',
    };

    it('should return empty array when no tasks have changes', async () => {
      const task = {
        id: 'task-1',
        issueId: 'event-123',
        issueProviderId: 'provider-1',
        issueType: 'ICAL',
        title: 'Same Title',
        dueWithTime: new Date('2025-01-15T10:00:00Z').getTime(),
        timeEstimate: 3600000,
      } as Task;

      const calendarEvent: CalendarIntegrationEvent = {
        id: 'event-123',
        calProviderId: 'provider-1',
        title: 'Same Title',
        start: new Date('2025-01-15T10:00:00Z').getTime(),
        duration: 3600000,
      };

      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(mockCalendarCfg as any));
      calendarIntegrationServiceSpy.requestEventsForSchedule$.and.returnValue(
        of([calendarEvent]),
      );

      const result = await service.getFreshDataForIssueTasks([task]);

      expect(result).toEqual([]);
    });

    it('should return only tasks with changes', async () => {
      const task1 = {
        id: 'task-1',
        issueId: 'event-1',
        issueProviderId: 'provider-1',
        issueType: 'ICAL',
        title: 'Same Title',
        dueWithTime: new Date('2025-01-15T10:00:00Z').getTime(),
        timeEstimate: 3600000,
      } as Task;

      const task2 = {
        id: 'task-2',
        issueId: 'event-2',
        issueProviderId: 'provider-1',
        issueType: 'ICAL',
        title: 'Old Title',
        dueWithTime: new Date('2025-01-15T11:00:00Z').getTime(),
        timeEstimate: 3600000,
      } as Task;

      const calendarEvent1: CalendarIntegrationEvent = {
        id: 'event-1',
        calProviderId: 'provider-1',
        title: 'Same Title',
        start: new Date('2025-01-15T10:00:00Z').getTime(),
        duration: 3600000,
      };

      const calendarEvent2: CalendarIntegrationEvent = {
        id: 'event-2',
        calProviderId: 'provider-1',
        title: 'New Title',
        start: new Date('2025-01-15T11:00:00Z').getTime(),
        duration: 3600000,
      };

      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(mockCalendarCfg as any));
      calendarIntegrationServiceSpy.requestEventsForSchedule$.and.returnValue(
        of([calendarEvent1, calendarEvent2]),
      );

      const result = await service.getFreshDataForIssueTasks([task1, task2]);

      expect(result.length).toBe(1);
      expect(result[0].task.id).toBe('task-2');
      expect(result[0].taskChanges.title).toBe('New Title');
    });

    it('should batch tasks by provider to minimize calendar fetches', async () => {
      const mockCfgProvider1 = {
        id: 'provider-1',
        isEnabled: true,
        icalUrl: 'https://example.com/calendar1.ics',
      };
      const mockCfgProvider2 = {
        id: 'provider-2',
        isEnabled: true,
        icalUrl: 'https://example.com/calendar2.ics',
      };

      // Tasks from two different providers
      const task1 = {
        id: 'task-1',
        issueId: 'event-1',
        issueProviderId: 'provider-1',
        issueType: 'ICAL',
        title: 'Old Title 1',
        dueWithTime: new Date('2025-01-15T10:00:00Z').getTime(),
        timeEstimate: 3600000,
      } as Task;

      const task2 = {
        id: 'task-2',
        issueId: 'event-2',
        issueProviderId: 'provider-1',
        issueType: 'ICAL',
        title: 'Old Title 2',
        dueWithTime: new Date('2025-01-15T11:00:00Z').getTime(),
        timeEstimate: 3600000,
      } as Task;

      const task3 = {
        id: 'task-3',
        issueId: 'event-3',
        issueProviderId: 'provider-2',
        issueType: 'ICAL',
        title: 'Old Title 3',
        dueWithTime: new Date('2025-01-15T12:00:00Z').getTime(),
        timeEstimate: 3600000,
      } as Task;

      // Calendar events with updated titles
      const calendarEvent1: CalendarIntegrationEvent = {
        id: 'event-1',
        calProviderId: 'provider-1',
        title: 'New Title 1',
        start: new Date('2025-01-15T10:00:00Z').getTime(),
        duration: 3600000,
      };

      const calendarEvent2: CalendarIntegrationEvent = {
        id: 'event-2',
        calProviderId: 'provider-1',
        title: 'New Title 2',
        start: new Date('2025-01-15T11:00:00Z').getTime(),
        duration: 3600000,
      };

      const calendarEvent3: CalendarIntegrationEvent = {
        id: 'event-3',
        calProviderId: 'provider-2',
        title: 'New Title 3',
        start: new Date('2025-01-15T12:00:00Z').getTime(),
        duration: 3600000,
      };

      // Setup spies to return different configs for different providers
      issueProviderServiceSpy.getCfgOnce$.and.callFake((providerId: string) => {
        if (providerId === 'provider-1') return of(mockCfgProvider1 as any);
        if (providerId === 'provider-2') return of(mockCfgProvider2 as any);
        return of(null as any);
      });

      // Setup calendar service to return events based on config
      calendarIntegrationServiceSpy.requestEventsForSchedule$.and.callFake((cfg: any) => {
        if (cfg.id === 'provider-1') return of([calendarEvent1, calendarEvent2]);
        if (cfg.id === 'provider-2') return of([calendarEvent3]);
        return of([]);
      });

      const result = await service.getFreshDataForIssueTasks([task1, task2, task3]);

      // Should return all 3 tasks with changes
      expect(result.length).toBe(3);

      // Verify batching: getCfgOnce$ should be called once per provider (not per task)
      expect(issueProviderServiceSpy.getCfgOnce$.calls.count()).toBe(2);

      // Verify batching: requestEventsForSchedule$ should be called once per provider
      expect(calendarIntegrationServiceSpy.requestEventsForSchedule$.calls.count()).toBe(
        2,
      );

      // Verify all tasks got their updates
      const task1Result = result.find((r) => r.task.id === 'task-1');
      const task2Result = result.find((r) => r.task.id === 'task-2');
      const task3Result = result.find((r) => r.task.id === 'task-3');

      expect(task1Result?.taskChanges.title).toBe('New Title 1');
      expect(task2Result?.taskChanges.title).toBe('New Title 2');
      expect(task3Result?.taskChanges.title).toBe('New Title 3');
    });

    it('should handle mixed scenarios: some providers fail, some succeed', async () => {
      const mockCfgProvider1 = {
        id: 'provider-1',
        isEnabled: true,
        icalUrl: 'https://example.com/calendar1.ics',
      };

      const task1 = {
        id: 'task-1',
        issueId: 'event-1',
        issueProviderId: 'provider-1',
        issueType: 'ICAL',
        title: 'Old Title',
        dueWithTime: new Date('2025-01-15T10:00:00Z').getTime(),
        timeEstimate: 3600000,
      } as Task;

      const task2 = {
        id: 'task-2',
        issueId: 'event-2',
        issueProviderId: 'provider-missing',
        issueType: 'ICAL',
        title: 'Old Title 2',
        dueWithTime: new Date('2025-01-15T11:00:00Z').getTime(),
        timeEstimate: 3600000,
      } as Task;

      const calendarEvent1: CalendarIntegrationEvent = {
        id: 'event-1',
        calProviderId: 'provider-1',
        title: 'New Title',
        start: new Date('2025-01-15T10:00:00Z').getTime(),
        duration: 3600000,
      };

      issueProviderServiceSpy.getCfgOnce$.and.callFake((providerId: string) => {
        if (providerId === 'provider-1') return of(mockCfgProvider1 as any);
        return of(null as any); // Provider not found
      });

      calendarIntegrationServiceSpy.requestEventsForSchedule$.and.returnValue(
        of([calendarEvent1]),
      );

      const result = await service.getFreshDataForIssueTasks([task1, task2]);

      // Should only return the task from the working provider
      expect(result.length).toBe(1);
      expect(result[0].task.id).toBe('task-1');
      expect(result[0].taskChanges.title).toBe('New Title');
    });

    it('should skip tasks without issueProviderId or issueId', async () => {
      const taskWithoutProvider = {
        id: 'task-1',
        issueId: 'event-1',
        issueProviderId: undefined, // Missing provider
        issueType: 'ICAL',
        title: 'Task 1',
      } as Task;

      const taskWithoutIssueId = {
        id: 'task-2',
        issueId: undefined, // Missing issue ID
        issueProviderId: 'provider-1',
        issueType: 'ICAL',
        title: 'Task 2',
      } as Task;

      const result = await service.getFreshDataForIssueTasks([
        taskWithoutProvider,
        taskWithoutIssueId,
      ]);

      // Should return empty array since both tasks are invalid
      expect(result).toEqual([]);
      // Should not call any services
      expect(issueProviderServiceSpy.getCfgOnce$.calls.count()).toBe(0);
      expect(calendarIntegrationServiceSpy.requestEventsForSchedule$.calls.count()).toBe(
        0,
      );
    });

    it('should handle multiple changes in a single event', async () => {
      const task = {
        id: 'task-1',
        issueId: 'event-1',
        issueProviderId: 'provider-1',
        issueType: 'ICAL',
        title: 'Old Title',
        dueWithTime: new Date('2025-01-15T10:00:00Z').getTime(),
        timeEstimate: 3600000, // 1 hour
      } as Task;

      // Event with multiple changes: title, time, and duration
      const calendarEvent: CalendarIntegrationEvent = {
        id: 'event-1',
        calProviderId: 'provider-1',
        title: 'New Title',
        start: new Date('2025-01-16T14:00:00Z').getTime(), // Different day and time
        duration: 7200000, // 2 hours
      };

      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of(mockCalendarCfg as any));
      calendarIntegrationServiceSpy.requestEventsForSchedule$.and.returnValue(
        of([calendarEvent]),
      );

      const result = await service.getFreshDataForIssueTasks([task]);

      expect(result.length).toBe(1);
      expect(result[0].taskChanges.title).toBe('New Title');
      expect(result[0].taskChanges.dueWithTime).toBe(
        new Date('2025-01-16T14:00:00Z').getTime(),
      );
      expect(result[0].taskChanges.timeEstimate).toBe(7200000);
      expect(result[0].taskChanges.issueWasUpdated).toBe(true);
    });
  });

  describe('pollInterval', () => {
    it('should have a poll interval of 10 minutes', () => {
      expect(service.pollInterval).toBe(10 * 60 * 1000);
    });
  });
});
