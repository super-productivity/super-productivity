import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { CaldavCommonInterfacesService } from './caldav-common-interfaces.service';
import { CaldavClientService } from './caldav-client.service';
import { CaldavSyncAdapterService } from './caldav-sync-adapter.service';
import { IssueProviderService } from '../../issue-provider.service';
import { CaldavIssue, CaldavIssueReduced } from './caldav-issue.model';
import { IssueProviderCaldav } from '../../issue.model';

const BASE_ISSUE: CaldavIssue = {
  id: 'uid-1',
  completed: false,
  item_url: 'https://cal.example.com/task.ics',
  summary: 'Test Task',
  labels: [],
  etag_hash: 42,
};

const BASE_CFG: IssueProviderCaldav = {
  id: 'test-provider',
  issueProviderKey: 'CALDAV',
  caldavUrl: 'https://cal.example.com',
  resourceName: 'tasks',
  username: 'user',
  password: 'pass',
  categoryFilter: null,
  isEnabled: true,
};

const makeReduced = (id: string, related_to?: string): CaldavIssueReduced => ({
  id,
  completed: false,
  item_url: `https://cal.example.com/${id}.ics`,
  summary: `Task ${id}`,
  labels: [],
  etag_hash: 1,
  ...(related_to ? { related_to } : {}),
});

// 2026-04-15 local-midnight timestamp (ical.js returns local-midnight for VALUE=DATE)
const ALL_DAY_DATE_STR = '2026-04-15';
const ALL_DAY_TIMESTAMP = new Date(2026, 3, 15, 0, 0, 0, 0).getTime(); // local midnight
const TIMED_TIMESTAMP = new Date('2026-04-15T14:00:00Z').getTime();

