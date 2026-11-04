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
import { ReactiveFormsModule } from '@angular/forms';
// FormlyConfigModule (not FormlyModule) is needed here to register custom
// field types and validation within the TestBed injector.
import { FormlyConfigModule } from '../../../ui/formly-config.module';
import { CustomDateAdapter } from '../../../core/date-time-format/custom-date-adapter';

import { DialogEditTaskRepeatCfgComponent } from './dialog-edit-task-repeat-cfg.component';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { TaskRepeatCfgService } from '../task-repeat-cfg.service';
import { TagService } from '../../tag/tag.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { DEFAULT_TASK_REPEAT_CFG, TaskRepeatCfg } from '../task-repeat-cfg.model';
import { TaskCopy } from '../../tasks/task.model';
import { TranslateService } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { DateService } from '../../../core/date/date.service';
import { AFTER_COMPLETION_PRESET } from './after-completion-form-mapping';
import { TASK_REMINDER_OPTIONS_WITHOUT_LONG_LEAD } from '../../planner/dialog-schedule-task/task-reminder-options.const';

describe('DialogEditTaskRepeatCfgComponent', () => {
  let mockDialogRef: jasmine.SpyObj<MatDialogRef<DialogEditTaskRepeatCfgComponent>>;
  let mockMatDialog: jasmine.SpyObj<MatDialog>;
  let mockTaskRepeatCfgService: jasmine.SpyObj<TaskRepeatCfgService>;
  let mockTagService: jasmine.SpyObj<TagService>;
  let mockGlobalConfigService: jasmine.SpyObj<GlobalConfigService>;
  let mockDateTimeFormatService: jasmine.SpyObj<DateTimeFormatService>;
  let mockDateService: jasmine.SpyObj<DateService>;

  // Mutable locale backing the DateTimeFormatService mock, so a test can
  // simulate the ISO 8601 option (numeric locale = sv sentinel, spelled-out
  // names = UI language). Reset in setupTestBed.
  let mockCurrentLocale = 'en-US';
  let mockTextLocale = 'en-US';

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
      initialStartDate?: string;
      isRemoveConfirmationRequired?: boolean;
    },
    getRepeatCfgReturnValue?:
      | Observable<TaskRepeatCfg | undefined>
      | Subject<TaskRepeatCfg>,
    renderTemplate = false,
    { startOfNextDayDiffMs = 0 }: { startOfNextDayDiffMs?: number } = {},
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
      'deleteTaskRepeatCfg',
      'deleteTaskRepeatCfgWithDialog',
    ]);
    mockDateService = jasmine.createSpyObj('DateService', [
      'todayStr',
      'getLogicalTodayDate',
      'getStartOfNextDayDiffMs',
    ]);
    mockDateService.todayStr.and.returnValue(MOCK_TODAY_STR);
    mockDateService.getStartOfNextDayDiffMs.and.returnValue(startOfNextDayDiffMs);
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
    mockCurrentLocale = 'en-US';
    mockTextLocale = 'en-US';
    mockDateTimeFormatService = jasmine.createSpyObj('DateTimeFormatService', [], {
      currentLocale: () => mockCurrentLocale,
      // Mirrors the real service: spelled-out names follow this locale (equals
      // currentLocale() unless the ISO option remaps it to the UI language).
      textLocale: () => mockTextLocale,
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
    it('copies an existing task priority into a new repeat config', async () => {
      const fixture = await setupTestBed({ task: { ...mockTask, priority: 'high' } });
      expect(fixture.componentInstance.repeatCfg().priority).toBe(3);
    });

    it('does not turn a missing legacy priority into an update on save', async () => {
      const fixture = await setupTestBed({ repeatCfg: mockRepeatCfg });
      fixture.componentInstance.save();
      const changes =
        mockTaskRepeatCfgService.updateTaskRepeatCfg.calls.mostRecent().args[1];
      expect('priority' in changes).toBe(false);
    });

    it('shows None for a legacy config loaded through an existing task without changing its priority', async () => {
      const fixture = await setupTestBed(
        { task: { ...mockTask, repeatCfgId: mockRepeatCfg.id } },
        of(mockRepeatCfg),
        true,
      );
      fixture.detectChanges();
      await fixture.whenStable();
      const optionsHeader = (
        Array.from(
          fixture.nativeElement.querySelectorAll('.collapsible-header'),
        ) as HTMLElement[]
      ).find((header) =>
        header.textContent?.includes(T.F.TASK_REPEAT.D_EDIT.ADVANCED_CFG),
      );
      optionsHeader!.click();
      fixture.detectChanges();
      await fixture.whenStable();

      const loader = TestbedHarnessEnvironment.loader(fixture);
      const prioritySelect = await loader.getHarness(
        MatSelectHarness.with({ selector: '[id*="priority"]' }),
      );
      expect(await prioritySelect.getValueText()).toBe(T.F.TASK.CMP.PRIORITY_NONE);
      await prioritySelect.clickOptions({ text: T.F.TASK.CMP.PRIORITY_NONE });
      fixture.componentInstance.save();

      const changes =
        mockTaskRepeatCfgService.updateTaskRepeatCfg.calls.mostRecent().args[1];
      expect('priority' in changes).toBe(false);
    });

    it('offers to update instances when the series priority is cleared', async () => {
      const fixture = await setupTestBed({
        repeatCfg: { ...mockRepeatCfg, priority: 3 },
      });
      fixture.componentInstance.repeatCfg.update((cfg) => ({ ...cfg, priority: null }));
      fixture.componentInstance.save();
      expect(mockTaskRepeatCfgService.updateTaskRepeatCfg).toHaveBeenCalledWith(
        mockRepeatCfg.id,
        jasmine.objectContaining({ priority: null }),
        true,
      );
    });

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

  describe('deleteInstance', () => {
    it('formats a date-only target date at local midnight in the skip confirmation', async () => {
      const fixture = await setupTestBed({
        repeatCfg: mockRepeatCfg,
        targetDate: '2026-06-10',
      });
      const component = fixture.componentInstance;
      component.canRemoveInstance.set(true);
      const toLocaleDateStringSpy = spyOn(
        Date.prototype,
        'toLocaleDateString',
      ).and.callFake(function (this: Date): string {
        return String(this.getHours());
      });
      spyOn(TestBed.inject(TranslateService), 'instant').and.callFake(
        (_key: string, params?: { date?: string }) => params?.date || '',
      );

      component.deleteInstance();

      expect(toLocaleDateStringSpy).toHaveBeenCalled();
      expect(mockMatDialog.open).toHaveBeenCalledWith(
        jasmine.anything(),
        jasmine.objectContaining({ data: jasmine.objectContaining({ message: '0' }) }),
      );
    });
  });

  describe('new config initialization', () => {
    it('uses the explicit initial start date from the schedule dialog', async () => {
      const taskWithStoredDueDate = {
        ...mockTask,
        dueDay: '2026-06-01',
      } as TaskCopy;
      const fixture = await setupTestBed({
        task: taskWithStoredDueDate,
        initialStartDate: '2026-06-12',
      });

      expect(fixture.componentInstance.repeatCfg().startDate).toBe('2026-06-12');
    });

    it('starts an undated task on the logical today (#3378)', async () => {
      const fixture = await setupTestBed({ task: mockTask });

      expect(fixture.componentInstance.repeatCfg().startDate).toBe(MOCK_TODAY_STR);
    });

    it('starts a late-night timed task on its logical day (#3378)', async () => {
      const hourMs = 60 * 60 * 1000;
      // 02:00 on 06-10 is the late night of logical 06-09 with a 05:00 day start
      const lateNightTask = {
        ...mockTask,
        dueWithTime: new Date(2026, 5, 10, 2, 0).getTime(),
      } as TaskCopy;
      const fixture = await setupTestBed({ task: lateNightTask }, undefined, false, {
        startOfNextDayDiffMs: 5 * hourMs,
      });

      expect(fixture.componentInstance.repeatCfg().startDate).toBe('2026-06-09');
    });

    it('returns the created config ID when saving', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      mockTaskRepeatCfgService.addTaskRepeatCfgToTask.and.callFake(
        () => 'created-repeat-cfg',
      );

      fixture.componentInstance.save();

      expect(mockDialogRef.close).toHaveBeenCalledOnceWith('created-repeat-cfg');
    });

    // a repeat cfg persists the option id, which clients before v19.2.0 cannot
    // convert for the day/week lead times
    it('offers no long lead times in the schedule pick', async () => {
      const fixture = await setupTestBed({ task: mockTask });

      fixture.componentInstance.openScheduleDialog();

      const data = mockMatDialog.open.calls.mostRecent().args[1]?.data as {
        reminderOptions?: unknown;
      };
      expect(data.reminderOptions).toBe(TASK_REMINDER_OPTIONS_WITHOUT_LONG_LEAD);
    });
  });

  describe('remove', () => {
    it('removes without confirmation when the config was created from the schedule dialog', fakeAsync(async () => {
      const taskWithRepeatCfg = {
        ...mockTask,
        repeatCfgId: 'repeat-cfg-123',
      } as TaskCopy;
      const fixture = await setupTestBed(
        {
          task: taskWithRepeatCfg,
          isRemoveConfirmationRequired: false,
        },
        of(mockRepeatCfg),
      );
      fixture.detectChanges();
      tick();

      fixture.componentInstance.remove();

      expect(mockTaskRepeatCfgService.deleteTaskRepeatCfg).toHaveBeenCalledOnceWith(
        'repeat-cfg-123',
      );
      expect(
        mockTaskRepeatCfgService.deleteTaskRepeatCfgWithDialog,
      ).not.toHaveBeenCalled();
    }));

    it('keeps confirmation for a pre-existing repeat config', fakeAsync(async () => {
      const taskWithRepeatCfg = {
        ...mockTask,
        repeatCfgId: 'repeat-cfg-123',
      } as TaskCopy;
      const fixture = await setupTestBed({ task: taskWithRepeatCfg }, of(mockRepeatCfg));
      fixture.detectChanges();
      tick();

      fixture.componentInstance.remove();

      expect(
        mockTaskRepeatCfgService.deleteTaskRepeatCfgWithDialog,
      ).toHaveBeenCalledOnceWith('repeat-cfg-123');
      expect(mockTaskRepeatCfgService.deleteTaskRepeatCfg).not.toHaveBeenCalled();
    }));
  });

  describe('plannedStartDateStr localization (#8987 follow-up)', () => {
    it('renders the start-date value in the UI language under the ISO option, not sv', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      // ISO 8601 option: numeric locale is the sv sentinel, but spelled-out
      // names must follow the UI language ('en').
      mockCurrentLocale = 'sv';
      mockTextLocale = 'en';

      fixture.componentInstance.repeatCfg.set({
        ...DEFAULT_TASK_REPEAT_CFG,
        startDate: '2026-07-15',
      });

      const label = fixture.componentInstance.plannedStartDateStr();
      // English spelled-out names ("Wed, Jul 15, 2026"), not Swedish
      // ("ons 15 juli 2026").
      expect(label).toContain('Jul');
      expect(label).not.toContain('juli');
      expect(label).not.toContain('ons');
    });

    it('keeps the configured locale for spelled-out names when not the ISO option', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      // de-DE renders its own spelled-out names; textLocale equals currentLocale.
      mockCurrentLocale = 'de-DE';
      mockTextLocale = 'de-DE';

      fixture.componentInstance.repeatCfg.set({
        ...DEFAULT_TASK_REPEAT_CFG,
        startDate: '2026-07-15',
      });

      expect(fixture.componentInstance.plannedStartDateStr()).toContain('Juli');
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

    it('converts a cleared repeatUntilDay (null) to undefined (#10091)', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const normalized = (fixture.componentInstance as any)._normalizeMonthlyAnchor({
        quickSetting: 'DAILY',
        repeatUntilDay: null,
      });
      expect('repeatUntilDay' in normalized).toBe(true);
      expect(normalized.repeatUntilDay).toBeUndefined();
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
      const formValid = component.areFormsValid();
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

    it('respects an explicit "If you fall behind" choice over the derived default', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;

      component.onModelChange({
        ...component.repeatCfg(),
        quickSetting: 'MONTHLY_FIRST_DAY',
      });
      component.onModelChange({ ...component.repeatCfg(), fallBehind: 'LATEST' }, true);
      component.save();

      expect(savedCfg().skipOverdue).toBe(true);
    });
  });

  // save() re-derives the quick setting from the stored start date, so a preset
  // that ignored that date rewrote it on every save — and a startDate in the
  // change set reschedules the live instance (#7373).
  describe('monthly anchors survive an unrelated save', () => {
    const changes = (): Partial<TaskRepeatCfg> =>
      mockTaskRepeatCfgService.updateTaskRepeatCfg.calls.mostRecent()
        .args[1] as Partial<TaskRepeatCfg>;

    it('keeps a future MONTHLY_LAST_DAY start date where the user put it', async () => {
      const fixture = await setupTestBed({
        repeatCfg: {
          ...DEFAULT_TASK_REPEAT_CFG,
          id: 'repeat-cfg-last-day',
          title: 'Pay rent',
          quickSetting: 'MONTHLY_LAST_DAY',
          repeatCycle: 'MONTHLY',
          monthlyLastDay: true,
          startDate: '2099-09-30',
        },
      });

      fixture.componentInstance.save();

      expect(mockTaskRepeatCfgService.updateTaskRepeatCfg).toHaveBeenCalledTimes(1);
      // `rescheduleTaskOnRepeatCfgUpdate$` filters on `field in changes`, so key
      // absence is the assertion that matches the effect.
      expect('startDate' in changes()).toBe(false);
    });

    it('keeps a future MONTHLY_FIRST_DAY start date where the user put it', async () => {
      const fixture = await setupTestBed({
        repeatCfg: {
          ...DEFAULT_TASK_REPEAT_CFG,
          id: 'repeat-cfg-first-day',
          title: 'Pay rent',
          quickSetting: 'MONTHLY_FIRST_DAY',
          repeatCycle: 'MONTHLY',
          startDate: '2099-10-01',
        },
      });

      fixture.componentInstance.save();

      expect('startDate' in changes()).toBe(false);
    });
  });

  describe('next occurrence and inherited subtasks (issue #10233)', () => {
    const dailyCfg: TaskRepeatCfg = {
      ...mockRepeatCfg,
      quickSetting: 'CUSTOM',
      repeatCycle: 'DAILY',
      repeatEvery: 1,
      startDate: '2026-06-01',
      lastTaskCreationDay: '2026-06-09',
    };
    const formatDay = (day: number, month = 5, year = 2026): string =>
      new Date(year, month, day).toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    const expectedDate = formatDay(10);

    let instantCalls: { key: string | string[]; params?: object }[];

    const setup = async (
      dialogData: Parameters<typeof setupTestBed>[0],
    ): Promise<DialogEditTaskRepeatCfgComponent> => {
      const fixture = await setupTestBed(dialogData);
      instantCalls = [];
      spyOn(TestBed.inject(TranslateService), 'instant').and.callFake(
        (key: string | string[], params?: object) => {
          instantCalls.push({ key, params });
          return key;
        },
      );
      return fixture.componentInstance;
    };

    beforeEach(() => {
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(2026, 5, 9, 10, 0, 0));
    });

    afterEach(() => {
      jasmine.clock().uninstall();
    });

    it('shows the next occurrence of the saved config', async () => {
      const component = await setup({ repeatCfg: dailyCfg });

      expect(component.nextOccurrenceText()).toBe(T.F.TASK_REPEAT.D_EDIT.NEXT_OCCURRENCE);
      expect(instantCalls.at(-1)!.params).toEqual({ date: expectedDate });
    });

    it('qualifies the date for wait-for-completion configs', async () => {
      const component = await setup({
        repeatCfg: { ...dailyCfg, waitForCompletion: true },
      });

      expect(component.nextOccurrenceText()).toBe(
        T.F.TASK_REPEAT.D_EDIT.NEXT_OCCURRENCE_WAIT_FOR_COMPLETION,
      );
    });

    it('passes over a skipped instance', async () => {
      const component = await setup({
        repeatCfg: { ...dailyCfg, deletedInstanceDates: ['2026-06-10'] },
      });

      expect(component.nextOccurrenceText()).toBe(T.F.TASK_REPEAT.D_EDIT.NEXT_OCCURRENCE);
      expect(instantCalls.at(-1)!.params).toEqual({ date: formatDay(11) });
    });

    it('passes over consecutive skipped instances', async () => {
      const component = await setup({
        repeatCfg: { ...dailyCfg, deletedInstanceDates: ['2026-06-10', '2026-06-11'] },
      });

      expect(component.nextOccurrenceText()).toBe(T.F.TASK_REPEAT.D_EDIT.NEXT_OCCURRENCE);
      expect(instantCalls.at(-1)!.params).toEqual({ date: formatDay(12) });
    });

    it('passes over a skipped monthly instance', async () => {
      const component = await setup({
        repeatCfg: {
          ...dailyCfg,
          repeatCycle: 'MONTHLY',
          startDate: '2026-05-10',
          lastTaskCreationDay: '2026-05-10',
          deletedInstanceDates: ['2026-06-10'],
        },
      });

      expect(component.nextOccurrenceText()).toBe(T.F.TASK_REPEAT.D_EDIT.NEXT_OCCURRENCE);
      expect(instantCalls.at(-1)!.params).toEqual({
        date: formatDay(10, 6),
      });
    });

    it('passes over consecutive skipped monthly instances', async () => {
      const component = await setup({
        repeatCfg: {
          ...dailyCfg,
          repeatCycle: 'MONTHLY',
          startDate: '2026-05-10',
          lastTaskCreationDay: '2026-05-10',
          deletedInstanceDates: ['2026-06-10', '2026-07-10'],
        },
      });

      expect(component.nextOccurrenceText()).toBe(T.F.TASK_REPEAT.D_EDIT.NEXT_OCCURRENCE);
      expect(instantCalls.at(-1)!.params).toEqual({
        date: formatDay(10, 7),
      });
    });

    it('keeps the completion-date anchor when passing over a skipped month', async () => {
      // Skipping does not move lastTaskCreationDay, so the May 31 anchor holds
      // and the month after a skipped June 30 is July 31, not July 30.
      const component = await setup({
        repeatCfg: {
          ...dailyCfg,
          repeatCycle: 'MONTHLY',
          repeatFromCompletionDate: true,
          startDate: '2026-01-15',
          lastTaskCreationDay: '2026-05-31',
          deletedInstanceDates: ['2026-06-30'],
        },
      });

      component.nextOccurrenceText();
      expect(instantCalls.at(-1)!.params).toEqual({
        date: formatDay(31, 6),
      });
    });

    it('passes over a skipped yearly instance', async () => {
      const component = await setup({
        repeatCfg: {
          ...dailyCfg,
          repeatCycle: 'YEARLY',
          startDate: '2025-06-10',
          lastTaskCreationDay: '2025-06-10',
          deletedInstanceDates: ['2026-06-10'],
        },
      });

      expect(component.nextOccurrenceText()).toBe(T.F.TASK_REPEAT.D_EDIT.NEXT_OCCURRENCE);
      expect(instantCalls.at(-1)!.params).toEqual({
        date: formatDay(10, 5, 2027),
      });
    });

    it('shows no date while a due instance waits for the current one to be done', async () => {
      // The June 8 instance is unfinished, so June 9 is held back and is created
      // as soon as June 8 is completed.
      const component = await setup({
        repeatCfg: {
          ...dailyCfg,
          waitForCompletion: true,
          lastTaskCreationDay: '2026-06-08',
        },
      });

      expect(component.nextOccurrenceText()).toBe(
        T.F.TASK_REPEAT.D_EDIT.NEXT_OCCURRENCE_AFTER_COMPLETION,
      );
    });

    it('qualifies the date for configs repeating from the completion date', async () => {
      const component = await setup({
        repeatCfg: { ...dailyCfg, repeatFromCompletionDate: true },
      });

      expect(component.nextOccurrenceText()).toBe(
        T.F.TASK_REPEAT.D_EDIT.NEXT_OCCURRENCE_FROM_COMPLETION,
      );
    });

    // After completion always waits (#5388), but completing the open copy only
    // re-anchors the schedule; no held-back copy is added at that moment.
    it('keeps the completion wording for an after-completion config, also when one is due', async () => {
      const component = await setup({
        repeatCfg: {
          ...dailyCfg,
          repeatFromCompletionDate: true,
          waitForCompletion: true,
          lastTaskCreationDay: '2026-06-08',
        },
      });

      expect(component.nextOccurrenceText()).toBe(
        T.F.TASK_REPEAT.D_EDIT.NEXT_OCCURRENCE_FROM_COMPLETION,
      );
    });

    it('withholds the date while schedule changes are unsaved', async () => {
      const component = await setup({ repeatCfg: dailyCfg });

      component.repeatCfg.update((cfg) => ({ ...cfg, repeatEvery: 3 }));

      expect(component.nextOccurrenceText()).toBe(
        T.F.TASK_REPEAT.D_EDIT.NEXT_OCCURRENCE_UNSAVED,
      );
    });

    it('treats a changed quick setting as an unsaved schedule change', async () => {
      const component = await setup({ repeatCfg: dailyCfg });

      component.repeatCfg.update((cfg) => ({ ...cfg, quickSetting: 'MONDAY_TO_FRIDAY' }));

      expect(component.hasUnsavedScheduleChanges()).toBe(true);
    });

    // repeatUntilDay is not schedule-affecting for the reschedule effect, but an
    // unsaved end date can still leave no next occurrence.
    it('treats a changed end date as an unsaved schedule change', async () => {
      const component = await setup({ repeatCfg: dailyCfg });

      component.repeatCfg.update((cfg) => ({ ...cfg, repeatUntilDay: '2099-12-31' }));

      expect(component.hasUnsavedScheduleChanges()).toBe(true);
    });

    it('keeps the date when only non-schedule fields change', async () => {
      const component = await setup({ repeatCfg: dailyCfg });

      component.repeatCfg.update((cfg) => ({ ...cfg, title: 'Renamed' }));

      expect(component.nextOccurrenceText()).toBe(T.F.TASK_REPEAT.D_EDIT.NEXT_OCCURRENCE);
    });

    it('shows nothing for a paused config', async () => {
      const component = await setup({ repeatCfg: { ...dailyCfg, isPaused: true } });

      expect(component.nextOccurrenceText()).toBeNull();
    });

    it('shows nothing when creating a new config', async () => {
      const component = await setup({ task: mockTask });

      expect(component.nextOccurrenceText()).toBeNull();
    });

    it('lists the subtasks new instances inherit', async () => {
      const component = await setup({
        repeatCfg: {
          ...dailyCfg,
          shouldInheritSubtasks: true,
          subTaskTemplates: [{ title: 'Pack bag' }, { title: 'Water plants' }],
        },
      });

      expect(component.inheritedSubtaskTitles()).toEqual(['Pack bag', 'Water plants']);

      component.repeatCfg.update((cfg) => ({ ...cfg, shouldInheritSubtasks: false }));

      expect(component.inheritedSubtaskTitles()).toEqual([]);
    });

    it('lists no subtasks while inheritance is newly enabled', async () => {
      // Saving replaces the templates with the newest instance's subtasks.
      const component = await setup({
        repeatCfg: {
          ...dailyCfg,
          shouldInheritSubtasks: false,
          subTaskTemplates: [{ title: 'Stale template' }],
        },
      });

      component.repeatCfg.update((cfg) => ({ ...cfg, shouldInheritSubtasks: true }));

      expect(component.inheritedSubtaskTitles()).toEqual([]);
    });
  });
  describe('after completion (#5388)', () => {
    const savedCfg = (): TaskRepeatCfg =>
      mockTaskRepeatCfgService.addTaskRepeatCfgToTask.calls.mostRecent()
        .args[2] as TaskRepeatCfg;
    const updateChanges = (): Partial<TaskRepeatCfg> =>
      mockTaskRepeatCfgService.updateTaskRepeatCfg.calls.mostRecent()
        .args[1] as Partial<TaskRepeatCfg>;

    it('offers "After I complete it…" just above Custom', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const quickSetting = fixture.componentInstance
        .essentialFormFields()
        .find((f) => f.key === 'quickSetting');
      const values = (quickSetting?.templateOptions?.options as { value: string }[]).map(
        (o) => o.value,
      );
      expect(values.slice(-2)).toEqual([AFTER_COMPLETION_PRESET, 'CUSTOM']);
    });

    it('saves "every 2 weeks after I complete it" as 14 days, waiting, as CUSTOM', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;

      component.onModelChange({
        ...component.repeatCfg(),
        quickSetting: AFTER_COMPLETION_PRESET,
      });
      component.onModelChange({
        ...component.repeatCfg(),
        repeatCycle: 'WEEKLY',
        repeatEvery: 2,
        monday: false,
        tuesday: false,
        wednesday: false,
        thursday: false,
        friday: false,
      });

      // no weekday is needed after completion
      expect(component.isWeekdaySelectionInvalid()).toBe(false);
      component.save();

      expect(savedCfg().quickSetting).toBe('CUSTOM');
      expect(savedCfg().repeatFromCompletionDate).toBe(true);
      expect(savedCfg().waitForCompletion).toBe(true);
      expect(savedCfg().repeatCycle).toBe('DAILY');
      expect(savedCfg().repeatEvery).toBe(14);
    });

    it('opens a stored 14-day after-completion config as 2 weeks and saves no changes', async () => {
      const afterCfg: TaskRepeatCfg = {
        ...mockRepeatCfg,
        quickSetting: 'CUSTOM',
        repeatFromCompletionDate: true,
        waitForCompletion: true,
        repeatCycle: 'DAILY',
        repeatEvery: 14,
      };
      const fixture = await setupTestBed({ repeatCfg: afterCfg });
      const component = fixture.componentInstance;

      expect(component.repeatCfg().quickSetting).toBe(AFTER_COMPLETION_PRESET);
      expect(component.repeatCfg().repeatCycle).toBe('WEEKLY');
      expect(component.repeatCfg().repeatEvery).toBe(2);
      expect(component.hasUnsavedScheduleChanges()).toBe(false);

      component.save();

      expect(updateChanges()).toEqual({});
    });

    const legacyCfg: TaskRepeatCfg = {
      ...mockRepeatCfg,
      quickSetting: 'CUSTOM',
      repeatFromCompletionDate: true,
      waitForCompletion: false,
      repeatCycle: 'WEEKLY',
      repeatEvery: 2,
    };

    it('keeps a legacy weekday-based schedule on an unrelated save, so the open copy stays put', async () => {
      const fixture = await setupTestBed({ repeatCfg: legacyCfg });
      const component = fixture.componentInstance;

      component.onModelChange({ ...component.repeatCfg(), title: 'Renamed' });
      component.save();

      // Schedule fields would make the reschedule effect relocate the open copy.
      expect(updateChanges()).toEqual({ title: 'Renamed', waitForCompletion: true });
    });

    it('converts a legacy weekday-based schedule once the user edits it', async () => {
      const fixture = await setupTestBed({ repeatCfg: legacyCfg });
      const component = fixture.componentInstance;

      component.onModelChange({ ...component.repeatCfg(), repeatEvery: 3 });
      component.save();

      expect(updateChanges()).toEqual({
        repeatCycle: 'DAILY',
        repeatEvery: 21,
        waitForCompletion: true,
      });
    });

    it('restores the stored waiting behaviour when switching back to a fixed schedule', async () => {
      const fixedWaitingCfg: TaskRepeatCfg = {
        ...mockRepeatCfg,
        quickSetting: 'CUSTOM',
        waitForCompletion: true,
      };
      const fixture = await setupTestBed({ repeatCfg: fixedWaitingCfg });
      const component = fixture.componentInstance;

      component.onModelChange({
        ...component.repeatCfg(),
        quickSetting: AFTER_COMPLETION_PRESET,
      });
      component.onModelChange({ ...component.repeatCfg(), quickSetting: 'CUSTOM' });

      expect(component.repeatCfg().repeatFromCompletionDate).toBe(false);
      expect(component.repeatCfg().waitForCompletion).toBe(true);
      component.save();
      expect(updateChanges()).toEqual({});
    });

    it('keeps a picked "Wait" when switching to after completion and back', async () => {
      const fixture = await setupTestBed({
        repeatCfg: { ...mockRepeatCfg, quickSetting: 'CUSTOM' },
      });
      const component = fixture.componentInstance;

      component.onModelChange({ ...component.repeatCfg(), fallBehind: 'WAIT' }, true);
      component.onModelChange({
        ...component.repeatCfg(),
        quickSetting: AFTER_COMPLETION_PRESET,
      });
      component.onModelChange({ ...component.repeatCfg(), quickSetting: 'CUSTOM' });

      expect(component.repeatCfg().fallBehind).toBe('WAIT');
      component.save();
      expect(updateChanges()).toEqual({ waitForCompletion: true });
    });

    it('keeps a legacy fixed preset with the after-completion flag on an unrelated save', async () => {
      const fixture = await setupTestBed({
        repeatCfg: {
          ...mockRepeatCfg,
          quickSetting: 'MONTHLY_LAST_DAY',
          repeatFromCompletionDate: true,
          waitForCompletion: true,
          repeatCycle: 'MONTHLY',
          monthlyLastDay: true,
        },
      });
      const component = fixture.componentInstance;

      expect(component.repeatCfg().quickSetting).toBe(AFTER_COMPLETION_PRESET);
      expect(component.hasUnsavedScheduleChanges()).toBe(false);
      component.onModelChange({ ...component.repeatCfg(), title: 'Renamed' });
      component.save();

      // monthlyLastDay is schedule-affecting: stripping it would move the open copy.
      expect(updateChanges()).toEqual({ title: 'Renamed' });
    });
  });
  describe('title field', () => {
    const titleField = (fixture: {
      componentInstance: DialogEditTaskRepeatCfgComponent;
    }): FormlyFieldConfig | undefined =>
      fixture.componentInstance.essentialFormFields().find((f) => f.key === 'title');

    it('is hidden when making a task recurring, which keeps the task title', async () => {
      const fixture = await setupTestBed({ task: mockTask });

      expect(titleField(fixture)?.hide).toBe(true);
      expect(fixture.componentInstance.repeatCfg().title).toBe(mockTask.title);
    });

    it('is shown when editing a series, to rename its future copies', async () => {
      const fixture = await setupTestBed({ repeatCfg: mockRepeatCfg });

      expect(titleField(fixture)?.hide).toBeFalsy();
    });
  });

  describe('"If you fall behind" (#5388 follow-up)', () => {
    const savedCfg = (): TaskRepeatCfg =>
      mockTaskRepeatCfgService.addTaskRepeatCfgToTask.calls.mostRecent()
        .args[2] as TaskRepeatCfg;
    const updateChanges = (): Partial<TaskRepeatCfg> =>
      mockTaskRepeatCfgService.updateTaskRepeatCfg.calls.mostRecent()
        .args[1] as Partial<TaskRepeatCfg>;

    it('shows the schedule default for a new config and re-seeds it while untouched', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;

      expect(component.repeatCfg().fallBehind).toBe('LATEST');
      component.onModelChange({
        ...component.repeatCfg(),
        quickSetting: 'MONTHLY_FIRST_DAY',
      });
      expect(component.repeatCfg().fallBehind).toBe('KEEP');
      component.onModelChange({ ...component.repeatCfg(), quickSetting: 'DAILY' });
      expect(component.repeatCfg().fallBehind).toBe('LATEST');
    });

    it('keeps a picked choice when the schedule changes afterwards', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;

      component.onModelChange({ ...component.repeatCfg(), fallBehind: 'KEEP' }, true);
      component.onModelChange({ ...component.repeatCfg(), quickSetting: 'CUSTOM' });
      component.onModelChange({
        ...component.repeatCfg(),
        repeatCycle: 'DAILY',
        repeatEvery: 1,
      });
      component.save();

      expect(savedCfg().skipOverdue).toBe(false);
      expect(savedCfg().waitForCompletion).toBe(false);
    });

    // Formly can emit a second, older copy of its model, e.g. when a field
    // hides after a change. It must not count as picking "If you fall behind".
    it('ignores a stale fall-behind value from another form', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;
      const stale = {
        ...component.repeatCfg(),
        quickSetting: 'MONTHLY_FIRST_DAY' as const,
      };
      component.onModelChange(stale);
      expect(component.repeatCfg().fallBehind).toBe('KEEP');
      component.onModelChange({ ...component.repeatCfg(), quickSetting: 'DAILY' });
      expect(component.repeatCfg().fallBehind).toBe('LATEST');

      component.onModelChange({ ...stale, quickSetting: 'DAILY' });

      expect(component.repeatCfg().fallBehind).toBe('LATEST');
      expect(component.repeatCfg().skipOverdue).toBe(true);
    });

    it('writes "Wait" without skipping, so nothing silently disappears', async () => {
      const fixture = await setupTestBed({
        repeatCfg: { ...mockRepeatCfg, repeatCycle: 'DAILY', skipOverdue: true },
      });
      const component = fixture.componentInstance;

      component.onModelChange({ ...component.repeatCfg(), fallBehind: 'WAIT' }, true);
      component.save();

      expect(updateChanges()).toEqual({ waitForCompletion: true, skipOverdue: false });
    });

    it('shows a legacy config with both flags as "Wait" and keeps both until changed', async () => {
      const fixture = await setupTestBed({
        repeatCfg: {
          ...mockRepeatCfg,
          repeatCycle: 'DAILY',
          waitForCompletion: true,
          skipOverdue: true,
        },
      });
      const component = fixture.componentInstance;

      expect(component.repeatCfg().fallBehind).toBe('WAIT');
      component.onModelChange({ ...component.repeatCfg(), title: 'Renamed' });
      component.save();

      expect(updateChanges()).toEqual({ title: 'Renamed' });
    });

    it('never stores the dialog-only choice', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      fixture.componentInstance.save();
      expect('fallBehind' in savedCfg()).toBe(false);
    });

    it('describes the picked choice', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const field = fixture.componentInstance
        .behaviourFormFields()
        .find((f) => f.key === 'fallBehind');
      const describe = field?.expressionProperties?.['templateOptions.description'] as (
        model: object,
      ) => string;
      expect(describe({ fallBehind: 'WAIT' })).toBe(
        T.F.TASK_REPEAT.F.FALL_BEHIND_WAIT_HINT,
      );
      expect(describe({ fallBehind: 'KEEP' })).toBe(
        T.F.TASK_REPEAT.F.FALL_BEHIND_KEEP_HINT,
      );
    });
  });
  describe('pause (#3589)', () => {
    const updateChanges = (): Partial<TaskRepeatCfg> =>
      mockTaskRepeatCfgService.updateTaskRepeatCfg.calls.mostRecent()
        .args[1] as Partial<TaskRepeatCfg>;

    it('resumes in one update that also skips the dates missed while paused', async () => {
      const fixture = await setupTestBed({
        repeatCfg: {
          ...mockRepeatCfg,
          repeatCycle: 'DAILY',
          isPaused: true,
          lastTaskCreationDay: '2026-06-01',
        },
      });
      const component = fixture.componentInstance;

      component.onModelChange({ ...component.repeatCfg(), isPaused: false });
      component.save();

      expect(mockTaskRepeatCfgService.updateTaskRepeatCfg).toHaveBeenCalledTimes(1);
      expect(updateChanges()).toEqual(
        jasmine.objectContaining({
          isPaused: false,
          // MOCK_TODAY is 2026-06-09
          lastTaskCreationDay: '2026-06-08',
        }),
      );
    });

    it('pauses without touching the creation cursor', async () => {
      const fixture = await setupTestBed({
        repeatCfg: { ...mockRepeatCfg, repeatCycle: 'DAILY' },
      });
      const component = fixture.componentInstance;

      component.onModelChange({ ...component.repeatCfg(), isPaused: true });
      component.save();

      expect(updateChanges()).toEqual({ isPaused: true });
    });
  });
  describe('rule summary', () => {
    const NO_WEEKDAYS = {
      monday: false,
      tuesday: false,
      wednesday: false,
      thursday: false,
      friday: false,
      saturday: false,
      sunday: false,
    };
    const spyTranslate = (): void => {
      spyOn(TestBed.inject(TranslateService), 'instant').and.callFake(
        (key: string | string[], params?: object) =>
          params ? `${key}|${JSON.stringify(params)}` : key,
      );
    };

    it('is hidden when the preset label already says it all', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      expect(fixture.componentInstance.ruleSummary()).toBeNull();
    });

    it('states a custom rule and the dates it falls on', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      spyTranslate();
      const component = fixture.componentInstance;

      component.onModelChange({
        ...component.repeatCfg(),
        quickSetting: 'CUSTOM',
        repeatCycle: 'WEEKLY',
        repeatEvery: 2,
        ...NO_WEEKDAYS,
        monday: true,
        wednesday: true,
      });

      const summary = component.ruleSummary();
      expect(summary?.rule).toContain(T.F.TASK_REPEAT.ADD_INFO_PANEL.EVERY_X_WEEKLY);
      // MOCK_TODAY Tue 2026-06-09 starts the 2-week blocks
      expect(summary?.fallsOn).toContain(T.F.TASK_REPEAT.D_EDIT.RULE_FALLS_ON);
      expect(summary?.fallsOn).toContain('Jun 10');
      expect(summary?.fallsOn).toContain('Jun 15');
      expect(summary?.fallsOn).toContain('Jun 24');
      // The fields above already say the rule; only the dates are shown.
      expect(summary?.line).toBe(summary?.fallsOn as string);
    });

    it('describes after completion without dates', async () => {
      const fixture = await setupTestBed({ task: mockTask });
      const component = fixture.componentInstance;

      component.onModelChange({
        ...component.repeatCfg(),
        quickSetting: AFTER_COMPLETION_PRESET,
      });
      component.onModelChange({
        ...component.repeatCfg(),
        repeatCycle: 'WEEKLY',
        repeatEvery: 2,
      });

      expect(component.ruleSummary()).toEqual({
        rule: T.F.TASK_REPEAT.ADD_INFO_PANEL.AFTER_COMPLETION_X_WEEKS,
        fallsOn: null,
        line: null,
      });
    });

    it('says when the series is paused and keeps the rule', async () => {
      const fixture = await setupTestBed({
        repeatCfg: { ...mockRepeatCfg, repeatCycle: 'DAILY', isPaused: true },
      });
      spyTranslate();
      const summary = fixture.componentInstance.ruleSummary();
      expect(summary?.line).toContain(T.F.TASK_REPEAT.D_EDIT.RULE_WITH_POLICY);
      expect(summary?.line).toContain(T.F.TASK_REPEAT.D_EDIT.RULE_PAUSED);
      expect(summary?.line).toContain(T.F.TASK_REPEAT.ADD_INFO_PANEL.DAILY);
      expect(summary?.fallsOn).toBeNull();
    });

    it('starts the dates of an existing series after today', async () => {
      const fixture = await setupTestBed({
        repeatCfg: {
          ...mockRepeatCfg,
          quickSetting: 'CUSTOM',
          repeatCycle: 'DAILY',
          repeatEvery: 2,
          startDate: '2026-06-09',
        },
      });
      spyTranslate();
      // MOCK_TODAY is Tue 2026-06-09, which already has its copy
      const fallsOn = fixture.componentInstance.ruleSummary()?.fallsOn;
      expect(fallsOn).not.toContain('Jun 9');
      expect(fallsOn).toContain('Jun 11');
    });

    it('mentions a fall-behind choice that differs from the default', async () => {
      const fixture = await setupTestBed({
        repeatCfg: {
          ...mockRepeatCfg,
          quickSetting: 'WEEKLY_CURRENT_WEEKDAY',
          repeatCycle: 'WEEKLY',
          ...NO_WEEKDAYS,
          friday: true,
          skipOverdue: true,
        },
      });
      spyTranslate();

      const summary = fixture.componentInstance.ruleSummary();
      // After the dates, which the line shows instead of the rule.
      expect(summary?.line).toContain(T.F.TASK_REPEAT.D_EDIT.RULE_WITH_POLICY);
      expect(summary?.line).toContain(T.F.TASK_REPEAT.D_EDIT.RULE_FALLS_ON);
      expect(summary?.line).toContain(T.F.TASK_REPEAT.D_EDIT.RULE_ONLY_LATEST);
    });

    it('shows the rule with a non-default policy when there are no dates', async () => {
      const fixture = await setupTestBed({
        repeatCfg: {
          ...mockRepeatCfg,
          quickSetting: 'DAILY',
          repeatCycle: 'DAILY',
          repeatEvery: 1,
          skipOverdue: false,
        },
      });
      spyTranslate();

      const summary = fixture.componentInstance.ruleSummary();
      expect(summary?.fallsOn).toBeNull();
      expect(summary?.line).toContain(T.F.TASK_REPEAT.ADD_INFO_PANEL.DAILY);
      expect(summary?.line).toContain(T.F.TASK_REPEAT.D_EDIT.RULE_KEEPS_EVERY_COPY);
    });

    it('shows the year once a "Falls on" date leaves this year', async () => {
      const fixture = await setupTestBed({
        repeatCfg: {
          ...mockRepeatCfg,
          quickSetting: 'CUSTOM',
          repeatCycle: 'YEARLY',
          repeatEvery: 2,
          startDate: '2026-06-10',
        },
      });
      spyTranslate();

      const fallsOn = fixture.componentInstance.ruleSummary()?.fallsOn;
      expect(fallsOn).toContain('2028');
      expect(fallsOn).toContain('2030');
    });

    it('shows no summary for an interval the form rejects', async () => {
      const fixture = await setupTestBed({
        repeatCfg: {
          ...mockRepeatCfg,
          quickSetting: 'CUSTOM',
          repeatCycle: 'DAILY',
          repeatEvery: 0,
        },
      });

      expect(fixture.componentInstance.ruleSummary()).toBeNull();
    });
  });
});
