import { getRelevantEventsForCalendarIntegrationFromIcal } from './get-relevant-events-from-ical';

describe('cancelled calendar events', () => {
  const read = (
    events: string,
  ): ReturnType<typeof getRelevantEventsForCalendarIntegrationFromIcal> =>
    getRelevantEventsForCalendarIntegrationFromIcal(
      `BEGIN:VCALENDAR
VERSION:2.0
${events}
END:VCALENDAR`,
      'calendar',
      Date.parse('2026-10-24T00:00:00Z'),
      Date.parse('2026-10-25T00:00:00Z'),
    );
  it('omits cancelled standalone events while retaining confirmed events', async () => {
    const events = await read(`BEGIN:VEVENT
UID:cancelled
DTSTART:20261024T120000Z
DTEND:20261024T130000Z
SUMMARY:Cancelled
STATUS:CANCELLED
END:VEVENT
BEGIN:VEVENT
UID:active
DTSTART:20261024T140000Z
DTEND:20261024T150000Z
SUMMARY:Active
STATUS:CONFIRMED
END:VEVENT`);
    expect(events.map((event) => event.id)).toEqual(['active']);
  });
  for (const { description, rule } of [
    { description: 'count-limited', rule: 'COUNT=3' },
    { description: 'ended before the query window', rule: 'UNTIL=20261023T120000Z' },
  ]) {
    it(`omits a cancelled series (${description}) including detached overrides`, async () => {
      expect(
        await read(`BEGIN:VEVENT
UID:series
DTSTART:20261022T120000Z
DTEND:20261022T130000Z
RRULE:FREQ=DAILY;${rule}
SUMMARY:Cancelled series
STATUS:CANCELLED
END:VEVENT
BEGIN:VEVENT
UID:series
RECURRENCE-ID:20261023T120000Z
DTSTART:20261024T140000Z
DTEND:20261024T150000Z
SUMMARY:Old override
STATUS:CONFIRMED
END:VEVENT`),
      ).toEqual([]);
    });
  }
});
