import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { LocalDateStrPipe } from './local-date-str.pipe';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { DateService } from '../../core/date/date.service';
import { DateTimeLocales } from '../../core/locale.constants';

describe('LocalDateStrPipe', () => {
  let pipe: LocalDateStrPipe;
  // The app's today as DateService reports it (start-of-next-day offset applied)
  let appToday: string;

  beforeEach(() => {
    appToday = '2026-10-28';
    TestBed.configureTestingModule({
      providers: [
        LocalDateStrPipe,
        {
          provide: DateTimeFormatService,
          useValue: { currentLocale: () => DateTimeLocales.en_us },
        },
        { provide: TranslateService, useValue: { instant: () => 'Today' } },
        { provide: DateService, useValue: { todayStr: () => appToday } },
      ],
    });
    pipe = TestBed.inject(LocalDateStrPipe);
  });

  it('returns null for a value that is not a date string', () => {
    expect(pipe.transform(undefined)).toBeNull();
    expect(pipe.transform('not-a-date')).toBeNull();
  });

  it('shows "Today" for today', () => {
    expect(pipe.transform('2026-10-28', '2026-10-28')).toBe('Today');
  });

  it('shows only month and day within the current year', () => {
    expect(pipe.transform('2026-12-20', '2026-10-28')).toBe('12/20');
  });

  it('adds a 2-digit year outside the current year (#10804)', () => {
    expect(pipe.transform('2027-06-01', '2026-10-28')).toBe('6/1/27');
    expect(pipe.transform('2025-12-31', '2026-10-28')).toBe('12/31/25');
  });

  it("uses DateService's today, not the wall clock, when no today string is given", () => {
    appToday = '2031-03-01';
    expect(pipe.transform('2031-03-01')).toBe('Today');
    expect(pipe.transform('2031-12-20')).toBe('12/20');
    expect(pipe.transform('2026-12-20')).toBe('12/20/26');
  });

  describe('just after midnight on New Year (start of next day at 4:00)', () => {
    beforeEach(() => {
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(2027, 0, 1, 1, 0)); // wall clock: 2027
      appToday = '2026-12-31'; // the app's day is still Dec 31, 2026
    });
    afterEach(() => jasmine.clock().uninstall());

    it("takes the year from the app's day, not the wall clock", () => {
      expect(pipe.transform('2026-12-30')).toBe('12/30');
      expect(pipe.transform('2027-01-02')).toBe('1/2/27');
    });
  });

  it("falls back to DateService's today for an invalid today string", () => {
    expect(pipe.transform('2026-10-28', 'garbage')).toBe('Today');
    expect(pipe.transform('2027-06-01', '')).toBe('6/1/27');
  });
});
