import { TestBed } from '@angular/core/testing';
import { DateHasOtherYearPipe } from './date-has-other-year.pipe';
import { DateService } from '../../core/date/date.service';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { DateTimeLocales } from '../../core/locale.constants';
import { dateStrToUtcDate } from '../../util/date-str-to-utc-date';

describe('DateHasOtherYearPipe', () => {
  // The app's today as DateService reports it (start-of-next-day offset applied)
  let appToday: string;
  let pipe: DateHasOtherYearPipe;

  beforeEach(() => {
    appToday = '2026-10-29';
    TestBed.configureTestingModule({
      providers: [
        DateHasOtherYearPipe,
        {
          provide: DateTimeFormatService,
          useValue: { currentLocale: () => DateTimeLocales.en_us },
        },
        {
          provide: DateService,
          useValue: { getLogicalTodayDate: () => dateStrToUtcDate(appToday) },
        },
      ],
    });
    pipe = TestBed.inject(DateHasOtherYearPipe);
  });

  it('is false without a valid date', () => {
    expect(pipe.transform(undefined)).toBeFalse();
    expect(pipe.transform(null)).toBeFalse();
    expect(pipe.transform('not-a-date')).toBeFalse();
  });

  it('is false for date strings and timestamps in the current year', () => {
    expect(pipe.transform('2026-12-20')).toBeFalse();
    expect(pipe.transform(new Date(2026, 9, 29, 22, 30).getTime())).toBeFalse();
  });

  it('is true for date strings and timestamps in another year (#10804)', () => {
    expect(pipe.transform('2027-06-01')).toBeTrue();
    expect(pipe.transform(new Date(2025, 11, 31, 10, 0).getTime())).toBeTrue();
  });

  it('takes the year from a given today string', () => {
    expect(pipe.transform('2027-06-01', '2027-03-01')).toBeFalse();
    expect(pipe.transform('2027-06-01', 'garbage')).toBeTrue();
  });

  describe('just after midnight on New Year (start of next day at 4:00)', () => {
    beforeEach(() => {
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(2027, 0, 1, 1, 0)); // wall clock: 2027
      appToday = '2026-12-31'; // the app's day is still Dec 31, 2026
    });
    afterEach(() => jasmine.clock().uninstall());

    it("takes the year from the app's day, not the wall clock", () => {
      expect(pipe.transform('2026-12-30')).toBeFalse();
      expect(pipe.transform('2027-01-02')).toBeTrue();
    });
  });
});