describe('CaldavCommonInterfacesService', () => {
  let service: CaldavCommonInterfacesService;
  let caldavClientSpy: jasmine.SpyObj<CaldavClientService>;
  let issueProviderServiceSpy: jasmine.SpyObj<IssueProviderService>;

  beforeEach(() => {
    caldavClientSpy = jasmine.createSpyObj('CaldavClientService', [
      'getOpenTasks$',
      'searchOpenTasks$',
      'getById$',
      'getByIds$',
      'updateFields$',
    ]);
    issueProviderServiceSpy = jasmine.createSpyObj('IssueProviderService', [
      'getCfgOnce$',
    ]);

    TestBed.configureTestingModule({
      providers: [
        CaldavCommonInterfacesService,
        { provide: CaldavClientService, useValue: caldavClientSpy },
        {
          provide: CaldavSyncAdapterService,
          useValue: jasmine.createSpyObj('CaldavSyncAdapterService', {
            extractSyncValues: {},
          }),
        },
        { provide: IssueProviderService, useValue: issueProviderServiceSpy },
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

  describe('getNewIssuesToAddToBacklog', () => {
    const PROVIDER_ID = 'provider-1';

    const setupTasks = (
      tasks: CaldavIssueReduced[],
      cfg: Partial<IssueProviderCaldav> = {},
    ): void => {
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of({ ...BASE_CFG, ...cfg }));
      caldavClientSpy.getOpenTasks$.and.returnValue(of(tasks));
    };

    it('should return all tasks when isAddSubTasks is disabled', async () => {
      const tasks = [makeReduced('parent'), makeReduced('child', 'parent')];
      setupTasks(tasks, { isAddSubTasks: false });

      const result = await service.getNewIssuesToAddToBacklog(PROVIDER_ID, []);
      expect(result.length).toBe(2);
    });

    it('should return all tasks when isAddSubTasks is not set', async () => {
      const tasks = [makeReduced('parent'), makeReduced('child', 'parent')];
      setupTasks(tasks);

      const result = await service.getNewIssuesToAddToBacklog(PROVIDER_ID, []);
      expect(result.length).toBe(2);
    });

    it('should exclude child tasks whose parent is NOT yet in SP when isAddSubTasks is enabled', async () => {
      const tasks = [makeReduced('parent'), makeReduced('child', 'parent')];
      setupTasks(tasks, { isAddSubTasks: true });

      const result = await service.getNewIssuesToAddToBacklog(PROVIDER_ID, []);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('parent');
    });

    it('should include child tasks whose parent IS already in SP when isAddSubTasks is enabled', async () => {
      const child = makeReduced('child', 'parent');
      setupTasks([child], { isAddSubTasks: true });

      const result = await service.getNewIssuesToAddToBacklog(PROVIDER_ID, ['parent']);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('child');
    });

    it('should include top-level tasks and exclude orphaned children in a mixed list', async () => {
      const tasks = [
        makeReduced('p1'),
        makeReduced('p2'),
        makeReduced('child-of-p1', 'p1'), // parent new → excluded
        makeReduced('child-of-p2', 'p2'), // parent new → excluded
        makeReduced('child-of-existing', 'already-in-sp'), // parent exists → included
      ];
      setupTasks(tasks, { isAddSubTasks: true });

      const result = await service.getNewIssuesToAddToBacklog(PROVIDER_ID, [
        'already-in-sp',
      ]);
      expect(result.map((t) => t.id)).toEqual(
        jasmine.arrayContaining(['p1', 'p2', 'child-of-existing']),
      );
      expect(result.map((t) => t.id)).not.toContain('child-of-p1');
      expect(result.map((t) => t.id)).not.toContain('child-of-p2');
      expect(result.length).toBe(3);
    });
  });

  describe('getSubTasks', () => {
    const PROVIDER_ID = 'provider-1';

    const setupTasks = (
      tasks: CaldavIssueReduced[],
      cfg: Partial<IssueProviderCaldav> = {},
    ): void => {
      issueProviderServiceSpy.getCfgOnce$.and.returnValue(of({ ...BASE_CFG, ...cfg }));
      caldavClientSpy.getOpenTasks$.and.returnValue(of(tasks));
    };

    it('should return empty array when isAddSubTasks is disabled', async () => {
      setupTasks([makeReduced('child', 'parent')], { isAddSubTasks: false });

      const result = await service.getSubTasks('parent', PROVIDER_ID);
      expect(result).toEqual([]);
    });

    it('should return empty array when isAddSubTasks is not set', async () => {
      setupTasks([makeReduced('child', 'parent')]);

      const result = await service.getSubTasks('parent', PROVIDER_ID);
      expect(result).toEqual([]);
    });

    it('should not call getOpenTasks$ when isAddSubTasks is disabled', async () => {
      setupTasks([], { isAddSubTasks: false });

      await service.getSubTasks('parent', PROVIDER_ID);
      expect(caldavClientSpy.getOpenTasks$).not.toHaveBeenCalled();
    });

    it('should return direct children of the given parent when isAddSubTasks is enabled', async () => {
      const tasks = [
        makeReduced('parent'),
        makeReduced('child-1', 'parent'),
        makeReduced('child-2', 'parent'),
        makeReduced('unrelated', 'other-parent'),
      ];
      setupTasks(tasks, { isAddSubTasks: true });

      const result = await service.getSubTasks('parent', PROVIDER_ID);
      expect(result.map((t) => t.id)).toEqual(
        jasmine.arrayContaining(['child-1', 'child-2']),
      );
      expect(result.length).toBe(2);
    });

    it('should return empty array when parent has no children in CalDAV', async () => {
      setupTasks([makeReduced('parent')], { isAddSubTasks: true });

      const result = await service.getSubTasks('parent', PROVIDER_ID);
      expect(result).toEqual([]);
    });

    it('should handle numeric issueId by converting to string for comparison', async () => {
      const child = makeReduced('child', '42');
      setupTasks([child], { isAddSubTasks: true });

      const result = await service.getSubTasks(42, PROVIDER_ID);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('child');
    });

    it('should exclude a self-referential task (RELATED-TO:<own-uid>) to prevent store corruption', async () => {
      // A malformed VTODO where related_to === id would cause _addSubTasks
      // to attach a task to itself, corrupting the task tree.
      const selfRef = makeReduced('parent', 'parent');
      const child = makeReduced('child', 'parent');
      setupTasks([selfRef, child], { isAddSubTasks: true });

      const result = await service.getSubTasks('parent', PROVIDER_ID);
      expect(result.map((t) => t.id)).not.toContain('parent');
      expect(result.map((t) => t.id)).toContain('child');
      expect(result.length).toBe(1);
    });
  });
});
