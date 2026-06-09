import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DateAdapter } from '@angular/material/core';
import { TranslateModule } from '@ngx-translate/core';
import { HeatmapMonthCalendarComponent } from './heatmap-month-calendar.component';
import { DayData } from './heatmap.component';
import { buildProjectionDayMap } from './build-heatmap-data.util';

const D = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
};

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
): ComponentFixture<HeatmapMonthCalendarComponent> => {
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
  return fixture;
};

describe('HeatmapMonthCalendarComponent', () => {
  // Past ranges so "today" is never inside → default month is deterministic.
  it('defaults to the range-end month and lays it into 7-column weeks', () => {
    const c = setup(new Date(2024, 4, 1), new Date(2024, 4, 31)).componentInstance; // May 2024
    expect(c.viewMonth()).toEqual({ y: 2024, m: 4 });
    // May 1 2024 is a Wednesday → Sunday-start lead 3, 31 days → 5 rows.
    expect(c.weeks().length).toBe(5);
    c.weeks().forEach((w) => expect(w.length).toBe(7));
  });

  it('clamps navigation to a single-month range', () => {
    const c = setup(new Date(2024, 4, 1), new Date(2024, 4, 31)).componentInstance;
    expect(c.canPrev()).toBe(false);
    expect(c.canNext()).toBe(false);
  });

  it('navigates prev within a multi-month range and stops at the start', () => {
    const c = setup(new Date(2024, 2, 1), new Date(2024, 4, 31)).componentInstance; // Mar–May 2024
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
    const c = setup(new Date(2024, 4, 1), new Date(2024, 4, 31)).componentInstance;
    const flat = c.weeks().flat();
    expect(flat.find((cell) => cell.dateStr === '2024-05-15')!.isOtherMonth).toBe(false);
    // Leading cells belong to April.
    expect(flat[0].isOtherMonth).toBe(true);
  });

  it('defaults to the CURRENT month even before noon when rangeStart is noon-anchored', () => {
    // Regression: the projection preview anchors rangeStart at local noon; an
    // instant comparison made "today 09:00 < rangeStart 12:00" → out of range →
    // the calendar opened on the month of rangeEnd, a year ahead.
    jasmine.clock().install();
    try {
      jasmine.clock().mockDate(new Date(2024, 4, 10, 9, 0, 0)); // 09:00 May 10
      const c = setup(
        new Date(2024, 4, 10, 12, 0, 0), // noon "today"
        new Date(2025, 4, 10, 12, 0, 0),
      ).componentInstance;
      expect(c.viewMonth()).toEqual({ y: 2024, m: 4 }); // May 2024, not May 2025
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('falls back into range when the data range changes under a navigated month', () => {
    // Regression: metric year select swaps dayMap/range while the component
    // stays mounted; a navigated month outside the new range stranded the user
    // on an all-empty month with nav disabled.
    const fixture = setup(new Date(2024, 2, 1), new Date(2024, 4, 31)); // Mar–May 2024
    const c = fixture.componentInstance;
    c.prev();
    expect(c.viewMonth()).toEqual({ y: 2024, m: 3 }); // navigated to Apr 2024
    fixture.componentRef.setInput('rangeStart', new Date(2022, 0, 1));
    fixture.componentRef.setInput('rangeEnd', new Date(2022, 11, 31));
    fixture.detectChanges();
    expect(c.viewMonth()).toEqual({ y: 2022, m: 11 }); // snapped to the new range
  });

  it('does not emit dayClick for other-month spill-over cells', () => {
    // dayMap covers Apr 28 – May 31, so May's leading grey cells HAVE data.
    const map = buildProjectionDayMap(
      [D('2024-04-29'), D('2024-05-15')],
      D('2024-04-28'),
      D('2024-05-31'),
    );
    const c = setup(D('2024-04-28'), D('2024-05-31'), map).componentInstance;
    expect(c.viewMonth()).toEqual({ y: 2024, m: 4 }); // May
    const emitted: unknown[] = [];
    c.dayClick.subscribe((d) => emitted.push(d));
    const flat = c.weeks().flat();
    const greyWithData = flat.find((cell) => cell.isOtherMonth && !!cell.data);
    expect(greyWithData).toBeTruthy();
    c.onCellClick(greyWithData!);
    expect(emitted.length).toBe(0);
    const inMonth = flat.find((cell) => !cell.isOtherMonth && !!cell.data);
    c.onCellClick(inMonth!);
    expect(emitted.length).toBe(1);
  });
});
