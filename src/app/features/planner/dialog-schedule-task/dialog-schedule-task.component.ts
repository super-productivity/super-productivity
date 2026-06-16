import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
} from '@angular/material/dialog';
import {
  Task,
  TaskCopy,
  TaskReminderOption,
  TaskReminderOptionId,
} from '../../tasks/task.model';
import { T } from 'src/app/t.const';
import { Store } from '@ngrx/store';
import { PlannerActions } from '../store/planner.actions';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { LocaleDatePipe } from 'src/app/ui/pipes/locale-date.pipe';
import { SnackService } from '../../../core/snack/snack.service';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { truncate } from '../../../util/truncate';
import { TASK_REMINDER_OPTIONS } from './task-reminder-options.const';
import { FormsModule } from '@angular/forms';
import { millisecondsDiffToRemindOption } from '../../tasks/util/remind-option-to-milliseconds';
import { DateService } from '../../../core/date/date.service';
import { TaskService } from '../../tasks/task.service';
import { ReminderService } from '../../reminder/reminder.service';
import { getDateTimeFromClockString } from '../../../util/get-date-time-from-clock-string';
import { isValidSplitTime } from '../../../util/is-valid-split-time';
import { normalizeClockStr } from '../../../util/normalize-clock-str';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { DateAdapter } from '@angular/material/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Log } from '../../../core/log';
import { GlobalConfigService } from '../../config/global-config.service';
import { DEFAULT_GLOBAL_CONFIG } from '../../config/default-global-config.const';
import { selectAllTasksWithDueTimeSorted } from '../../tasks/store/task.selectors';
import { selectTimelineConfig } from '../../config/store/global-config.reducer';
import { getTimeConflictTaskIds } from '../../tasks/util/get-time-conflict-task-ids';
import { isTaskOutsideWorkHours } from '../../tasks/util/is-task-outside-work-hours';
import { DateTimePickerComponent } from '../../../ui/datetime-picker/datetime-picker.component';

