import type {
  IssueProviderPluginDefinition,
  OAuthFlowConfig,
  OAuthTokenResult,
  PluginFieldMapping,
  PluginHttp,
  PluginIssue,
  PluginSearchResult,
} from '@super-productivity/plugin-api';

declare const PluginAPI: {
  registerIssueProvider(definition: IssueProviderPluginDefinition): void;
  startOAuthFlow(config: OAuthFlowConfig): Promise<OAuthTokenResult>;
  getOAuthToken(): Promise<string | null>;
  clearOAuthToken(): Promise<void>;
};

const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const CALENDAR_READONLY_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const CLIENT_ID =
  '637968426975-p6bu3f76b9cbk927k6281lb30bris19o.apps.googleusercontent.com';
// NOT A SECRET — this is a "Desktop" OAuth client type (RFC 8252).
// Google classifies these as public clients where the secret cannot be kept
// confidential (it ships in the binary users download). PKCE + server-side
// redirect URI restrictions are the actual security mechanisms.
// Do not rotate or revoke — this value is intentionally committed.
const CLIENT_SECRET = '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';
// Android OAuth client ID — authenticates via package name + SHA-1 signing key.
// No client secret needed; PKCE is the sole proof mechanism.
// Requires "Custom URI scheme" to be enabled in Google Cloud Console.
const MOBILE_CLIENT_ID =
  '637968426975-ks6oveqe619324pimp8f7e1uqovfg65b.apps.googleusercontent.com';
// iOS OAuth client ID — authenticates via bundle ID.
// Requires "Custom URI scheme" to be enabled in Google Cloud Console.
const IOS_CLIENT_ID =
  '637968426975-ka1muro7mee1go0m7hhog49fm7svr4os.apps.googleusercontent.com';

// --- Config ---

interface GoogleCalendarConfig {
  readCalendarIds?: string[];
  writeCalendarId?: string;
  syncRangeWeeks?: string;
  showDeclinedEvents?: boolean;
  isAutoTimeBlock?: boolean;
  timeBlockCalendarId?: string;
  // Legacy field — migrated at runtime
  calendarId?: string;
}

/** Migrate old single-calendar config to new multi-calendar shape. */
const migrateConfig = (raw: Record<string, unknown>): GoogleCalendarConfig => {
  const cfg = raw as unknown as GoogleCalendarConfig;
  if (cfg.calendarId && !cfg.readCalendarIds?.length) {
    return {
      ...cfg,
      readCalendarIds: [cfg.calendarId],
      writeCalendarId: cfg.writeCalendarId || cfg.calendarId,
    };
  }
  return cfg;
};

const getWriteCalendarId = (cfg: GoogleCalendarConfig): string =>
  cfg.writeCalendarId || 'primary';

const getTimeBlockCalendarId = (cfg: GoogleCalendarConfig): string =>
  cfg.timeBlockCalendarId || getWriteCalendarId(cfg);

const getReadCalendarIds = (cfg: GoogleCalendarConfig): string[] =>
  cfg.readCalendarIds?.length ? cfg.readCalendarIds : ['primary'];

// --- Compound IDs ---
// With multiple read calendars, CRUD methods need to know which calendar
// an event belongs to. Format: "calendarId::eventId"

const COMPOUND_SEP = '::';

const toCompoundId = (calendarId: string, eventId: string): string =>
  `${calendarId}${COMPOUND_SEP}${eventId}`;

const parseCompoundId = (
  id: string,
  fallbackCalendarId: string,
): { calendarId: string; eventId: string } => {
  const sep = id.indexOf(COMPOUND_SEP);
  if (sep === -1) return { calendarId: fallbackCalendarId, eventId: id };
  return { calendarId: id.slice(0, sep), eventId: id.slice(sep + COMPOUND_SEP.length) };
};

// --- Helpers ---

interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  status?: string;
  updated?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  htmlLink?: string;
  attendees?: { self?: boolean; responseStatus?: string }[];
  [key: string]: unknown;
}

interface GoogleCalendarListResponse {
  items?: GoogleCalendarEvent[];
}

const formatEventTime = (time?: { dateTime?: string; date?: string }): string => {
  if (!time) return '';
  if (time.dateTime) {
    return new Date(time.dateTime).toLocaleString();
  }
  if (time.date) {
    // Parse as local midnight (not UTC) to avoid date shift in western timezones
    return new Date(time.date + 'T00:00:00').toLocaleDateString();
  }
  return '';
};

