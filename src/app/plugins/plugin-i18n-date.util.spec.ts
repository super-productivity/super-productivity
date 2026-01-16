import { formatDateForPlugin } from './plugin-i18n-date.util';

describe('formatDateForPlugin', () => {
  const testDate = new Date('2026-01-16T14:30:00Z');
  const testTimestamp = testDate.getTime();
  const testISOString = '2026-01-16T14:30:00Z';

  describe('short format', () => {
    it('should format date with short format in English', () => {
      const result = formatDateForPlugin(testDate, 'short', 'en');
      // Format: M/D/YY or similar
      expect(result).toMatch(/\d{1,2}\/\d{1,2}\/\d{2}/);
    });

    it('should format date with short format in German', () => {
      const result = formatDateForPlugin(testDate, 'short', 'de');
      // Format: D.M.YY or similar
      expect(result).toMatch(/\d{1,2}\.\d{1,2}\.\d{2}/);
    });

    it('should handle different locales', () => {
      const enResult = formatDateForPlugin(testDate, 'short', 'en');
      const deResult = formatDateForPlugin(testDate, 'short', 'de');
      const frResult = formatDateForPlugin(testDate, 'short', 'fr');

      // Results should be different for different locales
      expect(enResult).not.toBe(deResult);
      expect(deResult).not.toBe(frResult);
    });
  });

  describe('medium format', () => {
    it('should format date with medium format in English', () => {
      const result = formatDateForPlugin(testDate, 'medium', 'en');
      // Should contain month abbreviation (Jan, Feb, etc.)
      expect(result).toContain('Jan');
      expect(result).toContain('16');
      expect(result).toContain('2026');
    });

    it('should format date with medium format in German', () => {
      const result = formatDateForPlugin(testDate, 'medium', 'de');
      // German uses "Jan" as well, but format differs
      expect(result).toContain('16');
      expect(result).toContain('2026');
    });
  });

  describe('long format', () => {
    it('should format date with long format in English', () => {
      const result = formatDateForPlugin(testDate, 'long', 'en');
      // Should contain full month name
      expect(result).toContain('January');
      expect(result).toContain('16');
      expect(result).toContain('2026');
    });

    it('should format date with long format in German', () => {
      const result = formatDateForPlugin(testDate, 'long', 'de');
      // German uses full month names
      expect(result).toContain('16');
      expect(result).toContain('2026');
    });
  });

  describe('time format', () => {
    it('should format time only in English (12-hour)', () => {
      const result = formatDateForPlugin(testDate, 'time', 'en');
      // English typically uses 12-hour format with AM/PM
      expect(result).toMatch(/\d{1,2}:\d{2}\s*(AM|PM|am|pm)?/i);
    });

    it('should format time only in German (24-hour)', () => {
      const result = formatDateForPlugin(testDate, 'time', 'de');
      // German uses 24-hour format
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });
  });

  describe('datetime format', () => {
    it('should format datetime in English', () => {
      const result = formatDateForPlugin(testDate, 'datetime', 'en');
      // Should contain both date and time
      expect(result).toMatch(/\d{1,2}\/\d{1,2}\/\d{2}/);
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });

    it('should format datetime in German', () => {
      const result = formatDateForPlugin(testDate, 'datetime', 'de');
      // Should contain both date and time
      expect(result).toMatch(/\d{1,2}\.\d{1,2}\.\d{2}/);
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });
  });

  describe('input types', () => {
    it('should handle Date objects', () => {
      const result = formatDateForPlugin(testDate, 'short', 'en');
      expect(result).toBeTruthy();
      expect(result).not.toBe('');
    });

    it('should handle ISO date strings', () => {
      const result = formatDateForPlugin(testISOString, 'short', 'en');
      expect(result).toBeTruthy();
      expect(result).not.toBe('');
    });

    it('should handle timestamps (numbers)', () => {
      const result = formatDateForPlugin(testTimestamp, 'short', 'en');
      expect(result).toBeTruthy();
      expect(result).not.toBe('');
    });

    it('should produce same result for different input types', () => {
      const dateResult = formatDateForPlugin(testDate, 'short', 'en');
      const stringResult = formatDateForPlugin(testISOString, 'short', 'en');
      const timestampResult = formatDateForPlugin(testTimestamp, 'short', 'en');

      expect(dateResult).toBe(stringResult);
      expect(stringResult).toBe(timestampResult);
    });
  });

  describe('invalid inputs', () => {
    it('should return empty string for invalid Date object', () => {
      const invalidDate = new Date('invalid');
      const result = formatDateForPlugin(invalidDate, 'short', 'en');
      expect(result).toBe('');
    });

    it('should return empty string for invalid date string', () => {
      const result = formatDateForPlugin('not a date', 'short', 'en');
      expect(result).toBe('');
    });

    it('should return empty string for NaN timestamp', () => {
      const result = formatDateForPlugin(NaN, 'short', 'en');
      expect(result).toBe('');
    });

    it('should return empty string for null', () => {
      const result = formatDateForPlugin(null as unknown as Date, 'short', 'en');
      expect(result).toBe('');
    });

    it('should return empty string for undefined', () => {
      const result = formatDateForPlugin(undefined as unknown as Date, 'short', 'en');
      expect(result).toBe('');
    });

    it('should return empty string for invalid format string', () => {
      const result = formatDateForPlugin(testDate, 'invalid-format' as 'short', 'en');
      expect(result).toBe('');
    });
  });

  describe('locale fallback', () => {
    it('should fallback to English for invalid locale', () => {
      const result = formatDateForPlugin(testDate, 'short', 'invalid-locale');
      // Should not throw and should return a formatted date
      expect(result).toBeTruthy();
      expect(result).not.toBe('');
    });

    it('should handle empty locale string', () => {
      const result = formatDateForPlugin(testDate, 'short', '');
      // Should fallback and not throw
      expect(result).toBeTruthy();
      expect(result).not.toBe('');
    });
  });

  describe('edge cases', () => {
    it('should format dates at year boundaries', () => {
      const newYearsEve = new Date('2025-12-31T23:59:59Z');
      const result = formatDateForPlugin(newYearsEve, 'short', 'en');
      expect(result).toBeTruthy();
    });

    it('should format leap year dates', () => {
      const leapDay = new Date('2024-02-29T12:00:00Z');
      const result = formatDateForPlugin(leapDay, 'long', 'en');
      expect(result).toContain('29');
      expect(result).toContain('February');
    });

    it('should format very old dates', () => {
      const oldDate = new Date('1900-01-01T00:00:00Z');
      const result = formatDateForPlugin(oldDate, 'short', 'en');
      expect(result).toBeTruthy();
    });

    it('should format far future dates', () => {
      const futureDate = new Date('2099-12-31T23:59:59Z');
      const result = formatDateForPlugin(futureDate, 'short', 'en');
      expect(result).toBeTruthy();
    });

    it('should format midnight times', () => {
      const midnight = new Date('2026-01-16T00:00:00Z');
      const result = formatDateForPlugin(midnight, 'time', 'en');
      expect(result).toBeTruthy();
    });

    it('should format noon times', () => {
      const noon = new Date('2026-01-16T12:00:00Z');
      const result = formatDateForPlugin(noon, 'time', 'en');
      expect(result).toBeTruthy();
    });
  });

  describe('consistency', () => {
    it('should produce consistent results for same input', () => {
      const result1 = formatDateForPlugin(testDate, 'short', 'en');
      const result2 = formatDateForPlugin(testDate, 'short', 'en');
      expect(result1).toBe(result2);
    });

    it('should produce consistent results across multiple formats', () => {
      const formats: Array<'short' | 'medium' | 'long' | 'time' | 'datetime'> = [
        'short',
        'medium',
        'long',
        'time',
        'datetime',
      ];

      formats.forEach((format) => {
        const result = formatDateForPlugin(testDate, format, 'en');
        expect(result).toBeTruthy();
        expect(result).not.toBe('');
      });
    });
  });
});
