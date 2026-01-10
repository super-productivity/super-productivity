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
import { Store } from '@ngrx/store';
import { TranslateModule, TranslateService, TranslateStore } from '@ngx-translate/core';
import { SnackService } from '../../../core/snack/snack.service';
import { LocaleDatePipe } from 'src/app/ui/pipes/locale-date.pipe';
import { TaskService } from '../../../features/tasks/task.service';
import { WorkContextService } from '../../../features/work-context/work-context.service';
import { of } from 'rxjs';
import { PlannerService } from '../planner.service';
import { RootState } from '../../../root-store/root-state';
import { CONFIG_FEATURE_NAME } from '../../config/store/global-config.reducer';
import { TaskCopy, TaskReminderOptionId } from '../../tasks/task.model';
import { ReminderService } from '../../reminder/reminder.service';
import { PlannerActions } from '../store/planner.actions';
import { getDbDateStr } from '../../../util/get-db-date-str';

describe('DialogScheduleTaskComponent', () => {
  let component: DialogScheduleTaskComponent;
  let fixture: ComponentFixture<DialogScheduleTaskComponent>;
  let dialogRefSpy: jasmine.SpyObj<MatDialogRef<DialogScheduleTaskComponent>>;
  let snackServiceSpy: jasmine.SpyObj<SnackService>;
  let taskServiceSpy: jasmine.SpyObj<TaskService>;
  let plannerServiceSpy: jasmine.SpyObj<PlannerService>;
  let workContextServiceSpy: jasmine.SpyObj<WorkContextService>;
  let reminderServiceSpy: jasmine.SpyObj<ReminderService>;
  let store: Store;

  const mockDialogData = {
    taskId: 'task123',
    title: 'Test Task',
    date: new Date(),
  };

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
        { provide: MAT_DIALOG_DATA, useValue: mockDialogData },
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

    fixture = TestBed.createComponent(DialogScheduleTaskComponent);
    component = fixture.componentInstance;
    store = TestBed.inject(Store);
    const t = {
      id: 'task123',
      title: 'Test Task',
      tagIds: [] as string[],
      projectId: 'DEFAULT',
      timeSpentOnDay: {},
      attachments: [],
      timeEstimate: 0,
      timeSpent: 0,
      isDone: false,
      created: Date.now(),
      subTaskIds: [],
    } as TaskCopy;
    component.data = {
      task: t,
    };
    component.task = t;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should close dialog with form data when submit is clicked', async () => {
    const testDate = new Date(2023, 4, 15);
    component.selectedDate = testDate;
    await component.submit();
    expect(dialogRefSpy.close).toHaveBeenCalledWith(true);
  });

  describe('submit()', () => {
    it('should call taskService.scheduleTask with correct parameters when submit is called', async () => {
      const testDate = new Date(2023, 5, 1);
      const expectedDate = new Date(testDate);
      expectedDate.setHours(10, 0, 0, 0); // Set time to 10:00 AM

      const mockTask = {
        id: 'task123',
        title: 'Test Task',
        tagIds: [] as string[],
        projectId: 'DEFAULT',
        timeSpentOnDay: {},
        attachments: [],
        timeEstimate: 0,
        timeSpent: 0,
        isDone: false,
        created: 1640995200000, // Fixed timestamp
        subTaskIds: [],
      } as TaskCopy;

      component.selectedDate = testDate;
      component.selectedTime = '10:00';
      component.selectedReminderCfgId = TaskReminderOptionId.AtStart;
      component.task = mockTask;
      await component.submit();

      expect(taskServiceSpy.scheduleTask).toHaveBeenCalledWith(
        jasmine.objectContaining({
          id: 'task123',
          title: 'Test Task',
          tagIds: [],
          projectId: 'DEFAULT',
          timeSpentOnDay: {},
          attachments: [],
          timeEstimate: 0,
          timeSpent: 0,
          isDone: false,
          subTaskIds: [],
        }),
        expectedDate.getTime(),
        TaskReminderOptionId.AtStart,
        false,
      );
    });

    it('should not schedule task or close dialog if no date is selected', async () => {
      component.selectedDate = undefined as any;
      component.selectedTime = undefined as any;
      await component.submit();
      expect(taskServiceSpy.scheduleTask).not.toHaveBeenCalled();
      expect(dialogRefSpy.close).not.toHaveBeenCalled();
    });

    it('should handle when scheduleTask throws (should not close dialog)', async () => {
      const testDate = new Date(2023, 11, 1);
      component.selectedDate = testDate;
      component.selectedTime = '14:00';
      component.selectedReminderCfgId = TaskReminderOptionId.AtStart;
      component.task = {
        id: 'taskThrow',
        title: 'Throw Task',
        tagIds: [] as string[],
        projectId: 'DEFAULT',
        timeSpentOnDay: {},
        attachments: [],
        timeEstimate: 0,
        timeSpent: 0,
        isDone: false,
        created: 1640995200000, // Fixed timestamp
        subTaskIds: [],
      } as TaskCopy;
      taskServiceSpy.scheduleTask.and.throwError('Schedule failed');
      try {
        await component.submit();
      } catch {}
      expect(dialogRefSpy.close).not.toHaveBeenCalled();
      expect(snackServiceSpy.open).not.toHaveBeenCalled();
    });

    it('should close dialog with true when scheduling is successful', async () => {
      const testDate = new Date(2024, 0, 1);
      component.selectedDate = testDate;
      component.selectedTime = '15:00';
      component.selectedReminderCfgId = TaskReminderOptionId.AtStart;
      component.task = {
        id: 'taskClose',
        title: 'Close Task',
        tagIds: [] as string[],
        projectId: 'DEFAULT',
        timeSpentOnDay: {},
        attachments: [],
        timeEstimate: 0,
        timeSpent: 0,
        isDone: false,
        created: 1640995200000, // Fixed timestamp
        subTaskIds: [],
      } as TaskCopy;
      await component.submit();
      expect(dialogRefSpy.close).toHaveBeenCalledWith(true);
    });

    it('should not call snackService.open if scheduleTask fails', async () => {
      const testDate = new Date(2024, 1, 1);
      component.selectedDate = testDate;
      component.selectedTime = '16:00';
      component.selectedReminderCfgId = TaskReminderOptionId.AtStart;
      component.task = {
        id: 'taskNoSnack',
        title: 'No Snack Task',
        tagIds: [] as string[],
        projectId: 'DEFAULT',
        timeSpentOnDay: {},
        attachments: [],
        timeEstimate: 0,
        timeSpent: 0,
        isDone: false,
        created: 1640995200000, // Fixed timestamp
        subTaskIds: [],
      } as TaskCopy;
      taskServiceSpy.scheduleTask.and.throwError('Error');
      try {
        await component.submit();
      } catch {}
      expect(snackServiceSpy.open).not.toHaveBeenCalled();
    });

    it('should plan for today (clear time) when removing time from a task scheduled for today', async () => {
      const today = new Date();
      const mockTask = {
        id: 'taskWithTimeToday',
        title: 'Task With Time',
        tagIds: [] as string[],
        projectId: 'DEFAULT',
        timeSpentOnDay: {},
        attachments: [],
        timeEstimate: 0,
        timeSpent: 0,
        isDone: false,
        created: 1640995200000,
        subTaskIds: [],
        dueWithTime: today.getTime(),
        dueDay: getDbDateStr(today),
      } as unknown as TaskCopy;

      const dispatchSpy = spyOn(store, 'dispatch');

      component.task = mockTask;
      component.data = { task: mockTask } as any;
      component.selectedDate = new Date(today);
      component.selectedTime = null;

      await component.submit();

      expect(dispatchSpy).toHaveBeenCalledWith(
        PlannerActions.planTaskForDay({
          task: mockTask,
          day: getDbDateStr(today),
          isShowSnack: true,
        }),
      );
      expect(dialogRefSpy.close).toHaveBeenCalledWith(true);
    });
  });

  describe('ngAfterViewInit - dueWithTime initialization (issue #5515)', () => {
    it('should initialize selectedDate from dueWithTime without timezone corruption', async () => {
      // Create a task scheduled for 2:45 PM today
      const scheduledTime = new Date();
      scheduledTime.setHours(14, 45, 0, 0);
      const dueWithTime = scheduledTime.getTime();

      const mockTask = {
        id: 'taskWithDueTime',
        title: 'Scheduled Task',
        tagIds: [] as string[],
        projectId: 'DEFAULT',
        timeSpentOnDay: {},
        attachments: [],
        timeEstimate: 0,
        timeSpent: 0,
        isDone: false,
        created: Date.now(),
        subTaskIds: [],
        dueWithTime,
        reminderId: null,
      } as unknown as TaskCopy;

      component.data = { task: mockTask };
      component.task = mockTask;
      fixture.detectChanges();

      await component.ngAfterViewInit();

      // The selectedDate should preserve the original date without timezone shift
      const selectedDate = component.selectedDate as Date;
      expect(selectedDate.getDate()).toBe(scheduledTime.getDate());
      expect(selectedDate.getMonth()).toBe(scheduledTime.getMonth());
      expect(selectedDate.getFullYear()).toBe(scheduledTime.getFullYear());
    });

    it('should initialize selectedTime correctly from dueWithTime', async () => {
      // Create a task scheduled for 2:45 PM
      const scheduledTime = new Date();
      scheduledTime.setHours(14, 45, 0, 0);
      const dueWithTime = scheduledTime.getTime();

      const mockTask = {
        id: 'taskWithDueTime',
        title: 'Scheduled Task',
        tagIds: [] as string[],
        projectId: 'DEFAULT',
        timeSpentOnDay: {},
        attachments: [],
        timeEstimate: 0,
        timeSpent: 0,
        isDone: false,
        created: Date.now(),
        subTaskIds: [],
        dueWithTime,
        reminderId: null,
      } as unknown as TaskCopy;

      component.data = { task: mockTask };
      component.task = mockTask;
      fixture.detectChanges();

      await component.ngAfterViewInit();

      // The selectedTime should be "14:45"
      expect(component.selectedTime).toBe('14:45');
    });

    it('should preserve exact timestamp when dialog is opened and closed', async () => {
      // This tests that opening the dialog doesn't corrupt the dueWithTime
      const originalDueWithTime = new Date(2025, 5, 15, 14, 45, 0).getTime();

      const mockTask = {
        id: 'taskPreserveTime',
        title: 'Preserve Time Task',
        tagIds: [] as string[],
        projectId: 'DEFAULT',
        timeSpentOnDay: {},
        attachments: [],
        timeEstimate: 0,
        timeSpent: 0,
        isDone: false,
        created: Date.now(),
        subTaskIds: [],
        dueWithTime: originalDueWithTime,
        reminderId: null,
      } as unknown as TaskCopy;

      component.data = { task: mockTask };
      component.task = mockTask;
      fixture.detectChanges();

      await component.ngAfterViewInit();

      // Verify the displayed date/time matches the original
      const selectedDate = component.selectedDate as Date;
      const originalDate = new Date(originalDueWithTime);

      expect(selectedDate.getFullYear()).toBe(originalDate.getFullYear());
      expect(selectedDate.getMonth()).toBe(originalDate.getMonth());
      expect(selectedDate.getDate()).toBe(originalDate.getDate());
      expect(component.selectedTime).toBe('14:45');
    });
  });
});
