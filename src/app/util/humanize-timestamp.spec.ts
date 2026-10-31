/* eslint-disable no-mixed-operators */
import { humanizeTimestamp } from './humanize-timestamp';
import { TranslateService } from '@ngx-translate/core';
import { T } from '../t.const';

describe('humanizeTimestamp', () => {
  let now: Date;
  let mockTranslateService: jasmine.SpyObj<TranslateService>;

  beforeEach(() => {
    now = new Date(2024, 0, 15, 12, 0, 0);
    jasmine.clock().install();
    jasmine.clock().mockDate(now);

    mockTranslateService = jasmine.createSpyObj('TranslateService', ['instant']);
    // Mock the translations to return the expected English strings
    mockTranslateService.instant.and.callFake((key: string, params?: any) => {
      const translations: Record<string, string> = {};
      translations[T.GLOBAL_RELATIVE_TIME.PAST.FEW_SECONDS] = 'a few seconds ago';
      translations[T.GLOBAL_RELATIVE_TIME.PAST.A_MINUTE] = 'a minute ago';
      translations[T.GLOBAL_RELATIVE_TIME.PAST.MINUTES] = `${params?.count} minutes ago`;
      translations[T.GLOBAL_RELATIVE_TIME.PAST.AN_HOUR] = 'an hour ago';
      translations[T.GLOBAL_RELATIVE_TIME.PAST.HOURS] = `${params?.count} hours ago`;
      translations[T.GLOBAL_RELATIVE_TIME.PAST.A_DAY] = 'a day ago';
      translations[T.GLOBAL_RELATIVE_TIME.PAST.DAYS] = `${params?.count} days ago`;
      translations[T.GLOBAL_RELATIVE_TIME.PAST.A_MONTH] = 'a month ago';
      translations[T.GLOBAL_RELATIVE_TIME.PAST.MONTHS] = `${params?.count} months ago`;
      translations[T.GLOBAL_RELATIVE_TIME.PAST.A_YEAR] = 'a year ago';
      translations[T.GLOBAL_RELATIVE_TIME.PAST.YEARS] = `${params?.count} years ago`;
      translations[T.GLOBAL_RELATIVE_TIME.FUTURE.FEW_SECONDS] = 'in a few seconds';
      translations[T.GLOBAL_RELATIVE_TIME.FUTURE.A_MINUTE] = 'in a minute';
      translations[T.GLOBAL_RELATIVE_TIME.FUTURE.MINUTES] = `in ${params?.count} minutes`;
      translations[T.GLOBAL_RELATIVE_TIME.FUTURE.AN_HOUR] = 'in an hour';
      translations[T.GLOBAL_RELATIVE_TIME.FUTURE.HOURS] = `in ${params?.count} hours`;
      translations[T.GLOBAL_RELATIVE_TIME.FUTURE.A_DAY] = 'in a day';
      translations[T.GLOBAL_RELATIVE_TIME.FUTURE.DAYS] = `in ${params?.count} days`;
      translations[T.GLOBAL_RELATIVE_TIME.FUTURE.A_MONTH] = 'in a month';
      translations[T.GLOBAL_RELATIVE_TIME.FUTURE.MONTHS] = `in ${params?.count} months`;
      translations[T.GLOBAL_RELATIVE_TIME.FUTURE.A_YEAR] = 'in a year';
      translations[T.GLOBAL_RELATIVE_TIME.FUTURE.YEARS] = `in ${params?.count} years`;
      return translations[key] || key;
    });
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  it('should return empty string for falsy values', () => {
    expect(humanizeTimestamp(null as any, mockTranslateService)).toBe('');
    expect(humanizeTimestamp(undefined as any, mockTranslateService)).toBe('');
    expect(humanizeTimestamp('', mockTranslateService)).toBe('');
  });

  it('should return empty string for invalid dates', () => {
    expect(humanizeTimestamp('invalid', mockTranslateService)).toBe('');
  });

  describe('past dates', () => {
    it('should handle seconds ago', () => {
      const date = new Date(now.getTime() - 30 * 1000);
      expect(humanizeTimestamp(date, mockTranslateService)).toBe('a few seconds ago');
    });

    it('should handle a minute ago', () => {
      const date = new Date(now.getTime() - 60 * 1000);
      expect(humanizeTimestamp(date, mockTranslateService)).toBe('a minute ago');
    });

    it('should handle minutes ago', () => {
      const date = new Date(now.getTime() - 5 * 60 * 1000);
      expect(humanizeTimestamp(date, mockTranslateService)).toBe('5 minutes ago');

      const date2 = new Date(now.getTime() - 44 * 60 * 1000);
      expect(humanizeTimestamp(date2, mockTranslateService)).toBe('44 minutes ago');
    });

    it('should handle an hour ago', () => {
      const date = new Date(now.getTime() - 60 * 60 * 1000);
      expect(humanizeTimestamp(date, mockTranslateService)).toBe('an hour ago');
    });

    it('should handle hours ago', () => {
      const date = new Date(now.getTime() - 3 * 60 * 60 * 1000);
      expect(humanizeTimestamp(date, mockTranslateService)).toBe('3 hours ago');
    });

    it('should handle a day ago', () => {
      const date = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      expect(humanizeTimestamp(date, mockTranslateService)).toBe('a day ago');
    });

    it('should handle days ago', () => {
      const date = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      expect(humanizeTimestamp(date, mockTranslateService)).toBe('7 days ago');
    });

    it('should handle a month ago', () => {
      const date = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      expect(humanizeTimestamp(date, mockTranslateService)).toBe('a month ago');
    });

    it('should handle months ago', () => {
      const date = new Date(now.getTime() - 6 * 30 * 24 * 60 * 60 * 1000);
      expect(humanizeTimestamp(date, mockTranslateService)).toBe('6 months ago');
    });

    it('should handle a year ago', () => {
      const date = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      expect(humanizeTimestamp(date, mockTranslateService)).toBe('a year ago');
    });

    it('should handle years ago', () => {
      const date = new Date(now.getTime() - 3 * 365 * 24 * 60 * 60 * 1000);
      expect(humanizeTimestamp(date, mockTranslateService)).toBe('3 years ago');
    });
  });

  describe('future dates', () => {
    it('should handle seconds in future', () => {
      const date = new Date(now.getTime() + 30 * 1000);
      expect(humanizeTimestamp(date, mockTranslateService)).toBe('in a few seconds');
    });

    it('should handle a minute in future', () => {
      const date = new Date(now.getTime() + 60 * 1000);
      expect(humanizeTimestamp(date, mockTranslateService)).toBe('in a minute');
    });

    it('should handle minutes in future', () => {
      const date = new Date(now.getTime() + 5 * 60 * 1000);
      expect(humanizeTimestamp(date, mockTranslateService)).toBe('in 5 minutes');
    });

    it('should handle an hour in future', () => {
      const date = new Date(now.getTime() + 60 * 60 * 1000);
      expect(humanizeTimestamp(date, mockTranslateService)).toBe('in an hour');
    });

    it('should handle hours in future', () => {
      const date = new Date(now.getTime() + 3 * 60 * 60 * 1000);
      expect(humanizeTimestamp(date, mockTranslateService)).toBe('in 3 hours');
    });

    it('should handle a day in future', () => {
      const date = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      expect(humanizeTimestamp(date, mockTranslateService)).toBe('in a day');
    });

    it('should handle days in future', () => {
      const date = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      expect(humanizeTimestamp(date, mockTranslateService)).toBe('in 7 days');
    });

    it('should handle a year in future', () => {
      const date = new Date(now.getTime() + 400 * 24 * 60 * 60 * 1000);
      expect(humanizeTimestamp(date, mockTranslateService)).toBe('in a year');
    });

    it('should round future relative times toward zero like past ones', () => {
      const cases: [number, string, string][] = [
        [3 * 60 * 60 * 1000, '3 hours ago', 'in 3 hours'],
        [10 * 24 * 60 * 60 * 1000, '10 days ago', 'in 10 days'],
        [60 * 24 * 60 * 60 * 1000, '2 months ago', 'in 2 months'],
        [400 * 24 * 60 * 60 * 1000, 'a year ago', 'in a year'],
        [800 * 24 * 60 * 60 * 1000, '2 years ago', 'in 2 years'],
      ];
      for (const [ms, pastExpected, futureExpected] of cases) {
        expect(
          humanizeTimestamp(new Date(now.getTime() - ms), mockTranslateService),
        ).toBe(pastExpected);
        expect(
          humanizeTimestamp(new Date(now.getTime() + ms), mockTranslateService),
        ).toBe(futureExpected);
      }
    });
  });

  it('should handle timestamps', () => {
    const timestamp = now.getTime() - 5 * 60 * 1000;
    expect(humanizeTimestamp(timestamp, mockTranslateService)).toBe('5 minutes ago');
  });

  it('should handle date strings', () => {
    const dateStr = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    expect(humanizeTimestamp(dateStr, mockTranslateService)).toBe('2 hours ago');
  });
});
