import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { IssueProviderPluginDefinition } from '@super-productivity/plugin-api';

let definition: IssueProviderPluginDefinition;

beforeAll(async () => {
  (globalThis as any).PluginAPI = {
    registerIssueProvider: vi.fn((def: IssueProviderPluginDefinition) => {
      definition = def;
    }),
    getOAuthToken: vi.fn().mockResolvedValue('mock-token'),
    clearOAuthToken: vi.fn().mockResolvedValue(undefined),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  await import('./plugin');
});

describe('Google Calendar Plugin', () => {
  describe('fieldMappings', () => {
    const ctx = { issueId: 'event-1' };

    describe('title <-> summary', () => {
      it('should pass title through to issue (toIssueValue)', () => {
        const mapping = definition.fieldMappings!.find((m) => m.taskField === 'title')!;
        expect(mapping.toIssueValue('My Event', ctx)).toBe('My Event');
      });

      it('should strip [DONE] prefix from summary (toTaskValue)', () => {
        const mapping = definition.fieldMappings!.find((m) => m.taskField === 'title')!;
        expect(mapping.toTaskValue('[DONE] My Event', ctx)).toBe('My Event');
      });

      it('should return summary as-is when no [DONE] prefix', () => {
        const mapping = definition.fieldMappings!.find((m) => m.taskField === 'title')!;
        expect(mapping.toTaskValue('My Event', ctx)).toBe('My Event');
      });

      it('should return (No title) for empty summary', () => {
        const mapping = definition.fieldMappings!.find((m) => m.taskField === 'title')!;
        expect(mapping.toTaskValue('', ctx)).toBe('(No title)');
      });
    });

    describe('notes <-> description', () => {
      it('should pass notes to issue', () => {
        const mapping = definition.fieldMappings!.find((m) => m.taskField === 'notes')!;
        expect(mapping.toIssueValue('some notes', ctx)).toBe('some notes');
      });

      it('should pass description to task', () => {
        const mapping = definition.fieldMappings!.find((m) => m.taskField === 'notes')!;
        expect(mapping.toTaskValue('some desc', ctx)).toBe('some desc');
      });

      it('should return empty string for falsy values', () => {
        const mapping = definition.fieldMappings!.find((m) => m.taskField === 'notes')!;
        expect(mapping.toIssueValue('', ctx)).toBe('');
        expect(mapping.toTaskValue('', ctx)).toBe('');
      });
    });

    describe('dueWithTime <-> start_dateTime', () => {
      it('should convert ms timestamp to local ISO string (toIssueValue)', () => {
        const mapping = definition.fieldMappings!.find(
          (m) => m.taskField === 'dueWithTime',
        )!;
        const ts = new Date('2026-03-20T10:00:00Z').getTime();
        const result = mapping.toIssueValue(ts, ctx) as string;
        expect(new Date(result).getTime()).toBe(ts);
      });

      it('should convert ISO string to ms timestamp (toTaskValue)', () => {
        const mapping = definition.fieldMappings!.find(
          (m) => m.taskField === 'dueWithTime',
        )!;
        const iso = '2026-03-20T10:00:00Z';
        expect(mapping.toTaskValue(iso, ctx)).toBe(new Date(iso).getTime());
      });

      it('should return null for falsy toIssueValue and undefined for falsy toTaskValue', () => {
        const mapping = definition.fieldMappings!.find(
          (m) => m.taskField === 'dueWithTime',
        )!;
        expect(mapping.toIssueValue(0, ctx)).toBeNull();
        expect(mapping.toTaskValue('', ctx)).toBeUndefined();
      });

      it('should declare dueDay as mutually exclusive', () => {
        const mapping = definition.fieldMappings!.find(
          (m) => m.taskField === 'dueWithTime',
        )!;
        expect(mapping.mutuallyExclusive).toEqual(['dueDay']);
      });
    });

    describe('timeEstimate <-> duration_ms', () => {
      it('should pass number through both directions', () => {
        const mapping = definition.fieldMappings!.find(
          (m) => m.taskField === 'timeEstimate',
        )!;
        expect(mapping.toIssueValue(3600000, ctx)).toBe(3600000);
        expect(mapping.toTaskValue(1800000, ctx)).toBe(1800000);
      });

      it('should return 0 for falsy values', () => {
        const mapping = definition.fieldMappings!.find(
          (m) => m.taskField === 'timeEstimate',
        )!;
        expect(mapping.toIssueValue(0, ctx)).toBe(0);
        expect(mapping.toTaskValue(0, ctx)).toBe(0);
      });
    });

    describe('dueDay <-> start_date', () => {
      it('should pass date string through both directions', () => {
        const mapping = definition.fieldMappings!.find((m) => m.taskField === 'dueDay')!;
        expect(mapping.toIssueValue('2026-03-20', ctx)).toBe('2026-03-20');
        expect(mapping.toTaskValue('2026-03-20', ctx)).toBe('2026-03-20');
      });

      it('should return null for falsy toIssueValue and undefined for falsy toTaskValue', () => {
        const mapping = definition.fieldMappings!.find((m) => m.taskField === 'dueDay')!;
        expect(mapping.toIssueValue('', ctx)).toBeNull();
        expect(mapping.toTaskValue('', ctx)).toBeUndefined();
      });

      it('should declare dueWithTime as mutually exclusive', () => {
        const mapping = definition.fieldMappings!.find((m) => m.taskField === 'dueDay')!;
        expect(mapping.mutuallyExclusive).toEqual(['dueWithTime']);
      });
    });
  });

  describe('extractSyncValues', () => {
    it('should normalize timed event to UTC ISO', () => {
      const issue = {
        id: 'e1',
        title: 'Meeting',
        body: 'notes',
        start: { dateTime: '2026-03-20T12:00:00+02:00' },
        end: { dateTime: '2026-03-20T13:00:00+02:00' },
      };

      const result = definition.extractSyncValues!(issue as any);

      expect(result.start_dateTime).toBe('2026-03-20T10:00:00.000Z');
      expect(result.duration_ms).toBe(3600000);
      expect(result.summary).toBe('Meeting');
      expect(result.description).toBe('notes');
    });

    it('should extract all-day event fields', () => {
      const issue = {
        id: 'e1',
        title: 'Holiday',
        body: '',
        start: { date: '2026-03-20' },
        end: { date: '2026-03-21' },
      };

      const result = definition.extractSyncValues!(issue as any);

      expect(result.start_date).toBe('2026-03-20');
      expect(result.start_dateTime).toBeUndefined();
      expect(result.duration_ms).toBe(0);
    });

    it('should handle missing start/end gracefully', () => {
      const issue = { id: 'e1', title: 'Bare', body: '' };

      const result = definition.extractSyncValues!(issue as any);

      expect(result.start_dateTime).toBeUndefined();
      expect(result.start_date).toBeUndefined();
      expect(result.duration_ms).toBe(0);
    });
  });

  describe('updateIssue', () => {
    let mockHttp: { get: any; post: any; put: any; patch: any; delete: any };
    const cfg = { calendarId: 'test-cal' };

    beforeEach(() => {
      mockHttp = {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
      };
    });

    it('should patch summary when title changes', async () => {
      await definition.updateIssue!(
        'event-1',
        { summary: 'New Title' },
        cfg as any,
        mockHttp as any,
      );

      expect(mockHttp.patch).toHaveBeenCalledTimes(1);
      const [, body] = mockHttp.patch.mock.calls[0];
      expect(body.summary).toBe('New Title');
    });

    it('should patch description when notes change', async () => {
      await definition.updateIssue!(
        'event-1',
        { description: 'New notes' },
        cfg as any,
        mockHttp as any,
      );

      expect(mockHttp.patch).toHaveBeenCalledTimes(1);
      const [, body] = mockHttp.patch.mock.calls[0];
      expect(body.description).toBe('New notes');
    });

    it('should set start/end dateTime and null out date for timed events', async () => {
      const startIso = '2026-03-20T10:00:00+00:00';
      await definition.updateIssue!(
        'event-1',
        { start_dateTime: startIso, duration_ms: 3600000 },
        cfg as any,
        mockHttp as any,
      );

      expect(mockHttp.patch).toHaveBeenCalledTimes(1);
      const [, body] = mockHttp.patch.mock.calls[0];
      expect(body.start.dateTime).toBeDefined();
      expect(body.start.date).toBeNull();
      expect(body.end.dateTime).toBeDefined();
      expect(body.end.date).toBeNull();
      const endTs = new Date(body.end.dateTime).getTime();
      const startTs = new Date(body.start.dateTime).getTime();
      expect(endTs - startTs).toBe(3600000);
    });

    it('should set start/end date and null out dateTime for all-day events', async () => {
      await definition.updateIssue!(
        'event-1',
        { start_date: '2026-03-20' },
        cfg as any,
        mockHttp as any,
      );

      expect(mockHttp.patch).toHaveBeenCalledTimes(1);
      const [, body] = mockHttp.patch.mock.calls[0];
      expect(body.start.date).toBe('2026-03-20');
      expect(body.start.dateTime).toBeNull();
      expect(body.end.date).toBe('2026-03-21');
      expect(body.end.dateTime).toBeNull();
    });

    it('should fetch current event and update end when only duration changes', async () => {
      mockHttp.get.mockResolvedValue({
        start: { dateTime: '2026-03-20T10:00:00Z' },
      });

      await definition.updateIssue!(
        'event-1',
        { duration_ms: 7200000 },
        cfg as any,
        mockHttp as any,
      );

      expect(mockHttp.get).toHaveBeenCalledTimes(1);
      expect(mockHttp.patch).toHaveBeenCalledTimes(1);
      const [, body] = mockHttp.patch.mock.calls[0];
      const endTs = new Date(body.end.dateTime).getTime();
      expect(endTs).toBe(new Date('2026-03-20T10:00:00Z').getTime() + 7200000);
    });

    it('should not call patch when no recognized fields changed', async () => {
      await definition.updateIssue!(
        'event-1',
        { unknown_field: 'value' },
        cfg as any,
        mockHttp as any,
      );

      expect(mockHttp.patch).not.toHaveBeenCalled();
    });
  });

  describe('createIssue', () => {
    it('should create an all-day event with today/tomorrow dates', async () => {
      const mockHttp = {
        get: vi.fn(),
        post: vi.fn().mockResolvedValue({
          id: 'new-event-1',
          summary: 'New Task',
          status: 'confirmed',
        }),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
      };

      const result = await definition.createIssue!(
        'New Task',
        { calendarId: 'test-cal' } as any,
        mockHttp as any,
      );

      expect(mockHttp.post).toHaveBeenCalledTimes(1);
      const [, body] = mockHttp.post.mock.calls[0];
      expect(body.summary).toBe('New Task');
      expect(body.start.date).toBeDefined();
      expect(body.end.date).toBeDefined();
      expect(body.start.dateTime).toBeUndefined();
      expect(result.issueId).toBe('new-event-1');
    });
  });
});
