import { TestBed } from '@angular/core/testing';
import { DateAdapter } from '@angular/material/core';
import { TranslateModule } from '@ngx-translate/core';
import { HeatmapMonthCalendarComponent } from './heatmap-month-calendar.component';
import { DayData } from './heatmap.component';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const setup = (
  rangeStart: Date,
  rangeEnd: Date,
  dayMap = new Map<string, DayData>(),
): HeatmapMonthCalendarComponent => {
  TestBed.configureTestingModule({
    // Real TranslateModule (no translations → keys pass through): the template's
    // `| translate` pipes need the full service surface, not just `instant`.
    imports: [HeatmapMonthCalendarComponent, TranslateModule.forRoot()],
    providers: [
      {
        provide: DateAdapter,
        useValue: {
          getFirstDayOfWeek: () => 0,
          getMonthNames: () => MONTHS,
          getDayOfWeekNames: () => WEEKDAYS,
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(HeatmapMonthCalendarComponent);
  fixture.componentRef.setInput('rangeStart', rangeStart);
  fixture.componentRef.setInput('rangeEnd', rangeEnd);
  fixture.componentRef.setInput('dayMap', dayMap);
  fixture.detectChanges();
  return fixture.componentInstance;
};

describe('HeatmapMonthCalendarComponent', () => {
  // Past ranges so "today" is never inside → default month is deterministic.
  it('defaults to the range-end month and lays it into 7-column weeks', () => {
    const c = setup(new Date(2024, 4, 1), new Date(2024, 4, 31)); // May 2024
    expect(c.viewMonth()).toEqual({ y: 2024, m: 4 });
    // May 1 2024 is a Wednesday → Sunday-start lead 3, 31 days → 5 rows.
    expect(c.weeks().length).toBe(5);
    c.weeks().forEach((w) => expect(w.length).toBe(7));
  });

  it('clamps navigation to a single-month range', () => {
    const c = setup(new Date(2024, 4, 1), new Date(2024, 4, 31));
    expect(c.canPrev()).toBe(false);
    expect(c.canNext()).toBe(false);
  });

  it('navigates prev within a multi-month range and stops at the start', () => {
    const c = setup(new Date(2024, 2, 1), new Date(2024, 4, 31)); // Mar–May 2024
    expect(c.viewMonth()).toEqual({ y: 2024, m: 4 }); // May (range end)
    expect(c.canNext()).toBe(false);
    expect(c.canPrev()).toBe(true);

    c.prev();
    expect(c.viewMonth()).toEqual({ y: 2024, m: 3 }); // Apr
    c.prev();
    expect(c.viewMonth()).toEqual({ y: 2024, m: 2 }); // Mar
    expect(c.canPrev()).toBe(false);
    c.prev(); // no-op past the bound
    expect(c.viewMonth()).toEqual({ y: 2024, m: 2 });
  });

  it('marks in-month vs other-month cells', () => {
    const c = setup(new Date(2024, 4, 1), new Date(2024, 4, 31));
    const flat = c.weeks().flat();
    expect(flat.find((cell) => cell.dateStr === '2024-05-15')!.isOtherMonth).toBe(false);
    // Leading cells belong to April.
    expect(flat[0].isOtherMonth).toBe(true);
  });
});
