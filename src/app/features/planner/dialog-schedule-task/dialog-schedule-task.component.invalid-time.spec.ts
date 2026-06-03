import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideMockStore } from '@ngrx/store/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService, TranslateStore } from '@ngx-translate/core';
import { DateAdapter } from '@angular/material/core';
import { DialogScheduleTaskComponent } from './dialog-schedule-task.component';
import { TaskCopy } from '../../tasks/task.model';
import { SnackService } from '../../../core/snack/snack.service';
import { LocaleDatePipe } from 'src/app/ui/pipes/locale-date.pipe';
import { TaskService } from '../../tasks/task.service';
import { ReminderService } from '../../reminder/reminder.service';
import { DateService } from '../../../core/date/date.service';
import { GlobalConfigService } from '../../config/global-config.service';
import {
  selectAllTasksWithDueTimeSorted,
  selectTaskById,
} from '../../tasks/store/task.selectors';
import { selectTimelineConfig } from '../../config/store/global-config.reducer';

/**
 * Repro for issue #7802 — "Invalid clock string" on Schedule Task dialog.
 *
 * `plannedTimestamp` (a computed signal added in #7559) calls
 * getDateTimeFromClockString eagerly whenever selectedTime changes. Any value
 * that is non-empty but fails isValidSplitTime (e.g. an HH:MM:SS value pasted
 * into <input type="time">, an out-of-range "25:00", or garbage) makes the
 * computed throw, the throw escapes through the template's
 * scheduleWarnings() call, and "Invalid clock string" bubbles to the global
 * error handler.
 *
 * Mirrors the pattern already established by:
 *  - dialog-deadline.component.spec.ts (#7490)
 *  - invalid-clock-string-bug-7067.spec.ts (#7067)
 */
describe('DialogScheduleTaskComponent — malformed selectedTime', () => {
  let matDialogRefSpy: jasmine.SpyObj<MatDialogRef<DialogScheduleTaskComponent>>;
  let taskServiceSpy: jasmine.SpyObj<TaskService>;

  const task: TaskCopy = {
    id: 'task-1',
    title: 'Test',
    tagIds: [],
    projectId: 'DEFAULT',
    timeSpentOnDay: {},
    attachments: [],
    timeEstimate: 0,
    timeSpent: 0,
    isDone: false,
    created: 1640995200000,
    subTaskIds: [],
  } as TaskCopy;

  const createComponent = (): DialogScheduleTaskComponent => {
    const fixture = TestBed.createComponent(DialogScheduleTaskComponent);
    const component = fixture.componentInstance;
    component.data = { task };
    component.task = task;
    return component;
  };

  beforeEach(async () => {
    matDialogRefSpy = jasmine.createSpyObj('MatDialogRef', ['close']);
    taskServiceSpy = jasmine.createSpyObj('TaskService', ['scheduleTask']);
    // ngAfterViewInit reads viewChild.required(MatCalendar). With the template
    // stubbed there is no calendar — skip the hook and test in isolation.
    spyOn(DialogScheduleTaskComponent.prototype, 'ngAfterViewInit').and.stub();

    await TestBed.configureTestingModule({
      imports: [
        DialogScheduleTaskComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        provideMockStore({
          initialState: {},
          selectors: [
            { selector: selectAllTasksWithDueTimeSorted, value: [] },
            { selector: selectTimelineConfig, value: null },
            { selector: selectTaskById, value: task },
          ],
        }),
        { provide: MatDialogRef, useValue: matDialogRefSpy },
        { provide: MAT_DIALOG_DATA, useValue: { task } },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
        { provide: TaskService, useValue: taskServiceSpy },
        {
          provide: ReminderService,
          useValue: jasmine.createSpyObj('ReminderService', ['getById']),
        },
        {
          provide: DateService,
          useValue: {
            isToday: () => false,
            todayStr: () => '2026-05-26',
            getStartOfNextDayDiffMs: () => 0,
          },
        },
        {
          provide: GlobalConfigService,
          useValue: { localization: () => undefined, cfg: () => undefined },
        },
        {
          provide: DateAdapter,
          useValue: { getFirstDayOfWeek: () => 1, getDayOfWeek: () => 1 },
        },
        TranslateService,
        TranslateStore,
        LocaleDatePipe,
      ],
    })
      .overrideComponent(DialogScheduleTaskComponent, { set: { template: '' } })
      .compileComponents();
  });

  // --- pinning tests (must keep passing through the fix) ---

  it('plannedTimestamp returns a number for a valid HH:MM time', () => {
    const component = createComponent();
    component.selectedDate = new Date(2026, 4, 26);
    component.selectedTime = '14:30';

    expect(typeof component.plannedTimestamp()).toBe('number');
  });

  it('plannedTimestamp returns null when no time is set', () => {
    const component = createComponent();
    component.selectedDate = new Date(2026, 4, 26);
    component.selectedTime = null;

    expect(component.plannedTimestamp()).toBeNull();
  });

  // --- repro for #7802 ---

  // A stray seconds component (`13:30:00`, which macOS Chrome produces from
  // <input type="time"> even with step="60") is recoverable: it must normalize
  // to `13:30` and schedule, not be dropped. See the dedicated tests below.
  it('plannedTimestamp normalizes a "13:30:00" time and returns a number', () => {
    const component = createComponent();
    component.selectedDate = new Date(2026, 4, 26);
    component.selectedTime = '13:30:00';

    const ts = component.plannedTimestamp();
    expect(typeof ts).toBe('number');
    const d = new Date(ts as number);
    expect(d.getHours()).toBe(13);
    expect(d.getMinutes()).toBe(30);
  });

  it('submit() schedules with the normalized time for "13:30:00"', async () => {
    const component = createComponent();
    component.selectedDate = new Date(2026, 4, 26);
    component.selectedTime = '13:30:00';

    await component.submit();

    expect(taskServiceSpy.scheduleTask).toHaveBeenCalled();
    const scheduledTs = taskServiceSpy.scheduleTask.calls.mostRecent().args[1] as number;
    const d = new Date(scheduledTs);
    expect(d.getHours()).toBe(13);
    expect(d.getMinutes()).toBe(30);
  });

  // Genuinely malformed values still fail validation after normalization and
  // must not throw "Invalid clock string" — they fall back to null / day-only.
  ['25:00', '13:60', 'abc', '12'].forEach((badTime) => {
    it(`plannedTimestamp does NOT throw for malformed selectedTime "${badTime}"`, () => {
      const component = createComponent();
      component.selectedDate = new Date(2026, 4, 26);
      component.selectedTime = badTime;

      expect(() => component.plannedTimestamp()).not.toThrow();
      expect(component.plannedTimestamp()).toBeNull();
    });

    it(`scheduleWarnings does NOT throw for malformed selectedTime "${badTime}"`, () => {
      const component = createComponent();
      component.selectedDate = new Date(2026, 4, 26);
      component.selectedTime = badTime;

      expect(() => component.scheduleWarnings()).not.toThrow();
      expect(component.scheduleWarnings()).toEqual({
        hasOverlap: false,
        isOutsideWorkHours: false,
      });
    });

    it(`submit() falls back to day-only planning for malformed selectedTime "${badTime}"`, async () => {
      const component = createComponent();
      component.selectedDate = new Date(2026, 4, 26);
      component.selectedTime = badTime;

      let err: unknown;
      try {
        await component.submit();
      } catch (e) {
        err = e;
      }
      expect(err).toBeUndefined();
      // Invalid time must not reach scheduleTask — it would crash there too.
      expect(taskServiceSpy.scheduleTask).not.toHaveBeenCalled();
    });
  });
});
