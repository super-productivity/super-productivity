import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { DateAdapter, MatNativeDateModule } from '@angular/material/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { provideMockStore } from '@ngrx/store/testing';
import { Observable, of, Subject } from 'rxjs';
import { ReactiveFormsModule } from '@angular/forms';
// FormlyConfigModule (not FormlyModule) is needed here to register custom
// field types and validation within the TestBed injector.
import { FormlyConfigModule } from '../../../ui/formly-config.module';
import { CustomDateAdapter } from '../../../core/date-time-format/custom-date-adapter';

import { DialogEditTaskRepeatCfgComponent } from './dialog-edit-task-repeat-cfg.component';
import { TaskRepeatCfgService } from '../task-repeat-cfg.service';
import { TaskService } from '../../tasks/task.service';
import { TaskArchiveService } from '../../archive/task-archive.service';
import { TagService } from '../../tag/tag.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { DEFAULT_TASK_REPEAT_CFG, TaskRepeatCfg } from '../task-repeat-cfg.model';
import { DayData } from '../../../ui/heatmap/heatmap.component';
import { TaskCopy } from '../../tasks/task.model';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { TranslateService } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { SnackService } from '../../../core/snack/snack.service';
import { setRRuleEngineEnabled } from '../../config/rrule-engine-flag';

// Mirrors the ordinal-day format the option builder now passes for the concise
// "Monthly (15th)" label.
const ordinalDay = (n: number): string => {
  const suffix: Record<string, string> = { one: 'st', two: 'nd', few: 'rd', other: 'th' };
  return `${n}${suffix[new Intl.PluralRules('en-US', { type: 'ordinal' }).select(n)] ?? 'th'}`;
};

