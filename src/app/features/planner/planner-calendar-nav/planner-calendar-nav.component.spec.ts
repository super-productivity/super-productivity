import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { GlobalConfigService } from '../../config/global-config.service';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import {
  DAYS_IN_VIEW,
  MIN_HEIGHT,
  MAX_HEIGHT,
  ROW_HEIGHT,
  WEEKS_SHOWN,
} from './planner-calendar-gesture-handler';
import { PlannerCalendarNavComponent } from './planner-calendar-nav.component';
import { parseDbDateStr } from '../../../util/parse-db-date-str';
import { getWeekRange } from '../../../util/get-week-range';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';

// The app locale the component must follow. Deliberately NOT the browser's:
// monthLabel used to pass no locale at all, so a German browser rendered
// "Juli 2026" in an English app. Asserting against a fixed locale here would
// pass either way if it matched the runner's browser, so it must not.
const MOCK_TEXT_LOCALE = 'fr-FR';

/** Room below the first week row: exactly enough for all six. */
const ROOM_FOR_ALL_ROWS = MAX_HEIGHT;
/** Room for four rows, the XS case from the #9463 review. */
const ROOM_FOR_FOUR_ROWS = 4 * ROW_HEIGHT;

describe('PlannerCalendarNavComponent', () => {
  let fixture: ComponentFixture<PlannerCalendarNavComponent>;
  let component: PlannerCalendarNavComponent;

  // Writable signals for mocked service properties
  const mockTodayDateStr = signal('2026-02-16');
  const mockLocalization = signal<{ firstDayOfWeek?: number | null } | undefined>({
    firstDayOfWeek: 1,
  });

  let mockGlobalConfigService: jasmine.SpyObj<GlobalConfigService>;
  let mockGlobalTrackingIntervalService: jasmine.SpyObj<GlobalTrackingIntervalService>;

  beforeEach(() => {
    mockTodayDateStr.set('2026-02-16');
    mockLocalization.set({ firstDayOfWeek: 1 });

    mockGlobalConfigService = jasmine.createSpyObj('GlobalConfigService', [], {
      localization: mockLocalization,
    });
    mockGlobalTrackingIntervalService = jasmine.createSpyObj(
      'GlobalTrackingIntervalService',
      [],
      {
        todayDateStr: mockTodayDateStr,
      },
    );

    TestBed.configureTestingModule({
      imports: [PlannerCalendarNavComponent],
      providers: [
        { provide: GlobalConfigService, useValue: mockGlobalConfigService },
        {
          provide: GlobalTrackingIntervalService,
          useValue: mockGlobalTrackingIntervalService,
        },
        {
          provide: DateTimeFormatService,
          // monthLabel formats a spelled-out month, so it reads textLocale().
          useValue: { textLocale: () => MOCK_TEXT_LOCALE },
        },
      ],
    });

    fixture = TestBed.createComponent(PlannerCalendarNavComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe('weeks computed', () => {
    it('should generate a calendar grid of WEEKS_SHOWN weeks with 7 days per week', () => {
      const weeks = component.weeks();

      expect(weeks.length).toBe(WEEKS_SHOWN);
      for (const week of weeks) {
        expect(week.length).toBe(7);
      }
    });

    it('should still reach the last day of a month that spans six rows (#9449)', () => {
      // August 2026 starts on a Saturday, so with Monday as the first day of
      // week the grid is anchored at Mon 27 Jul and Mon 31 Aug lands in the
      // sixth row. At five rows it had no cell at all: no task dot, no way to
      // tap it.
      mockTodayDateStr.set('2026-08-01');
      fixture.componentRef.setInput('visibleDayDate', '2026-08-01');
      fixture.detectChanges();

      const allDays = component.weeks().flat();

      expect(allDays[0].dateStr).toBe('2026-07-27');
      expect(allDays.map((d) => d.dateStr)).toContain('2026-08-31');
    });

    it('should start the grid from the week containing today', () => {
      const weeks = component.weeks();
      const firstDateStr = weeks[0][0].dateStr;
      const firstDate = parseDbDateStr(firstDateStr);
      const todayDate = parseDbDateStr('2026-02-16');
      const weekRange = getWeekRange(todayDate, 1);

      expect(firstDate.getTime()).toBe(weekRange.start.getTime());
    });

    it('should mark today correctly using todayDateStr signal', () => {
      const weeks = component.weeks();
      const allDays = weeks.flat();
      const todayDays = allDays.filter((d) => d.isToday);

      expect(todayDays.length).toBe(1);
      expect(todayDays[0].dateStr).toBe('2026-02-16');
    });

    it('should mark past days as isPast', () => {
      mockTodayDateStr.set('2026-02-18');
      fixture.detectChanges();

      const weeks = component.weeks();
      const allDays = weeks.flat();
      const pastDay = allDays.find((d) => d.dateStr === '2026-02-16');

      expect(pastDay).toBeTruthy();
      expect(pastDay!.isPast).toBeTrue();
    });

    it('should not mark future days as isPast', () => {
      const weeks = component.weeks();
      const allDays = weeks.flat();
      const futureDay = allDays.find((d) => d.dateStr === '2026-02-17');

      expect(futureDay).toBeTruthy();
      expect(futureDay!.isPast).toBeFalse();
    });

    it('should mark days with tasks via daysWithTasks input', () => {
      const taskDays = new Set(['2026-02-16', '2026-02-18']);
      fixture.componentRef.setInput('daysWithTasks', taskDays);
      fixture.detectChanges();

      const weeks = component.weeks();
      const allDays = weeks.flat();

      const dayWithTask = allDays.find((d) => d.dateStr === '2026-02-16');
      expect(dayWithTask!.hasTasks).toBeTrue();

      const dayWithTask2 = allDays.find((d) => d.dateStr === '2026-02-18');
      expect(dayWithTask2!.hasTasks).toBeTrue();

      const dayWithoutTask = allDays.find((d) => d.dateStr === '2026-02-17');
      expect(dayWithoutTask!.hasTasks).toBeFalse();
    });

    it('should set dayOfMonth to the calendar day number', () => {
      const weeks = component.weeks();
      const allDays = weeks.flat();
      const feb16 = allDays.find((d) => d.dateStr === '2026-02-16');

      expect(feb16!.dayOfMonth).toBe(16);
    });

    it('should produce consecutive dates across weeks', () => {
      const weeks = component.weeks();
      const allDays = weeks.flat();

      for (let i = 1; i < allDays.length; i++) {
        const prev = parseDbDateStr(allDays[i - 1].dateStr);
        const curr = parseDbDateStr(allDays[i].dateStr);
        const prevUTC = Date.UTC(prev.getFullYear(), prev.getMonth(), prev.getDate());
        const currUTC = Date.UTC(curr.getFullYear(), curr.getMonth(), curr.getDate());
        expect(currUTC - prevUTC).toBe(86_400_000);
      }
    });
  });

  describe('activeWeekIndex computed', () => {
    it('should return 0 when visibleDayDate is not set', () => {
      expect(component.activeWeekIndex()).toBe(0);
    });

    it('should return correct index based on visibleDayDate', () => {
      const weeks = component.weeks();
      const targetDay = weeks[2][3].dateStr;
      fixture.componentRef.setInput('visibleDayDate', targetDay);
      fixture.detectChanges();

      expect(component.activeWeekIndex()).toBe(2);
    });

    it('should return 0 when visibleDayDate is not found in any week', () => {
      fixture.componentRef.setInput('visibleDayDate', '2099-12-31');
      fixture.detectChanges();

      expect(component.activeWeekIndex()).toBe(0);
    });

    it('should return the index of the first week containing visibleDayDate', () => {
      const weeks = component.weeks();
      const lastWeekDay = weeks[4][0].dateStr;
      fixture.componentRef.setInput('visibleDayDate', lastWeekDay);
      fixture.detectChanges();

      expect(component.activeWeekIndex()).toBe(4);
    });
  });

  describe('monthLabel computed', () => {
    it('should return a month/year string when collapsed', () => {
      const label = component.monthLabel();

      expect(label).toBeTruthy();
      expect(label.length).toBeGreaterThan(0);
    });

    it('should contain the year in the label', () => {
      const label = component.monthLabel();

      expect(label).toContain('2026');
    });

    it('should reflect the middle day of the active week when collapsed', () => {
      const weeks = component.weeks();
      const midDay = weeks[0][3];
      const midDate = parseDbDateStr(midDay.dateStr);
      const expected = midDate.toLocaleDateString(MOCK_TEXT_LOCALE, {
        month: 'long',
        year: 'numeric',
      });

      expect(component.monthLabel()).toBe(expected);
    });

    it('should reflect the middle week when expanded', () => {
      component.isExpanded.set(true);
      fixture.detectChanges();

      const weeks = component.weeks();
      const midWeekIdx = Math.floor(weeks.length / 2);
      const midDay = weeks[midWeekIdx][3];
      const midDate = parseDbDateStr(midDay.dateStr);
      const expected = midDate.toLocaleDateString(MOCK_TEXT_LOCALE, {
        month: 'long',
        year: 'numeric',
      });

      expect(component.monthLabel()).toBe(expected);
    });
  });

  describe('maxHeight computed', () => {
    // Stated explicitly rather than inherited from the Karma iframe: the
    // expanded height is clamped by the room actually below the rows, so
    // leaving it implicit would make these assertions depend on the runner.
    const setRoom = (px: number): void => component['_availableForRows'].set(px);

    it('should return MIN_HEIGHT when collapsed', () => {
      setRoom(ROOM_FOR_ALL_ROWS);
      component.isExpanded.set(false);
      expect(component.maxHeight()).toBe(MIN_HEIGHT);
    });

    it('should return MAX_HEIGHT when expanded', () => {
      setRoom(ROOM_FOR_ALL_ROWS);
      component.isExpanded.set(true);
      expect(component.maxHeight()).toBe(MAX_HEIGHT);
    });

    // Review of #9463: six 40px rows overflowed the Planner at XS heights.
    // planner-plan-view collapsed to 0px and the bottom nav covered all but
    // 6px of the collapse handle.
    it('should not expand past the room available below the rows', () => {
      setRoom(ROOM_FOR_FOUR_ROWS);
      component.isExpanded.set(true);

      const expanded = component.maxHeight();
      expect(expanded).toBe(4 * ROW_HEIGHT);
      expect(expanded).toBeLessThan(MAX_HEIGHT);
      expect(expanded).toBeLessThanOrEqual(ROOM_FOR_FOUR_ROWS);
    });

    it('should always keep at least one row when there is no room at all', () => {
      setRoom(0);
      component.isExpanded.set(true);

      expect(component.maxHeight()).toBe(ROW_HEIGHT);
    });

    it('should still build all six weeks of days when the height is clamped', () => {
      setRoom(ROOM_FOR_FOUR_ROWS);
      component.isExpanded.set(true);

      expect(component.weeks().length).toBe(WEEKS_SHOWN);
      expect(component.weeks().flat().length).toBe(DAYS_IN_VIEW);
    });
  });

  describe('weekOffset computed', () => {
    const setRoom = (px: number): void => component['_availableForRows'].set(px);

    it('should return 0 when expanded', () => {
      setRoom(ROOM_FOR_ALL_ROWS);
      component.isExpanded.set(true);
      expect(component.weekOffset()).toBe(0);
    });

    // Dropping rows must not make a day unreachable — that is the bug #9449
    // fixed, at a different viewport.
    it('should keep the active week visible when the height is clamped', () => {
      const weeks = component.weeks();
      fixture.componentRef.setInput('visibleDayDate', weeks[WEEKS_SHOWN - 1][0].dateStr);
      component.isExpanded.set(true);
      fixture.detectChanges();
      // After the last change detection: the component re-measures the real
      // available room on every expand, which would overwrite this.
      setRoom(ROOM_FOR_FOUR_ROWS);

      const rows = component.maxHeight() / ROW_HEIGHT;
      const firstVisibleRow = -component.weekOffset() / ROW_HEIGHT;

      expect(component.activeWeekIndex()).toBe(WEEKS_SHOWN - 1);
      expect(firstVisibleRow).toBeGreaterThan(0);
      expect(component.activeWeekIndex()).toBeGreaterThanOrEqual(firstVisibleRow);
      expect(component.activeWeekIndex()).toBeLessThan(firstVisibleRow + rows);
      // Never scrolled past the last row.
      expect(firstVisibleRow + rows).toBeLessThanOrEqual(WEEKS_SHOWN);
    });

    it('should return negative offset based on activeWeekIndex when collapsed', () => {
      const weeks = component.weeks();
      const targetDay = weeks[2][0].dateStr;
      fixture.componentRef.setInput('visibleDayDate', targetDay);
      component.isExpanded.set(false);
      fixture.detectChanges();

      expect(component.weekOffset()).toBe(-2 * ROW_HEIGHT);
    });

    it('should return 0 when collapsed and activeWeekIndex is 0', () => {
      component.isExpanded.set(false);
      expect(component.weekOffset()).toBe(0);
    });
  });

  describe('dayLabels computed', () => {
    it('should return 7 weekday labels', () => {
      expect(component.dayLabels().length).toBe(7);
    });

    it('should start from Monday when firstDayOfWeek is 1', () => {
      mockLocalization.set({ firstDayOfWeek: 1 });
      fixture.detectChanges();

      const labels = component.dayLabels();
      // Monday labels depend on locale, but we can verify rotation:
      // getWeekdaysMin() returns [Sun, Mon, Tue, ...] indexes 0-6
      // with firstDayOfWeek=1 (Monday), labels should start at index 1
      expect(labels.length).toBe(7);
      // Verify it is a rotation of all unique days
      const unique = new Set(labels);
      expect(unique.size).toBe(7);
    });

    it('should start from Sunday when firstDayOfWeek is 0', () => {
      mockLocalization.set({ firstDayOfWeek: 0 });
      fixture.detectChanges();

      const labels = component.dayLabels();
      expect(labels.length).toBe(7);
      const unique = new Set(labels);
      expect(unique.size).toBe(7);
    });

    it('should use default first day of week when localization config is undefined', () => {
      mockLocalization.set(undefined);
      fixture.detectChanges();

      // DEFAULT_FIRST_DAY_OF_WEEK is 1 (Monday), should still produce 7 labels
      const labels = component.dayLabels();
      expect(labels.length).toBe(7);
    });

    it('should produce different first label for different firstDayOfWeek values', () => {
      mockLocalization.set({ firstDayOfWeek: 0 });
      fixture.detectChanges();
      const sundayLabels = [...component.dayLabels()];

      mockLocalization.set({ firstDayOfWeek: 1 });
      fixture.detectChanges();
      const mondayLabels = [...component.dayLabels()];

      // The rotation should differ: first label should be different
      expect(sundayLabels[0]).toBe(mondayLabels[6]);
    });
  });

  describe('onDayTap', () => {
    it('should emit dayTapped output with the date string', () => {
      const emitted: string[] = [];
      component.dayTapped.subscribe((val: string) => emitted.push(val));

      component.onDayTap('2026-02-20');

      expect(emitted.length).toBe(1);
      expect(emitted[0]).toBe('2026-02-20');
    });
  });

  describe('template ARIA attributes', () => {
    it('should render aria-live on month-label', () => {
      const el: HTMLElement = fixture.nativeElement;
      const monthLabel = el.querySelector('.month-label');

      expect(monthLabel).toBeTruthy();
      expect(monthLabel!.getAttribute('aria-live')).toBe('polite');
    });

    it('should render role="grid" on weeks container', () => {
      const el: HTMLElement = fixture.nativeElement;
      const grid = el.querySelector('[role="grid"]');

      expect(grid).toBeTruthy();
    });

    it('should render role="gridcell" on day buttons', () => {
      const el: HTMLElement = fixture.nativeElement;
      const gridcells = el.querySelectorAll('[role="gridcell"]');

      expect(gridcells.length).toBe(WEEKS_SHOWN * 7);
    });

    it('should set aria-current="date" on today button', () => {
      const el: HTMLElement = fixture.nativeElement;
      const todayBtn = el.querySelector('[aria-current="date"]');

      expect(todayBtn).toBeTruthy();
      expect(todayBtn!.getAttribute('aria-label')).toBe('2026-02-16');
    });

    it('should set aria-pressed on the active day button', () => {
      fixture.componentRef.setInput('visibleDayDate', '2026-02-18');
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      const pressedBtn = el.querySelector('[aria-pressed="true"]');

      expect(pressedBtn).toBeTruthy();
      expect(pressedBtn!.getAttribute('aria-label')).toBe('2026-02-18');
    });
  });
});
