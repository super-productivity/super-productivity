import { CalendarIntegrationEvent } from '../../calendar-integration/calendar-integration.model';
import { Log } from '../../../core/log';
import { loadIcalModule } from './ical-lazy-loader';

// NOTE: this sucks and is slow, but writing a new ical parser would be very hard... :(

/**
 * Safely extracts a date value from an iCal property and converts it to timestamp.
 * Returns null if the property is missing or invalid.
 */
const safeGetDateTimestamp = (vevent: any, propertyName: string): number | null => {
  try {
    const prop = vevent.getFirstPropertyValue(propertyName);
    if (!prop) {
      return null;
    }
    if (typeof prop.toJSDate !== 'function') {
      return null;
    }
    return prop.toJSDate().getTime();
  } catch (error) {
    return null;
  }
};

/**
 * Checks if the event's DTSTART is a DATE value (all-day event) vs DATE-TIME.
 * In ical.js, ICAL.Time has an `isDate` property that is true for VALUE=DATE.
 */
const isAllDayEvent = (vevent: any): boolean => {
  try {
    const dtstart = vevent.getFirstPropertyValue('dtstart');
    return dtstart?.isDate === true;
  } catch {
    return false;
  }
};

/**
 * Exception event data for RECURRENCE-ID handling
 */
interface ExceptionEvent {
  vevent: any;
  recurrenceId: number;
  isCancelled: boolean;
}

/**
 * Map of UID to exception events for that recurring series
 */
type ExceptionMap = Map<string, ExceptionEvent[]>;

/**
 * Builds a map of exception events (modified/cancelled instances) grouped by UID.
 * Exception events are identified by having a RECURRENCE-ID property.
 */
const buildExceptionMap = (vevents: any[]): ExceptionMap => {
  const exceptionMap: ExceptionMap = new Map();

  for (const ve of vevents) {
    try {
      const recurrenceId = safeGetDateTimestamp(ve, 'recurrence-id');
      if (recurrenceId !== null) {
        const uid = ve.getFirstPropertyValue('uid');
        if (!uid) continue;

        const status = ve.getFirstPropertyValue('status');
        const isCancelled = status?.toUpperCase() === 'CANCELLED';

        if (!exceptionMap.has(uid)) {
          exceptionMap.set(uid, []);
        }

        exceptionMap.get(uid)!.push({
          vevent: ve,
          recurrenceId,
          isCancelled,
        });
      }
    } catch (error) {
      // Skip malformed exception events
      Log.warn('Failed to process exception event:', error);
    }
  }

  return exceptionMap;
};

export const getRelevantEventsForCalendarIntegrationFromIcal = async (
  icalData: string,
  calProviderId: string,
  startTimestamp: number,
  endTimestamp: number,
): Promise<CalendarIntegrationEvent[]> => {
  const ICAL = await loadIcalModule();
  let calendarIntegrationEvents: CalendarIntegrationEvent[] = [];
  const allPossibleFutureEvents = getAllPossibleEventsAfterStartFromIcal(
    ICAL,
    icalData,
    new Date(startTimestamp),
  );

  // Build exception map from all events
  const exceptionMap = buildExceptionMap(allPossibleFutureEvents);
  // Track which recurring series we already processed via their master event
  const processedRecurringUids = new Set<string>();

  allPossibleFutureEvents.forEach((ve) => {
    try {
      const recurrenceId = safeGetDateTimestamp(ve, 'recurrence-id');

      // Skip exception events here - they'll be processed separately
      if (recurrenceId !== null) {
        return;
      }

      if (ve.getFirstPropertyValue('rrule')) {
        const uid = ve.getFirstPropertyValue('uid');
        const exceptions = exceptionMap.get(uid) || [];
        if (uid) {
          processedRecurringUids.add(uid);
        }

        calendarIntegrationEvents = calendarIntegrationEvents.concat(
          getForRecurring(ve, calProviderId, startTimestamp, endTimestamp, exceptions),
        );
      } else {
        const dtstart = safeGetDateTimestamp(ve, 'dtstart');
        if (dtstart !== null && dtstart < endTimestamp) {
          calendarIntegrationEvents.push(
            convertVEventToCalendarIntegrationEvent(ve, calProviderId),
          );
        }
      }
    } catch (error) {
      Log.warn(
        'Failed to process event:',
        ve.getFirstPropertyValue('uid'),
        ve.getFirstPropertyValue('summary'),
        error,
      );
    }
  });

  // Handle orphan exception events where the master recurring event is outside the time range.
  // This happens when a recurring series has ended or hasn't started yet, but one or more
  // modified instances (RECURRENCE-ID) have been moved into our query window.
  // Example: A daily meeting series ended on Jan 1, but the Jan 2 instance was rescheduled to Jan 20.
  exceptionMap.forEach((exceptions, uid) => {
    if (processedRecurringUids.has(uid)) {
      return;
    }
    exceptions.forEach((exception) => {
      if (exception.isCancelled) {
        return;
      }
      const exceptionStart = safeGetDateTimestamp(exception.vevent, 'dtstart');
      if (
        exceptionStart !== null &&
        exceptionStart >= startTimestamp &&
        exceptionStart < endTimestamp
      ) {
        const baseId = uid || exception.vevent.getFirstPropertyValue('uid');
        const legacyIds = baseId ? [baseId] : undefined;
        calendarIntegrationEvents.push(
          convertVEventToCalendarIntegrationEvent(exception.vevent, calProviderId, {
            overrideId: baseId
              ? `${baseId}_${exception.recurrenceId}`
              : `${exception.recurrenceId}`,
            legacyIds,
          }),
        );
      }
    });
  });
  // Log.timeEnd('TEST');
  return calendarIntegrationEvents;
};

