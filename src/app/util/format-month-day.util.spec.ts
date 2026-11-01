import { DateTimeLocale, DateTimeLocales } from '../core/locale.constants';
import {
  formatMonthDay,
  formatMonthDayWithYear,
  formatMonthDayWithYearIfNeeded,
} from './format-month-day.util';

describe('formatMonthDay', () => {
  const testDate = new Date(2023, 11, 25); // December 25, 2023
  const singleDigitDate = new Date(2023, 0, 5); // January 5, 2023

  describe('US locale (en-US)', () => {
    it('should format dates as MM/DD', () => {
      const result = formatMonthDay(testDate, DateTimeLocales.en_us);
      expect(result).toBe('12/25');
    });

    it('should handle single digit months and days', () => {
      const result = formatMonthDay(singleDigitDate, DateTimeLocales.en_us);
      expect(result).toBe('1/5');
    });
  });

  describe('UK locale (en-GB)', () => {
    it('should format dates as DD/MM', () => {
      const result = formatMonthDay(testDate, DateTimeLocales.en_gb);
      expect(result).toBe('25/12');
    });

    it('should handle single digit months and days', () => {
      const result = formatMonthDay(singleDigitDate, DateTimeLocales.en_gb);
      expect(result).toBe('05/01');
    });
  });

  describe('Turkish locale (tr-TR)', () => {
    it('should format dates as DD/MM', () => {
      const result = formatMonthDay(testDate, DateTimeLocales.tr_tr);
      expect(result).toBe('25/12'); // Turkish format: DD/MM or DD.MM
    });

    it('should handle single digit months and days', () => {
      const result = formatMonthDay(singleDigitDate, DateTimeLocales.tr_tr);
      expect(result).toBe('5/01');
    });
  });

  describe('German locale (de-DE)', () => {
    it('should format dates as DD.MM.', () => {
      const result = formatMonthDay(testDate, DateTimeLocales.de_de);
      expect(result).toBe('25.12.'); // Note: German includes trailing period
    });

    it('should handle single digit months and days', () => {
      const result = formatMonthDay(singleDigitDate, DateTimeLocales.de_de);
      expect(result).toBe('05.01.');
    });
  });

  describe('French locale (fr-FR)', () => {
    it('should format dates as DD/MM', () => {
      const result = formatMonthDay(testDate, DateTimeLocales.fr_fr);
      expect(result).toBe('25/12');
    });

    it('should handle single digit months and days', () => {
      const result = formatMonthDay(singleDigitDate, DateTimeLocales.fr_fr);
      expect(result).toBe('05/01');
    });
  });

  describe('Spanish locale (es-ES)', () => {
    it('should format dates as DD/MM', () => {
      const result = formatMonthDay(testDate, DateTimeLocales.es_es);
      expect(result).toBe('25/12');
    });

    it('should handle single digit months and days', () => {
      const result = formatMonthDay(singleDigitDate, DateTimeLocales.es_es);
      expect(result).toBe('5/1'); // No zero-padding
    });
  });

  describe('Italian locale (it-IT)', () => {
    it('should format dates as DD/MM', () => {
      const result = formatMonthDay(testDate, DateTimeLocales.it_it);
      expect(result).toBe('25/12');
    });

    it('should handle single digit months and days', () => {
      const result = formatMonthDay(singleDigitDate, DateTimeLocales.it_it);
      expect(result).toBe('05/01');
    });
  });

  describe('Portuguese Brazil locale (pt-BR)', () => {
    it('should format dates as DD/MM', () => {
      const result = formatMonthDay(testDate, DateTimeLocales.pt_br);
      expect(result).toBe('25/12');
    });

    it('should handle single digit months and days', () => {
      const result = formatMonthDay(singleDigitDate, DateTimeLocales.pt_br);
      expect(result).toBe('05/01');
    });
  });

  describe('Russian locale (ru-RU)', () => {
    it('should format dates as DD.MM', () => {
      const result = formatMonthDay(testDate, DateTimeLocales.ru_ru);
      expect(result).toBe('25.12'); // Note: ru-RU uses dots, no trailing period
    });

    it('should handle single digit months and days', () => {
      const result = formatMonthDay(singleDigitDate, DateTimeLocales.ru_ru);
      expect(result).toBe('05.01');
    });
  });

  describe('Chinese Simplified locale (zh-CN)', () => {
    it('should format dates as MM/DD', () => {
      const result = formatMonthDay(testDate, DateTimeLocales.zh_cn);
      expect(result).toBe('12/25'); // Chinese uses MM/DD format
    });

    it('should handle single digit months and days', () => {
      const result = formatMonthDay(singleDigitDate, DateTimeLocales.zh_cn);
      expect(result).toBe('1/5'); // No zero-padding
    });
  });

  describe('Japanese locale (ja-JP)', () => {
    it('should format dates as MM/DD', () => {
      const result = formatMonthDay(testDate, DateTimeLocales.ja_jp);
      expect(result).toBe('12/25'); // Japanese uses MM/DD format for month/day
    });

    it('should handle single digit months and days', () => {
      const result = formatMonthDay(singleDigitDate, DateTimeLocales.ja_jp);
      // short date "2000/01/05" pads only because it is year-first
      expect(result).toBe('1/5');
    });
  });

  describe('Swedish locale (sv), the ISO 8601 option', () => {
    it('should not take padding from the year-first ISO short date', () => {
      const result = formatMonthDay(singleDigitDate, DateTimeLocales.sv);
      expect(result).toBe('5/1');
    });
  });

  describe('Korean locale (ko-KR)', () => {
    it('should format dates as MM. DD.', () => {
      const result = formatMonthDay(testDate, DateTimeLocales.ko_kr);
      expect(result).toBe('12. 25.'); // Korean uses MM. DD. format with periods and spaces
    });

    it('should handle single digit months and days', () => {
      const result = formatMonthDay(singleDigitDate, DateTimeLocales.ko_kr);
      expect(result).toBe('1. 5.'); // No zero-padding, uses periods with spaces
    });
  });

  describe('Persian locale (fa), non-Gregorian calendar', () => {
    it('should not pad single digits its short date leaves unpadded', () => {
      // Jan 21, 2000 = 1 Bahman 1378; fa short date is "۱۳۷۸/۱۱/۱"
      const result = formatMonthDay(new Date(2000, 0, 21), DateTimeLocales.fa);
      expect(result).toBe('۱۱/۱');
    });
  });

  describe('Error handling', () => {
    it('should return empty string for invalid dates', () => {
      const result = formatMonthDay(new Date('invalid'), DateTimeLocales.en_us);
      expect(result).toBe('');
    });

    it('should return empty string for null dates', () => {
      const result = formatMonthDay(null as any, DateTimeLocales.en_us);
      expect(result).toBe('');
    });

    it('should handle different year formats without including them in result', () => {
      // Test that both 2-digit and 4-digit years are properly removed
      const result = formatMonthDay(testDate, DateTimeLocales.en_us);
      expect(result).not.toContain('23');
      expect(result).not.toContain('2023');
    });

    it('should fallback to basic format when locale data is missing', () => {
      // Use a non-existent locale to trigger fallback
      const result = formatMonthDay(testDate, 'xx-XX' as DateTimeLocale);
      expect(result).toBe('25/12'); // Should fallback to d/M format
    });
  });

  describe('Locale-specific expectations', () => {
    it('should respect locale ordering differences', () => {
      // Same date should format differently for US vs GB
      const usResult = formatMonthDay(testDate, DateTimeLocales.en_us);
      const gbResult = formatMonthDay(testDate, DateTimeLocales.en_gb);

      expect(usResult).toBe('12/25'); // Month/Day
      expect(gbResult).toBe('25/12'); // Day/Month
      expect(usResult).not.toBe(gbResult); // Should be different
    });

    it('should handle various separator styles', () => {
      const usResult = formatMonthDay(testDate, DateTimeLocales.en_us); // Uses /
      const deResult = formatMonthDay(testDate, DateTimeLocales.de_de); // Uses . with trailing period
      const ruResult = formatMonthDay(testDate, DateTimeLocales.ru_ru); // Uses . without trailing period
      const krResult = formatMonthDay(testDate, DateTimeLocales.ko_kr); // Uses . with spaces

      expect(usResult).toContain('/');
      expect(deResult).toContain('.');
      expect(ruResult).toContain('.');
      expect(krResult).toContain('. '); // Korean has space after period
    });

    it('should differentiate between MM/DD and DD/MM locales', () => {
      // MM/DD format locales
      const mmddLocales = [
        DateTimeLocales.en_us,
        DateTimeLocales.zh_cn,
        DateTimeLocales.ja_jp,
      ];

      // DD/MM format locales
      const ddmmLocales = [
        DateTimeLocales.en_gb,
        DateTimeLocales.fr_fr,
        DateTimeLocales.es_es,
        DateTimeLocales.it_it,
        DateTimeLocales.pt_br,
        DateTimeLocales.tr_tr,
      ];

      mmddLocales.forEach((locale) => {
        const result = formatMonthDay(testDate, locale);
        expect(result.startsWith('12')).toBe(true); // Should start with month
      });

      ddmmLocales.forEach((locale) => {
        const result = formatMonthDay(testDate, locale);
        expect(result.startsWith('25')).toBe(true); // Should start with day
      });
    });

    it('should pad day and month only where the locale short date does (#11081)', () => {
      const padded = [
        DateTimeLocales.de_de,
        DateTimeLocales.en_gb,
        DateTimeLocales.fr_fr,
        DateTimeLocales.ru_ru,
      ];
      const unpadded = [
        DateTimeLocales.en_us,
        DateTimeLocales.es_es,
        DateTimeLocales.zh_cn,
        DateTimeLocales.ko_kr,
      ];

      padded.forEach((locale) => {
        expect(formatMonthDay(singleDigitDate, locale)).toMatch(/05\D+01/);
      });
      unpadded.forEach((locale) => {
        expect(formatMonthDay(singleDigitDate, locale)).not.toMatch(/\b0\d/);
      });
    });
  });
});

