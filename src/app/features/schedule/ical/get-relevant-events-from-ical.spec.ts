import { getRelevantEventsForCalendarIntegrationFromIcal } from './get-relevant-events-from-ical';

describe('getRelevantEventsForCalendarIntegrationFromIcal', () => {
  const calProviderId = 'test-provider';
  const startTimestamp = new Date('2025-01-01T00:00:00Z').getTime();
  const endTimestamp = new Date('2025-12-31T23:59:59Z').getTime();

  describe('non-recurring events', () => {
    it('should import event with dtend', async () => {
      const icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:test-event-1
DTSTART:20250115T100000Z
DTEND:20250115T110000Z
SUMMARY:Test Event with End
END:VEVENT
END:VCALENDAR`;

      const events = await getRelevantEventsForCalendarIntegrationFromIcal(
        icalData,
        calProviderId,
        startTimestamp,
        endTimestamp,
      );

      expect(events.length).toBe(1);
      expect(events[0].title).toBe('Test Event with End');
      expect(events[0].duration).toBe(3600000); // 1 hour in ms
    });

    it('should import event without dtend (zero duration)', async () => {
      const icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:test-event-2
DTSTART:20250115T100000Z
SUMMARY:Test Event without End
END:VEVENT
END:VCALENDAR`;

      const events = await getRelevantEventsForCalendarIntegrationFromIcal(
        icalData,
        calProviderId,
        startTimestamp,
        endTimestamp,
      );

      expect(events.length).toBe(1);
      expect(events[0].title).toBe('Test Event without End');
      expect(events[0].duration).toBe(0);
    });
  });

  describe('recurring events', () => {
    it('should import recurring event with dtend', async () => {
      const icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:recurring-event-1
DTSTART:20250115T100000Z
DTEND:20250115T110000Z
RRULE:FREQ=WEEKLY;COUNT=3
SUMMARY:Weekly Meeting with End
END:VEVENT
END:VCALENDAR`;

      const events = await getRelevantEventsForCalendarIntegrationFromIcal(
        icalData,
        calProviderId,
        startTimestamp,
        endTimestamp,
      );

      expect(events.length).toBe(3);
      events.forEach((event) => {
        expect(event.title).toBe('Weekly Meeting with End');
        expect(event.duration).toBe(3600000); // 1 hour
      });
    });

    it('should import recurring event with DURATION instead of dtend', async () => {
      const icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:recurring-event-2
DTSTART:20250115T100000Z
DURATION:PT1H30M
RRULE:FREQ=DAILY;COUNT=2
SUMMARY:Daily Task with Duration
END:VEVENT
END:VCALENDAR`;

      const events = await getRelevantEventsForCalendarIntegrationFromIcal(
        icalData,
        calProviderId,
        startTimestamp,
        endTimestamp,
      );

      expect(events.length).toBe(2);
      events.forEach((event) => {
        expect(event.title).toBe('Daily Task with Duration');
        expect(event.duration).toBe(5400000); // 1.5 hours in ms
      });
    });

    it('should import recurring event without dtend or DURATION (zero duration)', async () => {
      const icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:recurring-event-3
DTSTART:20250115T100000Z
RRULE:FREQ=DAILY;COUNT=2
SUMMARY:Daily Reminder without Duration
END:VEVENT
END:VCALENDAR`;

      const events = await getRelevantEventsForCalendarIntegrationFromIcal(
        icalData,
        calProviderId,
        startTimestamp,
        endTimestamp,
      );

      expect(events.length).toBe(2);
      events.forEach((event) => {
        expect(event.title).toBe('Daily Reminder without Duration');
        expect(event.duration).toBe(0);
      });
    });

    it('should handle recurring event with very short duration', async () => {
      const icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:recurring-event-4
DTSTART:20250115T100000Z
DURATION:PT15M
RRULE:FREQ=DAILY;COUNT=2
SUMMARY:15 Minute Standup
END:VEVENT
END:VCALENDAR`;

      const events = await getRelevantEventsForCalendarIntegrationFromIcal(
        icalData,
        calProviderId,
        startTimestamp,
        endTimestamp,
      );

      expect(events.length).toBe(2);
      events.forEach((event) => {
        expect(event.title).toBe('15 Minute Standup');
        expect(event.duration).toBe(900000); // 15 minutes in ms
      });
    });

    it('should keep descriptions for recurring events', async () => {
      const icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:recurring-event-desc
DTSTART:20250115T100000Z
DURATION:PT45M
RRULE:FREQ=DAILY;COUNT=2
SUMMARY:Recurring With Description
DESCRIPTION:Recurring description text
END:VEVENT
END:VCALENDAR`;

      const events = await getRelevantEventsForCalendarIntegrationFromIcal(
        icalData,
        calProviderId,
        startTimestamp,
        endTimestamp,
      );

      expect(events.length).toBe(2);
      events.forEach((event) => {
        expect(event.title).toBe('Recurring With Description');
        expect(event.description).toBe('Recurring description text');
      });
    });
  });

  describe('mixed event types', () => {
    it('should import mix of recurring and non-recurring events', async () => {
      const icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:single-event
DTSTART:20250115T100000Z
DTEND:20250115T110000Z
SUMMARY:Single Event
END:VEVENT
BEGIN:VEVENT
UID:recurring-event
DTSTART:20250116T140000Z
DURATION:PT30M
RRULE:FREQ=DAILY;COUNT=2
SUMMARY:Recurring Event
END:VEVENT
END:VCALENDAR`;

      const events = await getRelevantEventsForCalendarIntegrationFromIcal(
        icalData,
        calProviderId,
        startTimestamp,
        endTimestamp,
      );

      expect(events.length).toBe(3);
      const singleEvent = events.find((e) => e.title === 'Single Event');
      const recurringEvents = events.filter((e) => e.title === 'Recurring Event');

      expect(singleEvent).toBeDefined();
      expect(singleEvent!.duration).toBe(3600000);
      expect(recurringEvents.length).toBe(2);
      recurringEvents.forEach((event) => {
        expect(event.duration).toBe(1800000); // 30 minutes
      });
    });
  });

  describe('error handling', () => {
    it('should handle events outside the time range', async () => {
      const icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:past-event
DTSTART:20240101T100000Z
DTEND:20240101T110000Z
SUMMARY:Past Event
END:VEVENT
END:VCALENDAR`;

      const events = await getRelevantEventsForCalendarIntegrationFromIcal(
        icalData,
        calProviderId,
        startTimestamp,
        endTimestamp,
      );

      expect(events.length).toBe(0);
    });

    it('should continue processing even if one event fails', async () => {
      const icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:good-event
DTSTART:20250115T100000Z
DTEND:20250115T110000Z
SUMMARY:Good Event
END:VEVENT
BEGIN:VEVENT
UID:bad-event
DTSTART:20250116T100000Z
DTEND:INVALIDDATE
SUMMARY:Bad Event
END:VEVENT
END:VCALENDAR`;

      const events = await getRelevantEventsForCalendarIntegrationFromIcal(
        icalData,
        calProviderId,
        startTimestamp,
        endTimestamp,
      );

      expect(events.length).toBe(1);
      expect(events[0].title).toBe('Good Event');
      expect(events[0].duration).toBe(3600000);
    });
  });

  describe('edge cases', () => {
    it('should handle all-day events and set isAllDay flag', async () => {
      const icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:all-day-event
DTSTART;VALUE=DATE:20250115
DTEND;VALUE=DATE:20250116
SUMMARY:All Day Event
END:VEVENT
END:VCALENDAR`;

      const events = await getRelevantEventsForCalendarIntegrationFromIcal(
        icalData,
        calProviderId,
        startTimestamp,
        endTimestamp,
      );

      expect(events.length).toBe(1);
      expect(events[0].title).toBe('All Day Event');
      expect(events[0].isAllDay).toBe(true);
    });

    it('should NOT set isAllDay flag for timed events', async () => {
      const icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:timed-event
DTSTART:20250115T100000Z
DTEND:20250115T110000Z
SUMMARY:Timed Event
END:VEVENT
END:VCALENDAR`;

      const events = await getRelevantEventsForCalendarIntegrationFromIcal(
        icalData,
        calProviderId,
        startTimestamp,
        endTimestamp,
      );

      expect(events.length).toBe(1);
      expect(events[0].title).toBe('Timed Event');
      expect(events[0].isAllDay).toBeUndefined();
    });

    it('should handle recurring event with UNTIL', async () => {
      const icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:recurring-until
DTSTART:20250115T100000Z
DURATION:PT1H
RRULE:FREQ=DAILY;UNTIL=20250117T235959Z
SUMMARY:Daily Until Event
END:VEVENT
END:VCALENDAR`;

      const events = await getRelevantEventsForCalendarIntegrationFromIcal(
        icalData,
        calProviderId,
        startTimestamp,
        endTimestamp,
      );

      expect(events.length).toBeGreaterThan(0);
      events.forEach((event) => {
        expect(event.title).toBe('Daily Until Event');
        expect(event.duration).toBe(3600000);
      });
    });

    it('should handle recurring all-day event without end time and set isAllDay flag', async () => {
      const icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:recurring-allday-no-end
DTSTART;VALUE=DATE:20250115
RRULE:FREQ=DAILY;COUNT=3
SUMMARY:Recurring All Day No End
END:VEVENT
END:VCALENDAR`;

      const events = await getRelevantEventsForCalendarIntegrationFromIcal(
        icalData,
        calProviderId,
        startTimestamp,
        endTimestamp,
      );

      expect(events.length).toBe(3);
      events.forEach((event) => {
        expect(event.title).toBe('Recurring All Day No End');
        expect(event.duration).toBe(0); // No duration specified
        expect(event.isAllDay).toBe(true);
      });
    });

    it('should gracefully skip event with null dtstart', async () => {
      const icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:event-missing-dtstart
SUMMARY:Event Without Start Date
DESCRIPTION:This event has no DTSTART
END:VEVENT
END:VCALENDAR`;

      const events = await getRelevantEventsForCalendarIntegrationFromIcal(
        icalData,
        calProviderId,
        startTimestamp,
        endTimestamp,
      );

      // Should not crash, event should be skipped
      expect(events).toBeDefined();
      expect(events.length).toBe(0);
    });

    it('should handle mix of valid and invalid events gracefully', async () => {
      const icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:valid-event
DTSTART:20250115T100000Z
DTEND:20250115T110000Z
SUMMARY:Valid Event
END:VEVENT
BEGIN:VEVENT
UID:invalid-event-no-start
SUMMARY:Invalid Event No Start
END:VEVENT
BEGIN:VEVENT
UID:another-valid-event
DTSTART:20250116T140000Z
DURATION:PT30M
SUMMARY:Another Valid Event
END:VEVENT
END:VCALENDAR`;

      const events = await getRelevantEventsForCalendarIntegrationFromIcal(
        icalData,
        calProviderId,
        startTimestamp,
        endTimestamp,
      );

      // Should import 2 valid events and skip the invalid one
      expect(events.length).toBe(2);
      expect(events.find((e) => e.title === 'Valid Event')).toBeDefined();
      expect(events.find((e) => e.title === 'Another Valid Event')).toBeDefined();
      expect(events.find((e) => e.title === 'Invalid Event No Start')).toBeUndefined();
    });
  });

  describe('RECURRENCE-ID handling (modified recurring events)', () => {
    it('should not create duplicate when recurring event has one modified instance', async () => {
      const icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:recurring-event-modified@test
DTSTART:20250115T100000Z
DTEND:20250115T110000Z
RRULE:FREQ=DAILY;COUNT=3
SUMMARY:Daily Meeting
END:VEVENT
BEGIN:VEVENT
UID:recurring-event-modified@test
RECURRENCE-ID:20250116T100000Z
DTSTART:20250116T140000Z
DTEND:20250116T150000Z
SUMMARY:Daily Meeting (Moved)
END:VEVENT
END:VCALENDAR`;

      const events = await getRelevantEventsForCalendarIntegrationFromIcal(
        icalData,
        calProviderId,
        startTimestamp,
        endTimestamp,
      );

      // Should have exactly 3 events (not 4)
      expect(events.length).toBe(3);

      // Find the modified instance
      const modifiedEvent = events.find((e) => e.title === 'Daily Meeting (Moved)');
      expect(modifiedEvent).toBeDefined();
      // Modified event should be at 14:00 not 10:00
      expect(modifiedEvent!.start).toBe(new Date('2025-01-16T14:00:00Z').getTime());
      expect(modifiedEvent!.duration).toBe(3600000); // 1 hour

      // Other events should be unmodified
      const unmodifiedEvents = events.filter((e) => e.title === 'Daily Meeting');
      expect(unmodifiedEvents.length).toBe(2);
    });

    it('should handle multiple modified instances in recurring event', async () => {
      const icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:multi-modified@test
DTSTART:20250115T100000Z
DURATION:PT1H
RRULE:FREQ=DAILY;COUNT=5
SUMMARY:Standup
END:VEVENT
BEGIN:VEVENT
UID:multi-modified@test
RECURRENCE-ID:20250116T100000Z
DTSTART:20250116T110000Z
DURATION:PT1H
SUMMARY:Standup (Late)
END:VEVENT
BEGIN:VEVENT
UID:multi-modified@test
RECURRENCE-ID:20250118T100000Z
DTSTART:20250118T090000Z
DURATION:PT30M
SUMMARY:Standup (Early & Short)
END:VEVENT
END:VCALENDAR`;

      const events = await getRelevantEventsForCalendarIntegrationFromIcal(
        icalData,
        calProviderId,
        startTimestamp,
        endTimestamp,
      );

      // Should have exactly 5 events (not 7)
      expect(events.length).toBe(5);

      // Verify modified instances
      const lateEvent = events.find((e) => e.title === 'Standup (Late)');
      expect(lateEvent).toBeDefined();
      expect(lateEvent!.start).toBe(new Date('2025-01-16T11:00:00Z').getTime());

      const earlyEvent = events.find((e) => e.title === 'Standup (Early & Short)');
      expect(earlyEvent).toBeDefined();
      expect(earlyEvent!.start).toBe(new Date('2025-01-18T09:00:00Z').getTime());
      expect(earlyEvent!.duration).toBe(1800000); // 30 minutes

      // Unmodified events
      const unmodifiedEvents = events.filter((e) => e.title === 'Standup');
      expect(unmodifiedEvents.length).toBe(3);
    });

    it('should handle cancelled instance in recurring event', async () => {
      const icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:event-with-cancel@test
DTSTART:20250115T100000Z
DTEND:20250115T110000Z
RRULE:FREQ=DAILY;COUNT=4
SUMMARY:Team Sync
END:VEVENT
BEGIN:VEVENT
UID:event-with-cancel@test
RECURRENCE-ID:20250117T100000Z
DTSTART:20250117T100000Z
DTEND:20250117T110000Z
SUMMARY:Team Sync
STATUS:CANCELLED
END:VEVENT
END:VCALENDAR`;

      const events = await getRelevantEventsForCalendarIntegrationFromIcal(
        icalData,
        calProviderId,
        startTimestamp,
        endTimestamp,
      );

      // Should have 3 events (4 minus the cancelled one)
      expect(events.length).toBe(3);

      // Verify no event on the cancelled date
      const cancelledDate = new Date('2025-01-17T10:00:00Z').getTime();
      const eventOnCancelledDate = events.find((e) => e.start === cancelledDate);
      expect(eventOnCancelledDate).toBeUndefined();
    });

    it('should handle all-day recurring event with DATE-based RECURRENCE-ID', async () => {
      const icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:allday-modified@test
DTSTART;VALUE=DATE:20250115
RRULE:FREQ=DAILY;COUNT=3
SUMMARY:All Day Event
END:VEVENT
BEGIN:VEVENT
UID:allday-modified@test
RECURRENCE-ID;VALUE=DATE:20250116
DTSTART;VALUE=DATE:20250116
SUMMARY:All Day Event (Modified)
END:VEVENT
END:VCALENDAR`;

      const events = await getRelevantEventsForCalendarIntegrationFromIcal(
        icalData,
        calProviderId,
        startTimestamp,
        endTimestamp,
      );

      // Should have exactly 3 events (not 4)
      expect(events.length).toBe(3);

      const modifiedEvent = events.find((e) => e.title === 'All Day Event (Modified)');
      expect(modifiedEvent).toBeDefined();

      const unmodifiedEvents = events.filter((e) => e.title === 'All Day Event');
      expect(unmodifiedEvents.length).toBe(2);
    });

    it('should handle recurring event without exceptions (no regression)', async () => {
      const icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:no-exceptions@test
DTSTART:20250115T100000Z
DTEND:20250115T110000Z
RRULE:FREQ=DAILY;COUNT=3
SUMMARY:Regular Recurring
END:VEVENT
END:VCALENDAR`;

      const events = await getRelevantEventsForCalendarIntegrationFromIcal(
        icalData,
        calProviderId,
        startTimestamp,
        endTimestamp,
      );

      // Should still work correctly
      expect(events.length).toBe(3);
      events.forEach((event) => {
        expect(event.title).toBe('Regular Recurring');
      });
    });

    it('should handle exception outside time range gracefully', async () => {
      const icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:exception-out-of-range@test
DTSTART:20250115T100000Z
DTEND:20250115T110000Z
RRULE:FREQ=DAILY;COUNT=3
SUMMARY:Event Series
END:VEVENT
BEGIN:VEVENT
UID:exception-out-of-range@test
RECURRENCE-ID:20240101T100000Z
DTSTART:20240101T140000Z
DTEND:20240101T150000Z
SUMMARY:Event Series (Old Modified)
END:VEVENT
END:VCALENDAR`;

      const events = await getRelevantEventsForCalendarIntegrationFromIcal(
        icalData,
        calProviderId,
        startTimestamp,
        endTimestamp,
      );

      // Should have 3 events from the RRULE (exception is outside range)
      expect(events.length).toBe(3);
      events.forEach((event) => {
        expect(event.title).toBe('Event Series');
      });
    });

    it('should include modified instances that are in range when master recurring series is out of range', async () => {
      const icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:orphan@test
DTSTART:20250101T100000Z
DTEND:20250101T110000Z
RRULE:FREQ=DAILY;UNTIL=20250103T110000Z
SUMMARY:Series Ending Early
END:VEVENT
BEGIN:VEVENT
UID:orphan@test
RECURRENCE-ID:20250102T100000Z
DTSTART:20250120T150000Z
DTEND:20250120T160000Z
SUMMARY:Series Ending Early (Moved)
END:VEVENT
END:VCALENDAR`;

      const laterStart = new Date('2025-01-10T00:00:00Z').getTime();
      const laterEnd = new Date('2025-02-01T00:00:00Z').getTime();
      const events = await getRelevantEventsForCalendarIntegrationFromIcal(
        icalData,
        calProviderId,
        laterStart,
        laterEnd,
      );

      expect(events.length).toBe(1);
      expect(events[0].title).toBe('Series Ending Early (Moved)');
      expect(events[0].start).toBe(new Date('2025-01-20T15:00:00Z').getTime());
      const expectedId = `orphan@test_${new Date('2025-01-02T10:00:00Z').getTime()}`;
      expect(events[0].id).toBe(expectedId);
      expect(events[0].legacyIds).toEqual(['orphan@test']);
    });

    it('should not include cancelled orphan exception events', async () => {
      const icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:cancelled@test
DTSTART:20250101T100000Z
DTEND:20250101T110000Z
RRULE:FREQ=DAILY;UNTIL=20250103T110000Z
SUMMARY:Short Series
END:VEVENT
BEGIN:VEVENT
UID:cancelled@test
RECURRENCE-ID:20250102T100000Z
DTSTART:20250120T150000Z
DTEND:20250120T160000Z
STATUS:CANCELLED
SUMMARY:Short Series (Cancelled)
END:VEVENT
END:VCALENDAR`;

      const laterStart = new Date('2025-01-10T00:00:00Z').getTime();
      const laterEnd = new Date('2025-02-01T00:00:00Z').getTime();
      const events = await getRelevantEventsForCalendarIntegrationFromIcal(
        icalData,
        calProviderId,
        laterStart,
        laterEnd,
      );

      expect(events.length).toBe(0);
    });

    it('should generate unique IDs for modified instances', async () => {
      const icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:unique@test
DTSTART:20250115T080000Z
DTEND:20250115T090000Z
RRULE:FREQ=DAILY;COUNT=3
SUMMARY:Standup
END:VEVENT
BEGIN:VEVENT
UID:unique@test
RECURRENCE-ID:20250116T080000Z
DTSTART:20250116T100000Z
DTEND:20250116T110000Z
SUMMARY:Standup (Late)
END:VEVENT
BEGIN:VEVENT
UID:unique@test
RECURRENCE-ID:20250117T080000Z
DTSTART:20250118T070000Z
DTEND:20250118T080000Z
SUMMARY:Standup (Early)
END:VEVENT
END:VCALENDAR`;

      const events = await getRelevantEventsForCalendarIntegrationFromIcal(
        icalData,
        calProviderId,
        startTimestamp,
        endTimestamp,
      );

      const ids = events.map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
      const expectedLateId = `unique@test_${new Date('2025-01-16T08:00:00Z').getTime()}`;
      const expectedEarlyId = `unique@test_${new Date('2025-01-17T08:00:00Z').getTime()}`;
      expect(ids).toContain(expectedLateId);
      expect(ids).toContain(expectedEarlyId);

      const modifiedEvents = events.filter((e) => e.title !== 'Standup');
      modifiedEvents.forEach((ev) => {
        expect(ev.legacyIds).toEqual(['unique@test']);
      });
    });
  });

  describe('timezone edge cases (Office 365 compatibility)', () => {
    it('should handle iCal with timezone reference but malformed VTIMEZONE gracefully', async () => {
      // This reproduces the issue from GitHub #5722 where Office 365 calendars
      // can cause "Cannot read properties of null (reading 'parent')" errors
      // in ICAL.helpers.updateTimezones()
      const icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN
METHOD:PUBLISH
X-WR-TIMEZONE:Europe/London
BEGIN:VTIMEZONE
TZID:Europe/London
BEGIN:STANDARD
DTSTART:16010101T020000
RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10
TZOFFSETFROM:+0100
TZOFFSETTO:+0000
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:16010101T010000
RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3
TZOFFSETFROM:+0000
TZOFFSETTO:+0100
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:office365-event@microsoft.com
DTSTART;TZID=Europe/London:20250115T100000
DTEND;TZID=Europe/London:20250115T110000
SUMMARY:Office 365 Meeting
END:VEVENT
END:VCALENDAR`;

      // Should not throw an error
      const events = await getRelevantEventsForCalendarIntegrationFromIcal(
        icalData,
        calProviderId,
        startTimestamp,
        endTimestamp,
      );
      expect(events.length).toBe(1);
      expect(events[0].title).toBe('Office 365 Meeting');
    });

    it('should handle iCal with TZID reference to unknown timezone gracefully', async () => {
      // Some Office 365 calendars reference timezones that may not be in the
      // ical.js TimezoneService, which can cause updateTimezones to fail
      const icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN
BEGIN:VEVENT
UID:unknown-tz-event@microsoft.com
DTSTART;TZID=Custom/Unknown_Timezone:20250115T100000
DTEND;TZID=Custom/Unknown_Timezone:20250115T110000
SUMMARY:Event with Unknown Timezone
END:VEVENT
END:VCALENDAR`;

      // Should not throw, should handle gracefully
      expect(() => {
        getRelevantEventsForCalendarIntegrationFromIcal(
          icalData,
          calProviderId,
          startTimestamp,
          endTimestamp,
        );
      }).not.toThrow();
    });

    it('should handle iCal with empty VTIMEZONE component gracefully', async () => {
      // Edge case: VTIMEZONE exists but has no subcomponents
      const icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VTIMEZONE
TZID:Empty/Timezone
END:VTIMEZONE
BEGIN:VEVENT
UID:empty-tz-event@test.com
DTSTART;TZID=Empty/Timezone:20250115T100000
DTEND;TZID=Empty/Timezone:20250115T110000
SUMMARY:Event with Empty Timezone
END:VEVENT
END:VCALENDAR`;

      expect(() => {
        getRelevantEventsForCalendarIntegrationFromIcal(
          icalData,
          calProviderId,
          startTimestamp,
          endTimestamp,
        );
      }).not.toThrow();
    });
  });
});
