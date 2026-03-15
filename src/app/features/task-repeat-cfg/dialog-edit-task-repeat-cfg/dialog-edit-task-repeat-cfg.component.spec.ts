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
import { TagService } from '../../tag/tag.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { DEFAULT_TASK_REPEAT_CFG, TaskRepeatCfg } from '../task-repeat-cfg.model';
import { TaskCopy } from '../../tasks/task.model';
import { TranslateService } from '@ngx-translate/core';
import { T } from '../../../t.const';

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
  ): Promise<ComponentFixture<DialogEditTaskRepeatCfgComponent>> => {
    mockDialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
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
      cfg: () => ({ reminder: { defaultTaskRemindOption: null } }),
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
        { provide: TagService, useValue: mockTagService },
        { provide: GlobalConfigService, useValue: mockGlobalConfigService },
        { provide: DateTimeFormatService, useValue: mockDateTimeFormatService },
        { provide: DateAdapter, useClass: CustomDateAdapter },
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

    it('should use dueWithTime when task has no dueDay', async () => {
      // May 1st 2026 at noon local time
      const may1Noon = new Date(2026, 4, 1, 12, 0, 0).getTime();
      const taskWithDueWithTime = {
        ...mockTask,
        dueDay: undefined,
        dueWithTime: may1Noon,
      } as unknown as TaskCopy;

      const fixture = await setupTestBed({ task: taskWithDueWithTime });
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

      const dueDate = new Date(may1Noon);
      const expectedDayStr = dueDate.toLocaleDateString('en-US', { day: 'numeric' });

      expect(monthlyCall).toBeDefined();
      expect(monthlyCall!.params.dateDayStr).toBe(expectedDayStr);
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

      const today = new Date();
      const todayDayStr = today.toLocaleDateString('en-US', { day: 'numeric' });

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
});