const calculateEventDuration = (vevent: any, startTimeStamp: number): number => {
  // NOTE: Per RFC 2445, events can have either DTEND or DURATION, but not both
  // If neither is present, the event ends at DTSTART (zero duration)
  const dtend = vevent.getFirstPropertyValue('dtend');
  if (dtend) {
    return dtend.toJSDate().getTime() - startTimeStamp;
  }

  const durationProp = vevent.getFirstPropertyValue('duration');
  if (durationProp) {
    // ICAL.Duration provides toSeconds() method
    return durationProp.toSeconds() * 1000;
  }

  // Default to zero duration if neither DTEND nor DURATION is present
  return 0;
};

const getExDateTimestamps = (vevent: any): number[] => {
  const exDates: number[] = [];
  const exDateProps = vevent.getAllProperties('exdate');

  for (const prop of exDateProps) {
    // getValues() returns an array of ICAL.Time objects for multi-value properties (comma-separated)
    // or an array with a single ICAL.Time for single-value properties
    const values = prop.getValues();
    for (const val of values) {
      if (val && typeof val.toJSDate === 'function') {
        exDates.push(val.toJSDate().getTime());
      }
    }
  }
  return exDates;
};

const getForRecurring = (
  vevent: any,
  calProviderId: string,
  startTimestamp: number,
  endTimeStamp: number,
  exceptions: ExceptionEvent[] = [],
): CalendarIntegrationEvent[] => {
  try {
    const title: string = vevent.getFirstPropertyValue('summary');
    const description = vevent.getFirstPropertyValue('description');
    const start = vevent.getFirstPropertyValue('dtstart');

    // Handle missing or invalid dtstart for recurring events
    if (!start || typeof start.toJSDate !== 'function') {
      Log.warn(
        'Recurring event missing valid dtstart:',
        vevent.getFirstPropertyValue('uid'),
        title,
      );
      return [];
    }

    const startDate = start.toJSDate();
    const startTimeStamp = startDate.getTime();
    const baseId = vevent.getFirstPropertyValue('uid');

    // Calculate duration from either dtend, DURATION property, or default to 0
    // This follows RFC 2445 which allows either DTEND or DURATION (but not both)
    const duration = calculateEventDuration(vevent, startTimeStamp);

    const recur = vevent.getFirstPropertyValue('rrule');

    const iter = recur.iterator(start);
    const isAllDay = isAllDayEvent(vevent);

    // Build set of exception timestamps for fast lookup
    const exceptionTimestamps = new Set(exceptions.map((ex) => ex.recurrenceId));

    // Add EXDATEs to exception timestamps
    const exDateTimestamps = getExDateTimestamps(vevent);
    exDateTimestamps.forEach((ts) => exceptionTimestamps.add(ts));

    const evs: CalendarIntegrationEvent[] = [];
    for (let next = iter.next(); next; next = iter.next()) {
      const nextTimestamp = next.toJSDate().getTime();

      // Skip this occurrence if there's an exception for it
      if (exceptionTimestamps.has(nextTimestamp)) {
        continue;
      }

      if (nextTimestamp <= endTimeStamp && nextTimestamp >= startTimestamp) {
        evs.push({
          title,
          start: nextTimestamp,
          duration,
          id: baseId + '_' + next,
          calProviderId,
          description: description || undefined,
          ...(isAllDay && { isAllDay }),
        });
      } else if (nextTimestamp > endTimeStamp) {
        break;
      }
    }

    // Add non-cancelled exception events
    for (const exception of exceptions) {
      if (exception.isCancelled) {
        continue;
      }

      const exceptionStart = safeGetDateTimestamp(exception.vevent, 'dtstart');
      // Only include exceptions within the time range
      if (
        exceptionStart !== null &&
        exceptionStart >= startTimestamp &&
        exceptionStart < endTimeStamp
      ) {
        const legacyIds = baseId ? [baseId] : undefined;
        const overrideId =
          baseId !== undefined
            ? `${baseId}_${exception.recurrenceId}`
            : `${exception.recurrenceId}`;
        evs.push(
          convertVEventToCalendarIntegrationEvent(exception.vevent, calProviderId, {
            overrideId,
            legacyIds,
          }),
        );
      }
    }

    return evs;
  } catch (error) {
    Log.warn(
      'Failed to process recurring event:',
      vevent.getFirstPropertyValue('uid'),
      vevent.getFirstPropertyValue('summary'),
      error,
    );
    return [];
  }
};

