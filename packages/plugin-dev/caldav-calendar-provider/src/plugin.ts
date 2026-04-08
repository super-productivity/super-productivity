import type {
  IssueProviderPluginDefinition,
  PluginFieldMapping,
  PluginHttp,
  PluginIssue,
  PluginSearchResult,
} from '@super-productivity/plugin-api';

declare const PluginAPI: {
  registerIssueProvider(definition: IssueProviderPluginDefinition): void;
};

// --- Config ---

interface CaldavCalendarConfig {
  serverUrl?: string;
  username?: string;
  password?: string;
  readCalendarIds?: string[];
  writeCalendarId?: string;
  syncRangeWeeks?: string;
  isAutoTimeBlock?: boolean;
  timeBlockCalendarId?: string;
}

const getWriteCalendarId = (cfg: CaldavCalendarConfig): string =>
  cfg.writeCalendarId || '';

const getTimeBlockCalendarId = (cfg: CaldavCalendarConfig): string =>
  cfg.timeBlockCalendarId || getWriteCalendarId(cfg);

const getReadCalendarIds = (cfg: CaldavCalendarConfig): string[] =>
  cfg.readCalendarIds?.length ? cfg.readCalendarIds : [];

const getServerUrl = (cfg: CaldavCalendarConfig): string => {
  let url = cfg.serverUrl || '';
  if (url.endsWith('/')) url = url.slice(0, -1);
  return url;
};

// --- Compound IDs ---
// With multiple read calendars, CRUD methods need to know which calendar
// an event belongs to. Format: "calendarHref::eventHref"

const COMPOUND_SEP = '::';

const toCompoundId = (calendarHref: string, eventHref: string): string =>
  `${calendarHref}${COMPOUND_SEP}${eventHref}`;

const parseCompoundId = (
  id: string,
  fallbackCalendarHref: string,
): { calendarHref: string; eventHref: string } => {
  const sep = id.indexOf(COMPOUND_SEP);
  if (sep === -1) return { calendarHref: fallbackCalendarHref, eventHref: id };
  return {
    calendarHref: id.slice(0, sep),
    eventHref: id.slice(sep + COMPOUND_SEP.length),
  };
};

// --- iCal Helpers ---

/** Unfold iCal line continuations (RFC 5545 Section 3.1) */
const unfoldIcal = (data: string): string =>
  data.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');

/** Escape text for iCal property values (RFC 5545 Section 3.3.11) */
const escapeIcalText = (text: string): string =>
  text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n/g, '\\n')
    .replace(/\r/g, '\\n')
    .replace(/\n/g, '\\n');

/** Unescape iCal property values */
const unescapeIcalText = (text: string): string =>
  text
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\{2}/g, '\\');

/** Fold long iCal lines at 75 octets (RFC 5545 Section 3.1) */
const _encoder = new TextEncoder();
const _decoder = new TextDecoder();
const foldIcalLine = (line: string): string => {
  const bytes = _encoder.encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let byteOffset = 0;
  let isFirst = true;
  while (byteOffset < bytes.length) {
    const maxBytes = isFirst ? 75 : 74;
    let end = Math.min(byteOffset + maxBytes, bytes.length);
    // Don't split in the middle of a multi-byte UTF-8 sequence
    while (end > byteOffset && (bytes[end] & 0xc0) === 0x80) end--;
    if (end === byteOffset) end = byteOffset + 1;
    parts.push(_decoder.decode(bytes.slice(byteOffset, end)));
    byteOffset = end;
    isFirst = false;
  }
  return parts.join('\r\n ');
};

interface ParsedVEvent {
  uid: string;
  summary: string;
  description: string;
  dtstart: string;
  dtend: string;
  dtstartParams: string;
  dtendParams: string;
  duration: string;
  status: string;
  lastModified: string;
  etag: string;
}

/** Extract a property value from unfolded iCal lines */
const getIcalProp = (lines: string[], name: string): string => {
  const prefix1 = name + ':';
  const prefix2 = name + ';';
  for (const line of lines) {
    if (line.startsWith(prefix1)) return line.slice(prefix1.length);
    if (line.startsWith(prefix2)) {
      const colonIdx = line.indexOf(':');
      if (colonIdx !== -1) return line.slice(colonIdx + 1);
    }
  }
  return '';
};

/** Extract property parameters (e.g. TZID=America/New_York) */
const getIcalPropParams = (lines: string[], name: string): string => {
  const prefix = name + ';';
  for (const line of lines) {
    if (line.startsWith(prefix)) {
      const colonIdx = line.indexOf(':');
      if (colonIdx !== -1) return line.slice(prefix.length, colonIdx);
    }
  }
  return '';
};

