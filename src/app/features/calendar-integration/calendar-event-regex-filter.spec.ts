import {
  CALENDAR_REGEX_FILTER_MAX_LENGTH,
  isSafeCalendarFilterRegex,
  passesCalendarEventRegexFilter,
} from './calendar-event-regex-filter';
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

    it('should fail closed for unsafe include regexes without testing them', () => {
      const adversarialEvent = {
        ...baseEvent,
        title: `${'a'.repeat(5000)}!`,
      };

      expect(passesCalendarEventRegexFilter(adversarialEvent, '^(a+)+$', null)).toBe(
        false,
      );
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

    it('should fail open for unsafe exclude regexes without testing them', () => {
      const adversarialEvent = {
        ...baseEvent,
        title: `${'a'.repeat(5000)}!`,
      };

      expect(passesCalendarEventRegexFilter(adversarialEvent, null, '^(a+)+$')).toBe(
        true,
      );
    });
  });

  describe('regex safety checks', () => {
    it('should allow normal calendar filter regexes', () => {
      expect(isSafeCalendarFilterRegex('Lunch|Meeting')).toBe(true);
      expect(isSafeCalendarFilterRegex('^Team.*(Meeting|Standup)$')).toBe(true);
      expect(isSafeCalendarFilterRegex('\\b(project|planning)\\b')).toBe(true);
    });

    it('should reject nested quantified groups', () => {
      expect(isSafeCalendarFilterRegex('^(a+)+$')).toBe(false);
      expect(isSafeCalendarFilterRegex('^([a-z]*)+$')).toBe(false);
      expect(isSafeCalendarFilterRegex('^((a+))+$')).toBe(false);
    });

    it('should reject repeated groups with ambiguous alternatives', () => {
      expect(isSafeCalendarFilterRegex('^(a|aa)+$')).toBe(false);
      expect(isSafeCalendarFilterRegex('^(?:event|events)*$')).toBe(false);
      expect(isSafeCalendarFilterRegex('^((a|aa))+$')).toBe(false);
    });

    it('should reject backreferences', () => {
      expect(isSafeCalendarFilterRegex('^(a+)\\1+$')).toBe(false);
      expect(isSafeCalendarFilterRegex('^(?<word>\\w+)\\k<word>$')).toBe(false);
    });
  });

  describe('length cap', () => {
    it('should fail closed on an include regex longer than the limit', () => {
      // Oversized include is treated as unusable; hide the event rather than
      // silently broadening the user's intended scope.
      const oversized = 'a'.repeat(CALENDAR_REGEX_FILTER_MAX_LENGTH + 1);
      expect(passesCalendarEventRegexFilter(baseEvent, oversized, null)).toBe(false);
    });

    it('should fail open on an exclude regex longer than the limit', () => {
      // Oversized exclude degrades to "no exclusion" - matches prior
      // invalid-regex UX so a bad exclude does not hide every event.
      const oversized = 'a'.repeat(CALENDAR_REGEX_FILTER_MAX_LENGTH + 1);
      expect(passesCalendarEventRegexFilter(baseEvent, null, oversized)).toBe(true);
    });

    it('should still apply a regex exactly at the limit', () => {
      // 256-char pattern that still matches 'Team Meeting' via alternation. A
      // naive `'Meeting'.padEnd(256, '.')` fails because `.` matches any char,
      // requiring a 256+ char title.
      const padded =
        'Meeting|' + 'a'.repeat(CALENDAR_REGEX_FILTER_MAX_LENGTH - 'Meeting|'.length);
      expect(padded.length).toBe(CALENDAR_REGEX_FILTER_MAX_LENGTH);
      expect(passesCalendarEventRegexFilter(baseEvent, padded, null)).toBe(true);
    });

    it('should not let an oversized include be bypassed by also-oversized exclude', () => {
      const oversized = 'a'.repeat(CALENDAR_REGEX_FILTER_MAX_LENGTH + 1);
      expect(passesCalendarEventRegexFilter(baseEvent, oversized, oversized)).toBe(false);
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
