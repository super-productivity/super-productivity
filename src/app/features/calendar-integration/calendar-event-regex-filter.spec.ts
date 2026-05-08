import { passesCalendarEventRegexFilter } from './calendar-event-regex-filter';
import { CalendarIntegrationEvent } from './calendar-integration.model';

const baseEvent: CalendarIntegrationEvent = {
  id: 'event',
  calProviderId: 'provider',
  title: 'Team Meeting',
  start: 0,
  duration: 0,
  issueProviderKey: 'ICAL',
};

describe('passesCalendarEventRegexFilter', () => {
  it('should return true when both filters are null', () => {
    expect(passesCalendarEventRegexFilter(baseEvent, null, null)).toBe(true);
  });

  it('should return true when both filters are undefined', () => {
    expect(passesCalendarEventRegexFilter(baseEvent, undefined, undefined)).toBe(true);
  });

  it('should return true when both filters are empty strings', () => {
    expect(passesCalendarEventRegexFilter(baseEvent, '', '')).toBe(true);
  });

  describe('include filter', () => {
    it('should return true when title matches include regex', () => {
      expect(passesCalendarEventRegexFilter(baseEvent, 'Meeting', null)).toBe(true);
    });

    it('should return false when title does not match include regex', () => {
      expect(passesCalendarEventRegexFilter(baseEvent, 'Lunch', null)).toBe(false);
    });

    it('should match case-insensitively', () => {
      expect(passesCalendarEventRegexFilter(baseEvent, 'meeting', null)).toBe(true);
      expect(passesCalendarEventRegexFilter(baseEvent, 'MEETING', null)).toBe(true);
    });

    it('should support pipe-separated alternatives', () => {
      expect(passesCalendarEventRegexFilter(baseEvent, 'Lunch|Meeting', null)).toBe(true);
      expect(passesCalendarEventRegexFilter(baseEvent, 'Lunch|Standup', null)).toBe(
        false,
      );
    });

    it('should silently ignore an invalid include regex and return true', () => {
      expect(passesCalendarEventRegexFilter(baseEvent, '[invalid', null)).toBe(true);
    });
  });

  describe('exclude filter', () => {
    it('should return false when title matches exclude regex', () => {
      expect(passesCalendarEventRegexFilter(baseEvent, null, 'Meeting')).toBe(false);
    });

    it('should return true when title does not match exclude regex', () => {
      expect(passesCalendarEventRegexFilter(baseEvent, null, 'Lunch')).toBe(true);
    });

    it('should match case-insensitively', () => {
      expect(passesCalendarEventRegexFilter(baseEvent, null, 'meeting')).toBe(false);
    });

    it('should silently ignore an invalid exclude regex and return true', () => {
      expect(passesCalendarEventRegexFilter(baseEvent, null, '[invalid')).toBe(true);
    });
  });

  describe('combined filters', () => {
    it('should return true when include matches and exclude does not match', () => {
      expect(passesCalendarEventRegexFilter(baseEvent, 'Meeting', 'Lunch')).toBe(true);
    });

    it('should return false when include matches but exclude also matches', () => {
      expect(passesCalendarEventRegexFilter(baseEvent, 'Meeting', 'Team')).toBe(false);
    });

    it('should return false when include does not match, even if exclude would not match', () => {
      expect(passesCalendarEventRegexFilter(baseEvent, 'Standup', 'Lunch')).toBe(false);
    });
  });
});
