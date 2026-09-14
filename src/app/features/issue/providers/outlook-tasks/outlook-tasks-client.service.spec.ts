import { TestBed } from '@angular/core/testing';
import { OutlookTasksClientService } from './outlook-tasks-client.service';
import { SnackService } from '../../../../core/snack/snack.service';
import { Store } from '@ngrx/store';
import { OutlookTaskStatus, OutlookTaskImportance } from './outlook-tasks-issue.model';

describe('OutlookTasksClientService', () => {
  let service: OutlookTasksClientService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        OutlookTasksClientService,
        { provide: SnackService, useValue: { open: jasmine.createSpy('open') } },
        { provide: Store, useValue: { dispatch: jasmine.createSpy('dispatch') } },
      ],
    });
    service = TestBed.inject(OutlookTasksClientService);
  });

  // --- _mapTask ---
  describe('_mapTask', () => {
    const mapTask = (t: unknown): unknown => (service as any)._mapTask(t);

    it('should map a valid Graph task to OutlookTasksIssue', () => {
      const result = mapTask({
        id: 'task-1',
        title: 'Test Task',
        status: 'inProgress',
        importance: 'high',
        isReminderOn: true,
        lastModifiedDateTime: '2025-01-01T00:00:00Z',
        createdDateTime: '2024-12-01T00:00:00Z',
        hasAttachments: false,
      }) as any;

      expect(result.id).toBe('task-1');
      expect(result.title).toBe('Test Task');
      expect(result.status).toBe(OutlookTaskStatus.IN_PROGRESS);
      expect(result.importance).toBe(OutlookTaskImportance.HIGH);
      expect(result.isReminderOn).toBe(true);
    });

    it('should default unknown status to NOT_STARTED', () => {
      const result = mapTask({
        id: 'task-2',
        title: 'Unknown Status',
        status: 'unknownValue',
        importance: 'normal',
        isReminderOn: false,
        lastModifiedDateTime: '2025-01-01T00:00:00Z',
        createdDateTime: '2024-12-01T00:00:00Z',
        hasAttachments: false,
      }) as any;

      expect(result.status).toBe(OutlookTaskStatus.NOT_STARTED);
    });

    it('should default unknown importance to NORMAL', () => {
      const result = mapTask({
        id: 'task-3',
        title: 'Unknown Importance',
        status: 'notStarted',
        importance: 'unknownValue',
        isReminderOn: false,
        lastModifiedDateTime: '2025-01-01T00:00:00Z',
        createdDateTime: '2024-12-01T00:00:00Z',
        hasAttachments: false,
      }) as any;

      expect(result.importance).toBe(OutlookTaskImportance.NORMAL);
    });

    it('should map body with valid contentType', () => {
      const result = mapTask({
        id: 'task-4',
        title: 'With Body',
        status: 'notStarted',
        importance: 'normal',
        body: { content: 'Hello', contentType: 'text' },
        isReminderOn: false,
        lastModifiedDateTime: '2025-01-01T00:00:00Z',
        createdDateTime: '2024-12-01T00:00:00Z',
        hasAttachments: false,
      }) as any;

      expect(result.body).toEqual({ content: 'Hello', contentType: 'text' });
    });

    it('should default unknown body contentType to text', () => {
      const result = mapTask({
        id: 'task-5',
        title: 'Bad Content Type',
        status: 'notStarted',
        importance: 'normal',
        body: { content: 'Hello', contentType: 'unknown' },
        isReminderOn: false,
        lastModifiedDateTime: '2025-01-01T00:00:00Z',
        createdDateTime: '2024-12-01T00:00:00Z',
        hasAttachments: false,
      }) as any;

      expect(result.body.contentType).toBe('text');
    });

    it('should handle missing body', () => {
      const result = mapTask({
        id: 'task-6',
        title: 'No Body',
        status: 'notStarted',
        importance: 'normal',
        isReminderOn: false,
        lastModifiedDateTime: '2025-01-01T00:00:00Z',
        createdDateTime: '2024-12-01T00:00:00Z',
        hasAttachments: false,
      }) as any;

      expect(result.body).toBeUndefined();
    });

    it('should map optional date fields', () => {
      const result = mapTask({
        id: 'task-7',
        title: 'With Dates',
        status: 'notStarted',
        importance: 'normal',
        isReminderOn: false,
        lastModifiedDateTime: '2025-01-01T00:00:00Z',
        createdDateTime: '2024-12-01T00:00:00Z',
        dueDateTime: { dateTime: '2025-06-01', timeZone: 'UTC' },
        startDateTime: { dateTime: '2025-05-01', timeZone: 'UTC' },
        completedDateTime: { dateTime: '2025-06-15', timeZone: 'UTC' },
        categories: ['work', 'urgent'],
        hasAttachments: true,
      }) as any;

      expect(result.dueDateTime.dateTime).toBe('2025-06-01');
      expect(result.startDateTime.dateTime).toBe('2025-05-01');
      expect(result.completedDateTime.dateTime).toBe('2025-06-15');
      expect(result.categories).toEqual(['work', 'urgent']);
      expect(result.hasAttachments).toBe(true);
    });
  });

  // --- getAuthUrl ---
  describe('getAuthUrl', () => {
    it('should generate a valid OAuth URL with state stored', () => {
      const cfg = {
        isEnabled: true,
        clientId: 'test-client-id',
        tenantId: 'test-tenant',
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        taskListId: null,
      };
      const url = service.getAuthUrl(cfg);

      expect(url).toContain(
        'login.microsoftonline.com/test-tenant/oauth2/v2.0/authorize',
      );
      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain('scope=offline_access');
      expect(url).toContain('Tasks.ReadWrite');
      expect(url).toContain('state=');
      expect(url).toContain('response_type=code');
    });

    it('should use common tenant when tenantId is null', () => {
      const cfg = {
        isEnabled: true,
        clientId: 'test-client-id',
        tenantId: null,
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        taskListId: null,
      };
      const url = service.getAuthUrl(cfg);

      expect(url).toContain('login.microsoftonline.com/common/');
    });
  });
});