describe('DialogEditTaskRepeatCfgComponent', () => {
  let mockDialogRef: jasmine.SpyObj<MatDialogRef<DialogEditTaskRepeatCfgComponent>>;
  let mockTaskRepeatCfgService: jasmine.SpyObj<TaskRepeatCfgService>;
  let mockTagService: jasmine.SpyObj<TagService>;
  let mockGlobalConfigService: jasmine.SpyObj<GlobalConfigService>;
  let mockDateTimeFormatService: jasmine.SpyObj<DateTimeFormatService>;

  const mockRepeatCfg: TaskRepeatCfg = {
    ...DEFAULT_TASK_REPEAT_CFG,
    id: 'repeat-cfg-123',
    title: 'Test Repeat Task',
    startDate: '2026-01-02',
  };

  const mockTask = {
    id: 'task-123',
    title: 'Test Task',
    projectId: 'project-123',
    tagIds: [],
    subTaskIds: [],
    timeSpentOnDay: {},
    timeSpent: 0,
    timeEstimate: 0,
    isDone: false,
    notes: '',
    created: Date.now(),
    attachmentIds: [],
    attachments: [],
  } as unknown as TaskCopy;

  const setupTestBed = async (
    dialogData: {
      task?: TaskCopy;
      repeatCfg?: TaskRepeatCfg;
      targetDate?: string;
    },
    getTaskRepeatCfgById$ReturnValue?: Observable<TaskRepeatCfg> | Subject<TaskRepeatCfg>,
    seriesTasks: TaskCopy[] = [],
  ): Promise<ComponentFixture<DialogEditTaskRepeatCfgComponent>> => {
    mockDialogRef = jasmine.createSpyObj('MatDialogRef', [
      'close',
      'addPanelClass',
      'removePanelClass',
    ]);
    mockTaskRepeatCfgService = jasmine.createSpyObj('TaskRepeatCfgService', [
      'getTaskRepeatCfgById$',
      'updateTaskRepeatCfg',
      'addTaskRepeatCfgToTask',
      'deleteTaskRepeatCfgWithDialog',
    ]);

    // Set up the return value for getTaskRepeatCfgById$ before creating the component
    if (getTaskRepeatCfgById$ReturnValue) {
      mockTaskRepeatCfgService.getTaskRepeatCfgById$.and.returnValue(
        getTaskRepeatCfgById$ReturnValue,
      );
    }

    mockTagService = jasmine.createSpyObj('TagService', ['addTag'], {
      tags$: of([]),
      tagsNoMyDayAndNoList$: of([]),
    });
    mockGlobalConfigService = jasmine.createSpyObj('GlobalConfigService', [], {
      cfg: () => ({ reminder: { defaultTaskRemindOption: null }, tasks: {} }),
      // CustomDateAdapter.getFirstDayOfWeek() reads this — needed by the result
      // calendar preview (heatmap) build.
      localization: () => ({ firstDayOfWeek: 0 }),
    });
    mockDateTimeFormatService = jasmine.createSpyObj('DateTimeFormatService', [], {
      currentLocale: () => 'en-US',
      dateFormat: () => ({
        parse: 'MM/dd/yyyy',
        display: { dateInput: 'MM/dd/yyyy' },
      }),
    });

    await TestBed.configureTestingModule({
      imports: [
        DialogEditTaskRepeatCfgComponent,
        MatDialogModule,
        MatNativeDateModule,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
        FormlyConfigModule,
        ReactiveFormsModule,
      ],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        provideMockStore(),
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: dialogData },
        { provide: TaskRepeatCfgService, useValue: mockTaskRepeatCfgService },
        { provide: TaskService, useValue: { allTasks$: of(seriesTasks) } },
        {
          provide: TaskArchiveService,
          useValue: { load: () => Promise.resolve({ ids: [], entities: {} }) },
        },
        { provide: TagService, useValue: mockTagService },
        { provide: GlobalConfigService, useValue: mockGlobalConfigService },
        { provide: DateTimeFormatService, useValue: mockDateTimeFormatService },
        { provide: DateAdapter, useClass: CustomDateAdapter },
        { provide: SnackService, useValue: { open: () => undefined } },
      ],
    })
      .overrideComponent(DialogEditTaskRepeatCfgComponent, {
        set: {
          // Use a minimal template to avoid @ngx-formly/material select rendering,
          // which triggers a compareWith validation error with Angular Material 21+.
          // These tests verify component signals/logic, not template rendering.
          template: '<div></div>',
        },
      })
      .compileComponents();

    return TestBed.createComponent(DialogEditTaskRepeatCfgComponent);
  };

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('isLoading signal', () => {
    it('should be false when repeatCfg is provided directly (sync path)', async () => {
      const fixture = await setupTestBed({ repeatCfg: mockRepeatCfg });
      const component = fixture.componentInstance;

      expect(component.isLoading()).toBe(false);
    });

    it('should be false when creating new repeat config for task without repeatCfgId', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;

      expect(component.isLoading()).toBe(false);
    });

    it('should be true while loading existing repeat config for task with repeatCfgId', fakeAsync(async () => {
      const taskWithRepeatCfg = {
        ...mockTask,
        repeatCfgId: 'repeat-cfg-123',
      } as TaskCopy;
      const repeatCfgSubject = new Subject<TaskRepeatCfg>();

      const fixture = await setupTestBed({ task: taskWithRepeatCfg }, repeatCfgSubject);
      const component = fixture.componentInstance;
      fixture.detectChanges();
      tick();

      // Should be loading while waiting for async response
      expect(component.isLoading()).toBe(true);

      // Emit the repeat config
      repeatCfgSubject.next(mockRepeatCfg);
      tick();

      // Should no longer be loading after response
      expect(component.isLoading()).toBe(false);
    }));

    it('should set repeatCfgInitial after async load completes', fakeAsync(async () => {
      const taskWithRepeatCfg = {
        ...mockTask,
        repeatCfgId: 'repeat-cfg-123',
      } as TaskCopy;
      const repeatCfgSubject = new Subject<TaskRepeatCfg>();

      const fixture = await setupTestBed({ task: taskWithRepeatCfg }, repeatCfgSubject);
      const component = fixture.componentInstance;
      fixture.detectChanges();
      tick();

      // repeatCfgInitial should be undefined while loading
      expect(component.repeatCfgInitial()).toBeUndefined();

      // Emit the repeat config
      repeatCfgSubject.next(mockRepeatCfg);
      tick();

      // repeatCfgInitial should now be set
      expect(component.repeatCfgInitial()).toBeDefined();
      expect(component.repeatCfgInitial()?.id).toBe('repeat-cfg-123');
    }));
  });

  describe('isEdit computed', () => {
    it('should return true when repeatCfg is provided', async () => {
      const fixture = await setupTestBed({ repeatCfg: mockRepeatCfg });
      const component = fixture.componentInstance;

      expect(component.isEdit()).toBe(true);
    });

    it('should return true when task has repeatCfgId', fakeAsync(async () => {
      const taskWithRepeatCfg = {
        ...mockTask,
        repeatCfgId: 'repeat-cfg-123',
      } as TaskCopy;

      const fixture = await setupTestBed({ task: taskWithRepeatCfg }, of(mockRepeatCfg));
      const component = fixture.componentInstance;
      fixture.detectChanges();
      tick();

      expect(component.isEdit()).toBe(true);
    }));

    it('should return false when task has no repeatCfgId (create mode)', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;

      expect(component.isEdit()).toBe(false);
    });
  });

  describe('quick setting labels use due date (issue #6766)', () => {
    it('should pass due date day/month to translate for monthly/yearly labels when task has dueDay', async () => {
      const taskWithDueDate = {
        ...mockTask,
        dueDay: '2026-05-01',
      } as TaskCopy;

      const fixture = await setupTestBed({ task: taskWithDueDate });
      const translateService = TestBed.inject(TranslateService);
      const instantCalls: { key: string; params: any }[] = [];
      spyOn(translateService, 'instant').and.callFake((key: any, params?: any) => {
        instantCalls.push({ key, params });
        return key;
      });

      // Re-trigger form config initialization
      (fixture.componentInstance as any)._buildQuickSettingOptions();

      const monthlyCall = instantCalls.find(
        (c) => c.key === T.F.TASK_REPEAT.F.Q_MONTHLY_CURRENT_DATE,
      );
      const yearlyCall = instantCalls.find(
        (c) => c.key === T.F.TASK_REPEAT.F.Q_YEARLY_CURRENT_DATE,
      );

      // Due date is May 1st — concise labels use the ordinal day ("1st") and the
      // short month + day ("May 1").
      const dueDate = new Date(2026, 4, 1); // May 1st
      const expectedDayStr = ordinalDay(dueDate.getDate());
      const expectedDayAndMonthStr = dueDate.toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'short',
      });

      expect(monthlyCall).toBeDefined();
      expect(monthlyCall!.params.dateDayStr).toBe(expectedDayStr);
      expect(yearlyCall).toBeDefined();
      expect(yearlyCall!.params.dayAndMonthStr).toBe(expectedDayAndMonthStr);
    });

    it('should pass today day/month to translate when task has no due date', async () => {
      const taskNoDueDate = {
        ...mockTask,
        dueDay: undefined,
        dueWithTime: undefined,
      } as unknown as TaskCopy;

      const fixture = await setupTestBed({ task: taskNoDueDate });
      const translateService = TestBed.inject(TranslateService);
      const instantCalls: { key: string; params: any }[] = [];
      spyOn(translateService, 'instant').and.callFake((key: any, params?: any) => {
        instantCalls.push({ key, params });
        return key;
      });

      (fixture.componentInstance as any)._buildQuickSettingOptions();

      const monthlyCall = instantCalls.find(
        (c) => c.key === T.F.TASK_REPEAT.F.Q_MONTHLY_CURRENT_DATE,
      );

      const today = new Date();
      const todayDayStr = ordinalDay(today.getDate());

      expect(monthlyCall).toBeDefined();
      expect(monthlyCall!.params.dateDayStr).toBe(todayDayStr);
    });

    it('should pass repeatCfg startDate day to translate when editing existing config', async () => {
      const cfgWithStartDate: TaskRepeatCfg = {
        ...DEFAULT_TASK_REPEAT_CFG,
        id: 'repeat-cfg-456',
        title: 'Monthly on 15th',
        quickSetting: 'MONTHLY_CURRENT_DATE',
        startDate: '2026-03-15',
        repeatCycle: 'MONTHLY',
      };

      const fixture = await setupTestBed({ repeatCfg: cfgWithStartDate });
      const translateService = TestBed.inject(TranslateService);
      const instantCalls: { key: string; params: any }[] = [];
      spyOn(translateService, 'instant').and.callFake((key: any, params?: any) => {
        instantCalls.push({ key, params });
        return key;
      });

      (fixture.componentInstance as any)._buildQuickSettingOptions();

      const monthlyCall = instantCalls.find(
        (c) => c.key === T.F.TASK_REPEAT.F.Q_MONTHLY_CURRENT_DATE,
      );

      // startDate is March 15 — concise label uses the ordinal day ("15th").
      const startDate = new Date(2026, 2, 15); // March 15
      const expectedDayStr = ordinalDay(startDate.getDate());

      expect(monthlyCall).toBeDefined();
      expect(monthlyCall!.params.dateDayStr).toBe(expectedDayStr);
    });
  });

  describe('_processQuickSettingForDate preserves quick setting (issue #6766)', () => {
    it('should preserve MONTHLY_CURRENT_DATE when startDate day differs from today', async () => {
      const cfgMonthly: TaskRepeatCfg = {
        ...DEFAULT_TASK_REPEAT_CFG,
        id: 'repeat-cfg-monthly',
        title: 'Monthly Task',
        quickSetting: 'MONTHLY_CURRENT_DATE',
        startDate: '2026-05-01',
        repeatCycle: 'MONTHLY',
      };

      const fixture = await setupTestBed({ repeatCfg: cfgMonthly });
      const component = fixture.componentInstance;

      // Should keep MONTHLY_CURRENT_DATE, not fall back to CUSTOM
      expect(component.repeatCfg().quickSetting).toBe('MONTHLY_CURRENT_DATE');
    });

    it('should preserve YEARLY_CURRENT_DATE when startDate differs from today', async () => {
      const cfgYearly: TaskRepeatCfg = {
        ...DEFAULT_TASK_REPEAT_CFG,
        id: 'repeat-cfg-yearly',
        title: 'Yearly Task',
        quickSetting: 'YEARLY_CURRENT_DATE',
        startDate: '2026-07-04',
        repeatCycle: 'YEARLY',
      };

      const fixture = await setupTestBed({ repeatCfg: cfgYearly });
      const component = fixture.componentInstance;

      // Should keep YEARLY_CURRENT_DATE, not fall back to CUSTOM
      expect(component.repeatCfg().quickSetting).toBe('YEARLY_CURRENT_DATE');
    });

    it('should preserve WEEKLY_CURRENT_WEEKDAY when startDate weekday differs from today', async () => {
      // Pick a date whose weekday definitely differs from today
      const today = new Date();
      const differentDay = new Date(today);
      differentDay.setDate(today.getDate() + 3); // 3 days from now is a different weekday
      const dateStr = differentDay.toISOString().slice(0, 10);

      const cfgWeekly: TaskRepeatCfg = {
        ...DEFAULT_TASK_REPEAT_CFG,
        id: 'repeat-cfg-weekly',
        title: 'Weekly Task',
        quickSetting: 'WEEKLY_CURRENT_WEEKDAY',
        startDate: dateStr,
        repeatCycle: 'WEEKLY',
      };

      const fixture = await setupTestBed({ repeatCfg: cfgWeekly });
      const component = fixture.componentInstance;

      // Should keep WEEKLY_CURRENT_WEEKDAY, not fall back to CUSTOM
      expect(component.repeatCfg().quickSetting).toBe('WEEKLY_CURRENT_WEEKDAY');
    });

    it('migrates a startDate-less legacy cfg to RRULE (Custom UI removed)', async () => {
      const cfgNoDate: TaskRepeatCfg = {
        ...DEFAULT_TASK_REPEAT_CFG,
        id: 'repeat-cfg-nodate',
        title: 'No Date Task',
        quickSetting: 'MONTHLY_CURRENT_DATE',
        startDate: undefined,
        repeatCycle: 'MONTHLY',
      };

      const fixture = await setupTestBed({ repeatCfg: cfgNoDate });
      const component = fixture.componentInstance;

      expect(component.repeatCfg().quickSetting).toBe('RRULE');
      expect(component.repeatCfg().rrule).toContain('FREQ=MONTHLY');
    });

    it('migrates a legacy CUSTOM cfg to an equivalent RRULE on open', async () => {
      const customCfg: TaskRepeatCfg = {
        ...DEFAULT_TASK_REPEAT_CFG,
        id: 'repeat-cfg-custom',
        title: 'Legacy custom',
        quickSetting: 'CUSTOM',
        startDate: '2024-06-03',
        repeatCycle: 'WEEKLY',
        repeatEvery: 2,
        monday: true,
        wednesday: true,
        tuesday: false,
        thursday: false,
        friday: false,
        saturday: false,
        sunday: false,
      };

      const fixture = await setupTestBed({ repeatCfg: customCfg });
      const cfg = fixture.componentInstance.repeatCfg();

      expect(cfg.quickSetting).toBe('RRULE');
      expect(cfg.rrule).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE');
    });
  });

  describe('_normalizeMonthlyAnchor strips stale monthlyLastDay (#7726)', () => {
    it('clears monthlyLastDay when quickSetting is no longer MONTHLY_LAST_DAY', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const normalized = (fixture.componentInstance as any)._normalizeMonthlyAnchor({
        quickSetting: 'CUSTOM',
        monthlyLastDay: true,
      });
      expect(normalized.monthlyLastDay).toBeUndefined();
    });

    it('keeps monthlyLastDay for the MONTHLY_LAST_DAY preset', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const normalized = (fixture.componentInstance as any)._normalizeMonthlyAnchor({
        quickSetting: 'MONTHLY_LAST_DAY',
        monthlyLastDay: true,
      });
      expect(normalized.monthlyLastDay).toBe(true);
    });

    it('still converts the monthlyWeekOfMonth null sentinel to undefined', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const normalized = (fixture.componentInstance as any)._normalizeMonthlyAnchor({
        quickSetting: 'CUSTOM',
        monthlyWeekOfMonth: null,
      });
      expect(normalized.monthlyWeekOfMonth).toBeUndefined();
    });

    it('converts the null sentinel for RRULE cfgs too (null is not master-safe)', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const normalized = (fixture.componentInstance as any)._normalizeMonthlyAnchor({
        quickSetting: 'RRULE',
        monthlyWeekOfMonth: null,
      });
      expect(normalized.monthlyWeekOfMonth).toBeUndefined();
    });
  });

  describe('startDate min floor (#7768 Bug 4)', () => {
    const getStartDateMin = (
      fixture: ComponentFixture<DialogEditTaskRepeatCfgComponent>,
    ): unknown => {
      const fields = fixture.componentInstance.essentialFormFields();
      const startDateField = fields.find((f) => f.key === 'startDate');
      return (startDateField?.templateOptions as Record<string, unknown> | undefined)?.[
        'min'
      ];
    };

    const todayStr = (): string => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    };

    it('floors startDate to today for a new repeat cfg created from a task', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      expect(getStartDateMin(fixture)).toBe(todayStr());
    });

    it('keeps the past startDate as the floor when editing an existing past cfg', async () => {
      const pastCfg: TaskRepeatCfg = {
        ...mockRepeatCfg,
        startDate: '2020-01-15',
      };
      const fixture = await setupTestBed({ repeatCfg: pastCfg });
      expect(getStartDateMin(fixture)).toBe('2020-01-15');
    });

    it('floors to today when editing a cfg whose startDate is in the future', async () => {
      const future = new Date();
      future.setFullYear(future.getFullYear() + 1);
      const yyyy = future.getFullYear();
      const mm = String(future.getMonth() + 1).padStart(2, '0');
      const dd = String(future.getDate()).padStart(2, '0');
      const futureStr = `${yyyy}-${mm}-${dd}`;
      const futureCfg: TaskRepeatCfg = {
        ...mockRepeatCfg,
        startDate: futureStr,
      };
      const fixture = await setupTestBed({ repeatCfg: futureCfg });
      expect(getStartDateMin(fixture)).toBe(todayStr());
    });
  });

  describe('save button disabled state (issue #5828)', () => {
    it('should not allow save while isLoading is true', fakeAsync(async () => {
      const taskWithRepeatCfg = {
        ...mockTask,
        repeatCfgId: 'repeat-cfg-123',
      } as TaskCopy;
      const repeatCfgSubject = new Subject<TaskRepeatCfg>();

      const fixture = await setupTestBed({ task: taskWithRepeatCfg }, repeatCfgSubject);
      const component = fixture.componentInstance;
      fixture.detectChanges();
      tick();

      // While loading, isLoading should be true
      expect(component.isLoading()).toBe(true);

      // Attempting to save while loading would have thrown the error before the fix
      // After the fix, the button should be disabled so save() won't be called
      // We verify the condition that disables the button
      const formValid = component.formGroup1().valid && component.formGroup2().valid;
      const saveButtonShouldBeDisabled = !formValid || component.isLoading();
      expect(saveButtonShouldBeDisabled).toBe(true);

      // Complete loading
      repeatCfgSubject.next(mockRepeatCfg);
      tick();

      // Now isLoading should be false
      expect(component.isLoading()).toBe(false);
    }));

    it('should have repeatCfgInitial set before save can proceed in edit mode', fakeAsync(async () => {
      const taskWithRepeatCfg = {
        ...mockTask,
        repeatCfgId: 'repeat-cfg-123',
      } as TaskCopy;
      const repeatCfgSubject = new Subject<TaskRepeatCfg>();

      const fixture = await setupTestBed({ task: taskWithRepeatCfg }, repeatCfgSubject);
      const component = fixture.componentInstance;
      fixture.detectChanges();
      tick();

      // Before async completes: isLoading=true, repeatCfgInitial=undefined
      expect(component.isLoading()).toBe(true);
      expect(component.repeatCfgInitial()).toBeUndefined();

      // After async completes: isLoading=false, repeatCfgInitial is set
      repeatCfgSubject.next(mockRepeatCfg);
      tick();

      expect(component.isLoading()).toBe(false);
      expect(component.repeatCfgInitial()).toBeDefined();

      // This was the race condition: save() requires repeatCfgInitial in edit mode
      // Now the button is disabled until isLoading becomes false,
      // which only happens after repeatCfgInitial is set
    }));
  });

  describe('result calendar preview (Phase 2)', () => {
    const rruleCfg: TaskRepeatCfg = {
      ...DEFAULT_TASK_REPEAT_CFG,
      id: 'rr-cal-preview',
      title: 'Biweekly Mon',
      startDate: '2024-06-03',
      quickSetting: 'RRULE',
      repeatCycle: 'WEEKLY',
      rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO',
    };

    it('shows the calendar immediately for a valid rule (no toggle)', async () => {
      // The calendar doubles as the start-date picker, so it is always present
      // for a valid rule rather than hidden behind a toggle.
      const fixture = await setupTestBed({ repeatCfg: rruleCfg });
      expect(fixture.componentInstance.resultHeatmapData()).not.toBeNull();
    });

    it('projects future occurrences', async () => {
      const fixture = await setupTestBed({ repeatCfg: rruleCfg });
      const c = fixture.componentInstance;
      const hd = c.resultHeatmapData();
      expect(hd).not.toBeNull();
      expect(hd!.months!.length).toBeGreaterThan(0);
      const hasProjected = hd!.months!.some((m) =>
        m.weeks.some((w) => w.days.some((d) => !!d?.isProjected)),
      );
      expect(hasProjected).toBe(true);
    });

    it('exposes the next upcoming occurrence (date + non-negative countdown)', async () => {
      const fixture = await setupTestBed({ repeatCfg: rruleCfg });
      const n = fixture.componentInstance.nextOccurrence();
      expect(n).not.toBeNull();
      expect(n!.dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(n!.daysAway).toBeGreaterThanOrEqual(0);
    });

    it('spotlights exactly one "next" cell in the home window', async () => {
      const fixture = await setupTestBed({ repeatCfg: rruleCfg });
      const c = fixture.componentInstance;
      const nextCells = [...c.resultHeatmapData()!.dayMap.values()].filter(
        (d) => d.isNext,
      );
      expect(nextCells.length).toBe(1);
    });

    it('computes rhythm stats: count, average gap, and an end label', async () => {
      const fixture = await setupTestBed({ repeatCfg: rruleCfg });
      const c = fixture.componentInstance;
      const s = c.previewStats();
      expect(s).not.toBeNull();
      expect(s!.count).toBeGreaterThan(0);
      // FREQ=WEEKLY;INTERVAL=2 → occurrences are 14 days apart.
      expect(s!.avgGapDays).toBe(14);
      expect(typeof s!.end).toBe('string');
      expect(s!.end.length).toBeGreaterThan(0);
    });

    it('reports a finite end label for a COUNT rule', async () => {
      const fixture = await setupTestBed({
        repeatCfg: { ...rruleCfg, rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=5' },
      });
      const c = fixture.componentInstance;
      // Whether i18n is loaded (interpolates "5") or not (returns the key
      // containing "AFTER"), a COUNT rule yields a finite end label — never the
      // "runs forever" / NEVER one.
      const end = c.previewStats()!.end;
      expect(end).toMatch(/5|AFTER/i);
      expect(end).not.toMatch(/forever|NEVER/i);
    });

    // Simulation only exists for repeat-from-completion schedules.
    const completionCfg: TaskRepeatCfg = {
      ...rruleCfg,
      id: 'rr-cal-completion',
      repeatFromCompletionDate: true,
    };

    it('toggles the simulated completion day on double-click (from-completion cfg)', async () => {
      const fixture = await setupTestBed({ repeatCfg: completionCfg });
      const c = fixture.componentInstance;
      c.menuDay.set({ dateStr: '2099-01-06' } as DayData);
      c.menuSimulate();
      expect(c.simulatedCompletion()).toBe('2099-01-06');
      // Re-double-clicking the same day clears it.
      c.menuDay.set({ dateStr: '2099-01-06' } as DayData);
      c.menuSimulate();
      expect(c.simulatedCompletion()).toBeNull();
    });

    it('does not offer simulate for a start-anchored schedule, and never mutates the flag', async () => {
      // Simulation is a pure preview of from-completion re-anchoring; a
      // start-anchored series stays fixed when an occurrence is completed, so the
      // what-if is not offered there — and calling it (defensive) must NOT
      // silently convert the schedule to from-completion.
      const fixture = await setupTestBed({ repeatCfg: rruleCfg });
      const c = fixture.componentInstance;
      expect(c.repeatCfg().repeatFromCompletionDate).toBeFalsy();
      c.menuDay.set({ dateStr: '2099-01-06' } as DayData);
      expect(c.menuDaySimAllowed()).toBe(false);
      c.menuSimulate();
      fixture.detectChanges();
      expect(c.simulatedCompletion()).toBeNull();
      expect(c.repeatCfg().repeatFromCompletionDate).toBeFalsy();
    });

    it('does not offer simulate for a COUNT rule (completion + COUNT is unsupported)', async () => {
      // from-completion + COUNT never terminates and the save path rejects it,
      // so simulate — which would re-anchor the COUNT window from the sim day —
      // is withheld even on a from-completion cfg.
      const fixture = await setupTestBed({
        repeatCfg: { ...completionCfg, rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=5' },
      });
      const c = fixture.componentInstance;
      c.menuDay.set({ dateStr: '2099-01-06' } as DayData);
      expect(c.menuDaySimAllowed()).toBe(false);
    });

    it('offers simulate only on/after the start date (from-completion schedule)', async () => {
      const fixture = await setupTestBed({
        repeatCfg: { ...completionCfg, startDate: '2099-01-05' },
      });
      const c = fixture.componentInstance;
      c.menuDay.set({ dateStr: '2099-01-04' } as DayData); // before start
      expect(c.menuDaySimAllowed()).toBe(false);
      c.menuDay.set({ dateStr: '2099-01-05' } as DayData); // the start
      expect(c.menuDaySimAllowed()).toBe(true);
      c.menuDay.set({ dateStr: '2099-01-09' } as DayData); // after start
      expect(c.menuDaySimAllowed()).toBe(true);
    });

    it('clears a simulation that the new start date would precede', async () => {
      const fixture = await setupTestBed({
        repeatCfg: { ...completionCfg, startDate: '2099-01-01' },
      });
      const c = fixture.componentInstance;
      c.menuDay.set({ dateStr: '2099-01-06' } as DayData);
      c.menuSimulate();
      expect(c.simulatedCompletion()).toBe('2099-01-06');
      // Move the start AFTER the sim → the sim is now before the start → dropped.
      c.menuDay.set({ dateStr: '2099-01-10' } as DayData);
      c.menuSetStart();
      fixture.detectChanges();
      expect(c.simulatedCompletion()).toBeNull();
    });

    it('keeps a simulation when the new start date precedes it', async () => {
      // Moving the start to BEFORE the sim leaves the completion valid (it still
      // sits on/after the start), so the sim must survive — including the
      // sim-watcher effect that fires on the startDate slice change.
      const fixture = await setupTestBed({
        repeatCfg: { ...completionCfg, startDate: '2099-01-05' },
      });
      const c = fixture.componentInstance;
      c.menuDay.set({ dateStr: '2099-01-20' } as DayData);
      c.menuSimulate();
      fixture.detectChanges();
      expect(c.simulatedCompletion()).toBe('2099-01-20');
      // Move the start EARLIER, still before the sim → the sim stays.
      c.menuDay.set({ dateStr: '2099-01-10' } as DayData);
      c.menuSetStart();
      fixture.detectChanges();
      expect(c.repeatCfg().startDate).toBe('2099-01-10');
      expect(c.simulatedCompletion()).toBe('2099-01-20');
    });

    it('clears an active simulation when the rule is edited', async () => {
      // A sim belongs to the rule it was clicked on; keeping it across an edit
      // would re-anchor the NEW rule's series at a day picked for the old one.
      const fixture = await setupTestBed({ repeatCfg: completionCfg });
      const c = fixture.componentInstance;
      c.menuDay.set({ dateStr: '2099-01-06' } as DayData);
      c.menuSimulate();
      expect(c.simulatedCompletion()).toBe('2099-01-06');
      c.onRRuleChange('FREQ=MONTHLY;BYMONTHDAY=15');
      expect(c.simulatedCompletion()).toBeNull();
    });

    it('manual fullscreen toggle adds/removes the fullscreen panel class', async () => {
      // The calendar is always shown; fullscreen is purely the title-bar escape
      // hatch for the wide year strip.
      const fixture = await setupTestBed({ repeatCfg: rruleCfg });
      const c = fixture.componentInstance;
      expect(c.isFullScreen()).toBe(false);
      c.toggleFullScreen();
      expect(c.isFullScreen()).toBe(true);
      expect(mockDialogRef.addPanelClass).toHaveBeenCalledWith('dialog-fullscreen');
      c.toggleFullScreen();
      expect(c.isFullScreen()).toBe(false);
      expect(mockDialogRef.removePanelClass).toHaveBeenCalledWith('dialog-fullscreen');
    });

    it('year arrows shift the projection window by whole years, both directions', async () => {
      const fixture = await setupTestBed({ repeatCfg: rruleCfg });
      const c = fixture.componentInstance;
      const home = c.resultHeatmapData()!;
      // Window is padded to full calendar months.
      expect(home.rangeStart.getDate()).toBe(1);
      const homeStartYear = home.rangeStart.getFullYear();

      c.previewNextYear();
      expect(c.resultHeatmapData()!.rangeStart.getFullYear()).toBe(homeStartYear + 1);

      c.previewPrevYear();
      c.previewPrevYear();
      expect(c.resultHeatmapData()!.rangeStart.getFullYear()).toBe(homeStartYear - 1);
      expect(c.previewNavLabel()).toContain(String(homeStartYear - 1));
    });

    it('renders an empty HOME window with nav + hint instead of nothing (far-future start)', async () => {
      // A valid rule with no occurrence in the next 365 days used to null out
      // the preview entirely — including the ‹ › arrows, so the window where
      // it DOES fire was unreachable.
      const y = new Date().getFullYear() + 5;
      const fixture = await setupTestBed({
        repeatCfg: { ...rruleCfg, rrule: 'FREQ=DAILY', startDate: `${y}-01-15` },
      });
      const c = fixture.componentInstance;
      expect(c.resultHeatmapData()).not.toBeNull();
      expect(c.previewWindowEmpty()).toBe(true);
      for (let i = 0; i < 5; i++) {
        c.previewNextYear();
      }
      expect(c.previewWindowEmpty()).toBe(false);
    });

    it('keeps a navigated window rendered even when it has no occurrences (no stranding)', async () => {
      // Far in the past, before the cfg's startDate, the window is empty — the
      // calendar and its ‹ › nav must survive so the user can navigate back.
      const fixture = await setupTestBed({ repeatCfg: rruleCfg });
      const c = fixture.componentInstance;
      for (let i = 0; i < 5; i++) {
        c.previewPrevYear();
      }
      expect(c.resultHeatmapData()).not.toBeNull();
      // Back home it is populated again.
      for (let i = 0; i < 5; i++) {
        c.previewNextYear();
      }
      expect(c.resultHeatmapData()).not.toBeNull();
    });

    it('does not mark days already past as projected in the home window', async () => {
      const fixture = await setupTestBed({ repeatCfg: rruleCfg });
      const c = fixture.componentInstance;
      const home = c.resultHeatmapData()!;
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      [...home.dayMap.values()]
        .filter((d) => d.isProjected)
        .forEach((d) => expect(d.dateStr >= todayStr).toBe(true));
    });

    it('month navigation past the window edge pulls the window along', async () => {
      const fixture = await setupTestBed({ repeatCfg: rruleCfg });
      const c = fixture.componentInstance;
      const home = c.resultHeatmapData()!;
      const homeStartYear = home.rangeStart.getFullYear();
      // A month fully after the window end → window shifts forward a year.
      c.onPreviewMonthChange({
        y: home.rangeEnd.getFullYear(),
        m: home.rangeEnd.getMonth() + 1,
      });
      expect(c.resultHeatmapData()!.rangeStart.getFullYear()).toBe(homeStartYear + 1);
      // A month still inside the window → no shift.
      const cur = c.resultHeatmapData()!;
      c.onPreviewMonthChange({
        y: cur.rangeStart.getFullYear(),
        m: cur.rangeStart.getMonth() + 2,
      });
      expect(c.resultHeatmapData()!.rangeStart.getFullYear()).toBe(homeStartYear + 1);
    });

    it('clears an active simulation when startDate or excluded days change (formly model edit)', async () => {
      // These edits arrive only as a new formly model (no dedicated handler) —
      // the schedule-slice effect must drop the sim, same as a rule edit.
      const fixture = await setupTestBed({ repeatCfg: completionCfg });
      const c = fixture.componentInstance;
      c.menuDay.set({ dateStr: '2099-01-06' } as DayData);
      c.menuSimulate();
      expect(c.simulatedCompletion()).toBe('2099-01-06');
      c.repeatCfg.update((cfg) => ({ ...cfg, startDate: '2024-07-01' }) as any);
      fixture.detectChanges();
      expect(c.simulatedCompletion()).toBeNull();

      c.menuDay.set({ dateStr: '2099-01-06' } as DayData);
      c.menuSimulate();
      expect(c.simulatedCompletion()).toBe('2099-01-06');
      c.repeatCfg.update(
        (cfg) => ({ ...cfg, deletedInstanceDates: ['2099-01-05'] }) as any,
      );
      fixture.detectChanges();
      expect(c.simulatedCompletion()).toBeNull();
    });

    it('keeps an active simulation across an unrelated (title) edit', async () => {
      const fixture = await setupTestBed({ repeatCfg: completionCfg });
      const c = fixture.componentInstance;
      c.menuDay.set({ dateStr: '2099-01-06' } as DayData);
      c.menuSimulate();
      c.repeatCfg.update((cfg) => ({ ...cfg, title: 'typing…' }) as any);
      fixture.detectChanges();
      expect(c.simulatedCompletion()).toBe('2099-01-06');
    });

    it('does not rebuild the projection when an unrelated field changes', async () => {
      // formly emits a cloned model per keystroke in ANY field; the projection
      // must only recompute when a schedule-relevant field changes.
      const fixture = await setupTestBed({ repeatCfg: rruleCfg });
      const c = fixture.componentInstance;
      const before = c.resultHeatmapData();
      expect(before).not.toBeNull();
      c.repeatCfg.update((cfg) => ({ ...cfg, title: 'typing…' }) as any);
      expect(c.resultHeatmapData()).toBe(before); // same reference — no rebuild
      c.repeatCfg.update((cfg) => ({ ...cfg, rrule: 'FREQ=DAILY' }) as any);
      expect(c.resultHeatmapData()).not.toBe(before); // schedule change rebuilds
    });

    it('merges the saved series tracked time into the calendar as a green activity overlay', async () => {
      // #3: a purely forward window never showed activity (tracked time is in
      // the PAST). With the look-back window, a recently tracked day of the
      // series surfaces as a green (activityLevel) cell in the projection.
      const trackedDate = new Date();
      trackedDate.setDate(trackedDate.getDate() - 10);
      const trackedDay = getDbDateStr(trackedDate);
      const seriesTask = {
        ...mockTask,
        id: 'series-1',
        repeatCfgId: 'rr-activity',
        timeSpentOnDay: { [trackedDay]: 3_600_000 },
      } as unknown as TaskCopy;

      const fixture = await setupTestBed(
        {
          repeatCfg: {
            ...mockRepeatCfg,
            id: 'rr-activity',
            quickSetting: 'RRULE',
            rrule: 'FREQ=DAILY',
          },
        },
        undefined,
        [seriesTask],
      );
      const c = fixture.componentInstance;
      // Flush the repeatCfgId → toObservable → switchMap(loadSeriesTasks) →
      // Promise.all pipeline (a couple of microtask/macrotask turns).
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(c.hasActivity()).toBe(true);
      const day = c.resultHeatmapData()!.dayMap.get(trackedDay)!;
      expect(day).toBeTruthy();
      expect(day.timeSpent).toBe(3_600_000);
      // Sole tracked day → busiest in view → top green level.
      expect(day.activityLevel).toBe(4);

      // Toggling activity OFF drops the green merge.
      c.showActivity.set(false);
      const dayOff = c.resultHeatmapData()!.dayMap.get(trackedDay)!;
      expect(dayOff.activityLevel).toBeUndefined();
    });
  });

  describe('calendar context-menu actions', () => {
    const monthlyCfg: TaskRepeatCfg = {
      ...DEFAULT_TASK_REPEAT_CFG,
      id: 'cal-menu',
      title: 'Monthly 10th',
      startDate: '2026-06-15',
      quickSetting: 'RRULE',
      repeatCycle: 'MONTHLY',
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=10',
    };

    it('day menu: "on this day of month" adds BYMONTHDAY', async () => {
      const fixture = await setupTestBed({ repeatCfg: monthlyCfg });
      const c = fixture.componentInstance;
      c.menuDay.set({ date: new Date(2026, 5, 20), dateStr: '2026-06-20' } as DayData);
      c.menuToggleMonthDay();
      expect(c.repeatCfg().rrule).toBe('FREQ=MONTHLY;BYMONTHDAY=10,20');
    });

    it('day menu: "ends on" sets UNTIL for a day after the start', async () => {
      const fixture = await setupTestBed({ repeatCfg: monthlyCfg });
      const c = fixture.componentInstance;
      c.menuDay.set({ date: new Date(2027, 0, 1), dateStr: '2027-01-01' } as DayData);
      expect(c.menuDayIsEnd()).toBe(false);
      c.menuEndsOn();
      expect(c.repeatCfg().rrule).toContain('UNTIL=20270101');
    });

    it('day menu: clicking the day that IS the end removes the end (toggle)', async () => {
      const fixture = await setupTestBed({
        repeatCfg: {
          ...monthlyCfg,
          rrule: 'FREQ=MONTHLY;BYMONTHDAY=10;UNTIL=20270101T120000Z',
        },
      });
      const c = fixture.componentInstance;
      c.menuDay.set({ date: new Date(2027, 0, 1), dateStr: '2027-01-01' } as DayData);
      // The clicked day is the end → the menu flips to "Remove" and toggles off.
      expect(c.menuDayIsEnd()).toBe(true);
      c.menuEndsOn();
      expect(c.repeatCfg().rrule).not.toContain('UNTIL');
    });

    it('weekday menu: nth ordinal adds BYDAY=2MO', async () => {
      const fixture = await setupTestBed({ repeatCfg: monthlyCfg });
      const c = fixture.componentInstance;
      c.menuWeekdayIdx.set(0); // MO
      c.menuToggleNth(2, 'MONTHLY');
      expect(c.repeatCfg().rrule).toBe('FREQ=MONTHLY;BYDAY=2MO');
    });

    it('weekday menu: the YEARLY nth variant produces a yearly nth rule', async () => {
      const fixture = await setupTestBed({ repeatCfg: monthlyCfg });
      const c = fixture.componentInstance;
      c.menuWeekdayIdx.set(0); // MO
      c.menuToggleNth(2, 'YEARLY');
      expect(c.repeatCfg().rrule).toContain('FREQ=YEARLY');
      expect(c.repeatCfg().rrule).toContain('BYDAY=2MO');
    });

    it('weekday menu: selected day adds a plain BYDAY (monthly weekdays)', async () => {
      const fixture = await setupTestBed({ repeatCfg: monthlyCfg });
      const c = fixture.componentInstance;
      c.menuWeekdayIdx.set(2); // WE
      c.menuToggleSelectedDay('MONTHLY');
      expect(c.repeatCfg().rrule).toBe('FREQ=MONTHLY;BYDAY=WE');
    });

    it('weekday menu: the WEEKLY variant switches a monthly rule to weekly', async () => {
      const fixture = await setupTestBed({ repeatCfg: monthlyCfg });
      const c = fixture.componentInstance;
      c.menuWeekdayIdx.set(2); // WE
      c.menuToggleSelectedDay('WEEKLY');
      expect(c.repeatCfg().rrule).toBe('FREQ=WEEKLY;BYDAY=WE');
    });

    it('month-label menu: toggles BYMONTH for the viewed month', async () => {
      const fixture = await setupTestBed({
        repeatCfg: { ...monthlyCfg, rrule: 'FREQ=DAILY', repeatCycle: 'DAILY' },
      });
      const c = fixture.componentInstance;
      c.menuMonthIdx.set(5); // June → month 6
      c.menuToggleMonth();
      expect(c.repeatCfg().rrule).toContain('BYMONTH=6');
    });

    it('a calendar rule-edit switches the quick-setting to Custom (RRULE)', async () => {
      // A preset (e.g. Daily) edited via the calendar becomes a custom rule.
      const fixture = await setupTestBed({
        repeatCfg: {
          ...monthlyCfg,
          rrule: 'FREQ=DAILY',
          repeatCycle: 'DAILY',
          quickSetting: 'DAILY',
        },
      });
      const c = fixture.componentInstance;
      expect(c.repeatCfg().quickSetting).toBe('DAILY');
      c.menuMonthIdx.set(5);
      c.menuToggleMonth();
      expect(c.repeatCfg().quickSetting).toBe('RRULE');
    });

    it('weekday menu: "selected days" works in WEEKLY mode (adds BYDAY)', async () => {
      const fixture = await setupTestBed({
        repeatCfg: {
          ...monthlyCfg,
          rrule: 'FREQ=WEEKLY;BYDAY=MO',
          repeatCycle: 'WEEKLY',
        },
      });
      const c = fixture.componentInstance;
      c.menuWeekdayIdx.set(2); // WE
      c.menuToggleSelectedDay('WEEKLY');
      expect(c.repeatCfg().rrule).toBe('FREQ=WEEKLY;BYDAY=MO,WE');
    });

    it('moving the start on/after the end (UNTIL) clears the end back to Never', async () => {
      const fixture = await setupTestBed({
        repeatCfg: {
          ...monthlyCfg,
          rrule: 'FREQ=DAILY;UNTIL=20260620T120000Z',
          repeatCycle: 'DAILY',
          startDate: '2026-06-01',
        },
      });
      const c = fixture.componentInstance;
      expect(c.repeatCfg().rrule).toContain('UNTIL');
      c.menuDay.set({ dateStr: '2026-07-01' } as DayData); // after the 6/20 end
      c.menuSetStart();
      expect(c.repeatCfg().rrule).not.toContain('UNTIL');
    });

    it('setting the start re-anchors a running from-completion schedule', async () => {
      // A from-completion schedule that has run anchors on lastTaskCreationDay, so
      // an explicit start edit would otherwise be swallowed — clear the marker.
      const fixture = await setupTestBed({
        repeatCfg: {
          ...monthlyCfg,
          repeatFromCompletionDate: true,
          lastTaskCreationDay: '2026-01-01',
          startDate: '2026-06-01',
        },
      });
      const c = fixture.componentInstance;
      c.menuDay.set({ dateStr: '2026-07-01' } as DayData);
      c.menuSetStart();
      expect(c.repeatCfg().startDate).toBe('2026-07-01');
      expect(c.repeatCfg().lastTaskCreationDay).toBeUndefined();
    });

    it('setting the start on a fixed schedule leaves lastTaskCreationDay alone', async () => {
      const fixture = await setupTestBed({
        repeatCfg: {
          ...monthlyCfg,
          repeatFromCompletionDate: false,
          lastTaskCreationDay: '2026-01-01',
          startDate: '2026-06-01',
        },
      });
      const c = fixture.componentInstance;
      c.menuDay.set({ dateStr: '2026-07-01' } as DayData);
      c.menuSetStart();
      expect(c.repeatCfg().startDate).toBe('2026-07-01');
      expect(c.repeatCfg().lastTaskCreationDay).toBe('2026-01-01');
    });
  });

  describe('RRULE builder mode', () => {
    it('_processQuickSettingForDate forces RRULE mode for a non-preset rrule cfg', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance as any;
      const out = component._processQuickSettingForDate({
        rrule: 'FREQ=DAILY',
        quickSetting: 'CUSTOM',
        startDate: '2024-06-01',
      });
      expect(out.quickSetting).toBe('RRULE');
    });

    it('_processQuickSettingForDate keeps the preset label for a faithful rrule preset', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance as any;
      // rrule matches what the DAILY preset produces → stays a labelled preset.
      const out = component._processQuickSettingForDate({
        rrule: 'FREQ=DAILY',
        quickSetting: 'DAILY',
        repeatCycle: 'DAILY',
        repeatEvery: 1,
        startDate: '2024-06-01',
      });
      expect(out.quickSetting).toBe('DAILY');
    });

    it('_processQuickSettingForDate opens the builder when the rrule diverges from its preset label', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance as any;
      // Labelled DAILY but the rule is biweekly Monday → not a faithful preset.
      const out = component._processQuickSettingForDate({
        rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO',
        quickSetting: 'DAILY',
        repeatCycle: 'DAILY',
        repeatEvery: 1,
        startDate: '2024-06-03',
      });
      expect(out.quickSetting).toBe('RRULE');
    });

    it('editing an rrule cfg opens in RRULE mode with the rule preserved', async () => {
      const rruleCfg: TaskRepeatCfg = {
        ...DEFAULT_TASK_REPEAT_CFG,
        id: 'rr-cfg',
        title: 'Biweekly',
        startDate: '2024-06-03',
        repeatCycle: 'WEEKLY',
        rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO',
      };
      const fixture = await setupTestBed({ repeatCfg: rruleCfg });
      const cfg = fixture.componentInstance.repeatCfg();
      expect(cfg.quickSetting).toBe('RRULE');
      expect(cfg.rrule).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO');
    });

    it('onRRuleChange stores the rule and derives the legacy repeatCycle', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;
      component.onRRuleChange('FREQ=MONTHLY;BYMONTHDAY=15');
      const cfg = component.repeatCfg();
      expect(cfg.rrule).toBe('FREQ=MONTHLY;BYMONTHDAY=15');
      expect(cfg.repeatCycle).toBe('MONTHLY');
    });

    it('result preview reflects onRRuleChange freq/interval updates', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;
      component.repeatCfg.update((c) => ({ ...c, quickSetting: 'RRULE' }) as any);
      component.onRRuleChange('FREQ=MONTHLY;BYMONTHDAY=15');
      expect(component.rrulePreview()?.rrule).toBe('FREQ=MONTHLY;BYMONTHDAY=15');
      component.onRRuleChange('FREQ=YEARLY;INTERVAL=2;BYMONTHDAY=15');
      expect(component.rrulePreview()?.rrule).toBe(
        'FREQ=YEARLY;INTERVAL=2;BYMONTHDAY=15',
      );
    });

    it('exposes a live rrule result/preview in RRULE mode (dialog-level)', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;
      component.repeatCfg.update(
        (c) =>
          ({
            ...c,
            quickSetting: 'RRULE',
            rrule: 'FREQ=WEEKLY;BYDAY=MO',
          }) as any,
      );
      expect(component.rrulePreview()?.human.toLowerCase()).toContain('week');
      expect(component.rrulePreview()?.rrule).toBe('FREQ=WEEKLY;BYDAY=MO');
    });

    it('save() persists the rrule the builder produced', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;
      component.repeatCfg.update((c) => ({ ...c, quickSetting: 'RRULE' }) as any);
      component.onRRuleChange('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE');
      component.save();
      expect(mockTaskRepeatCfgService.addTaskRepeatCfgToTask).toHaveBeenCalled();
      const savedCfg = mockTaskRepeatCfgService.addTaskRepeatCfgToTask.calls.mostRecent()
        .args[2] as any;
      expect(savedCfg.rrule).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE');
      expect(savedCfg.repeatCycle).toBe('WEEKLY');
    });

    it('onRRuleChange clears stale monthly anchors from a previous rule', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;
      // Simulate a leftover nth-weekday anchor (e.g. from MONTHLY_NTH_WEEKDAY).
      component.repeatCfg.update(
        (c) => ({ ...c, monthlyWeekOfMonth: 2, monthlyWeekday: 2 }) as any,
      );
      component.onRRuleChange('FREQ=MONTHLY;BYMONTHDAY=15');
      const cfg = component.repeatCfg() as any;
      // undefined (not null!) — released clients' typia schema allows the
      // anchors only absent-or-numeric, so null must never be persisted.
      expect(cfg.monthlyWeekOfMonth).toBeUndefined();
      expect(cfg.monthlyWeekday).toBeUndefined();
    });

    it('onRRuleChange does NOT touch startDate (alignment happens at save only)', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;
      component.repeatCfg.update((c) => ({ ...c, startDate: '2024-06-03' }) as any);
      component.onRRuleChange('FREQ=MONTHLY;BYMONTHDAY=15');
      // Aligning live would silently rewrite the visible start-date field on
      // every builder interaction.
      expect(component.repeatCfg().startDate).toBe('2024-06-03');
    });

    it('save() aligns startDate onto the rule day for a new date-anchored cfg', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;
      component.repeatCfg.update(
        (c) => ({ ...c, quickSetting: 'RRULE', startDate: '2024-06-03' }) as any,
      );
      component.onRRuleChange('FREQ=MONTHLY;BYMONTHDAY=15');
      component.save();
      const savedCfg = mockTaskRepeatCfgService.addTaskRepeatCfgToTask.calls.mostRecent()
        .args[2] as any;
      // Old clients read the monthly day from startDate — must sit on the 15th.
      expect(savedCfg.startDate).toBe('2024-06-15');
    });

    it('save() keeps monthlyLastDay as the old-client fallback for BYMONTHDAY=-1', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;
      component.repeatCfg.update((c) => ({ ...c, quickSetting: 'RRULE' }) as any);
      component.onRRuleChange('FREQ=MONTHLY;BYMONTHDAY=-1');
      component.save();
      const savedCfg = mockTaskRepeatCfgService.addTaskRepeatCfgToTask.calls.mostRecent()
        .args[2] as any;
      expect(savedCfg.rrule).toBe('FREQ=MONTHLY;BYMONTHDAY=-1');
      // Regression: _normalizeMonthlyAnchor used to strip this for RRULE saves,
      // losing month-end semantics on old clients.
      expect(savedCfg.monthlyLastDay).toBe(true);
    });

    it('save() realigns startDate edited after the last builder change', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;
      component.repeatCfg.update((c) => ({ ...c, quickSetting: 'RRULE' }) as any);
      component.onRRuleChange('FREQ=MONTHLY;BYMONTHDAY=15');
      // User edits the start date afterwards — off-occurrence again.
      component.repeatCfg.update((c) => ({ ...c, startDate: '2024-07-03' }) as any);
      component.save();
      const savedCfg = mockTaskRepeatCfgService.addTaskRepeatCfgToTask.calls.mostRecent()
        .args[2] as any;
      expect(savedCfg.startDate).toBe('2024-07-15');
    });

    it('save() rejects a never-firing raw-override rule fast (pre-screen, no probe walk)', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;
      const snack = TestBed.inject(SnackService);
      const openSpy = spyOn(snack, 'open').and.callThrough();
      component.repeatCfg.update(
        (c) =>
          ({
            ...c,
            quickSetting: 'RRULE',
            rrule: 'FREQ=DAILY;BYWEEKNO=53;BYMONTH=2',
          }) as any,
      );
      const start = performance.now();
      component.save();
      const elapsed = performance.now() - start;
      // isRRuleValid's _canNeverFire pre-screen must reject before any probe:
      // without it, this contradiction walks rrule.js to its iteration ceiling
      // (~7-10s main-thread freeze) on the save click.
      expect(openSpy.calls.mostRecent().args[0]).toEqual(
        jasmine.objectContaining({ type: 'ERROR', msg: T.F.TASK_REPEAT.F.RRULE_INVALID }),
      );
      expect(mockTaskRepeatCfgService.addTaskRepeatCfgToTask).not.toHaveBeenCalled();
      // Generous bound — only meant to catch a regression back to the probe walk.
      expect(elapsed).toBeLessThan(1000);
    });

    it('save() re-derives the legacy weekday fallback when startDate changed after the last builder emit', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;
      component.repeatCfg.update(
        (c) => ({ ...c, quickSetting: 'RRULE', startDate: '2024-06-12' }) as any, // a Wednesday
      );
      // BYDAY-less weekly rule — the legacy fallback maps onto the start weekday.
      component.onRRuleChange('FREQ=WEEKLY');
      // User edits the start date afterwards; no alignment applies for weekly,
      // but the stale Wednesday flag must still be re-derived to Thursday —
      // else old clients fire on a different weekday than the saved dtstart.
      component.repeatCfg.update((c) => ({ ...c, startDate: '2024-06-13' }) as any); // a Thursday
      component.save();
      const savedCfg = mockTaskRepeatCfgService.addTaskRepeatCfgToTask.calls.mostRecent()
        .args[2] as any;
      expect(savedCfg.startDate).toBe('2024-06-13');
      expect(savedCfg.thursday).toBe(true);
      expect(savedCfg.wednesday).toBe(false);
    });

    it('save() does NOT realign startDate on an edit when the schedule was not touched', async () => {
      // Regression (#7373 class): a stored cfg whose startDate is off-occurrence
      // (imported / pre-alignment) must not get a startDate change — a
      // SCHEDULE_AFFECTING_FIELD — injected by save() when the user only edited
      // the title; that would reschedule today's live instance.
      const storedCfg: TaskRepeatCfg = {
        ...DEFAULT_TASK_REPEAT_CFG,
        id: 'rr-unaligned',
        title: 'Unaligned',
        startDate: '2024-06-03',
        repeatCycle: 'MONTHLY',
        quickSetting: 'RRULE' as any,
        rrule: 'FREQ=MONTHLY;BYMONTHDAY=15',
      };
      const fixture = await setupTestBed({ repeatCfg: storedCfg });
      const component = fixture.componentInstance;
      component.repeatCfg.update((c) => ({ ...c, title: 'Renamed' }) as any);
      component.save();
      expect(mockTaskRepeatCfgService.updateTaskRepeatCfg).toHaveBeenCalled();
      const changes = mockTaskRepeatCfgService.updateTaskRepeatCfg.calls.mostRecent()
        .args[1] as any;
      expect(changes.title).toBe('Renamed');
      expect('startDate' in changes).toBe(false);
    });

    it('save() blocks a parseable rule that can never produce an occurrence', async () => {
      // FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30 parses fine (and isRRuleValid is
      // true) but Feb 30 never exists — persisting it would create a silently
      // dead recurrence with the legacy fallback bypassed.
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;
      component.repeatCfg.update(
        (c) => ({ ...c, quickSetting: 'RRULE', startDate: '2024-06-03' }) as any,
      );
      component.onRRuleChange('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30');
      component.save();
      expect(mockTaskRepeatCfgService.addTaskRepeatCfgToTask).not.toHaveBeenCalled();
    });

    it('save() blocks sub-daily frequencies (raw override FREQ=HOURLY)', async () => {
      // The engine is day-granular: a sub-daily rule would be accepted but
      // silently collapse to ~daily firing, and it has no legacy repeatCycle
      // for old clients (rruleToLegacyTaskRepeatCfg returns {}).
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;
      component.repeatCfg.update(
        (c) => ({ ...c, quickSetting: 'RRULE', startDate: '2024-06-03' }) as any,
      );
      component.onRRuleChange('FREQ=HOURLY');
      component.save();
      expect(mockTaskRepeatCfgService.addTaskRepeatCfgToTask).not.toHaveBeenCalled();
    });

    it('save() blocks COUNT combined with repeat-from-completion (count never finishes)', async () => {
      // Completing an instance re-anchors startDate + lastTaskCreationDay to
      // the completion day, which restarts the COUNT window — the series would
      // never terminate.
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;
      component.repeatCfg.update(
        (c) => ({ ...c, quickSetting: 'RRULE', startDate: '2024-06-03' }) as any,
      );
      component.onRRuleChange('FREQ=DAILY;COUNT=5');
      component.onRepeatFromCompletionChange(true);
      component.save();
      expect(mockTaskRepeatCfgService.addTaskRepeatCfgToTask).not.toHaveBeenCalled();

      // The same rule WITHOUT the completion anchor saves fine.
      component.onRepeatFromCompletionChange(false);
      component.save();
      expect(mockTaskRepeatCfgService.addTaskRepeatCfgToTask).toHaveBeenCalled();
    });

    it('reopens a wire-clamped preset cfg under its preset label (not the raw builder)', async () => {
      // Non-master presets persist as quickSetting='CUSTOM' (sync clamp); the
      // rrule is the only thing identifying them on reopen — infer it back.
      const weekendsCfg: TaskRepeatCfg = {
        ...DEFAULT_TASK_REPEAT_CFG,
        id: 'rr-weekends',
        title: 'Weekends',
        quickSetting: 'CUSTOM',
        repeatCycle: 'WEEKLY',
        repeatEvery: 1,
        startDate: '2024-06-08', // a Saturday
        monday: false,
        tuesday: false,
        wednesday: false,
        thursday: false,
        friday: false,
        saturday: true,
        sunday: true,
        rrule: 'FREQ=WEEKLY;BYDAY=SA,SU',
      };
      const fixture = await setupTestBed({ repeatCfg: weekendsCfg });
      expect(fixture.componentInstance.repeatCfg().quickSetting).toBe('WEEKENDS');
    });

    it('opens completion-relative cfgs in builder mode even when the rrule matches a preset', async () => {
      // The schedule-type toggle ("from completion") only exists in the RRULE
      // builder — a preset label (e.g. EVERY_OTHER_DAY) would hide it.
      const completionCfg: TaskRepeatCfg = {
        ...DEFAULT_TASK_REPEAT_CFG,
        id: 'rr-completion',
        title: 'Every other day after done',
        quickSetting: 'CUSTOM',
        repeatCycle: 'DAILY',
        repeatEvery: 2,
        repeatFromCompletionDate: true,
        startDate: '2024-06-03',
        rrule: 'FREQ=DAILY;INTERVAL=2',
      };
      const fixture = await setupTestBed({ repeatCfg: completionCfg });
      expect(fixture.componentInstance.repeatCfg().quickSetting).toBe('RRULE');
    });

    it('opens a completion-relative FAITHFUL preset cfg in builder mode too', async () => {
      const faithful: TaskRepeatCfg = {
        ...DEFAULT_TASK_REPEAT_CFG,
        id: 'rr-completion-2',
        title: 'Daily after done',
        quickSetting: 'DAILY',
        repeatCycle: 'DAILY',
        repeatEvery: 1,
        repeatFromCompletionDate: true,
        startDate: '2024-06-03',
        rrule: 'FREQ=DAILY',
      };
      const fixture = await setupTestBed({ repeatCfg: faithful });
      expect(fixture.componentInstance.repeatCfg().quickSetting).toBe('RRULE');
    });

    it('offers the RRULE quick-setting option with the engine flag OFF, incl. on the async edit path', fakeAsync(async () => {
      // The builder replaced the legacy Custom UI, so the option is ALWAYS
      // offered regardless of the per-device engine flag — including on the
      // task/repeatCfgId path, where the cfg arrives async and migrates into
      // builder mode only after the form config was built. (A flag-gated
      // option list would leave the select holding 'RRULE' with no matching
      // option here.)
      setRRuleEngineEnabled(false);
      const taskWithRepeatCfg = {
        ...mockTask,
        repeatCfgId: 'repeat-cfg-123',
      } as TaskCopy;
      const repeatCfgSubject = new Subject<TaskRepeatCfg>();
      const fixture = await setupTestBed({ task: taskWithRepeatCfg }, repeatCfgSubject);
      const component = fixture.componentInstance;
      fixture.detectChanges();
      tick();

      // Option building now lives in the chip picker's source method (live
      // `includeRRule`), not a formly field's expressionProperties.
      const buildOptions = (): { value: string }[] =>
        (component as any)._buildQuickSettingOptions();

      // Custom ('RRULE') is always on offer, even with the engine flag off.
      expect(buildOptions().some((o) => o.value === 'RRULE')).toBe(true);

      // Async load delivers a completion cfg that migrates to builder mode.
      repeatCfgSubject.next({
        ...mockRepeatCfg,
        repeatFromCompletionDate: true,
        rrule: 'FREQ=DAILY',
      } as TaskRepeatCfg);
      tick();
      expect(component.repeatCfg().quickSetting).toBe('RRULE');
      expect(buildOptions().some((o) => o.value === 'RRULE')).toBe(true);
    }));

    it('opens a NO-rrule completion-relative cfg in builder mode (migrates to rrule)', async () => {
      // Pre-RRULE / imported completion cfgs have no rrule and a kept preset
      // label (DAILY here). They previously fell through `needsMigration === false`
      // and opened under that label with the "from completion" toggle hidden.
      // They must force builder mode so the toggle is visible.
      const legacyCompletion: TaskRepeatCfg = {
        ...DEFAULT_TASK_REPEAT_CFG,
        id: 'legacy-completion',
        title: 'Daily after done (legacy)',
        quickSetting: 'DAILY',
        repeatCycle: 'DAILY',
        repeatEvery: 1,
        repeatFromCompletionDate: true,
        startDate: '2024-06-03',
        rrule: undefined,
      };
      const fixture = await setupTestBed({ repeatCfg: legacyCompletion });
      const cfg = fixture.componentInstance.repeatCfg();
      expect(cfg.quickSetting).toBe('RRULE');
      expect(cfg.rrule).toBeTruthy();
      expect(cfg.repeatFromCompletionDate).toBe(true);
    });

    it('does NOT flip repeatFromCompletionDate to false when saving a migrated no-rrule completion cfg', async () => {
      // The exact regression: opened under a preset label with the toggle hidden,
      // a save would run the preset branch that resets the flag — silently
      // changing "repeat after completion" to "repeat from start date". Forcing
      // builder mode (quickSetting === 'RRULE') skips that reset.
      const legacyCompletion: TaskRepeatCfg = {
        ...DEFAULT_TASK_REPEAT_CFG,
        id: 'legacy-completion-2',
        title: 'Daily after done (legacy)',
        quickSetting: 'DAILY',
        repeatCycle: 'DAILY',
        repeatEvery: 1,
        repeatFromCompletionDate: true,
        startDate: '2024-06-03',
        rrule: undefined,
      };
      const fixture = await setupTestBed({ repeatCfg: legacyCompletion });
      const component = fixture.componentInstance;
      // Touch the schedule so a non-empty diff exists (else the empty-diff guard
      // closes without dispatching).
      component.repeatCfg.update(
        (c) => ({ ...c, rrule: 'FREQ=DAILY;INTERVAL=2' }) as any,
      );
      component.save();
      expect(mockTaskRepeatCfgService.updateTaskRepeatCfg).toHaveBeenCalled();
      const changes = mockTaskRepeatCfgService.updateTaskRepeatCfg.calls.mostRecent()
        .args[1] as any;
      // Flag was already true and stays true → absent from the diff, never `false`.
      expect(changes.repeatFromCompletionDate).toBeUndefined();
    });

    it('clears repeatFromCompletionDate when switching a completion-relative cfg to a preset', async () => {
      // The "from completion" toggle lives only in the RRULE builder, so picking
      // a preset (which hides it) must clear the flag — otherwise it persists
      // with no visible control and keeps firing relative to completion.
      const completionCfg: TaskRepeatCfg = {
        ...DEFAULT_TASK_REPEAT_CFG,
        id: 'rr-switch',
        title: 'After done daily',
        quickSetting: 'DAILY',
        repeatCycle: 'DAILY',
        repeatEvery: 1,
        repeatFromCompletionDate: true,
        startDate: '2024-06-03',
        rrule: 'FREQ=DAILY',
      };
      const fixture = await setupTestBed({ repeatCfg: completionCfg });
      const component = fixture.componentInstance;
      // Completion-relative cfgs open in the builder regardless of preset match.
      expect(component.repeatCfg().quickSetting).toBe('RRULE');
      // User picks a plain preset, hiding the from-completion control.
      component.repeatCfg.update((c) => ({ ...c, quickSetting: 'DAILY' }) as any);
      component.save();
      expect(mockTaskRepeatCfgService.updateTaskRepeatCfg).toHaveBeenCalled();
      const changes = mockTaskRepeatCfgService.updateTaskRepeatCfg.calls.mostRecent()
        .args[1] as any;
      expect(changes.repeatFromCompletionDate).toBe(false);
    });

    it('does NOT inject repeatFromCompletionDate on a preset save when it was never set', async () => {
      // Guards the conditional clear: an untouched (falsy) flag must stay out of
      // the change set so a title-only preset save stays an empty-diff no-op
      // (#7373 class) instead of dispatching a spurious undefined→false op.
      const presetCfg: TaskRepeatCfg = {
        ...DEFAULT_TASK_REPEAT_CFG,
        id: 'rr-preset-plain',
        title: 'Plain daily',
        quickSetting: 'DAILY',
        repeatCycle: 'DAILY',
        repeatEvery: 1,
        startDate: '2024-06-03',
        rrule: 'FREQ=DAILY',
      };
      const fixture = await setupTestBed({ repeatCfg: presetCfg });
      const component = fixture.componentInstance;
      component.repeatCfg.update((c) => ({ ...c, title: 'Renamed' }) as any);
      component.save();
      const changes = mockTaskRepeatCfgService.updateTaskRepeatCfg.calls.mostRecent()
        .args[1] as any;
      expect(changes.title).toBe('Renamed');
      expect('repeatFromCompletionDate' in changes).toBe(false);
    });

    it('still opens the builder for a CUSTOM cfg whose rrule matches no preset', async () => {
      const handBuilt: TaskRepeatCfg = {
        ...DEFAULT_TASK_REPEAT_CFG,
        id: 'rr-hand',
        title: 'Hand built',
        quickSetting: 'CUSTOM',
        repeatCycle: 'WEEKLY',
        startDate: '2024-06-03',
        rrule: 'FREQ=WEEKLY;INTERVAL=3;BYDAY=MO,FR',
      };
      const fixture = await setupTestBed({ repeatCfg: handBuilt });
      expect(fixture.componentInstance.repeatCfg().quickSetting).toBe('RRULE');
    });

    it('does NOT persist the lazy rrule migration on a title-only edit (no reschedule)', async () => {
      // Opening a legacy CUSTOM cfg migrates it to rrule IN MEMORY. `rrule` is
      // a SCHEDULE_AFFECTING_FIELD — leaking it into the change set of an
      // unrelated edit would relocate today's live instance (#7373 class).
      const legacyCfg: TaskRepeatCfg = {
        ...DEFAULT_TASK_REPEAT_CFG,
        id: 'legacy-migrate',
        title: 'Old custom',
        quickSetting: 'CUSTOM',
        repeatCycle: 'WEEKLY',
        repeatEvery: 2,
        startDate: '2024-06-03',
        monday: true,
        tuesday: false,
        wednesday: false,
        thursday: false,
        friday: false,
        saturday: false,
        sunday: false,
      };
      const fixture = await setupTestBed({ repeatCfg: legacyCfg });
      const component = fixture.componentInstance;
      // Migrated in-memory:
      expect(component.repeatCfg().rrule).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO');
      component.repeatCfg.update((c) => ({ ...c, title: 'Renamed' }) as any);
      component.save();
      const changes = mockTaskRepeatCfgService.updateTaskRepeatCfg.calls.mostRecent()
        .args[1] as any;
      expect(changes.title).toBe('Renamed');
      expect('rrule' in changes).toBe(false);
      expect('quickSetting' in changes).toBe(false);
      expect('startDate' in changes).toBe(false);
    });

    it('skips the update dispatch entirely when nothing changed', async () => {
      const storedCfg: TaskRepeatCfg = {
        ...DEFAULT_TASK_REPEAT_CFG,
        id: 'rr-noop',
        title: 'Unchanged',
        startDate: '2024-06-03',
        repeatCycle: 'WEEKLY',
        quickSetting: 'CUSTOM',
        rrule: 'FREQ=WEEKLY;INTERVAL=3;BYDAY=MO',
        monday: true,
        tuesday: false,
        wednesday: false,
        thursday: false,
        friday: false,
        saturday: false,
        sunday: false,
      };
      const fixture = await setupTestBed({ repeatCfg: storedCfg });
      fixture.componentInstance.save();
      expect(mockTaskRepeatCfgService.updateTaskRepeatCfg).not.toHaveBeenCalled();
    });

    it('save() blocks when the rrule is missing/invalid in RRULE mode', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;
      component.repeatCfg.update(
        (c) => ({ ...c, quickSetting: 'RRULE', rrule: undefined }) as any,
      );
      component.save();
      expect(mockTaskRepeatCfgService.addTaskRepeatCfgToTask).not.toHaveBeenCalled();
    });

    it('save() replaces a stale builder rrule with the preset canonical rule (presets stay rrule-backed)', async () => {
      // Switching from builder mode to a preset must NOT strip the rrule —
      // getQuickSettingUpdates overwrites it with the preset's canonical rule.
      // (Clearing via `rrule: undefined` would also be dropped by the JSON
      // wire, leaving remote clients on the old rule.)
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;
      component.repeatCfg.update(
        (c) => ({ ...c, quickSetting: 'DAILY', rrule: 'FREQ=WEEKLY' }) as any,
      );
      component.save();
      const savedCfg = mockTaskRepeatCfgService.addTaskRepeatCfgToTask.calls.mostRecent()
        .args[2] as any;
      expect(savedCfg.rrule).toBe('FREQ=DAILY');
      expect(savedCfg.repeatCycle).toBe('DAILY');
    });
  });

  describe('onQuickSettingSelect (chip picker)', () => {
    // Replaces the old formly-select `change` handler coverage (#5806): the
    // chip picker now drives quickSetting via onQuickSettingSelect.
    it('uses the selected start date for date-writing presets (not today)', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;
      component.repeatCfg.update((c) => ({ ...c, startDate: '2099-09-15' }));
      component.onQuickSettingSelect('MONTHLY_CURRENT_DATE');
      expect(component.repeatCfg().quickSetting).toBe('MONTHLY_CURRENT_DATE');
      expect(component.repeatCfg().startDate).toBe('2099-09-15');
    });

    it('applies weekday flags from the selected start date for weekly presets', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;
      // 2099-09-14 is a Monday.
      component.repeatCfg.update((c) => ({ ...c, startDate: '2099-09-14' }));
      component.onQuickSettingSelect('WEEKLY_CURRENT_WEEKDAY');
      expect(component.repeatCfg().monday).toBe(true);
      expect(component.repeatCfg().tuesday).toBe(false);
    });

    it('switching to Custom (RRULE) keeps the current rrule for the builder', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;
      component.onQuickSettingSelect('DAILY');
      const dailyRule = component.repeatCfg().rrule;
      component.onQuickSettingSelect('RRULE');
      expect(component.repeatCfg().quickSetting).toBe('RRULE');
      expect(component.repeatCfg().rrule).toBe(dailyRule);
    });
  });
});