/**
 * Parse iCal date/time value to a JS Date.
 * Handles: 20260320T100000Z (UTC), 20260320T100000 (floating/local),
 *          TZID=America/New_York:20260320T100000 (timezone — treated as local),
 *          20260320 (date-only, VALUE=DATE).
 */
const parseIcalDateTime = (value: string, params: string): Date | null => {
  if (!value) return null;
  // Date-only: YYYYMMDD
  if (value.length === 8) {
    const y = parseInt(value.slice(0, 4), 10);
    const m = parseInt(value.slice(4, 6), 10) - 1;
    const d = parseInt(value.slice(6, 8), 10);
    const date = new Date(y, m, d);
    return isNaN(date.getTime()) ? null : date;
  }
  // DateTime: YYYYMMDDTHHmmss or YYYYMMDDTHHmmssZ
  const y = parseInt(value.slice(0, 4), 10);
  const m = parseInt(value.slice(4, 6), 10) - 1;
  const d = parseInt(value.slice(6, 8), 10);
  const h = parseInt(value.slice(9, 11), 10);
  const min = parseInt(value.slice(11, 13), 10);
  const s = parseInt(value.slice(13, 15), 10);
  if (value.endsWith('Z')) {
    const date = new Date(Date.UTC(y, m, d, h, min, s));
    return isNaN(date.getTime()) ? null : date;
  }
  // Try to resolve TZID via Intl API.
  // Uses formatToParts to extract timezone-shifted components without
  // local-timezone contamination from Date string parsing.
  const tzidMatch = params.match(/TZID=([^;:]+)/);
  if (tzidMatch) {
    try {
      const utcMs = Date.UTC(y, m, d, h, min, s);
      const utcDate = new Date(utcMs);
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: tzidMatch[1],
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false,
      });
      const parts = fmt.formatToParts(utcDate);
      const g = (t: string): number =>
        parseInt(parts.find((p) => p.type === t)?.value || '0', 10);
      const inTzMs = Date.UTC(
        g('year'),
        g('month') - 1,
        g('day'),
        g('hour'),
        g('minute'),
        g('second'),
      );
      const offset = inTzMs - utcMs;
      const result = new Date(utcMs - offset);
      if (!isNaN(result.getTime())) return result;
    } catch {
      // Unknown TZID — fall through to local time
    }
  }
  const date = new Date(y, m, d, h, min, s);
  return isNaN(date.getTime()) ? null : date;
};

/** Check if a DTSTART is a date-only value (VALUE=DATE) */
const isDateOnly = (value: string, params: string): boolean =>
  value.length === 8 || params.includes('VALUE=DATE');

/**
 * Parse iCal DURATION (RFC 5545 Section 3.3.6) to milliseconds.
 * Examples: PT1H, PT30M, PT1H30M, P1D, P1DT2H30M
 */
const parseDuration = (dur: string): number => {
  if (!dur) return 0;
  const sign = dur.startsWith('-') ? -1 : 1;
  let ms = 0;
  const dayMatch = dur.match(/(\d+)D/);
  const hourMatch = dur.match(/(\d+)H/);
  const minMatch = dur.match(/(\d+)M/);
  const secMatch = dur.match(/(\d+)S/);
  const weekMatch = dur.match(/(\d+)W/);
  if (weekMatch) ms += parseInt(weekMatch[1], 10) * 7 * 24 * 60 * 60 * 1000;
  if (dayMatch) ms += parseInt(dayMatch[1], 10) * 24 * 60 * 60 * 1000;
  if (hourMatch) ms += parseInt(hourMatch[1], 10) * 60 * 60 * 1000;
  if (minMatch) ms += parseInt(minMatch[1], 10) * 60 * 1000;
  if (secMatch) ms += parseInt(secMatch[1], 10) * 1000;
  return sign * ms;
};

/** Format a Date as iCal UTC datetime: YYYYMMDDTHHmmssZ */
const toIcalUtcDateTime = (date: Date): string => {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
};

/** Format a Date as iCal date-only: YYYYMMDD */
const toIcalDate = (date: Date): string => {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
};

/** Format a timestamp as UTC ISO 8601 */
const toUTCISO = (timestamp: number): string => new Date(timestamp).toISOString();