describe('formatMonthDayWithYear (#10804)', () => {
  const nextYearDate = new Date(2027, 5, 1); // June 1, 2027

  it('adds a 2-digit year in the locale order', () => {
    expect(formatMonthDayWithYear(nextYearDate, DateTimeLocales.en_us)).toBe('6/1/27');
    expect(formatMonthDayWithYear(nextYearDate, DateTimeLocales.en_gb)).toBe('01/06/27');
    expect(formatMonthDayWithYear(nextYearDate, DateTimeLocales.de_de)).toBe('01.06.27');
    expect(formatMonthDayWithYear(nextYearDate, DateTimeLocales.ko_kr)).toBe('27. 6. 1.');
  });

  it('uses the full year in year-first formats, where "27" would read like a day', () => {
    expect(formatMonthDayWithYear(nextYearDate, DateTimeLocales.sv)).toBe('2027-06-01');
    expect(formatMonthDayWithYear(nextYearDate, DateTimeLocales.ja_jp)).toBe('2027/6/1');
    expect(formatMonthDayWithYear(nextYearDate, DateTimeLocales.zh_cn)).toBe('2027/6/1');
  });

  it('pads day and month like formatMonthDay', () => {
    const singleDigitDate = new Date(2027, 0, 5); // January 5, 2027
    const cases: [DateTimeLocale, string, string][] = [
      [DateTimeLocales.en_us, '1/5', '1/5/27'],
      [DateTimeLocales.en_gb, '05/01', '05/01/27'],
      [DateTimeLocales.de_de, '05.01.', '05.01.27'],
      [DateTimeLocales.fr_fr, '05/01', '05/01/27'],
      [DateTimeLocales.es_es, '5/1', '5/1/27'],
      [DateTimeLocales.nl, '05-01', '05-01-27'],
    ];
    cases.forEach(([locale, withoutYear, withYear]) => {
      expect(formatMonthDay(singleDigitDate, locale)).toBe(withoutYear);
      expect(formatMonthDayWithYear(singleDigitDate, locale)).toBe(withYear);
    });
  });

  it("takes separators from the locale's format with a year, which can differ", () => {
    const singleDigitDate = new Date(2027, 0, 5);
    expect(formatMonthDay(singleDigitDate, DateTimeLocales.tr_tr)).toBe('5/01');
    expect(formatMonthDayWithYear(singleDigitDate, DateTimeLocales.tr_tr)).toBe(
      '5.01.27',
    );
    expect(formatMonthDay(singleDigitDate, DateTimeLocales.sv)).toBe('5/1');
    expect(formatMonthDayWithYear(singleDigitDate, DateTimeLocales.sv)).toBe(
      '2027-01-05',
    );
  });

  it('returns an empty string for an invalid date', () => {
    expect(formatMonthDayWithYear(new Date('invalid'), DateTimeLocales.en_us)).toBe('');
  });
});

