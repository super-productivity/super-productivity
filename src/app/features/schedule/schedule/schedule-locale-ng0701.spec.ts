import { ComponentFixture, TestBed } from '@angular/core/testing';
import { formatDate } from '@angular/common';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { provideMockStore } from '@ngrx/store/testing';
import { TranslateModule } from '@ngx-translate/core';
import { DateAdapter } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';

import { ScheduleComponent } from './schedule.component';
import { TaskService } from '../../tasks/task.service';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { ScheduleService } from '../schedule.service';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { DateTimeLocales } from '../../../core/locale.constants';
import { safeFormatDate } from '../../../util/safe-format-date';

/**
 * Regression guard for issue #7383 (NG0701 on /schedule).
 *
 * Root cause: src/main.ts lazily registers non-default locales via
 * requestIdleCallback. If the schedule view renders before idle fires
 * (e.g. during initial sync replay on a slow Electron host), Angular's
 * formatDate(date, fmt, 'zh-cn') throws RuntimeError(701).
 *
 * Fix: schedule's formatDate calls go through safeFormatDate (try/catch
 * with DEFAULT_LOCALE fallback) so a missing locale registration shows
 * a default-locale string instead of crashing.
 */
describe('issue #7383 — NG0701 race on /schedule', () => {
  // Angular's locale registry is module-global. We avoid registering any
  // locale data here so that zh-cn is consistently absent — that absence is
  // the race window we're reproducing.

  describe('via Angular formatDate (race window simulation)', () => {
    it('throws NG0701 for zh-cn when locale data is not registered', () => {
      expect(() => formatDate(new Date(2026, 3, 20), 'LLLL yyyy', 'zh-cn')).toThrowError(
        /NG07?01|Missing locale data/i,
      );
    });

    it('does NOT throw for en-gb (Angular falls back to baked-in en data)', () => {
      expect(() => formatDate(new Date(2026, 3, 20), 'LLLL yyyy', 'en-gb')).not.toThrow();
    });
  });

  describe('via ScheduleComponent.headerTitle() (race window simulation)', () => {
    let component: ScheduleComponent;
    let fixture: ComponentFixture<ScheduleComponent>;
    let mockScheduleService: jasmine.SpyObj<ScheduleService>;
    let mockLayoutService: jasmine.SpyObj<LayoutService>;
    let localeSignal: ReturnType<
      typeof signal<{ firstDayOfWeek: number; dateTimeLocale: string }>
    >;

    beforeEach(async () => {
      const mockTaskService = jasmine.createSpyObj('TaskService', ['currentTaskId']);
      (mockTaskService as any).currentTaskId = signal(null);

      mockLayoutService = jasmine.createSpyObj('LayoutService', [], {
        selectedTimeView: signal('month'),
      });

      mockScheduleService = jasmine.createSpyObj('ScheduleService', [
        'getDaysToShow',
        'getMonthDaysToShow',
        'buildScheduleDays',
        'getTodayStr',
        'createScheduleDaysWithContext',
        'getDayClass',
        'hasEventsForDay',
        'getEventsForDay',
      ]);
      const monthDays = Array.from({ length: 35 }, (_, i) => {
        const d = new Date(2026, 3, 1 + i);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      });
      mockScheduleService.getDaysToShow.and.returnValue(monthDays);
      mockScheduleService.getMonthDaysToShow.and.returnValue(monthDays);
      mockScheduleService.buildScheduleDays.and.returnValue([]);
      mockScheduleService.getTodayStr.and.returnValue('2026-04-15');
      mockScheduleService.createScheduleDaysWithContext.and.returnValue([]);
      mockScheduleService.getDayClass.and.returnValue('');
      mockScheduleService.hasEventsForDay.and.returnValue(false);
      mockScheduleService.getEventsForDay.and.returnValue([]);
      (mockScheduleService as any).scheduleRefreshTick = signal(0);

      const mockGlobalTrackingIntervalService = jasmine.createSpyObj(
        'GlobalTrackingIntervalService',
        [],
        { todayDateStr$: of('2026-04-15') },
      );

      // The reporter's environment: dateTimeLocale='zh-cn'.
      localeSignal = signal({ firstDayOfWeek: 1, dateTimeLocale: 'zh-cn' });
      const mockGlobalConfigService = jasmine.createSpyObj('GlobalConfigService', [], {
        localization: localeSignal,
        cfg: signal(undefined),
      });

      await TestBed.configureTestingModule({
        imports: [ScheduleComponent, TranslateModule.forRoot()],
        providers: [
          provideMockStore({ initialState: {} }),
          { provide: TaskService, useValue: mockTaskService },
          { provide: LayoutService, useValue: mockLayoutService },
          { provide: ScheduleService, useValue: mockScheduleService },
          { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
          {
            provide: GlobalTrackingIntervalService,
            useValue: mockGlobalTrackingIntervalService,
          },
          { provide: GlobalConfigService, useValue: mockGlobalConfigService },
          {
            provide: DateAdapter,
            useValue: { getFirstDayOfWeek: () => 1, setLocale: () => {} },
          },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(ScheduleComponent);
      component = fixture.componentInstance;
    });

    it('does NOT throw when zh-cn locale data is not yet registered (regression guard for #7383)', () => {
      // headerTitle() in month view calls safeFormatDate(mid, 'LLLL yyyy', 'zh-cn').
      // Pre-fix this would throw NG0701; safeFormatDate falls back to the
      // default locale until lazy-loaded zh-cn registration completes.
      let result: string | undefined;
      expect(() => {
        result = component.headerTitle();
      }).not.toThrow();
      // Should produce a non-empty string (the fallback locale's rendering).
      expect(result).toMatch(/\S/);
    });
  });
});

/**
 * Coverage proof for issue #7405 (reported as a possible duplicate of #7383).
 *
 * #7405's reporter is on en-US Chrome but did not share their configured
 * `dateTimeLocale`. This block verifies that:
 *   1. 'en-us' itself never throws NG0701 (Angular ships en-US baked in),
 *      which would *refute* the duplicate diagnosis if and only if the
 *      reporter's `dateTimeLocale` was 'en-us'.
 *   2. safeFormatDate handles every locale string a user could have
 *      configured via DateTimeLocales — bounding the fix's safety across
 *      the entire config surface, regardless of which exact value the
 *      #7405 reporter had set.
 */
describe('issue #7405 — safeFormatDate coverage across DateTimeLocales', () => {
  const sample = new Date(2026, 3, 20);

  it("'en-us' does not throw NG0701 even without explicit registration", () => {
    // Refutes the duplicate hypothesis if reporter's dateTimeLocale was 'en-us'.
    expect(() => formatDate(sample, 'LLLL yyyy', 'en-us')).not.toThrow();
  });

  Object.entries(DateTimeLocales).forEach(([key, locale]) => {
    it(`safeFormatDate(_, _, '${locale}') returns non-empty without throwing [key=${key}]`, () => {
      let result: string | undefined;
      expect(() => {
        result = safeFormatDate(sample, 'LLLL yyyy', locale);
      }).not.toThrow();
      expect(result).toMatch(/\S/);
    });
  });
});