/** Parse VEVENT blocks from unfolded iCal data */
const parseVEvents = (icalData: string): ParsedVEvent[] => {
  const unfolded = unfoldIcal(icalData);
  const events: ParsedVEvent[] = [];
  let pos = 0;
  while (true) {
    const start = unfolded.indexOf('BEGIN:VEVENT', pos);
    if (start === -1) break;
    const end = unfolded.indexOf('END:VEVENT', start);
    if (end === -1) break;
    const block = unfolded.slice(start, end + 'END:VEVENT'.length);
    const lines = block.split(/\r?\n/).filter((l) => l.length > 0);
    const dtstartRaw = getIcalProp(lines, 'DTSTART');
    const dtendRaw = getIcalProp(lines, 'DTEND');
    events.push({
      uid: getIcalProp(lines, 'UID'),
      summary: unescapeIcalText(getIcalProp(lines, 'SUMMARY')),
      description: unescapeIcalText(getIcalProp(lines, 'DESCRIPTION')),
      dtstart: dtstartRaw,
      dtend: dtendRaw,
      dtstartParams: getIcalPropParams(lines, 'DTSTART'),
      dtendParams: getIcalPropParams(lines, 'DTEND'),
      duration: getIcalProp(lines, 'DURATION'),
      status: getIcalProp(lines, 'STATUS'),
      lastModified: getIcalProp(lines, 'LAST-MODIFIED'),
      etag: '',
    });
    pos = end + 'END:VEVENT'.length;
  }
  return events;
};

/** Build a full iCalendar string for a VEVENT */
const buildICalEvent = (event: {
  uid: string;
  summary: string;
  description?: string;
  dtstart: string;
  dtstartParam?: string;
  dtend?: string;
  dtendParam?: string;
  status?: string;
}): string => {
  const now = toIcalUtcDateTime(new Date());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Super Productivity//CalDAV Plugin//EN',
    'BEGIN:VEVENT',
    foldIcalLine(`UID:${event.uid}`),
    `DTSTAMP:${now}`,
  ];
  if (event.dtstartParam) {
    lines.push(foldIcalLine(`DTSTART;${event.dtstartParam}:${event.dtstart}`));
  } else {
    lines.push(foldIcalLine(`DTSTART:${event.dtstart}`));
  }
  if (event.dtend) {
    if (event.dtendParam) {
      lines.push(foldIcalLine(`DTEND;${event.dtendParam}:${event.dtend}`));
    } else {
      lines.push(foldIcalLine(`DTEND:${event.dtend}`));
    }
  }
  lines.push(foldIcalLine(`SUMMARY:${escapeIcalText(event.summary)}`));
  if (event.description) {
    lines.push(foldIcalLine(`DESCRIPTION:${escapeIcalText(event.description)}`));
  }
  if (event.status) {
    lines.push(`STATUS:${event.status}`);
  }
  lines.push(`LAST-MODIFIED:${now}`);
  lines.push('END:VEVENT');
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
};

/**
 * Modify specific properties in an existing iCal string.
 * Uses line-based replacement matching on base property name (before ';' or ':')
 * to correctly handle property parameter changes (e.g. DTSTART → DTSTART;VALUE=DATE).
 */
const modifyICalEvent = (icalData: string, changes: Record<string, string>): string => {
  const lines = unfoldIcal(icalData).split(/\r?\n/);
  const now = toIcalUtcDateTime(new Date());

  // Index changes by base property name (e.g. "DTSTART;VALUE=DATE" → "DTSTART")
  const changesByBase = new Map<string, string>();
  for (const [prop, value] of Object.entries(changes)) {
    const baseName = prop.split(/[;:]/)[0];
    changesByBase.set(baseName, foldIcalLine(`${prop}:${value}`));
  }

  // RFC 5545: DTEND and DURATION are mutually exclusive.
  // When setting DTEND, strip existing DURATION (and vice versa).
  const stripProps = new Set<string>();
  if (changesByBase.has('DTEND')) stripProps.add('DURATION');
  if (changesByBase.has('DURATION')) stripProps.add('DTEND');

  const replaced = new Set<string>();
  const result: string[] = [];
  let seqBumped = false;
  let inVevent = false;

  for (const line of lines) {
    const baseName = line.split(/[;:]/)[0];

    if (line === 'BEGIN:VEVENT') inVevent = true;
    if (line === 'END:VEVENT') inVevent = false;

    // Only modify properties inside the VEVENT block to avoid
    // corrupting VTIMEZONE or other component blocks.
    if (!inVevent) {
      result.push(line);
      continue;
    }

    if (stripProps.has(baseName)) continue;

    if (changesByBase.has(baseName) && !replaced.has(baseName)) {
      result.push(changesByBase.get(baseName)!);
      replaced.add(baseName);
      continue;
    } else if (changesByBase.has(baseName)) {
      // Skip duplicate old lines
      continue;
    }

    if (baseName === 'LAST-MODIFIED' || baseName === 'DTSTAMP') {
      result.push(`${baseName}:${now}`);
      continue;
    }
    if (baseName === 'SEQUENCE') {
      const seq = parseInt(line.split(':')[1] || '0', 10) + 1;
      result.push(`SEQUENCE:${seq}`);
      seqBumped = true;
      continue;
    }
    result.push(line);
  }

  // Insert any changes that didn't replace existing lines
  const endIdx = result.findIndex((l) => l === 'END:VEVENT');
  if (endIdx !== -1) {
    const toInsert: string[] = [];
    for (const [baseName, newLine] of changesByBase) {
      if (!replaced.has(baseName)) toInsert.push(newLine);
    }
    if (!seqBumped) toInsert.push('SEQUENCE:1');
    result.splice(endIdx, 0, ...toInsert);
  }

  return result.join('\r\n') + '\r\n';
};

