import { TestBed } from '@angular/core/testing';
import { OutlookTasksSyncAdapterService } from './outlook-tasks-sync-adapter.service';
import { OutlookTasksClientService } from './outlook-tasks-client.service';
import { OutlookTaskStatus } from './outlook-tasks-issue.model';
import { FieldMapping, FieldMappingContext } from '../../two-way-sync/issue-sync.model';

const CTX: FieldMappingContext = { issueId: 'test-id' };

describe('OutlookTasksSyncAdapterService', () => {
  let adapter: OutlookTasksSyncAdapterService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        OutlookTasksSyncAdapterService,
        {
          provide: OutlookTasksClientService,
          useValue: {
            getById$: jasmine.createSpy('getById$'),
            updateTask$: jasmine.createSpy('updateTask$'),
          },
        },
      ],
    });
    adapter = TestBed.inject(OutlookTasksSyncAdapterService);
  });

  describe('getFieldMappings', () => {
    it('should return 3 field mappings (isDone, title, notes)', () => {
      const mappings = adapter.getFieldMappings();
      expect(mappings.length).toBe(3);
      expect(mappings.map((m) => m.taskField)).toEqual(['isDone', 'title', 'notes']);
    });
  });

  describe('isDone mapping', () => {
    const isDoneMapping = (): FieldMapping =>
      adapter.getFieldMappings().find((m) => m.taskField === 'isDone')!;

    it('toIssueValue: true -> completed', () => {
      expect(isDoneMapping().toIssueValue(true, CTX)).toBe(OutlookTaskStatus.COMPLETED);
    });

    it('toIssueValue: false -> notStarted', () => {
      expect(isDoneMapping().toIssueValue(false, CTX)).toBe(
        OutlookTaskStatus.NOT_STARTED,
      );
    });

    it('toTaskValue: completed -> true', () => {
      expect(isDoneMapping().toTaskValue(OutlookTaskStatus.COMPLETED, CTX)).toBe(true);
    });

    it('toTaskValue: notStarted -> false', () => {
      expect(isDoneMapping().toTaskValue(OutlookTaskStatus.NOT_STARTED, CTX)).toBe(false);
    });

    it('toTaskValue: inProgress -> false', () => {
      expect(isDoneMapping().toTaskValue(OutlookTaskStatus.IN_PROGRESS, CTX)).toBe(false);
    });
  });

  describe('title mapping', () => {
    const titleMapping = (): FieldMapping =>
      adapter.getFieldMappings().find((m) => m.taskField === 'title')!;

    it('toIssueValue: string passthrough', () => {
      expect(titleMapping().toIssueValue('Hello', CTX)).toBe('Hello');
    });

    it('toIssueValue: non-string -> empty string', () => {
      expect(titleMapping().toIssueValue(123, CTX)).toBe('');
    });

    it('toTaskValue: string passthrough', () => {
      expect(titleMapping().toTaskValue('World', CTX)).toBe('World');
    });

    it('toTaskValue: non-string -> empty string', () => {
      expect(titleMapping().toTaskValue(null, CTX)).toBe('');
    });
  });

  describe('notes mapping', () => {
    const notesMapping = (): FieldMapping =>
      adapter.getFieldMappings().find((m) => m.taskField === 'notes')!;

    it('toIssueValue: string passthrough', () => {
      expect(notesMapping().toIssueValue('note text', CTX)).toBe('note text');
    });

    it('toTaskValue: extracts content from body object', () => {
      expect(
        notesMapping().toTaskValue({ content: 'body text', contentType: 'text' }, CTX),
      ).toBe('body text');
    });

    it('toTaskValue: string passthrough', () => {
      expect(notesMapping().toTaskValue('plain string', CTX)).toBe('plain string');
    });

    it('toTaskValue: non-string, non-object -> empty string', () => {
      expect(notesMapping().toTaskValue(42, CTX)).toBe('');
    });

    it('toTaskValue: object without content -> empty string', () => {
      expect(notesMapping().toTaskValue({ foo: 'bar' }, CTX)).toBe('');
    });
  });

  describe('getSyncConfig', () => {
    it('should return empty object when twoWaySync is undefined', () => {
      expect(
        adapter.getSyncConfig({
          isEnabled: true,
          clientId: null,
          tenantId: null,
          accessToken: null,
          refreshToken: null,
          tokenExpiresAt: null,
          taskListId: null,
        }),
      ).toEqual({});
    });

    it('should map twoWaySync fields to sync config', () => {
      const cfg = {
        isEnabled: true,
        clientId: null,
        tenantId: null,
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        taskListId: null,
        twoWaySync: {
          isDone: 'both' as const,
          title: 'pullOnly' as const,
          notes: 'off' as const,
        },
      };
      expect(adapter.getSyncConfig(cfg)).toEqual({
        isDone: 'both',
        title: 'pullOnly',
        notes: 'off',
      });
    });
  });

  describe('extractSyncValues', () => {
    it('should extract status, title, and body', () => {
      const issue = {
        status: 'completed',
        title: 'Test',
        body: { content: 'hi', contentType: 'text' },
      };
      expect(adapter.extractSyncValues(issue)).toEqual({
        status: 'completed',
        title: 'Test',
        body: { content: 'hi', contentType: 'text' },
      });
    });
  });

  describe('getIssueLastUpdated', () => {
    it('should parse lastModifiedDateTime to timestamp', () => {
      const issue = { lastModifiedDateTime: '2025-06-01T12:00:00Z' };
      expect(adapter.getIssueLastUpdated(issue)).toBe(
        new Date('2025-06-01T12:00:00Z').getTime(),
      );
    });

    it('should return 0 for missing lastModifiedDateTime', () => {
      expect(adapter.getIssueLastUpdated({})).toBe(0);
    });

    it('should return 0 for non-string lastModifiedDateTime', () => {
      expect(adapter.getIssueLastUpdated({ lastModifiedDateTime: 123 })).toBe(0);
    });
  });
});
