import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { IssueProviderPluginDefinition } from '@super-productivity/plugin-api';

let definition: IssueProviderPluginDefinition;

beforeAll(async () => {
  (globalThis as any).PluginAPI = {
    registerIssueProvider: vi.fn((def: IssueProviderPluginDefinition) => {
      definition = def;
    }),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  await import('./plugin');
});

describe('CalDAV Calendar Plugin', () => {
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
      it('should convert ms timestamp to UTC ISO string (toIssueValue)', () => {
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
        start: '20260320T120000Z',
        end: '20260320T130000Z',
        startParams: '',
      };

      const result = definition.extractSyncValues!(issue as any);

      expect(result.start_dateTime).toBe('2026-03-20T12:00:00.000Z');
      expect(result.duration_ms).toBe(3600000);
      expect(result.summary).toBe('Meeting');
      expect(result.description).toBe('notes');
    });

    it('should extract all-day event fields', () => {
      const issue = {
        id: 'e1',
        title: 'Holiday',
        body: '',
        start: '20260320',
        end: '20260321',
        startParams: 'VALUE=DATE',
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

    it('should use DURATION property when available', () => {
      const issue = {
        id: 'e1',
        title: 'Event with duration',
        body: '',
        start: '20260320T100000Z',
        startParams: '',
        duration: 'PT2H30M',
      };

      const result = definition.extractSyncValues!(issue as any);

      expect(result.start_dateTime).toBe('2026-03-20T10:00:00.000Z');
      expect(result.duration_ms).toBe(2 * 60 * 60 * 1000 + 30 * 60 * 1000);
    });
  });

  describe('updateIssue', () => {
    let mockHttp: {
      get: any;
      post: any;
      put: any;
      patch: any;
      delete: any;
      request: any;
    };
    const cfg = {
      serverUrl: 'https://cloud.example.com/dav',
      username: 'user',
      password: 'pass',
    };

    const sampleIcal = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:event-1',
      'DTSTART:20260320T100000Z',
      'DTEND:20260320T110000Z',
      'SUMMARY:Original Title',
      'DESCRIPTION:Original notes',
      'DTSTAMP:20260320T090000Z',
      'LAST-MODIFIED:20260320T090000Z',
      'SEQUENCE:0',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    beforeEach(() => {
      mockHttp = {
        get: vi.fn().mockResolvedValue(sampleIcal),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
        request: vi.fn(),
      };
    });

    it('should update summary when title changes', async () => {
      await definition.updateIssue!(
        'event-1',
        { summary: 'New Title' },
        cfg as any,
        mockHttp as any,
      );

      expect(mockHttp.get).toHaveBeenCalledTimes(1);
      expect(mockHttp.put).toHaveBeenCalledTimes(1);
      const [, body] = mockHttp.put.mock.calls[0];
      expect(body).toContain('SUMMARY:New Title');
    });

    it('should update description when notes change', async () => {
      await definition.updateIssue!(
        'event-1',
        { description: 'New notes' },
        cfg as any,
        mockHttp as any,
      );

      expect(mockHttp.put).toHaveBeenCalledTimes(1);
      const [, body] = mockHttp.put.mock.calls[0];
      expect(body).toContain('DESCRIPTION:New notes');
    });

    it('should update DTSTART/DTEND for timed event changes', async () => {
      const startIso = '2026-03-20T14:00:00.000Z';
      await definition.updateIssue!(
        'event-1',
        { start_dateTime: startIso, duration_ms: 3600000 },
        cfg as any,
        mockHttp as any,
      );

      expect(mockHttp.put).toHaveBeenCalledTimes(1);
      const [, body] = mockHttp.put.mock.calls[0];
      expect(body).toContain('DTSTART:20260320T140000Z');
      expect(body).toContain('DTEND:20260320T150000Z');
    });

    it('should update DTSTART/DTEND for all-day event changes', async () => {
      await definition.updateIssue!(
        'event-1',
        { start_date: '2026-03-25' },
        cfg as any,
        mockHttp as any,
      );

      expect(mockHttp.put).toHaveBeenCalledTimes(1);
      const [, body] = mockHttp.put.mock.calls[0];
      expect(body).toContain('DTSTART;VALUE=DATE:20260325');
      expect(body).toContain('DTEND;VALUE=DATE:20260326');
    });

    it('should update end when only duration changes', async () => {
      await definition.updateIssue!(
        'event-1',
        { duration_ms: 7200000 },
        cfg as any,
        mockHttp as any,
      );

      expect(mockHttp.get).toHaveBeenCalledTimes(1);
      expect(mockHttp.put).toHaveBeenCalledTimes(1);
      const [, body] = mockHttp.put.mock.calls[0];
      expect(body).toContain('DTEND:20260320T120000Z');
    });

    it('should not call put when no recognized fields changed', async () => {
      await definition.updateIssue!(
        'event-1',
        { unknown_field: 'value' },
        cfg as any,
        mockHttp as any,
      );

      expect(mockHttp.put).not.toHaveBeenCalled();
    });

    it('should strip DURATION when setting DTEND (RFC 5545 mutual exclusion)', async () => {
      const icalWithDuration = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:event-1',
        'DTSTART:20260320T100000Z',
        'DURATION:PT1H',
        'SUMMARY:Duration Event',
        'DTSTAMP:20260320T090000Z',
        'LAST-MODIFIED:20260320T090000Z',
        'SEQUENCE:0',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');
      mockHttp.get = vi.fn().mockResolvedValue(icalWithDuration);

      await definition.updateIssue!(
        'event-1',
        { start_dateTime: '2026-03-20T14:00:00.000Z', duration_ms: 3600000 },
        cfg as any,
        mockHttp as any,
      );

      const [, body] = mockHttp.put.mock.calls[0];
      expect(body).toContain('DTEND:');
      expect(body).not.toContain('DURATION:');
    });

    it('should convert to all-day event when start_dateTime is null (unschedule)', async () => {
      await definition.updateIssue!(
        'event-1',
        { start_dateTime: null },
        cfg as any,
        mockHttp as any,
      );

      expect(mockHttp.put).toHaveBeenCalledTimes(1);
      const [, body] = mockHttp.put.mock.calls[0];
      expect(body).toContain('DTSTART;VALUE=DATE:');
      expect(body).toContain('DTEND;VALUE=DATE:');
    });

    it('should bump SEQUENCE on update', async () => {
      await definition.updateIssue!(
        'event-1',
        { summary: 'Updated' },
        cfg as any,
        mockHttp as any,
      );

      const [, body] = mockHttp.put.mock.calls[0];
      expect(body).toContain('SEQUENCE:1');
    });
  });

  describe('createIssue', () => {
    it('should create an all-day event with PUT', async () => {
      const mockHttp = {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
        request: vi.fn(),
      };

      const result = await definition.createIssue!(
        'New Task',
        {
          serverUrl: 'https://cloud.example.com/dav',
          username: 'user',
          password: 'pass',
          writeCalendarId: '/dav/calendars/user/default/',
        } as any,
        mockHttp as any,
      );

      expect(mockHttp.put).toHaveBeenCalledTimes(1);
      const [url, body, opts] = mockHttp.put.mock.calls[0];
      expect(url).toContain('/dav/calendars/user/default/');
      expect(url).toMatch(/\.ics$/);
      expect(body).toContain('SUMMARY:New Task');
      expect(body).toContain('DTSTART;VALUE=DATE:');
      expect(body).toContain('DTEND;VALUE=DATE:');
      expect(opts.headers['If-None-Match']).toBe('*');
      expect(result.issueId).toBeDefined();
      expect(result.issueData.title).toBe('New Task');
    });
  });

  describe('deleteIssue', () => {
    it('should call DELETE on the event URL', async () => {
      const mockHttp = {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
        request: vi.fn(),
      };

      await definition.deleteIssue!(
        '/dav/calendars/user/default/::/dav/calendars/user/default/event-uid.ics',
        {
          serverUrl: 'https://cloud.example.com/dav',
          username: 'user',
          password: 'pass',
        } as any,
        mockHttp as any,
      );

      expect(mockHttp.delete).toHaveBeenCalledTimes(1);
      const [url] = mockHttp.delete.mock.calls[0];
      expect(url).toContain('event-uid.ics');
    });
  });

  describe('getHeaders', () => {
    it('should return Basic auth header', async () => {
      const headers = await definition.getHeaders({
        username: 'user',
        password: 'pass',
      } as any);

      // UTF-8 safe encoding: TextEncoder → btoa
      const expected =
        'Basic ' + btoa(String.fromCodePoint(...new TextEncoder().encode('user:pass')));
      expect(headers.Authorization).toBe(expected);
    });

    it('should return empty headers when credentials are missing', () => {
      const headers = definition.getHeaders({} as any);
      expect(headers).toEqual({});
    });
  });

  describe('getNewIssuesForBacklog (Nextcloud XML parsing)', () => {
    const NEXTCLOUD_REPORT_RESPONSE = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/remote.php/dav/calendars/admin/personal/event1.ics</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>"abc123"</d:getetag>
        <cal:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event1-uid
DTSTART:20260320T100000Z
DTEND:20260320T110000Z
SUMMARY:Test Meeting
DESCRIPTION:A test event
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR</cal:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

    it('should parse Nextcloud REPORT response into events', async () => {
      const mockHttp = {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
        request: vi.fn().mockResolvedValue(NEXTCLOUD_REPORT_RESPONSE),
      };

      const events = await definition.getNewIssuesForBacklog!(
        {
          serverUrl: 'https://example.com/dav',
          username: 'admin',
          password: 'pass',
          readCalendarIds: ['/remote.php/dav/calendars/admin/personal/'],
        } as any,
        mockHttp as any,
      );

      expect(events.length).toBe(1);
      expect(events[0].title).toBe('Test Meeting');
      expect(events[0].description).toBe('A test event');
      expect(events[0].isAllDay).toBe(false);
      expect(events[0].start).toBeDefined();
      // Compound ID should contain the event href from REPORT, not the UID
      expect(events[0].id).toContain('event1.ics');
    });
  });
});
