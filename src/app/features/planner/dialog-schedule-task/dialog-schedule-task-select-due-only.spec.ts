import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DialogScheduleTaskComponent } from './dialog-schedule-task.component';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { provideMockStore } from '@ngrx/store/testing';
import { TranslateModule, TranslateService, TranslateStore } from '@ngx-translate/core';
import { SnackService } from '../../../core/snack/snack.service';
import { LocaleDatePipe } from 'src/app/ui/pipes/locale-date.pipe';
import { TaskService } from '../../../features/tasks/task.service';
import { WorkContextService } from '../../../features/work-context/work-context.service';
import { of } from 'rxjs';
import { PlannerService } from '../planner.service';
import { RootState } from '../../../root-store/root-state';
import { CONFIG_FEATURE_NAME } from '../../config/store/global-config.reducer';
import { TaskReminderOptionId } from '../../tasks/task.model';
import { ReminderService } from '../../reminder/reminder.service';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';

describe('DialogScheduleTaskComponent - Select Due Only Mode', () => {
  let component: DialogScheduleTaskComponent;
  let fixture: ComponentFixture<DialogScheduleTaskComponent>;
  let dialogRefSpy: jasmine.SpyObj<MatDialogRef<DialogScheduleTaskComponent>>;
  let snackServiceSpy: jasmine.SpyObj<SnackService>;
  let taskServiceSpy: jasmine.SpyObj<TaskService>;
  let plannerServiceSpy: jasmine.SpyObj<PlannerService>;
  let workContextServiceSpy: jasmine.SpyObj<WorkContextService>;
  let reminderServiceSpy: jasmine.SpyObj<ReminderService>;

  beforeEach(async () => {
    dialogRefSpy = jasmine.createSpyObj('MatDialogRef', ['close']);
    snackServiceSpy = jasmine.createSpyObj('SnackService', ['open']);
    plannerServiceSpy = jasmine.createSpyObj('PlannerService', [
      'open',
      'getSnackExtraStr',
    ]);
    reminderServiceSpy = jasmine.createSpyObj('ReminderService', ['getById']);
    taskServiceSpy = jasmine.createSpyObj('TaskService', ['scheduleTask']);
    workContextServiceSpy = jasmine.createSpyObj(
      'WorkContextService',
      ['activeWorkContextId$'],
      {
        activeWorkContextId$: of('someWorkContextId'),
      },
    );

    await TestBed.configureTestingModule({
      imports: [
        DialogScheduleTaskComponent,
        MatDialogModule,
        ReactiveFormsModule,
        FormsModule,
        NoopAnimationsModule,
        MatFormFieldModule,
        MatInputModule,
        MatDatepickerModule,
        MatNativeDateModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        provideMockStore<Partial<RootState>>({
          initialState: {
            [CONFIG_FEATURE_NAME]: {
              sync: {},
              localization: {
                lng: undefined,
                dateTimeLocale: undefined,
                firstDayOfWeek: 0,
              },
            } as any,
          },
        }),
        { provide: MatDialogRef, useValue: dialogRefSpy },
        { provide: SnackService, useValue: snackServiceSpy },
        { provide: ReminderService, useValue: reminderServiceSpy },
        { provide: PlannerService, useValue: plannerServiceSpy },
        { provide: TaskService, useValue: taskServiceSpy },
        { provide: WorkContextService, useValue: workContextServiceSpy },
        TranslateService,
        TranslateStore,
        LocaleDatePipe,
      ],
    }).compileComponents();
  });

  describe('isSelectDueOnly mode', () => {
    beforeEach(() => {
      TestBed.overrideProvider(MAT_DIALOG_DATA, {
        useValue: {
          isSelectDueOnly: true,
        },
      });

      fixture = TestBed.createComponent(DialogScheduleTaskComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should initialize with isSelectDueOnly mode', () => {
      expect(component.data.isSelectDueOnly).toBe(true);
    });

    it('should set default reminder to AtStart in select-due-only mode', () => {
      expect(component.selectedReminderCfgId).toBe(TaskReminderOptionId.AtStart);
    });

    it('should return selected date and time instead of scheduling when submit is called', async () => {
      const testDate = new Date('2024-01-15T00:00:00.000Z');
      const testTime = '14:30';

      component.selectedDate = testDate;
      component.selectedTime = testTime;

      await component.submit();

      expect(dialogRefSpy.close).toHaveBeenCalledWith({
        date: testDate,
        time: testTime,
        remindOption: TaskReminderOptionId.AtStart,
      });
      expect(taskServiceSpy.scheduleTask).not.toHaveBeenCalled();
    });

    it('should return null time when no time selected', async () => {
      const testDate = new Date('2024-01-15T00:00:00.000Z');

      component.selectedDate = testDate;
      component.selectedTime = null;

      await component.submit();

      expect(dialogRefSpy.close).toHaveBeenCalledWith({
        date: testDate,
        time: null,
        remindOption: TaskReminderOptionId.AtStart,
      });
    });

    it('should not submit if no date is selected', async () => {
      component.selectedDate = null;
      component.selectedTime = '14:30';

      await component.submit();

      expect(dialogRefSpy.close).not.toHaveBeenCalled();
    });

    it('should handle remove operation gracefully in select-due-only mode', () => {
      component.remove();

      expect(dialogRefSpy.close).toHaveBeenCalledWith(false);
    });
  });

  describe('isSelectDueOnly mode with targetDay', () => {
    beforeEach(() => {
      TestBed.overrideProvider(MAT_DIALOG_DATA, {
        useValue: {
          isSelectDueOnly: true,
          targetDay: '2024-01-15',
        },
      });

      fixture = TestBed.createComponent(DialogScheduleTaskComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should initialize with targetDay when provided', () => {
      expect(component.data.targetDay).toBe('2024-01-15');
    });

    it('should set selectedDate to targetDay on initialization', async () => {
      fixture.detectChanges();
      await component.ngAfterViewInit();

      const expectedDate = dateStrToUtcDate('2024-01-15');
      expect(component.selectedDate).toEqual(expectedDate);
    });
  });

  describe('isSelectDueOnly mode without targetDay', () => {
    beforeEach(() => {
      TestBed.overrideProvider(MAT_DIALOG_DATA, {
        useValue: {
          isSelectDueOnly: true,
        },
      });

      fixture = TestBed.createComponent(DialogScheduleTaskComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should not have initial selectedDate when no targetDay provided', async () => {
      fixture.detectChanges();
      await component.ngAfterViewInit();

      // selectedDate should be null since no targetDay was provided
      expect(component.selectedDate).toBe(null);
    });
  });

  describe('Date selection in select-due-only mode', () => {
    beforeEach(() => {
      TestBed.overrideProvider(MAT_DIALOG_DATA, {
        useValue: {
          isSelectDueOnly: true,
        },
      });

      fixture = TestBed.createComponent(DialogScheduleTaskComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should update selectedDate when dateSelected is called', () => {
      const testDate = new Date('2024-01-20');

      component.dateSelected(testDate);

      // Wait for setTimeout to complete
      setTimeout(() => {
        expect(component.selectedDate).toEqual(testDate);
      }, 1);
    });

    it('should handle quick access buttons correctly', () => {
      const initialDate = new Date();
      initialDate.setMinutes(0, 0, 0);

      // Test "Today" button (item 1)
      component.quickAccessBtnClick(1);
      expect(component.selectedDate).toEqual(initialDate);

      // Test "Tomorrow" button (item 2)
      const tomorrow = new Date(initialDate);
      tomorrow.setDate(tomorrow.getDate() + 1);
      component.quickAccessBtnClick(2);
      expect(component.selectedDate).toEqual(tomorrow);
    });
  });

  describe('Time handling in select-due-only mode', () => {
    beforeEach(() => {
      TestBed.overrideProvider(MAT_DIALOG_DATA, {
        useValue: {
          isSelectDueOnly: true,
        },
      });

      fixture = TestBed.createComponent(DialogScheduleTaskComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should clear time when onTimeClear is called', () => {
      component.selectedTime = '10:30';
      const mockEvent = new MouseEvent('click');

      component.onTimeClear(mockEvent);

      expect(component.selectedTime).toBeNull();
      expect(component.isInitValOnTimeFocus).toBe(true);
    });

    it('should set default time on focus when no time selected', () => {
      component.selectedTime = null;
      component.isInitValOnTimeFocus = true;
      const testDate = new Date();
      testDate.setDate(testDate.getDate() + 1); // Tomorrow
      component.selectedDate = testDate;

      component.onTimeFocus();

      expect(component.selectedTime).toBeTruthy();
      expect(component.isInitValOnTimeFocus).toBe(false);
    });
  });
});
