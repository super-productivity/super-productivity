import { formatTodayPrefix, parseDatePrefix } from './date-prefix.util';

describe('date-prefix.util', () => {
  describe('parseDatePrefix', () => {
    it('matches dotted dd.MM.', () => {
      expect(parseDatePrefix('18.06.: Phone call')).toEqual({
        format: 'dotted',
        length: 8,
      });
    });

    it('matches dotted dd.MM.yyyy', () => {
      expect(parseDatePrefix('18.06.2026: x')).toEqual({
        format: 'dottedYear',
        length: 12,
      });
    });

    it('matches ISO yyyy-MM-dd', () => {
      expect(parseDatePrefix('2026-06-18: x')).toEqual({ format: 'iso', length: 12 });
    });

    it('matches an unpadded dotted date', () => {
      expect(parseDatePrefix('8.6.: x')).toEqual({ format: 'dotted', length: 6 });
    });

    it('matches an unpadded ISO date', () => {
      expect(parseDatePrefix('2026-6-8: x')).toEqual({ format: 'iso', length: 10 });
    });

    it('accepts a calendar-invalid but in-range date (validation is range-only by design)', () => {
      // 31 Feb never exists, but day/month are individually in range. We do not do
      // full calendar validation — today is always regenerated correctly, so the
      // only cost is mirroring a nonsensical source date the user typed themselves.
      expect(parseDatePrefix('31.02.: x')).toEqual({ format: 'dotted', length: 8 });
    });

    it('returns null for slashed dates (ambiguous field order)', () => {
      expect(parseDatePrefix('18/06: x')).toBeNull();
    });

    it('returns null for textual months', () => {
      expect(parseDatePrefix('June 18: x')).toBeNull();
    });

    it('returns null for a 2-digit year', () => {
      expect(parseDatePrefix('18.06.26: x')).toBeNull();
    });

    it('returns null when the colon is missing', () => {
      expect(parseDatePrefix('18.06. release notes')).toBeNull();
    });

    it('returns null when the colon has no trailing space', () => {
      expect(parseDatePrefix('18.06.:x')).toBeNull();
    });

    it('returns null for an out-of-range month', () => {
      expect(parseDatePrefix('1.13.: x')).toBeNull();
    });

    it('returns null for an out-of-range day', () => {
      expect(parseDatePrefix('32.01.: x')).toBeNull();
    });

    it('returns null for a time stamp', () => {
      expect(parseDatePrefix('14:30: standup')).toBeNull();
    });
  });

  describe('formatTodayPrefix', () => {
    const today = new Date(2026, 5, 26); // 26 Jun 2026 (month is 0-indexed)

    it('formats the dotted layout', () => {
      expect(formatTodayPrefix('dotted', today)).toBe('26.06.: ');
    });

    it('formats the dotted-with-year layout', () => {
      expect(formatTodayPrefix('dottedYear', today)).toBe('26.06.2026: ');
    });

    it('formats the ISO layout', () => {
      expect(formatTodayPrefix('iso', today)).toBe('2026-06-26: ');
    });

    it('zero-pads single-digit day and month', () => {
      expect(formatTodayPrefix('dotted', new Date(2026, 0, 5))).toBe('05.01.: ');
    });
  });
});