describe('formatMonthDayWithYearIfNeeded (#10804)', () => {
  const today = new Date(2026, 9, 29); // October 29, 2026

  it('omits the year for dates in the same year as today', () => {
    const date = new Date(2026, 11, 20);
    expect(formatMonthDayWithYearIfNeeded(date, DateTimeLocales.en_us, today)).toBe(
      '12/20',
    );
    expect(formatMonthDayWithYearIfNeeded(date, DateTimeLocales.nl, today)).toBe(
      formatMonthDay(date, DateTimeLocales.nl),
    );
  });

  it('adds the year for dates in any other year', () => {
    expect(
      formatMonthDayWithYearIfNeeded(new Date(2027, 5, 1), DateTimeLocales.en_us, today),
    ).toBe('6/1/27');
    expect(
      formatMonthDayWithYearIfNeeded(
        new Date(2025, 11, 31),
        DateTimeLocales.en_us,
        today,
      ),
    ).toBe('12/31/25');
  });

  it("compares years in the locale's calendar (Persian year starts in March)", () => {
    const fa = DateTimeLocales.fa;
    // Jan 15, 2027 and Oct 29, 2026 are both in Persian year 1405
    expect(formatMonthDayWithYearIfNeeded(new Date(2027, 0, 15), fa, today)).toBe(
      formatMonthDay(new Date(2027, 0, 15), fa),
    );
    // Apr 1, 2027 is in 1406, while Jan 15, 2027 is still in 1405
    expect(
      formatMonthDayWithYearIfNeeded(new Date(2027, 3, 1), fa, new Date(2027, 0, 15)),
    ).toBe(formatMonthDayWithYear(new Date(2027, 3, 1), fa));
  });

  it('returns an empty string for an invalid date', () => {
    expect(
      formatMonthDayWithYearIfNeeded(new Date('invalid'), DateTimeLocales.en_us, today),
    ).toBe('');
  });
});
