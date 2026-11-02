import { TestBed } from '@angular/core/testing';
import { MAT_DATE_LOCALE } from '@angular/material/core';
import { CustomDateAdapter } from './custom-date-adapter';
import { DateTimeFormatService } from './date-time-format.service';
import { GlobalConfigService } from '../../features/config/global-config.service';

describe('CustomDateAdapter (ISO weekday/month localization)', () => {
  let adapter: CustomDateAdapter;
  let isoTextLocale: string | null;

  const RAW_NUMERIC_FORMAT = 'yyyy-MM-dd';
  const NUMERIC_SENTINEL = 'NUMERIC-2026-07-14';
  // July 14, 2026 (month index 6). Local components are UTC-normalized by the
  // adapter's `_format`, so the rendered month/weekday is stable across zones.
  const testDate = new Date(2026, 6, 14);

  beforeEach(() => {
    isoTextLocale = null;

    const dateTimeFormatServiceMock: Partial<DateTimeFormatService> = {
      isoTextLocale: (() => isoTextLocale) as DateTimeFormatService['isoTextLocale'],
      dateFormat: (() => ({
        raw: RAW_NUMERIC_FORMAT,
        humanReadable: RAW_NUMERIC_FORMAT.toUpperCase(),
      })) as DateTimeFormatService['dateFormat'],
      formatDate: () => NUMERIC_SENTINEL,
    };

    TestBed.configureTestingModule({
      providers: [
        CustomDateAdapter,
        { provide: MAT_DATE_LOCALE, useValue: 'sv' },
        { provide: DateTimeFormatService, useValue: dateTimeFormatServiceMock },
        {
          provide: GlobalConfigService,
          useValue: { localization: () => ({ firstDayOfWeek: 1 }) },
        },
      ],
    });

    adapter = TestBed.inject(CustomDateAdapter);
    // Mirror the app: the ISO 8601 option keeps `sv` as the adapter locale.
    adapter.setLocale('sv');
  });

  describe('with an ISO text locale set (ISO 8601 option active)', () => {
    it('renders weekday names in the UI language', () => {
      isoTextLocale = 'en';
      expect(adapter.getDayOfWeekNames('long')).toContain('Monday');

      isoTextLocale = 'de';
      expect(adapter.getDayOfWeekNames('long')).toContain('Montag');
    });

    it('renders month names in the UI language', () => {
      isoTextLocale = 'en';
      expect(adapter.getMonthNames('long')[6]).toBe('July');

      isoTextLocale = 'de';
      expect(adapter.getMonthNames('long')[6]).toBe('Juli');
    });

    it('renders the spelled-out month/year header in the UI language', () => {
      isoTextLocale = 'en';
      expect(adapter.format(testDate, { year: 'numeric', month: 'long' })).toBe(
        'July 2026',
      );
    });

    it('keeps the numeric date format on the configured locale', () => {
      isoTextLocale = 'en';
      expect(adapter.format(testDate, RAW_NUMERIC_FORMAT)).toBe(NUMERIC_SENTINEL);
    });

    it('keeps time-only formats on the adapter locale (24h preserved)', () => {
      isoTextLocale = 'en-US';
      const withTime = new Date(2026, 6, 14, 13, 0, 0);
      expect(adapter.format(withTime, { hour: 'numeric', minute: '2-digit' })).toBe(
        '13:00',
      );
    });

    it('restores the adapter locale after a localized read', () => {
      isoTextLocale = 'de';
      adapter.getMonthNames('long');
      adapter.getDayOfWeekNames('narrow');
      adapter.format(testDate, { year: 'numeric', month: 'long' });

      expect((adapter as unknown as { locale: string }).locale).toBe('sv');
    });
  });

  describe('without an ISO text locale (every non-ISO option)', () => {
    it('leaves weekday names on the adapter locale', () => {
      isoTextLocale = null;
      expect(adapter.getDayOfWeekNames('long')).toContain('måndag');
    });

    it('leaves month names on the adapter locale', () => {
      isoTextLocale = null;
      expect(adapter.getMonthNames('long')[6]).toBe('juli');
    });

    it('leaves the month/year header on the adapter locale', () => {
      isoTextLocale = null;
      expect(adapter.format(testDate, { year: 'numeric', month: 'long' })).toBe(
        'juli 2026',
      );
    });
  });
});

describe('CustomDateAdapter.parseTime (#8565)', () => {
  let adapter: CustomDateAdapter;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        CustomDateAdapter,
        { provide: MAT_DATE_LOCALE, useValue: 'de' },
        {
          provide: DateTimeFormatService,
          useValue: {
            dateFormat: () => ({ raw: 'dd.MM.yyyy' }),
            isoTextLocale: () => null,
          },
        },
        {
          provide: GlobalConfigService,
          useValue: { localization: () => ({ firstDayOfWeek: 1 }) },
        },
      ],
    });
    adapter = TestBed.inject(CustomDateAdapter);
  });

  const parsedClock = (value: string): string | null => {
    const d = adapter.parseTime(value, null);
    return d && adapter.isValid(d) ? `${d.getHours()}:${d.getMinutes()}` : null;
  };

  it('keeps parsing separated times', () => {
    expect(parsedClock('14:30')).toBe('14:30');
    expect(parsedClock('2:30 PM')).toBe('14:30');
  });

  it('parses a bare hour, including 20-23 (#11252)', () => {
    expect(parsedClock('9')).toBe('9:0');
    expect(parsedClock('22')).toBe('22:0');
  });

  it('parses compact digits', () => {
    expect(parsedClock('1430')).toBe('14:30');
    expect(parsedClock('930')).toBe('9:30');
    expect(parsedClock('2215')).toBe('22:15');
  });

  it('parses a compact 12h time with AM/PM', () => {
    expect(parsedClock('2pm')).toBe('14:0');
    expect(parsedClock('1230am')).toBe('0:30');
  });

  // the timepicker shows its value formatted, so editing it re-parses that text
  ['ko-kr', 'zh-tw', 'ar', 'en-us'].forEach((locale) => {
    it(`reads back a ${locale} formatted 12h time`, () => {
      adapter.setLocale(locale);
      const timeInput = { hour: 'numeric', minute: 'numeric' } as const;
      const am = adapter.format(new Date(2000, 0, 1, 1, 5), timeInput);
      const pm = adapter.format(new Date(2000, 0, 1, 14, 30), timeInput);

      expect(parsedClock(am)).toBe('1:5');
      expect(parsedClock(pm)).toBe('14:30');
    });
  });

  it('rejects out-of-range or garbage input', () => {
    expect(parsedClock('2460')).toBeNull();
    expect(parsedClock('25')).toBeNull();
    expect(parsedClock('13pm')).toBeNull();
    expect(parsedClock('abc')).toBeNull();
  });
});
