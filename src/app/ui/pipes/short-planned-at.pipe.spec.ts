import { TestBed } from '@angular/core/testing';
import { ShortPlannedAtPipe } from './short-planned-at.pipe';
import { ShortTimeHtmlPipe } from './short-time-html.pipe';
import { DateService } from '../../core/date/date.service';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { DateTimeLocales } from '../../core/locale.constants';
import { getDbDateStr } from '../../util/get-db-date-str';
import { dateStrToUtcDate } from '../../util/date-str-to-utc-date';

describe('ShortPlannedAtPipe', () => {
  // The app's today as DateService reports it (start-of-next-day offset applied)
  let appToday: string;
  let pipe: ShortPlannedAtPipe;

  beforeEach(() => {
    appToday = '2026-10-29';
    TestBed.configureTestingModule({
      providers: [
        ShortPlannedAtPipe,
        { provide: ShortTimeHtmlPipe, useValue: { transform: () => 'TIME' } },
        {
          provide: DateTimeFormatService,
          useValue: { currentLocale: () => DateTimeLocales.en_us },
        },
        {
          provide: DateService,
          useValue: {
            isToday: (ts: number) => getDbDateStr(new Date(ts)) === appToday,
            todayStr: (date?: Date | number) => (date ? getDbDateStr(date) : appToday),
            getLogicalTodayDate: () => dateStrToUtcDate(appToday),
          },
        },
      ],
    });
    pipe = TestBed.inject(ShortPlannedAtPipe);
  });

  it('returns null for a value that is not a timestamp', () => {
    expect(pipe.transform(undefined)).toBeNull();
    expect(pipe.transform(null)).toBeNull();
  });

  it('shows only the time for today, or when asked for the time only', () => {
    expect(pipe.transform(new Date(2026, 9, 29, 10, 0).getTime())).toBe('TIME');
    expect(pipe.transform(new Date(2027, 5, 1, 10, 0).getTime(), true)).toBe('TIME');
  });

  it('shows month and day for another day in the current year', () => {
    expect(pipe.transform(new Date(2026, 11, 20, 10, 0).getTime())).toBe('12/20');
    // late evening on the last day of the year still counts as this year
    expect(pipe.transform(new Date(2026, 11, 31, 23, 30).getTime())).toBe('12/31');
  });

  it('adds the year for a day in another year (#10804)', () => {
    expect(pipe.transform(new Date(2027, 5, 1, 10, 0).getTime())).toBe('6/1/27');
    expect(pipe.transform(new Date(2025, 11, 31, 10, 0).getTime())).toBe('12/31/25');
  });

  it('takes the year from a given today string', () => {
    const june2027 = new Date(2027, 5, 1, 10, 0).getTime();
    expect(pipe.transform(june2027, false, '2027-03-01')).toBe('6/1');
    expect(pipe.transform(june2027, false, 'garbage')).toBe('6/1/27');
  });

  describe('just after midnight on New Year (start of next day at 4:00)', () => {
    beforeEach(() => {
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(2027, 0, 1, 1, 0)); // wall clock: 2027
      appToday = '2026-12-31'; // the app's day is still Dec 31, 2026
    });
    afterEach(() => jasmine.clock().uninstall());

    it("takes the year from the app's day, not the wall clock", () => {
      expect(pipe.transform(new Date(2026, 11, 30, 10, 0).getTime())).toBe('12/30');
      expect(pipe.transform(new Date(2027, 0, 2, 10, 0).getTime())).toBe('1/2/27');
    });
  });
});