// --- XML Helpers ---

const DAV_NS = 'DAV:';
const CALDAV_NS = 'urn:ietf:params:xml:ns:caldav';
const CS_NS = 'http://calendarserver.org/ns/';

/** Build PROPFIND body for calendar discovery */
const buildPropfindBody = (): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:cs="${CS_NS}" xmlns:c="${CALDAV_NS}">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <cs:getctag/>
    <c:supported-calendar-component-set/>
  </d:prop>
</d:propfind>`;

/** Build REPORT body for time-range event query */
const buildCalendarQueryBody = (start: string, end: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="${CALDAV_NS}">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${start}" end="${end}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

/** Get text content from an XML element, searching by local name across namespaces */
const getXmlText = (parent: Element, localName: string): string => {
  // Try known namespaces
  for (const ns of [DAV_NS, CALDAV_NS, CS_NS]) {
    const el = parent.getElementsByTagNameNS(ns, localName)[0];
    if (el?.textContent) return el.textContent;
  }
  // Fallback: search by local name
  const all = parent.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === localName && all[i].textContent) {
      return all[i].textContent!;
    }
  }
  return '';
};

/** Check if element has a child element with given local name */
const hasXmlChild = (parent: Element, localName: string): boolean => {
  const all = parent.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === localName) return true;
  }
  return false;
};

interface CalendarInfo {
  href: string;
  displayName: string;
  supportsVevent: boolean;
}

/** Parse PROPFIND multistatus response for calendar discovery */
const parseCalendarList = (xml: string): CalendarInfo[] => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  const parseErr = doc.querySelector('parsererror');
  if (parseErr) {
    throw new Error('[CalDAV] Failed to parse XML response: ' + parseErr.textContent);
  }
  const responses = doc.getElementsByTagNameNS(DAV_NS, 'response');
  const calendars: CalendarInfo[] = [];

  for (let i = 0; i < responses.length; i++) {
    const resp = responses[i];
    const href = getXmlText(resp, 'href');
    if (!href) continue;

    // Check if this is a calendar resource
    const resourceType = resp.getElementsByTagNameNS(DAV_NS, 'resourcetype')[0];
    if (!resourceType) continue;
    const isCalendar = hasXmlChild(resourceType, 'calendar');
    if (!isCalendar) continue;

    const displayName =
      getXmlText(resp, 'displayname') || href.split('/').filter(Boolean).pop() || href;

    // Check supported components
    let supportsVevent = true; // Default to true if not specified
    const compSet = resp.getElementsByTagNameNS(
      CALDAV_NS,
      'supported-calendar-component-set',
    )[0];
    if (compSet) {
      const comps = compSet.getElementsByTagNameNS(CALDAV_NS, 'comp');
      if (comps.length > 0) {
        supportsVevent = false;
        for (let j = 0; j < comps.length; j++) {
          if (comps[j].getAttribute('name') === 'VEVENT') {
            supportsVevent = true;
            break;
          }
        }
      }
    }

    calendars.push({ href, displayName, supportsVevent });
  }

  return calendars;
};

interface CalendarEventResponse {
  href: string;
  etag: string;
  calendarData: string;
}

/** Parse REPORT multistatus response for calendar events */
const parseEventResponses = (xml: string): CalendarEventResponse[] => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  const parseErr = doc.querySelector('parsererror');
  if (parseErr) {
    throw new Error('[CalDAV] Failed to parse XML response: ' + parseErr.textContent);
  }
  const responses = doc.getElementsByTagNameNS(DAV_NS, 'response');
  const events: CalendarEventResponse[] = [];

  for (let i = 0; i < responses.length; i++) {
    const resp = responses[i];
    const rawHref = getXmlText(resp, 'href');
    const etag = getXmlText(resp, 'getetag').replace(/"/g, '');
    const calendarData = getXmlText(resp, 'calendar-data');
    if (rawHref && calendarData) {
      // Normalize href to pathname so IDs are consistent with createIssue
      const href =
        rawHref.startsWith('http://') || rawHref.startsWith('https://')
          ? new URL(rawHref).pathname
          : rawHref;
      events.push({ href, etag, calendarData });
    }
  }

  return events;
};

// --- CalDAV Operations ---

/** Resolve the base URL for PROPFIND. Appends trailing slash if missing. */
const ensureTrailingSlash = (url: string): string =>
  url.endsWith('/') ? url : url + '/';

const caldavHeaders = (extra?: Record<string, string>): Record<string, string> => ({
  'Content-Type': 'application/xml; charset=utf-8',
  ...extra,
});

/** Resolve a relative href to a full URL using the server origin */
const resolveHref = (cfg: CaldavCalendarConfig, href: string): string => {
  const serverOrigin = new URL(getServerUrl(cfg)).origin;
  if (href.startsWith('http://') || href.startsWith('https://')) {
    if (new URL(href).origin !== serverOrigin) {
      throw new Error(`[CalDAV] Refusing cross-origin href: ${href}`);
    }
    return href;
  }
  return serverOrigin + href;
};

/** Discover calendars supporting VEVENT via PROPFIND */
const discoverCalendars = async (
  http: PluginHttp,
  cfg: CaldavCalendarConfig,
): Promise<{ label: string; value: string }[]> => {
  const url = ensureTrailingSlash(getServerUrl(cfg));
  const xml = await http.request<string>('PROPFIND', url, buildPropfindBody(), {
    headers: { ...caldavHeaders(), Depth: '1' },
    responseType: 'text',
  });
  return parseCalendarList(xml)
    .filter((c) => c.supportsVevent)
    .map((c) => ({
      label: c.displayName,
      value: c.href,
    }));
};

/** Map a parsed VEVENT to a PluginSearchResult.
 * eventHref is the actual resource href from the CalDAV REPORT response. */
const mapEventToSearchResult = (
  event: ParsedVEvent,
  calendarHref: string,
  eventHref: string,
): PluginSearchResult => {
  const startDate = parseIcalDateTime(event.dtstart, event.dtstartParams);
  const endDate = parseIcalDateTime(event.dtend, event.dtendParams);
  const allDay = isDateOnly(event.dtstart, event.dtstartParams);
  const startMs = startDate?.getTime();
  const endMs = endDate?.getTime();

  let duration = 0;
  if (event.duration) {
    duration = parseDuration(event.duration);
  } else if (startMs && endMs) {
    duration = endMs - startMs;
  } else if (allDay) {
    duration = 24 * 60 * 60 * 1000;
  }

  return {
    id: toCompoundId(calendarHref, eventHref),
    title: event.summary || '(No title)',
    status: event.status || 'CONFIRMED',
    start: startMs,
    dueWithTime: allDay ? undefined : startMs,
    duration,
    isAllDay: allDay,
    description: event.description,
  };
};

/** Fetch events from a single calendar via REPORT */
const fetchEventsForCalendar = async (
  http: PluginHttp,
  calendarHref: string,
  cfg: CaldavCalendarConfig,
): Promise<PluginSearchResult[]> => {
  const syncRangeWeeks = Math.max(parseInt(cfg.syncRangeWeeks || '', 10) || 2, 1);
  const now = new Date();
  const start = toIcalUtcDateTime(now);
  const end = toIcalUtcDateTime(
    new Date(now.getTime() + syncRangeWeeks * 7 * 24 * 60 * 60 * 1000),
  );

  const calUrl = resolveHref(cfg, calendarHref);
  const xml = await http.request<string>(
    'REPORT',
    calUrl,
    buildCalendarQueryBody(start, end),
    {
      headers: { ...caldavHeaders(), Depth: '1' },
      responseType: 'text',
    },
  );

  const responses = parseEventResponses(xml);
  return responses.flatMap((r) => {
    const events = parseVEvents(r.calendarData);
    return events
      .filter((e) => e.status !== 'CANCELLED')
      .map((e) => mapEventToSearchResult(e, calendarHref, r.href));
  });
};

/** Fetch events from all read calendars, merged and sorted by start time */
const fetchEvents = async (
  http: PluginHttp,
  cfg: CaldavCalendarConfig,
  opts?: { maxResults?: number },
): Promise<PluginSearchResult[]> => {
  const calendarIds = getReadCalendarIds(cfg);
  if (calendarIds.length === 0) return [];
  const results = await Promise.all(
    calendarIds.map((calId) => fetchEventsForCalendar(http, calId, cfg)),
  );
  let merged = results.flat().sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  if (opts?.maxResults) {
    merged = merged.slice(0, opts.maxResults);
  }
  return merged;
};

/** Build a new event URL from calendar href and UID (for creating new events) */
const buildNewEventUrl = (
  cfg: CaldavCalendarConfig,
  calendarHref: string,
  uid: string,
): string => {
  const calUrl = ensureTrailingSlash(resolveHref(cfg, calendarHref));
  return calUrl + encodeURIComponent(uid) + '.ics';
};

/** Derive a deterministic CalDAV UID from a task ID.
 * CalDAV UIDs are opaque strings with no charset restriction (unlike Google Calendar). */
const taskIdToCaldavUid = (taskId: string): string => `sp-${taskId}@super-productivity`;

const isHttpStatus = (err: unknown, status: number): boolean =>
  typeof err === 'object' &&
  err !== null &&
  'status' in err &&
  (err as { status: number }).status === status;

// --- Load calendars for config dropdowns ---

const loadCalendars = async (
  config: Record<string, unknown>,
  http: PluginHttp,
): Promise<{ label: string; value: string }[]> => {
  const cfg = config as unknown as CaldavCalendarConfig;
  if (!cfg.serverUrl || !cfg.username || !cfg.password) return [];
  return discoverCalendars(http, cfg);
};

// --- Plugin registration ---

PluginAPI.registerIssueProvider({
  configFields: [
    {
      key: 'serverUrl',
      type: 'input' as const,
      label: 'CalDAV server URL',
      description:
        'The CalDAV endpoint URL (e.g. https://cloud.example.com/remote.php/dav/calendars/username/)',
      required: true,
    },
    {
      key: 'username',
      type: 'input' as const,
      label: 'Username',
      required: true,
    },
    {
      key: 'password',
      type: 'password' as const,
      label: 'Password',
      required: true,
    },
    {
      key: 'readCalendarIds',
      type: 'multiSelect' as const,
      label: 'Calendars to display',
      description: 'Select which calendars to show in planner and schedule views.',
      options: [],
      loadOptions: loadCalendars,
    },
    {
      key: 'writeCalendarId',
      type: 'select' as const,
      label: 'Default calendar for new events',
      description: 'Used when creating or rescheduling events directly from the planner.',
      options: [],
      loadOptions: loadCalendars,
    },
    {
      key: 'syncRangeWeeks',
      type: 'input' as const,
      label: 'Sync range (weeks)',
      description: 'How many weeks ahead to sync events. Defaults to 2.',
      required: false,
      pattern: '^[0-9]*$',
    },
    {
      key: 'isAutoTimeBlock',
      type: 'checkbox' as const,
      label: 'Auto time blocking',
      description:
        'When you schedule a task to a specific time, automatically create a matching event in the CalDAV calendar. Rescheduling, completing, or deleting the task updates the event.',
    },
    {
      key: 'timeBlockCalendarId',
      type: 'select' as const,
      label: 'Time block calendar',
      description:
        'Which calendar to create time block events in. Use "Load Calendars" above to populate this list.',
      required: false,
      showIf: 'isAutoTimeBlock',
      options: [],
      loadOptions: loadCalendars,
    },
  ],

  getHeaders(config: Record<string, unknown>): Record<string, string> {
    const cfg = config as unknown as CaldavCalendarConfig;
    if (!cfg.username || !cfg.password) {
      return {};
    }
    // Use TextEncoder for UTF-8 safe Base64 encoding (btoa only supports Latin1)
    const credentials = new TextEncoder().encode(cfg.username + ':' + cfg.password);
    const base64 = btoa(Array.from(credentials, (b) => String.fromCharCode(b)).join(''));
    return { Authorization: 'Basic ' + base64 };
  },

  async searchIssues(
    searchTerm: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    const cfg = config as unknown as CaldavCalendarConfig;
    const events = await fetchEvents(http, cfg);
    const term = searchTerm.toLowerCase();
    return events.filter(
      (e) =>
        e.title.toLowerCase().includes(term) ||
        (e.description && e.description.toLowerCase().includes(term)),
    );
  },

  async getById(
    issueId: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginIssue> {
    const cfg = config as unknown as CaldavCalendarConfig;
    const { eventHref } = parseCompoundId(issueId, getWriteCalendarId(cfg));
    const eventUrl = resolveHref(cfg, eventHref);
    const icalData = await http.get<string>(eventUrl, { responseType: 'text' });
    const events = parseVEvents(icalData);
    const event = events[0];
    if (!event) {
      throw new Error('Event not found: ' + eventHref);
    }

    const startDate = parseIcalDateTime(event.dtstart, event.dtstartParams);
    const endDate = parseIcalDateTime(event.dtend, event.dtendParams);

    return {
      id: issueId,
      title: event.summary || '(No title)',
      body: event.description || '',
      state: event.status || 'CONFIRMED',
      lastUpdated: event.lastModified
        ? parseIcalDateTime(event.lastModified, '')?.getTime()
        : undefined,
      summary: event.summary || '(No title)',
      start: event.dtstart,
      end: event.dtend,
      startParams: event.dtstartParams,
      endParams: event.dtendParams,
      startFormatted: startDate?.toLocaleString() || '',
      endFormatted: endDate?.toLocaleString() || '',
      status: event.status,
      description: event.description,
      duration: event.duration,
    };
  },

  getIssueLink(issueId: string, config: Record<string, unknown>): string {
    const cfg = config as unknown as CaldavCalendarConfig;
    const { eventHref } = parseCompoundId(issueId, getWriteCalendarId(cfg));
    return resolveHref(cfg, eventHref);
  },

  async testConnection(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<boolean> {
    const cfg = config as unknown as CaldavCalendarConfig;
    try {
      const url = ensureTrailingSlash(getServerUrl(cfg));
      await http.request<string>('PROPFIND', url, buildPropfindBody(), {
        headers: { ...caldavHeaders(), Depth: '0' },
        responseType: 'text',
      });
      return true;
    } catch {
      return false;
    }
  },

  async getNewIssuesForBacklog(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    const cfg = config as unknown as CaldavCalendarConfig;
    return fetchEvents(http, cfg, { maxResults: 100 });
  },

  issueDisplay: [
    { field: 'summary', label: 'Title', type: 'text' },
    { field: 'startFormatted', label: 'Start', type: 'text' },
    { field: 'endFormatted', label: 'End', type: 'text' },
    { field: 'status', label: 'Status', type: 'text' },
    { field: 'description', label: 'Description', type: 'text' },
  ],

  fieldMappings: [
    {
      taskField: 'title',
      issueField: 'summary',
      defaultDirection: 'both',
      toIssueValue: (taskValue: unknown): string => (taskValue as string) ?? '',
      toTaskValue: (issueValue: unknown): string => {
        const val = issueValue as string;
        if (val && val.startsWith('[DONE] ')) return val.slice(7);
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
    const cfg = config as unknown as CaldavCalendarConfig;
    const { eventHref } = parseCompoundId(id, getWriteCalendarId(cfg));
    const eventUrl = resolveHref(cfg, eventHref);

    // Fetch current iCal data
    const currentIcal = await http.get<string>(eventUrl, { responseType: 'text' });
    // Try to get etag from a HEAD-like approach — we'll use If-Match: * as fallback
    // The etag was in the REPORT response, but we don't have it here.
    // Use * to indicate we want to update regardless.

    const icalChanges: Record<string, string> = {};

    if (changes.summary !== undefined) {
      icalChanges['SUMMARY'] = escapeIcalText(changes.summary as string);
    }
    if (changes.description !== undefined) {
      icalChanges['DESCRIPTION'] = escapeIcalText((changes.description as string) || '');
    }

    // Handle timed event updates
    if (changes.start_dateTime !== undefined) {
      if (changes.start_dateTime === null) {
        // Unscheduled — convert to all-day event for today so the remote
        // event stays in sync and doesn't re-apply the old time on next pull.
        const now = new Date();
        const tmrw = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        icalChanges['DTSTART;VALUE=DATE'] = toIcalDate(now);
        icalChanges['DTEND;VALUE=DATE'] = toIcalDate(tmrw);
      } else {
        const startDate = new Date(changes.start_dateTime as string);
        const durationMs = (changes.duration_ms as number) || 30 * 60 * 1000;
        const endDate = new Date(startDate.getTime() + durationMs);
        icalChanges['DTSTART'] = toIcalUtcDateTime(startDate);
        icalChanges['DTEND'] = toIcalUtcDateTime(endDate);
      }
    } else if (changes.duration_ms !== undefined) {
      // Duration changed but start didn't — parse current start and compute new end
      const currentEvents = parseVEvents(currentIcal);
      const current = currentEvents[0];
      if (current) {
        const startDate = parseIcalDateTime(current.dtstart, current.dtstartParams);
        if (startDate && !isDateOnly(current.dtstart, current.dtstartParams)) {
          const endDate = new Date(startDate.getTime() + (changes.duration_ms as number));
          icalChanges['DTEND'] = toIcalUtcDateTime(endDate);
        }
      }
    }

    // Handle all-day event updates
    if (changes.start_date !== undefined) {
      if (changes.start_date === null) {
        // dueDay cleared — skip (likely dueWithTime set instead)
      } else {
        const dateStr = changes.start_date as string;
        const icalDate = dateStr.replace(/-/g, '');
        const startDate = new Date(dateStr + 'T00:00:00');
        const endDate = new Date(
          startDate.getFullYear(),
          startDate.getMonth(),
          startDate.getDate() + 1,
        );
        icalChanges['DTSTART;VALUE=DATE'] = icalDate;
        icalChanges['DTEND;VALUE=DATE'] = toIcalDate(endDate);
      }
    }

    if (Object.keys(icalChanges).length === 0) return;

    const modifiedIcal = modifyICalEvent(currentIcal, icalChanges);
    await http.put(eventUrl, modifiedIcal, {
      headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
      responseType: 'text',
    });
  },

  extractSyncValues(issue: PluginIssue): Record<string, unknown> {
    const raw = issue as Record<string, unknown>;
    const startRaw = raw.start as string | undefined;
    const endRaw = raw.end as string | undefined;
    const startParams = (raw.startParams as string) || '';
    const durationRaw = raw.duration as string | undefined;

    let startDateTime: string | undefined;
    let startDate: string | undefined;
    let durationMs = 0;

    if (startRaw) {
      const parsed = parseIcalDateTime(startRaw, startParams);
      if (parsed) {
        if (isDateOnly(startRaw, startParams)) {
          // Convert YYYYMMDD to YYYY-MM-DD
          startDate = `${startRaw.slice(0, 4)}-${startRaw.slice(4, 6)}-${startRaw.slice(6, 8)}`;
        } else {
          startDateTime = parsed.toISOString();
        }
      }
    }

    if (durationRaw) {
      durationMs = parseDuration(durationRaw);
    } else if (startDateTime && endRaw) {
      const endParams = (raw.endParams as string) || '';
      const endParsed = parseIcalDateTime(endRaw, endParams);
      if (endParsed) {
        durationMs = endParsed.getTime() - new Date(startDateTime).getTime();
      }
    }

    return {
      summary: issue.title || '',
      description: issue.body || '',
      start_dateTime: startDateTime,
      start_date: startDate,
      duration_ms: durationMs,
    };
  },

  async createIssue(title: string, config: Record<string, unknown>, http: PluginHttp) {
    const cfg = config as unknown as CaldavCalendarConfig;
    const calendarHref = getWriteCalendarId(cfg);
    if (!calendarHref) {
      throw new Error(
        'No write calendar configured. Please select a calendar in the CalDAV settings.',
      );
    }
    const uid = crypto.randomUUID();
    const now = new Date();
    const today = toIcalDate(now);
    const tmrw = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const tomorrow = toIcalDate(tmrw);

    const icalData = buildICalEvent({
      uid,
      summary: title,
      dtstart: today,
      dtstartParam: 'VALUE=DATE',
      dtend: tomorrow,
      dtendParam: 'VALUE=DATE',
    });

    const eventUrl = buildNewEventUrl(cfg, calendarHref, uid);
    await http.put(eventUrl, icalData, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'If-None-Match': '*',
      },
      responseType: 'text',
    });

    // Store the event path (not UID) in the compound ID for later CRUD
    const eventPath = new URL(eventUrl).pathname;
    const compoundId = toCompoundId(calendarHref, eventPath);
    return {
      issueId: compoundId,
      issueData: {
        id: compoundId,
        title,
        body: '',
        state: 'CONFIRMED',
        summary: title,
        start: today,
        end: tomorrow,
        startParams: 'VALUE=DATE',
        endParams: 'VALUE=DATE',
        startFormatted: now.toLocaleDateString(),
        endFormatted: tmrw.toLocaleDateString(),
        status: 'CONFIRMED',
        description: '',
      },
    };
  },

  deletedStates: ['CANCELLED'],

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
      const cfg = config as unknown as CaldavCalendarConfig;
      const calendarHref = getTimeBlockCalendarId(cfg);
      if (!calendarHref) {
        throw new Error(
          'No write calendar configured. Please select a calendar in the CalDAV settings.',
        );
      }
      const uid = taskIdToCaldavUid(taskId);
      const summary = eventData.isDone ? `[DONE] ${eventData.title}` : eventData.title;
      const startDate = new Date(eventData.dueWithTime);
      const endDate = new Date(eventData.dueWithTime + eventData.durationMs);

      const icalData = buildICalEvent({
        uid,
        summary,
        dtstart: toIcalUtcDateTime(startDate),
        dtend: toIcalUtcDateTime(endDate),
      });

      const eventUrl = buildNewEventUrl(cfg, calendarHref, uid);
      // CalDAV PUT is inherently an upsert — creates if absent, replaces if present.
      await http.put(eventUrl, icalData, {
        headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
        responseType: 'text',
      });
    },

    async deleteEvent(
      taskId: string,
      config: Record<string, unknown>,
      http: PluginHttp,
    ): Promise<void> {
      const cfg = config as unknown as CaldavCalendarConfig;
      const calendarHref = getTimeBlockCalendarId(cfg);
      if (!calendarHref) return; // No calendar configured — nothing to delete
      const uid = taskIdToCaldavUid(taskId);
      const eventUrl = buildNewEventUrl(cfg, calendarHref, uid);
      try {
        await http.delete(eventUrl, { responseType: 'text' });
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
    const cfg = config as unknown as CaldavCalendarConfig;
    const { eventHref } = parseCompoundId(id, getWriteCalendarId(cfg));
    const eventUrl = resolveHref(cfg, eventHref);
    await http.delete(eventUrl, { responseType: 'text' });
  },
});
