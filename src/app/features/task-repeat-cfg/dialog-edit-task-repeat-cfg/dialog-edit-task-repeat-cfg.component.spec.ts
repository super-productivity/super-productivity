import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { DateAdapter, MatNativeDateModule } from '@angular/material/core';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TranslateModule } from '@ngx-translate/core';
import { provideMockStore } from '@ngrx/store/testing';
import { Observable, of, Subject } from 'rxjs';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
// FormlyConfigModule (not FormlyModule) is needed here to register custom
// field types and validation within the TestBed injector.
import { FormlyConfigModule } from '../../../ui/formly-config.module';
import { CustomDateAdapter } from '../../../core/date-time-format/custom-date-adapter';

import { DialogEditTaskRepeatCfgComponent } from './dialog-edit-task-repeat-cfg.component';
import { TaskRepeatCfgService } from '../task-repeat-cfg.service';
import { TagService } from '../../tag/tag.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { DEFAULT_TASK_REPEAT_CFG, TaskRepeatCfg } from '../task-repeat-cfg.model';
import { TaskCopy } from '../../tasks/task.model';
import { TranslateService } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { DateService } from '../../../core/date/date.service';

describe('DialogEditTaskRepeatCfgComponent', () => {
  let mockDialogRef: jasmine.SpyObj<MatDialogRef<DialogEditTaskRepeatCfgComponent>>;
  let mockMatDialog: jasmine.SpyObj<MatDialog>;
  let mockTaskRepeatCfgService: jasmine.SpyObj<TaskRepeatCfgService>;
  let mockTagService: jasmine.SpyObj<TagService>;
  let mockGlobalConfigService: jasmine.SpyObj<GlobalConfigService>;
  let mockDateTimeFormatService: jasmine.SpyObj<DateTimeFormatService>;
  let mockDateService: jasmine.SpyObj<DateService>;

  // DateService is mocked to this fixed day; assertions about "today" must
  // derive from these consts, never from the real clock (see #8017 CI breakage).
  const MOCK_TODAY = new Date(2026, 5, 9, 0, 0, 0, 0);
  const MOCK_TODAY_STR = '2026-06-09';

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
    getRepeatCfgReturnValue?:
      | Observable<TaskRepeatCfg | undefined>
      | Subject<TaskRepeatCfg>,
    renderTemplate = false,
  ): Promise<ComponentFixture<DialogEditTaskRepeatCfgComponent>> => {
    mockDialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    mockMatDialog = jasmine.createSpyObj('MatDialog', ['open']);
    mockMatDialog.open.and.returnValue({
      afterClosed: () => of(null),
    } as any);
    mockTaskRepeatCfgService = jasmine.createSpyObj('TaskRepeatCfgService', [
      'getTaskRepeatCfgById$',
      'getTaskRepeatCfgByIdAllowUndefined$',
      'updateTaskRepeatCfg',
      'addTaskRepeatCfgToTask',
      'deleteTaskRepeatCfgWithDialog',
    ]);
    mockDateService = jasmine.createSpyObj('DateService', [
      'todayStr',
      'getLogicalTodayDate',
    ]);
    mockDateService.todayStr.and.returnValue(MOCK_TODAY_STR);
    mockDateService.getLogicalTodayDate.and.returnValue(new Date(MOCK_TODAY));

    // Set up the return value for the repeat-config lookup before creating the component
    if (getRepeatCfgReturnValue) {
      mockTaskRepeatCfgService.getTaskRepeatCfgByIdAllowUndefined$.and.returnValue(
        getRepeatCfgReturnValue,
      );
    }

    mockTagService = jasmine.createSpyObj('TagService', ['addTag'], {
      tags$: of([]),
      tagsNoMyDayAndNoList$: of([]),
    });
    mockGlobalConfigService = jasmine.createSpyObj('GlobalConfigService', [], {
      cfg: () => ({ reminder: { defaultTaskRemindOption: null } }),
    });
    mockDateTimeFormatService = jasmine.createSpyObj('DateTimeFormatService', [], {
      currentLocale: () => 'en-US',
      dateFormat: () => ({
        parse: 'MM/dd/yyyy',
        display: { dateInput: 'MM/dd/yyyy' },
      }),
      formatTime: () => '12:00 PM',
    });

    const testModule = TestBed.configureTestingModule({
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
        { provide: MatDialog, useValue: mockMatDialog },
        { provide: MAT_DIALOG_DATA, useValue: dialogData },
        { provide: TaskRepeatCfgService, useValue: mockTaskRepeatCfgService },
        { provide: TagService, useValue: mockTagService },
        { provide: GlobalConfigService, useValue: mockGlobalConfigService },
        { provide: DateTimeFormatService, useValue: mockDateTimeFormatService },
        { provide: DateService, useValue: mockDateService },
        { provide: DateAdapter, useClass: CustomDateAdapter },
      ],
    });

    if (!renderTemplate) {
      testModule.overrideComponent(DialogEditTaskRepeatCfgComponent, {
        set: {
          // Use a minimal template to avoid @ngx-formly/material select rendering,
          // which triggers a compareWith validation error with Angular Material 21+.
          // These tests verify component signals/logic, not template rendering.
          template: '<div></div>',
        },
      });
    }

    await testModule.compileComponents();

    return TestBed.createComponent(DialogEditTaskRepeatCfgComponent);
  };

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('keeps Day of month selected after switching from an Nth weekday (#8886)', async () => {
    const monthlyNthWeekdayCfg: TaskRepeatCfg = {
      ...DEFAULT_TASK_REPEAT_CFG,
      id: 'repeat-cfg-monthly-nth-weekday',
      title: 'Monthly task',
      quickSetting: 'CUSTOM',
      repeatCycle: 'MONTHLY',
      startDate: '2026-06-09',
      monthlyWeekOfMonth: 2,
      monthlyWeekday: 1,
    };
    const fixture = await setupTestBed(
      { repeatCfg: monthlyNthWeekdayCfg },
      undefined,
      true,
    );
    fixture.detectChanges();
    await fixture.whenStable();

    const loader = TestbedHarnessEnvironment.loader(fixture);
    const selects = await loader.getAllHarnesses(MatSelectHarness);
    const formFieldsBeforeSwitch = await loader.getAllHarnesses(MatFormFieldHarness);
    const labelsBeforeSwitch = await Promise.all(
      formFieldsBeforeSwitch.map((formField) => formField.getLabel()),
    );
    expect(labelsBeforeSwitch).toContain(T.F.TASK_REPEAT.F.WEEKDAY);
    let monthlyPatternSelect: MatSelectHarness | undefined;
    let dayOfMonthOptionText = '';

    for (const select of selects) {
      await select.open();
      const [dayOfMonthOption] = await select.getOptions({
        text: /MONTHLY_MODE_DAY_OF_MONTH/,
      });
      if (dayOfMonthOption) {
        monthlyPatternSelect = select;
        dayOfMonthOptionText = await dayOfMonthOption.getText();
        await dayOfMonthOption.click();
        break;
      }
      await select.close();
    }

    expect(monthlyPatternSelect).toBeDefined();
    expect(await monthlyPatternSelect!.getValueText()).toBe(dayOfMonthOptionText);

    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.repeatCfg().monthlyWeekOfMonth).toBeNull();
    const formFieldsAfterSwitch = await loader.getAllHarnesses(MatFormFieldHarness);
    const labelsAfterSwitch = await Promise.all(
      formFieldsAfterSwitch.map((formField) => formField.getLabel()),
    );
    expect(labelsAfterSwitch).not.toContain(T.F.TASK_REPEAT.F.WEEKDAY);

    fixture.componentInstance.save();

    const changes =
      mockTaskRepeatCfgService.updateTaskRepeatCfg.calls.mostRecent().args[1];
    expect(
      Object.prototype.hasOwnProperty.call(changes, 'monthlyWeekOfMonth'),
    ).toBeTrue();
    expect(changes.monthlyWeekOfMonth).toBeUndefined();
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

    // #8715: the task can reference a repeat config that was already deleted
    // (e.g. via cross-client sync). The lookup must not throw and crash — the
    // dialog should abort editing and close.
    it('should close instead of crashing when the repeat config was deleted (#8715)', fakeAsync(async () => {
      const taskWithRepeatCfg = {
        ...mockTask,
        repeatCfgId: 'repeat-cfg-123',
      } as TaskCopy;

      const fixture = await setupTestBed({ task: taskWithRepeatCfg }, of(undefined));
      const component = fixture.componentInstance;
      fixture.detectChanges();
      tick();

      expect(component.isLoading()).toBe(false);
      expect(mockDialogRef.close).toHaveBeenCalled();
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
      (fixture.componentInstance as any)._initializeFormConfig();

      const monthlyCall = instantCalls.find(
        (c) => c.key === T.F.TASK_REPEAT.F.Q_MONTHLY_CURRENT_DATE,
      );
      const yearlyCall = instantCalls.find(
        (c) => c.key === T.F.TASK_REPEAT.F.Q_YEARLY_CURRENT_DATE,
      );

      // Due date is May 1st — day should be "1", month/day should contain "5" and "1"
      const dueDate = new Date(2026, 4, 1); // May 1st
      const expectedDayStr = dueDate.toLocaleDateString('en-US', { day: 'numeric' });
      const expectedDayAndMonthStr = dueDate.toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'numeric',
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

      (fixture.componentInstance as any)._initializeFormConfig();

      const monthlyCall = instantCalls.find(
        (c) => c.key === T.F.TASK_REPEAT.F.Q_MONTHLY_CURRENT_DATE,
      );

      // "today" comes from the mocked DateService.getLogicalTodayDate (2026-06-09),
      // not the wall clock — asserting against new Date() breaks on any other day
      const todayDayStr = MOCK_TODAY.toLocaleDateString('en-US', { day: 'numeric' });

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

      (fixture.componentInstance as any)._initializeFormConfig();

      const monthlyCall = instantCalls.find(
        (c) => c.key === T.F.TASK_REPEAT.F.Q_MONTHLY_CURRENT_DATE,
      );

      // startDate is March 15 — day should be "15"
      const startDate = new Date(2026, 2, 15); // March 15
      const expectedDayStr = startDate.toLocaleDateString('en-US', { day: 'numeric' });

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
      // Pick a date whose weekday definitely differs from the mocked today
      const dateStr = '2026-06-12'; // Friday; MOCK_TODAY is a Tuesday

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

    it('should still fall back to CUSTOM when startDate is missing', async () => {
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

      expect(component.repeatCfg().quickSetting).toBe('CUSTOM');
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
  });

  describe('startDate min floor (#7768 Bug 4 refined)', () => {
    it('sets minDate to today for a brand-new repeat cfg (no due date)', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;
      component.openScheduleDialog();

      const expectedToday = new Date(MOCK_TODAY);
      expect(mockMatDialog.open).toHaveBeenCalledWith(
        jasmine.any(Function),
        jasmine.objectContaining({
          data: jasmine.objectContaining({
            minDate: expectedToday,
          }),
        }),
      );
    });

    it('sets minDate to task due date when creating new cfg for past task', async () => {
      const pastTask = { ...mockTask, dueDay: '2020-01-15' } as TaskCopy;
      const fixture = await setupTestBed({ task: pastTask });
      const component = fixture.componentInstance;
      component.openScheduleDialog();

      const expectedDate = new Date(2020, 0, 15, 0, 0, 0, 0);
      expect(mockMatDialog.open).toHaveBeenCalledWith(
        jasmine.any(Function),
        jasmine.objectContaining({
          data: jasmine.objectContaining({
            minDate: expectedDate,
          }),
        }),
      );
    });

    it('sets minDate to null when editing an existing past cfg (full flexibility)', async () => {
      const pastCfg: TaskRepeatCfg = {
        ...mockRepeatCfg,
        startDate: '2020-01-15',
      };
      const fixture = await setupTestBed({ repeatCfg: pastCfg });
      const component = fixture.componentInstance;
      component.openScheduleDialog();
      expect(mockMatDialog.open).toHaveBeenCalledWith(
        jasmine.any(Function),
        jasmine.objectContaining({
          data: jasmine.objectContaining({
            minDate: null,
          }),
        }),
      );
    });

    it('sets minDate to null when editing a future cfg (full flexibility)', async () => {
      const futureCfg: TaskRepeatCfg = {
        ...mockRepeatCfg,
        startDate: '2027-01-01',
      };
      const fixture = await setupTestBed({ repeatCfg: futureCfg });
      const component = fixture.componentInstance;
      component.openScheduleDialog();
      expect(mockMatDialog.open).toHaveBeenCalledWith(
        jasmine.any(Function),
        jasmine.objectContaining({
          data: jasmine.objectContaining({
            minDate: null,
          }),
        }),
      );
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

  describe('isWeekdaySelectionInvalid (issue #8025)', () => {
    const baseCfg = {
      ...DEFAULT_TASK_REPEAT_CFG,
      monday: false,
      tuesday: false,
      wednesday: false,
      thursday: false,
      friday: false,
      saturday: false,
      sunday: false,
    };

    it('should be true for a CUSTOM weekly config with no weekday selected', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;

      component.repeatCfg.set({
        ...baseCfg,
        quickSetting: 'CUSTOM',
        repeatCycle: 'WEEKLY',
      });

      expect(component.isWeekdaySelectionInvalid()).toBe(true);
    });

    it('should be false once at least one weekday is selected', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;

      component.repeatCfg.set({
        ...baseCfg,
        quickSetting: 'CUSTOM',
        repeatCycle: 'WEEKLY',
        wednesday: true,
      });

      expect(component.isWeekdaySelectionInvalid()).toBe(false);
    });

    it('should be false for non-weekly cycles even with no weekday selected', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;

      component.repeatCfg.set({
        ...baseCfg,
        quickSetting: 'CUSTOM',
        repeatCycle: 'MONTHLY',
      });

      expect(component.isWeekdaySelectionInvalid()).toBe(false);
    });

    it('should be false for non-CUSTOM quick settings (e.g. DAILY)', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;

      component.repeatCfg.set({
        ...baseCfg,
        quickSetting: 'DAILY',
        repeatCycle: 'WEEKLY',
      });

      expect(component.isWeekdaySelectionInvalid()).toBe(false);
    });

    it('should block direct save when a CUSTOM weekly config has no weekday selected', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;

      component.repeatCfg.set({
        ...baseCfg,
        quickSetting: 'CUSTOM',
        repeatCycle: 'WEEKLY',
      });

      component.save();

      expect(mockTaskRepeatCfgService.addTaskRepeatCfgToTask).not.toHaveBeenCalled();
      expect(mockTaskRepeatCfgService.updateTaskRepeatCfg).not.toHaveBeenCalled();
      expect(mockDialogRef.close).not.toHaveBeenCalled();
    });
  });

  describe('skipOverdue default seeding (#8644)', () => {
    const savedCfg = (): TaskRepeatCfg =>
      mockTaskRepeatCfgService.addTaskRepeatCfgToTask.calls.mostRecent()
        .args[2] as TaskRepeatCfg;

    it('seeds skipOverdue ON for a new Daily config (the default schedule)', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;

      // A new config defaults to the Daily quick setting; no user interaction.
      component.save();

      expect(mockTaskRepeatCfgService.addTaskRepeatCfgToTask).toHaveBeenCalledTimes(1);
      expect(savedCfg().skipOverdue).toBe(true);
    });

    it('seeds skipOverdue OFF when the final schedule is Monthly', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;

      // User switched the preset to monthly without touching the checkbox.
      component.repeatCfg.update((c) => ({ ...c, quickSetting: 'MONTHLY_FIRST_DAY' }));
      component.save();

      expect(savedCfg().skipOverdue).toBe(false);
    });

    it('respects an explicit user toggle over the schedule-derived default', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;

      // User opened Advanced and ticked skipOverdue ON for a monthly task;
      // a dirty control means the derived OFF default must not override it.
      const ctrl = new FormControl(true);
      ctrl.markAsDirty();
      component.formGroup2().addControl('skipOverdue', ctrl);
      component.repeatCfg.update((c) => ({
        ...c,
        quickSetting: 'MONTHLY_FIRST_DAY',
        skipOverdue: true,
      }));

      component.save();

      expect(savedCfg().skipOverdue).toBe(true);
    });
  });
});