@Component({
  selector: 'dialog-schedule-task',
  imports: [
    FormsModule,
    MatIcon,
    TranslatePipe,
    MatButton,
    MatDialogActions,
    MatDialogContent,
    DateTimePickerComponent,
  ],
  templateUrl: './dialog-schedule-task.component.html',
  styleUrl: './dialog-schedule-task.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogScheduleTaskComponent implements AfterViewInit {
  data = inject<{
    task?: Task;
    targetDay?: string;
    targetTime?: string;
    isSelectDueOnly?: boolean;
    showQuickAccess?: boolean;
    minDate?: Date | null;
    isSubmitOnQuickAccess?: boolean;
  }>(MAT_DIALOG_DATA);
  private _matDialogRef = inject<MatDialogRef<DialogScheduleTaskComponent>>(MatDialogRef);
  private _cd = inject(ChangeDetectorRef);
  private _store = inject(Store);
  private _snackService = inject(SnackService);
  private _datePipe = inject(LocaleDatePipe);
  private _taskService = inject(TaskService);
  private _reminderService = inject(ReminderService);
  private _translateService = inject(TranslateService);
  private _globalConfigService = inject(GlobalConfigService);
  private _dateService = inject(DateService);
  private readonly _dateAdapter = inject(DateAdapter);
  private readonly _tasksWithDueTimeSorted = this._store.selectSignal(
    selectAllTasksWithDueTimeSorted,
  );
  private readonly _timelineConfig = this._store.selectSignal(selectTimelineConfig);

  // Wait for localization config to be loaded before rendering calendar
  // This ensures DateAdapter.getFirstDayOfWeek() returns the correct value
  readonly isConfigReady = computed(
    () => this._globalConfigService.localization() !== undefined,
  );

  T: typeof T = T;
  minDate = this.data.minDate === undefined ? new Date() : this.data.minDate;

  remindAvailableOptions: TaskReminderOption[] = TASK_REMINDER_OPTIONS;
  task: TaskCopy | undefined = this.data.task;

  private _selectedDate = signal<Date | string | null>(null);
  private _selectedTime = signal<string | null>(null);
  selectedReminderCfgId!: TaskReminderOptionId;

  plannedDayForTask: string | null = null;

  todayStr = this._dateService.todayStr();
  // private _prevSelectedQuickAccessDate: Date | null = null;
  // private _prevQuickAccessAction: number | null = null;
  private _previewTaskId = '__schedule-preview__';

  private _defaultTaskRemindCfgId = computed(
    () =>
      (this._globalConfigService.cfg()?.reminder
        ?.defaultTaskRemindOption as TaskReminderOptionId) ??
      DEFAULT_GLOBAL_CONFIG.reminder.defaultTaskRemindOption!,
  );
  get selectedDate(): Date | string | null {
    return this._selectedDate();
  }
  set selectedDate(value: Date | string | null) {
    this._selectedDate.set(value);
  }

  get selectedTime(): string | null {
    return this._selectedTime();
  }
  set selectedTime(value: string | null) {
    this._selectedTime.set(value);
  }

  // A `<input type="time">` can yield `HH:MM:SS` (macOS Chrome renders a seconds
  // segment even with step="60"); recover it to `HH:MM` so the time the user set
  // survives validation instead of being dropped or crashing the guard (#7802).
  private _normalizedTime = computed<string | null>(() => {
    const t = this._selectedTime();
    return t ? normalizeClockStr(t) : null;
  });

  plannedTimestamp = computed<number | null>(() => {
    const selectedDate = this._selectedDate();
    const normalizedTime = this._normalizedTime();
    // Out-of-range (`25:00`) or garbage values still fail validation here and
    // would otherwise crash getDateTimeFromClockString and bubble "Invalid clock
    // string" to the global error handler via scheduleWarnings (#7802).
    if (!selectedDate || !normalizedTime || !isValidSplitTime(normalizedTime)) {
      return null;
    }

    return getDateTimeFromClockString(normalizedTime, selectedDate as Date);
  });
  scheduleWarnings = computed(() => {
    const plannedTimestamp = this.plannedTimestamp();
    if (!plannedTimestamp || this.data.isSelectDueOnly) {
      return {
        hasOverlap: false,
        isOutsideWorkHours: false,
      };
    }

    const candidateTask = {
      id: this._previewTaskId,
      dueWithTime: plannedTimestamp,
      timeEstimate: this.task?.timeEstimate || 0,
      timeSpent: this.task?.timeSpent || 0,
      subTaskIds: this.task?.subTaskIds || [],
      isDone: false,
      projectId: this.task?.projectId || '',
      timeSpentOnDay: this.task?.timeSpentOnDay || {},
      attachments: this.task?.attachments || [],
      title: this.task?.title || '',
      tagIds: this.task?.tagIds || [],
      created: this.task?.created || 0,
    };
    const conflictIds = getTimeConflictTaskIds([
      ...this._tasksWithDueTimeSorted().filter((task) => task.id !== this.task?.id),
      candidateTask,
    ]);

    return {
      hasOverlap: conflictIds.has(this._previewTaskId),
      isOutsideWorkHours: isTaskOutsideWorkHours(candidateTask, this._timelineConfig()),
    };
  });

  async ngAfterViewInit(): Promise<void> {
    // Handle case when task is provided
    if (this.data.task) {
      if (this.data.task.remindAt) {
        if (this.data.task.dueWithTime) {
          this.selectedReminderCfgId = millisecondsDiffToRemindOption(
            this.data.task.dueWithTime,
            this.data.task.remindAt,
          );
        }
      } else if (!this.data.task.dueWithTime) {
        this.selectedReminderCfgId = this._defaultTaskRemindCfgId();
      } else {
        this.selectedReminderCfgId = TaskReminderOptionId.DoNotRemind;
      }

      if (this.data.task.dueWithTime) {
        // dueWithTime is a UTC timestamp - Date constructor handles timezone conversion automatically
        // Do NOT add timezone offset here as it would double-apply the conversion (fixes #5515)
        this.selectedDate = new Date(this.data.task.dueWithTime);
        this.selectedTime = new Date(this.data.task.dueWithTime).toLocaleTimeString(
          'en-GB',
          {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        );
      } else {
        this.plannedDayForTask = this.data.task.dueDay || null;

        this.selectedDate = this.plannedDayForTask
          ? dateStrToUtcDate(this.plannedDayForTask)
          : null;
      }
    } else {
      this.selectedReminderCfgId = this._defaultTaskRemindCfgId();
    }

    if (this.data.targetDay) {
      this.selectedDate = dateStrToUtcDate(this.data.targetDay);
    }

    if (this.data.targetTime) {
      this.selectedTime = this.data.targetTime;
    }

    this._cd.detectChanges();
  }

  close(
    result:
      | boolean
      | {
          date: Date | null;
          time: string | null;
          remindOption: TaskReminderOptionId | null;
        } = false,
  ): void {
    this._matDialogRef.close(result);
  }

  dateSelected(newDate: Date): void {
    this.selectedDate = new Date(newDate);
  }

  remove(): void {
    // Only handle remove if task is provided
    if (!this.data.task) {
      this.close(false);
      return;
    }

    if (this.data.task.remindAt) {
      this._store.dispatch(
        TaskSharedActions.unscheduleTask({
          id: this.data.task.id,
        }),
      );
    } else if (this.plannedDayForTask === this._dateService.todayStr()) {
      // to cover edge cases
      this._store.dispatch(
        TaskSharedActions.unscheduleTask({
          id: this.data.task.id,
          isSkipToast: true,
        }),
      );

      this._snackService.open({
        type: 'SUCCESS',
        msg: T.F.PLANNER.S.REMOVED_PLAN_DATE,
        translateParams: { taskTitle: truncate(this.data.task.title) },
      });
    } else {
      this._store.dispatch(
        TaskSharedActions.unscheduleTask({
          id: this.data.task.id,
          isSkipToast: true,
        }),
      );

      this._snackService.open({
        type: 'SUCCESS',
        msg: T.F.PLANNER.S.REMOVED_PLAN_DATE,
        translateParams: { taskTitle: truncate(this.data.task.title) },
      });
    }
    this.close(true);
  }

  async submit(): Promise<void> {
    if (!this.selectedDate) {
      Log.err('no selected date');
      return;
    }

    // If in select-due-only mode, return the selected values instead of dispatching actions
    if (this.data.isSelectDueOnly) {
      const normalizedTime = this._normalizedTime();
      this.close({
        date: this.selectedDate as Date,
        time: normalizedTime,
        remindOption:
          normalizedTime && isValidSplitTime(normalizedTime)
            ? this.selectedReminderCfgId
            : null,
      });
      return;
    }

    const newDayDate = new Date(this.selectedDate);
    const newDay = getDbDateStr(newDayDate);

    this._handleReminderRemoval();

    // Treat genuinely malformed time the same as "no time": fall through to
    // day-only planning rather than crashing in _scheduleWithTime (#7802).
    const normalizedTime = this._normalizedTime();
    const hasValidTime = !!normalizedTime && isValidSplitTime(normalizedTime);

    if (hasValidTime) {
      this._scheduleWithTime();
    } else if (
      this.data.task &&
      this.data.task.dueDay === newDay &&
      // Only show info if there is no time set already
      !this.data.task.dueWithTime
    ) {
      const formattedDate =
        newDay == this._dateService.todayStr()
          ? this._translateService.instant(T.G.TODAY_TAG_TITLE)
          : (this._datePipe.transform(newDay, 'shortDate') as string);
      this._snackService.open({
        type: 'CUSTOM',
        ico: 'info',
        msg: T.F.PLANNER.S.TASK_ALREADY_PLANNED,
        translateParams: { date: formattedDate },
      });
    } else {
      await this._planForDay(newDay);
    }

    this.close(true);
  }

  private _handleReminderRemoval(): void {
    if (
      this.data.task &&
      this.selectedReminderCfgId === TaskReminderOptionId.DoNotRemind &&
      this.data.task.remindAt !== undefined
    ) {
      this._store.dispatch(
        TaskSharedActions.updateTask({
          task: {
            id: this.data.task.id,
            changes: {
              remindAt: undefined,
            },
          },
        }),
      );
    }
  }

  private _scheduleWithTime(): void {
    // Only schedule if task is provided and time is valid (submit() pre-validates;
    // belt-and-braces guard against direct callers / malformed paste — see #7802).
    const normalizedTime = this._normalizedTime();
    if (!this.data.task || !normalizedTime || !isValidSplitTime(normalizedTime)) {
      return;
    }

    const task = this.data.task;
    const newDate = new Date(
      getDateTimeFromClockString(normalizedTime, this.selectedDate as Date),
    );
    this._taskService.scheduleTask(
      task,
      newDate.getTime(),
      this.selectedReminderCfgId,
      false,
    );
    // TODO if we want this, we should add it as an effect
    // const isTodayI = isToday(newDate);
    // if (isTodayI) {
    //   this.addToToday();
    // }
  }

  private async _planForDay(newDay: string): Promise<void> {
    // Only plan if task is provided
    if (!this.data.task) {
      return;
    }

    this._store.dispatch(
      PlannerActions.planTaskForDay({
        task: this.data.task,
        day: newDay,
        isShowSnack: true,
      }),
    );
  }

  onQuickAccessClick(option: 'today' | 'tomorrow' | 'nextWeek' | 'nextMonth'): void {
    const tDate = new Date();
    tDate.setMinutes(0, 0, 0);

    switch (option) {
      case 'today':
        this.selectedDate = tDate;
        break;
      case 'tomorrow':
        const tomorrow = tDate;
        tomorrow.setDate(tomorrow.getDate() + 1);
        this.selectedDate = tomorrow;
        break;
      case 'nextWeek':
        const nextFirstDayOfWeek = tDate;
        const dayOffset =
          (this._dateAdapter.getFirstDayOfWeek() -
            this._dateAdapter.getDayOfWeek(nextFirstDayOfWeek) +
            7) %
            7 || 7;
        nextFirstDayOfWeek.setDate(nextFirstDayOfWeek.getDate() + dayOffset);
        this.selectedDate = nextFirstDayOfWeek;
        break;
      case 'nextMonth':
        const nextMonth = tDate;
        nextMonth.setDate(1);
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        this.selectedDate = nextMonth;
        break;
    }

    if (this.data.isSubmitOnQuickAccess !== false) {
      this.submit();
    }
  }
}
