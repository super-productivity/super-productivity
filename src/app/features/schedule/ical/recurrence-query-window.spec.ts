import { getRelevantEventsForCalendarIntegrationFromIcal } from './get-relevant-events-from-ical';

describe('recurrence overrides outside the query window', () => {
  it('excludes the original slot when its replacement was moved before the query', async () => {
    const events = await getRelevantEventsForCalendarIntegrationFromIcal(
      `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:window-test
DTSTART:20261023T120000Z
DTEND:20261023T130000Z
RRULE:FREQ=DAILY;COUNT=3
SUMMARY:Original
END:VEVENT
BEGIN:VEVENT
UID:window-test
RECURRENCE-ID:20261024T120000Z
DTSTART:20261023T140000Z
DTEND:20261023T150000Z
SUMMARY:Moved
END:VEVENT
END:VCALENDAR`,
      'calendar',
      Date.parse('2026-10-24T00:00:00Z'),
      Date.parse('2026-10-25T00:00:00Z'),
    );
    expect(events).toEqual([]);
  });
});