const formatYMD = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Format a timestamp as UTC ISO 8601 string for use in Google Calendar API. */
const toUTCISO = (timestamp: number): string => new Date(timestamp).toISOString();

const eventUrl = (calendarId: string, eventId?: string): string => {
  const base = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`;
  return eventId ? `${base}/${encodeURIComponent(eventId)}` : base;
};

const mapEventToSearchResult = (
  event: GoogleCalendarEvent,
  calendarId: string,
): PluginSearchResult => {
  const startDateTimeMs = event.start?.dateTime
    ? new Date(event.start.dateTime).getTime()
    : undefined;
  // Parse all-day date as local midnight (not UTC) to avoid date shift for western timezones
  const startDateMs = event.start?.date
    ? new Date(event.start.date + 'T00:00:00').getTime()
    : undefined;
  const endDateTimeMs = event.end?.dateTime
    ? new Date(event.end.dateTime).getTime()
    : undefined;
  const isAllDay = !event.start?.dateTime && !!event.start?.date;
  const duration =
    startDateTimeMs && endDateTimeMs
      ? endDateTimeMs - startDateTimeMs
      : isAllDay
        ? 24 * 60 * 60 * 1000
        : 0;
  return {
    id: toCompoundId(calendarId, event.id),
    title: event.summary || '(No title)',
    status: event.status,
    start: startDateTimeMs ?? startDateMs,
    dueWithTime: startDateTimeMs,
    duration,
    isAllDay,
    description: event.description,
  };
};

/**
 * Derive a deterministic Google Calendar event ID from a task ID.
 * Google Calendar event IDs: base32hex chars (a-v, 0-9), 5-1024 length.
 * SP task IDs are nanoid strings — hex-encode all bytes to stay within charset.
 */
const taskIdToGcalEventId = (taskId: string): string =>
  'sp' +
  Array.from(new TextEncoder().encode(taskId))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

const isHttpStatus = (err: unknown, status: number): boolean =>
  typeof err === 'object' &&
  err !== null &&
  'status' in err &&
  (err as { status: number }).status === status;

const isDeclined = (event: GoogleCalendarEvent): boolean =>
  event.attendees?.some((a) => a.self && a.responseStatus === 'declined') ?? false;

/** Fetch events from a single calendar. */
const fetchEventsForCalendar = async (
  http: PluginHttp,
  calendarId: string,
  cfg: GoogleCalendarConfig,
  opts?: { query?: string; maxResults?: string },
): Promise<PluginSearchResult[]> => {
  const syncRangeWeeks = parseInt(cfg.syncRangeWeeks || '', 10) || 2;
  const now = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(
    now.getTime() + syncRangeWeeks * 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const response = await http.get<GoogleCalendarListResponse>(eventUrl(calendarId), {
    params: {
      ...(opts?.query ? { q: opts.query } : {}),
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: opts?.maxResults ?? '50',
    },
  });

  return (response.items || [])
    .filter((e) => e.status !== 'cancelled')
    .filter((e) => cfg.showDeclinedEvents || !isDeclined(e))
    .map((e) => mapEventToSearchResult(e, calendarId));
};

/** Fetch events from all read calendars, merged and sorted by start time. */
const fetchEvents = async (
  http: PluginHttp,
  cfg: GoogleCalendarConfig,
  opts?: { query?: string; maxResults?: string },
): Promise<PluginSearchResult[]> => {
  const calendarIds = getReadCalendarIds(cfg);
  const results = await Promise.all(
    calendarIds.map((calId) => fetchEventsForCalendar(http, calId, cfg, opts)),
  );
  return results.flat().sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
};

// --- Load calendar list helpers ---

const loadCalendarList = async (
  _config: Record<string, unknown>,
  http: PluginHttp,
  params?: Record<string, string>,
): Promise<{ label: string; value: string }[]> => {
  const res = await http.get<{
    items?: { id: string; summary: string; primary?: boolean }[];
  }>(`${GOOGLE_CALENDAR_API}/users/me/calendarList`, params ? { params } : undefined);
  return (res.items || []).map((cal) => ({
    label: cal.summary + (cal.primary ? ' (Primary)' : ''),
    value: cal.id,
  }));
};

const loadAllCalendars = (
  config: Record<string, unknown>,
  http: PluginHttp,
): Promise<{ label: string; value: string }[]> => loadCalendarList(config, http);

const loadWritableCalendars = (
  config: Record<string, unknown>,
  http: PluginHttp,
): Promise<{ label: string; value: string }[]> =>
  loadCalendarList(config, http, { minAccessRole: 'writer' });

// --- Plugin registration ---

PluginAPI.registerIssueProvider({
  configFields: [
    {
      key: 'oauth',
      type: 'oauthButton' as const,
      label: 'Connect Google Account',
      oauthConfig: {
        authUrl: GOOGLE_AUTH_URL,
        tokenUrl: GOOGLE_TOKEN_URL,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        mobileClientId: MOBILE_CLIENT_ID,
        iosClientId: IOS_CLIENT_ID,
        scopes: [CALENDAR_EVENTS_SCOPE, CALENDAR_READONLY_SCOPE],
        extraAuthParams: { access_type: 'offline', prompt: 'consent' },
      },
    },
    {
      key: 'readCalendarIds',
      type: 'multiSelect' as const,
      label: 'Calendars to display',
      description: 'Select which calendars to show in planner and schedule views.',
      required: true,
      options: [{ label: 'Primary', value: 'primary' }],
      loadOptions: loadAllCalendars,
    },
    {
      key: 'writeCalendarId',
      type: 'select' as const,
      label: 'Default calendar for new events',
      description: 'Used when creating or rescheduling events directly from the planner.',
      required: true,
      options: [{ label: 'Primary', value: 'primary' }],
      loadOptions: loadWritableCalendars,
    },
    {
      key: 'syncRangeWeeks',
      type: 'input' as const,
      label: 'Sync range (weeks)',
      description: 'How many weeks ahead to sync events. Defaults to 2.',
      required: false,
    },
    {
      key: 'showDeclinedEvents',
      type: 'checkbox' as const,
      label: 'Show declined events',
      description: 'Display events you have declined in your calendar views.',
      advanced: true,
    },
    {
      key: 'isAutoTimeBlock',
      type: 'checkbox' as const,
      label: 'Auto time blocking',
      description:
        'When you schedule a task to a specific time, automatically create a matching event in Google Calendar. Rescheduling, completing, or deleting the task updates the event.',
    },
    {
      key: 'timeBlockCalendarId',
      type: 'select' as const,
      label: 'Time block calendar',
      description: 'Which calendar to create time block events in.',
      required: false,
      showIf: 'isAutoTimeBlock',
      options: [{ label: 'Primary', value: 'primary' }],
      loadOptions: loadWritableCalendars,
    },
  ],

  async getHeaders(_config: Record<string, unknown>): Promise<Record<string, string>> {
    const token = await PluginAPI.getOAuthToken();
    if (!token) {
      throw new Error('Not authenticated. Please connect your Google account first.');
    }
    return { Authorization: `Bearer ${token}` };
  },

  async searchIssues(
    searchTerm: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    return fetchEvents(http, migrateConfig(config), { query: searchTerm });
  },

  async getById(
    issueId: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginIssue> {
    const cfg = migrateConfig(config);
    const { calendarId, eventId } = parseCompoundId(issueId, getWriteCalendarId(cfg));
    const event = await http.get<GoogleCalendarEvent>(eventUrl(calendarId, eventId));

    return {
      id: issueId,
      title: event.summary || '(No title)',
      body: event.description || '',
      state: event.status || 'confirmed',
      lastUpdated: event.updated ? new Date(event.updated).getTime() : undefined,
      summary: event.summary || '(No title)',
      start: event.start,
      end: event.end,
      startFormatted: formatEventTime(event.start),
      endFormatted: formatEventTime(event.end),
      status: event.status,
      description: event.description,
    };
  },

  getIssueLink(issueId: string, config: Record<string, unknown>): string {
    const cfg = migrateConfig(config);
    const { calendarId, eventId } = parseCompoundId(issueId, getWriteCalendarId(cfg));
    const raw = `${eventId} ${calendarId}`;
    const eid = btoa(String.fromCharCode(...new TextEncoder().encode(raw)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    return `https://calendar.google.com/calendar/event?eid=${eid}`;
  },

  async testConnection(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<boolean> {
    const cfg = migrateConfig(config);
    const calendarId = getWriteCalendarId(cfg);
    try {
      await http.get(
        `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}`,
      );
      return true;
    } catch {
      return false;
    }
  },

  async getNewIssuesForBacklog(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    return fetchEvents(http, migrateConfig(config), { maxResults: '100' });
  },

  issueDisplay: [
    { field: 'summary', label: 'Title', type: 'text' },
    { field: 'startFormatted', label: 'Start', type: 'text' },
    { field: 'endFormatted', label: 'End', type: 'text' },
    { field: 'status', label: 'Status', type: 'text' },
    { field: 'description', label: 'Description', type: 'markdown' },
  ],

  fieldMappings: [
    {
      taskField: 'title',
      issueField: 'summary',
      defaultDirection: 'both',
      toIssueValue: (
        taskValue: unknown,
        _ctx: { issueId: string; issueNumber?: number },
      ): string => {
        // Done marker logic handled separately via isDone push
        return (taskValue as string) ?? '';
      },
      toTaskValue: (
        issueValue: unknown,
        _ctx: { issueId: string; issueNumber?: number },
      ): string => {
        const val = issueValue as string;
        // Strip done marker if present (from config or default [DONE])
        if (val && val.startsWith('[DONE] ')) {
          return val.slice(7);
        }
        return val || '(No title)';
      },
    },
    {
      taskField: 'notes',
      issueField: 'description',
      defaultDirection: 'both',
      toIssueValue: (taskValue: unknown): string => (taskValue as string) || '',
      toTaskValue: (issueValue: unknown): string => (issueValue as string) || '',
    },
    {
      taskField: 'dueWithTime',
      issueField: 'start_dateTime',
      defaultDirection: 'both',
      mutuallyExclusive: ['dueDay'],
      toIssueValue: (taskValue: unknown): string | null => {
        if (!taskValue) return null;
        return toUTCISO(taskValue as number);
      },
      toTaskValue: (issueValue: unknown): number | undefined => {
        if (!issueValue) return undefined;
        return new Date(issueValue as string).getTime();
      },
    },
    {
      taskField: 'timeEstimate',
      issueField: 'duration_ms',
      defaultDirection: 'both',
      toIssueValue: (taskValue: unknown): number => (taskValue as number) || 0,
      toTaskValue: (issueValue: unknown): number => (issueValue as number) || 0,
    },
    {
      taskField: 'dueDay',
      issueField: 'start_date',
      defaultDirection: 'both',
      mutuallyExclusive: ['dueWithTime'],
      toIssueValue: (taskValue: unknown): string | null => (taskValue as string) || null,
      toTaskValue: (issueValue: unknown): string | undefined =>
        (issueValue as string) || undefined,
    },
  ] satisfies PluginFieldMapping[],

  async updateIssue(
    id: string,
    changes: Record<string, unknown>,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<void> {
    const cfg = migrateConfig(config);
    const { calendarId, eventId } = parseCompoundId(id, getWriteCalendarId(cfg));
    const patch: Record<string, unknown> = {};

    if (changes.summary !== undefined) {
      patch.summary = changes.summary;
    }
    if (changes.description !== undefined) {
      patch.description = changes.description;
    }

    // Handle timed event updates
    // Null out `date` so Google Calendar PATCH doesn't merge both fields
    if (changes.start_dateTime !== undefined) {
      if (changes.start_dateTime === null) {
        // Task was unscheduled - convert timed event to all-day event for today
        const today = new Date();
        const todayStr = formatYMD(today);
        const tmrw = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
        const tmrwStr = formatYMD(tmrw);
        patch.start = { date: todayStr, dateTime: null };
        patch.end = { date: tmrwStr, dateTime: null };
      } else {
        patch.start = { dateTime: changes.start_dateTime, date: null };
        const durationMs = (changes.duration_ms as number) || 30 * 60 * 1000;
        const endMs = new Date(changes.start_dateTime as string).getTime() + durationMs;
        patch.end = { dateTime: toUTCISO(endMs), date: null };
      }
    } else if (changes.duration_ms !== undefined) {
      // Duration changed but start didn't - fetch current start
      const current = await http.get<GoogleCalendarEvent>(eventUrl(calendarId, eventId));
      if (current.start?.dateTime) {
        const endMs =
          new Date(current.start.dateTime).getTime() + (changes.duration_ms as number);
        patch.end = { dateTime: toUTCISO(endMs), date: null };
      }
    }

    // Handle all-day event updates
    // Null out `dateTime` so Google Calendar PATCH doesn't merge both fields
    if (changes.start_date !== undefined) {
      if (changes.start_date === null) {
        // dueDay cleared - convert to timed event (keep current time or use now)
        // Since we don't know what time to use, just skip the patch
        // The user likely set dueWithTime instead (mutually exclusive)
      } else {
        patch.start = { date: changes.start_date, dateTime: null };
        const startDate = new Date(changes.start_date + 'T00:00:00');
        const endDate = new Date(
          startDate.getFullYear(),
          startDate.getMonth(),
          startDate.getDate() + 1,
        );
        patch.end = { date: formatYMD(endDate), dateTime: null };
      }
    }

    if (Object.keys(patch).length > 0) {
      await http.patch(eventUrl(calendarId, eventId), patch);
    }
  },

  extractSyncValues(issue: PluginIssue): Record<string, unknown> {
    const raw = issue as Record<string, unknown>;
    const startObj = raw.start as Record<string, unknown> | undefined;
    const endObj = raw.end as Record<string, unknown> | undefined;
    const startDateTime = startObj?.dateTime as string | undefined;
    const endDateTime = endObj?.dateTime as string | undefined;
    const startDate = startObj?.date as string | undefined;

    // Normalize to UTC ISO to avoid timezone format mismatches
    // (Google may return "+01:00" but we send ".000Z")
    const normalizedStart = startDateTime
      ? new Date(startDateTime).toISOString()
      : undefined;
    const normalizedEnd = endDateTime ? new Date(endDateTime).toISOString() : undefined;

    return {
      summary: issue.title || '',
      description: issue.body || '',
      start_dateTime: normalizedStart,
      start_date: startDate || undefined,
      duration_ms:
        normalizedStart && normalizedEnd
          ? new Date(normalizedEnd).getTime() - new Date(normalizedStart).getTime()
          : 0,
    };
  },

  async createIssue(title: string, config: Record<string, unknown>, http: PluginHttp) {
    const cfg = migrateConfig(config);
    const calendarId = getWriteCalendarId(cfg);

    // Create as all-day event for today; _pushInitialValues will
    // convert to a timed event if the task has dueWithTime set.
    // Use local date (not UTC) to avoid date shift near midnight.
    const now = new Date();
    const today = formatYMD(now);
    const tmrw = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const tomorrow = formatYMD(tmrw);

    const event = await http.post<GoogleCalendarEvent>(eventUrl(calendarId), {
      summary: title,
      start: { date: today },
      end: { date: tomorrow },
    });

    return {
      issueId: toCompoundId(calendarId, event.id),
      issueData: {
        id: toCompoundId(calendarId, event.id),
        title: event.summary || title,
        body: event.description || '',
        state: event.status || 'confirmed',
        summary: event.summary,
        start: event.start,
        end: event.end,
        startFormatted: formatEventTime(event.start),
        endFormatted: formatEventTime(event.end),
        status: event.status,
        description: event.description,
      },
    };
  },

  deletedStates: ['cancelled'],

  timeBlock: {
    async upsertEvent(
      taskId: string,
      eventData: {
        title: string;
        dueWithTime: number;
        durationMs: number;
        isDone: boolean;
      },
      config: Record<string, unknown>,
      http: PluginHttp,
    ): Promise<void> {
      const cfg = migrateConfig(config);
      const calendarId = getTimeBlockCalendarId(cfg);
      const gcalEventId = taskIdToGcalEventId(taskId);
      const summary = eventData.isDone ? `[DONE] ${eventData.title}` : eventData.title;
      const body = {
        id: gcalEventId,
        summary,
        start: { dateTime: toUTCISO(eventData.dueWithTime) },
        end: { dateTime: toUTCISO(eventData.dueWithTime + eventData.durationMs) },
        extendedProperties: { private: { spTaskId: taskId } },
      };

      try {
        await http.post(eventUrl(calendarId), body);
      } catch (err: unknown) {
        if (isHttpStatus(err, 409)) {
          await http.patch(eventUrl(calendarId, gcalEventId), {
            summary: body.summary,
            start: body.start,
            end: body.end,
          });
        } else {
          throw err;
        }
      }
    },

    async deleteEvent(
      taskId: string,
      config: Record<string, unknown>,
      http: PluginHttp,
    ): Promise<void> {
      const cfg = migrateConfig(config);
      const calendarId = getTimeBlockCalendarId(cfg);
      const gcalEventId = taskIdToGcalEventId(taskId);
      try {
        await http.delete(eventUrl(calendarId, gcalEventId));
      } catch (err: unknown) {
        if (!isHttpStatus(err, 404)) throw err;
      }
    },
  },

  async deleteIssue(
    id: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<void> {
    const cfg = migrateConfig(config);
    const { calendarId, eventId } = parseCompoundId(id, getWriteCalendarId(cfg));
    await http.delete(eventUrl(calendarId, eventId));
  },
});
