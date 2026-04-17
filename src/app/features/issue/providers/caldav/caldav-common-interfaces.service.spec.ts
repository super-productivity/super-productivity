import { TestBed } from '@angular/core/testing';
import { CaldavCommonInterfacesService } from './caldav-common-interfaces.service';
import { CaldavClientService } from './caldav-client.service';
import { CaldavSyncAdapterService } from './caldav-sync-adapter.service';
import { IssueProviderService } from '../../issue-provider.service';
import { CaldavIssue } from './caldav-issue.model';

const BASE_ISSUE: CaldavIssue = {
  id: 'uid-1',
  completed: false,
  item_url: 'https://cal.example.com/task.ics',
  summary: 'Test Task',
  labels: [],
  etag_hash: 42,
};

// 2026-04-15 local-midnight timestamp (ical.js returns local-midnight for VALUE=DATE)
const ALL_DAY_DATE_STR = '2026-04-15';
const ALL_DAY_TIMESTAMP = new Date(2026, 3, 15, 0, 0, 0, 0).getTime(); // local midnight
const TIMED_TIMESTAMP = new Date('2026-04-15T14:00:00Z').getTime();

describe('CaldavCommonInterfacesService', () => {
  let service: CaldavCommonInterfacesService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        CaldavCommonInterfacesService,
        {
          provide: CaldavClientService,
          useValue: jasmine.createSpyObj('CaldavClientService', [
            'getOpenTasks$',
            'searchOpenTasks$',
            'getById$',
            'getByIds$',
            'updateFields$',
          ]),
        },
        {
          provide: CaldavSyncAdapterService,
          useValue: jasmine.createSpyObj('CaldavSyncAdapterService', {
            extractSyncValues: {},
          }),
        },
        {
          provide: IssueProviderService,
          useValue: jasmine.createSpyObj('IssueProviderService', ['getCfgOnce$']),
        },
      ],
    });
    service = TestBed.inject(CaldavCommonInterfacesService);
  });

  describe('getAddTaskData - DTSTART mapping', () => {
    it('should set dueWithTime and null dueDay for a timed DTSTART', () => {
      const issue: CaldavIssue = {
        ...BASE_ISSUE,
        start: TIMED_TIMESTAMP,
        isAllDay: false,
      };
      const result = service.getAddTaskData(issue);
      expect(result.dueWithTime).toBe(TIMED_TIMESTAMP);
      expect(result.dueDay).toBeNull();
    });

    it('should set dueDay and null dueWithTime for an all-day DTSTART (VALUE=DATE)', () => {
      const issue: CaldavIssue = {
        ...BASE_ISSUE,
        start: ALL_DAY_TIMESTAMP,
        isAllDay: true,
      };
      const result = service.getAddTaskData(issue);
      expect(result.dueDay).toBe(ALL_DAY_DATE_STR);
      expect(result.dueWithTime).toBeNull();
    });

    it('should null both dueDay and dueWithTime when DTSTART is absent (prevents default "Today", clears stale values)', () => {
      const issue: CaldavIssue = { ...BASE_ISSUE, start: undefined, isAllDay: undefined };
      const result = service.getAddTaskData(issue);
      expect(result.dueDay).toBeNull();
      expect(result.dueWithTime).toBeNull();
    });
  });

  describe('getAddTaskData - DUE mapping', () => {
    it('should set deadlineWithTime and null deadlineDay for a timed DUE', () => {
      const issue: CaldavIssue = {
        ...BASE_ISSUE,
        due: TIMED_TIMESTAMP,
        isDueAllDay: false,
      };
      const result = service.getAddTaskData(issue);
      expect(result.deadlineWithTime).toBe(TIMED_TIMESTAMP);
      expect(result.deadlineDay).toBeNull();
    });

    it('should set deadlineDay and null deadlineWithTime for an all-day DUE (VALUE=DATE)', () => {
      const issue: CaldavIssue = {
        ...BASE_ISSUE,
        due: ALL_DAY_TIMESTAMP,
        isDueAllDay: true,
      };
      const result = service.getAddTaskData(issue);
      expect(result.deadlineDay).toBe(ALL_DAY_DATE_STR);
      expect(result.deadlineWithTime).toBeNull();
    });

    it('should set no deadline fields when DUE is absent', () => {
      const issue: CaldavIssue = { ...BASE_ISSUE };
      const result = service.getAddTaskData(issue);
      expect(result.deadlineDay).toBeUndefined();
      expect(result.deadlineWithTime).toBeUndefined();
    });
  });

  describe('getAddTaskData - combined DTSTART + DUE', () => {
    it('should set dueDay and deadlineDay when both are all-day', () => {
      const dueTimestamp = new Date(2026, 3, 20, 0, 0, 0, 0).getTime();
      const issue: CaldavIssue = {
        ...BASE_ISSUE,
        start: ALL_DAY_TIMESTAMP,
        isAllDay: true,
        due: dueTimestamp,
        isDueAllDay: true,
      };
      const result = service.getAddTaskData(issue);
      expect(result.dueDay).toBe(ALL_DAY_DATE_STR);
      expect(result.dueWithTime).toBeNull();
      expect(result.deadlineDay).toBe('2026-04-20');
      expect(result.deadlineWithTime).toBeNull();
    });
  });
});