interface ConvertOptions {
  overrideId?: string;
  legacyIds?: string[];
}

const convertVEventToCalendarIntegrationEvent = (
  vevent: any,
  calProviderId: string,
  options?: ConvertOptions,
): CalendarIntegrationEvent => {
  // options.overrideId allows detached instances to re-use conversion while staying unique per occurrence
  // options.legacyIds preserves backward compatibility with previous ID schemes
  const start = vevent.getFirstPropertyValue('dtstart').toJSDate().getTime();
  // NOTE: if dtend is missing, it defaults to dtstart; @see #1814 and RFC 2455
  // detailed comment in #1814:
  // https://github.com/super-productivity/super-productivity/issues/1814#issuecomment-1008132824
  const duration = calculateEventDuration(vevent, start);
  const isAllDay = isAllDayEvent(vevent);

  return {
    id: options?.overrideId || vevent.getFirstPropertyValue('uid'),
    title: vevent.getFirstPropertyValue('summary') || '',
    description: vevent.getFirstPropertyValue('description') || undefined,
    start,
    duration,
    calProviderId,
    legacyIds: options?.legacyIds,
    ...(isAllDay && { isAllDay }),
  };
};

const getAllPossibleEventsAfterStartFromIcal = (
  ICAL: any,
  icalData: string,
  start: Date,
): any[] => {
  const c = ICAL.parse(icalData);
  const comp = new ICAL.Component(c);
  const tzAdded: string[] = [];
  if (comp.getFirstSubcomponent('vtimezone')) {
    for (const vtz of comp.getAllSubcomponents('vtimezone')) {
      const tz = new ICAL.Timezone({
        tzid: vtz.getFirstPropertyValue('tzid'),
        component: vtz,
      });

      if (!ICAL.TimezoneService.has(tz.tzid)) {
        ICAL.TimezoneService.register(tz);
        tzAdded.push(tz.tzid);
      }
    }
  }
  // Wrap updateTimezones in try-catch to handle edge cases in some Office 365 calendars
  // that can cause "Cannot read properties of null (reading 'parent')" errors.
  // See: https://github.com/super-productivity/super-productivity/issues/5722
  let vevents: any[];
  try {
    vevents = ICAL.helpers.updateTimezones(comp).getAllSubcomponents('vevent');
  } catch (error) {
    Log.warn(
      'Failed to update timezones for calendar, falling back to raw component:',
      error,
    );
    vevents = comp.getAllSubcomponents('vevent');
  }

  const allPossibleFutureEvents = vevents.filter((ve: any) => {
    try {
      const dtstart = ve.getFirstPropertyValue('dtstart');
      // Skip events without valid dtstart
      if (!dtstart || typeof dtstart.toJSDate !== 'function') {
        return false;
      }

      const dtstartDate = dtstart.toJSDate();
      if (dtstartDate >= start) {
        return true;
      }

      // Check if it's a recurring event that might have future occurrences
      const rrule = ve.getFirstPropertyValue('rrule');
      if (rrule) {
        const until = rrule?.until;
        if (!until) {
          // No end date means infinite recurrence
          return true;
        }
        if (typeof until.toJSDate === 'function') {
          return until.toJSDate() > start;
        }
        // If until exists but doesn't have toJSDate, include it to be safe
        return true;
      }

      return false;
    } catch (error) {
      // Skip events that cause errors during filtering
      return false;
    }
  });

  for (const tzid of tzAdded) {
    ICAL.TimezoneService.remove(tzid);
  }

  return allPossibleFutureEvents;
};
