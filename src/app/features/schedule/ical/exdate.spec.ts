import { getRelevantEventsForCalendarIntegrationFromIcal } from './get-relevant-events-from-ical';
import { getDbDateStr } from '../../../util/get-db-date-str';

describe('getRelevantEventsForCalendarIntegrationFromIcal - EXDATE Support', () => {
  const calProviderId = 'test-provider';
  const startTimestamp = new Date('2025-01-01T00:00:00Z').getTime();
  const endTimestamp = new Date('2025-01-10T23:59:59Z').getTime();

  it('should exclude date specified in EXDATE', async () => {
    const icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:exdate-test-1
DTSTART:20250101T100000Z
DTEND:20250101T110000Z
RRULE:FREQ=DAILY;COUNT=3
EXDATE:20250102T100000Z
SUMMARY:Daily with EXDATE
END:VEVENT
END:VCALENDAR`;

    const events = await getRelevantEventsForCalendarIntegrationFromIcal(
      icalData,
      calProviderId,
      startTimestamp,
      endTimestamp,
    );

    // Should have 2 events (Jan 1 and Jan 3), skipping Jan 2
    expect(events.length).toBe(2);

    const eventDates = events.map((e) => getDbDateStr(new Date(e.start))).sort();
    expect(eventDates).toEqual(['2025-01-01', '2025-01-03']);
  });

  it('should exclude multiple dates specified in multiple EXDATE properties', async () => {
    const icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:exdate-test-2
DTSTART:20250101T100000Z
DTEND:20250101T110000Z
RRULE:FREQ=DAILY;COUNT=5
EXDATE:20250102T100000Z
EXDATE:20250104T100000Z
SUMMARY:Daily with Multiple EXDATEs
END:VEVENT
END:VCALENDAR`;

    const events = await getRelevantEventsForCalendarIntegrationFromIcal(
      icalData,
      calProviderId,
      startTimestamp,
      endTimestamp,
    );

    // Should have 3 events (Jan 1, Jan 3, Jan 5)
    // Skipped: Jan 2, Jan 4
    expect(events.length).toBe(3);

    const eventDates = events.map((e) => getDbDateStr(new Date(e.start))).sort();
    expect(eventDates).toEqual(['2025-01-01', '2025-01-03', '2025-01-05']);
  });

  it('should exclude multiple dates specified in a single EXDATE property (comma separated)', async () => {
    const icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:exdate-test-3
DTSTART:20250101T100000Z
DTEND:20250101T110000Z
RRULE:FREQ=DAILY;COUNT=5
EXDATE:20250102T100000Z,20250104T100000Z
SUMMARY:Daily with Comma Separated EXDATE
END:VEVENT
END:VCALENDAR`;

    const events = await getRelevantEventsForCalendarIntegrationFromIcal(
      icalData,
      calProviderId,
      startTimestamp,
      endTimestamp,
    );

    // Should have 3 events (Jan 1, Jan 3, Jan 5)
    // Skipped: Jan 2, Jan 4
    expect(events.length).toBe(3);

    const eventDates = events.map((e) => getDbDateStr(new Date(e.start))).sort();
    expect(eventDates).toEqual(['2025-01-01', '2025-01-03', '2025-01-05']);
  });
});
