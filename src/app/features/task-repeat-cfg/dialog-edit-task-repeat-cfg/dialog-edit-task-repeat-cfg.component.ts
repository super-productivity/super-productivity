import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Task, TaskCopy, TaskReminderOptionId } from '../../tasks/task.model';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatDialog } from '@angular/material/dialog';
import { TaskRepeatCfgService } from '../task-repeat-cfg.service';
import {
  DEFAULT_TASK_REPEAT_CFG,
  TaskRepeatCfg,
  TaskRepeatCfgCopy,
} from '../task-repeat-cfg.model';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { UntypedFormGroup } from '@angular/forms';
import {
  TASK_REPEAT_CFG_ADVANCED_FORM_CFG,
  TASK_REPEAT_CFG_ESSENTIAL_FORM_CFG,
} from './task-repeat-cfg-form.const';
import { buildRepeatQuickSettingOptions } from './build-repeat-quick-setting-options';
import { T } from '../../../t.const';
import { TagService } from '../../tag/tag.service';
import { unique } from '../../../util/unique';
import { exists } from '../../../util/exists';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { getDbDateStr, isDBDateStr } from '../../../util/get-db-date-str';
import { formatMonthDay } from '../../../util/format-month-day.util';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { first } from 'rxjs/operators';
import { getQuickSettingUpdates } from './get-quick-setting-updates';
import { getTaskRepeatCfgChanges } from './get-task-repeat-cfg-changes';
import { clockStringFromDate } from '../../../ui/duration/clock-string-from-date';
import { ChipListInputComponent } from '../../../ui/chip-list-input/chip-list-input.component';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { Log } from '../../../core/log';
import { toSignal } from '@angular/core/rxjs-interop';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';
import { GlobalConfigService } from '../../config/global-config.service';
import { DEFAULT_GLOBAL_CONFIG } from '../../config/default-global-config.const';
import { DateTimeFormatService } from 'src/app/core/date-time-format/date-time-format.service';
import { RepeatTaskHeatmapComponent } from '../repeat-task-heatmap/repeat-task-heatmap.component';
import { CollapsibleComponent } from '../../../ui/collapsible/collapsible.component';
import { DialogScheduleTaskComponent } from '../../planner/dialog-schedule-task/dialog-schedule-task.component';
import { getDateTimeFromClockString } from '../../../util/get-date-time-from-clock-string';
import { remindOptionToMilliseconds } from '../../tasks/util/remind-option-to-milliseconds';
import { isValidSplitTime } from '../../../util/is-valid-split-time';
import { DateService } from '../../../core/date/date.service';

// Fields whose change requires offering "Update all task instances?" — covers
// what propagates to existing tasks (vs. schedule fields, which only affect
// future occurrences).
const RELEVANT_KEYS_FOR_UPDATE_ALL_TASKS: (keyof TaskRepeatCfgCopy)[] = [
  'title',
  'defaultEstimate',
  'remindAt',
  'startTime',
  'notes',
  'tagIds',
];

// A CUSTOM weekly recurrence with no weekday checked never produces an
// occurrence, so it must be blocked at save time (#8025).
const WEEKDAY_KEYS: (keyof TaskRepeatCfgCopy)[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

// TASK_REPEAT_CFG_FORM_CFG
@Component({
  selector: 'dialog-edit-task-repeat-cfg',
  templateUrl: './dialog-edit-task-repeat-cfg.component.html',
  styleUrls: ['./dialog-edit-task-repeat-cfg.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    TranslatePipe,
    MatDialogContent,
    FormlyModule,
    ChipListInputComponent,
    MatDialogActions,
    MatButton,
    MatIcon,
    RepeatTaskHeatmapComponent,
    CollapsibleComponent,
  ],
})
export class DialogEditTaskRepeatCfgComponent {
  private _globalConfigService = inject(GlobalConfigService);
  private _tagService = inject(TagService);
  private _dateService = inject(DateService);

  plannedStartDateStr = computed(() => {
    const d = this.repeatCfg().startDate;
    if (!d) return this._translateService.instant(T.F.TASK_REPEAT.F.START_DATE);
    const date = dateStrToUtcDate(d);
    const locale = this._dateTimeFormatService.currentLocale();
    const time = this.repeatCfg().startTime;
    if (time && isValidSplitTime(time)) {
      const formattedDate = date.toLocaleDateString(locale, {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
      const [hours, minutes] = time.split(':').map(Number);
      const safeTimeDate = new Date(2000, 0, 1, hours, minutes, 0, 0);
      const formattedTime = this._dateTimeFormatService.formatTime(
        safeTimeDate.getTime(),
        locale,
      );
      return `${formattedDate}, ${formattedTime}`;
    }
    return date.toLocaleDateString(locale, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  });

  openScheduleDialog(): void {
    const currentCfg = this.repeatCfg();
    const dummyTask: TaskCopy = {
      title: currentCfg.title || '',
      dueDay: currentCfg.startDate || undefined,
      dueWithTime: undefined,
      remindAt: undefined,
      timeEstimate: 0,
      timeSpent: 0,
      subTaskIds: [],
      isDone: false,
      projectId: '',
      timeSpentOnDay: {},
      attachments: [],
      tagIds: [],
      created: Date.now(),
    } as unknown as TaskCopy;

    const defaultRemindOption =
      this._data.defaultRemindOption ??
      this._globalConfigService.cfg()?.reminder.defaultTaskRemindOption ??
      DEFAULT_GLOBAL_CONFIG.reminder.defaultTaskRemindOption!;
    const remindAt =
      currentCfg.remindAt !== undefined ? currentCfg.remindAt : defaultRemindOption;

    const hasValidTime = !!currentCfg.startTime && isValidSplitTime(currentCfg.startTime);

    if (currentCfg.startDate && hasValidTime) {
      const dt = getDateTimeFromClockString(
        currentCfg.startTime!,
        dateStrToUtcDate(currentCfg.startDate),
      );
      dummyTask.dueWithTime = dt;
      if (remindAt && remindAt !== TaskReminderOptionId.DoNotRemind) {
        dummyTask.remindAt = remindOptionToMilliseconds(dt, remindAt);
      }
    }

    this._matDialog
      .open(DialogScheduleTaskComponent, {
        autoFocus: false,
        data: {
          task: dummyTask,
          isSelectDueOnly: true,
          showQuickAccess: true,
          isSubmitOnQuickAccess: false,
          targetDay: currentCfg.startDate || undefined,
          targetTime: hasValidTime ? currentCfg.startTime : undefined,
          minDate: this.isEdit() ? null : this._getReferenceDate(),
        },
      })
      .afterClosed()
      .subscribe((result) => {
        if (result) {
          const newDateStr = getDbDateStr(result.date);
          const hasTime = !!result.time && isValidSplitTime(result.time);
          this.repeatCfg.update((cfg) => ({
            ...cfg,
            startDate: newDateStr,
            startTime: result.time || undefined,
            remindAt: hasTime ? result.remindOption || undefined : undefined,
          }));
        }
      });
  }

  private _taskRepeatCfgService = inject(TaskRepeatCfgService);
  private _matDialog = inject(MatDialog);
  private _matDialogRef =
    inject<MatDialogRef<DialogEditTaskRepeatCfgComponent>>(MatDialogRef);
  private _translateService = inject(TranslateService);
  private _dateTimeFormatService = inject(DateTimeFormatService);
  private _data = inject<{
    task?: Task;
    repeatCfg?: TaskRepeatCfg;
    targetDate?: string;
    defaultRemindOption?: TaskReminderOptionId;
  }>(MAT_DIALOG_DATA);

  T: typeof T = T;
  isHeatmapExpanded = false;

  repeatCfgInitial = signal<TaskRepeatCfgCopy | undefined>(undefined);
  repeatCfg = signal<Omit<TaskRepeatCfgCopy, 'id'> | TaskRepeatCfg>(
    this._initializeRepeatCfg(),
  );
  isLoading = signal<boolean>(false);
  isEdit = computed(() => {
    if (this._data.repeatCfg) return true;
    if (this._data.task?.repeatCfgId) return true;
    return false;
  });

  // A CUSTOM weekly config with zero weekdays selected would never recur;
  // surface it as a blocking validation error (#8025). Derived from the
  // `repeatCfg` signal so it re-evaluates on every checkbox toggle.
  isWeekdaySelectionInvalid = computed(() => {
    const cfg = this.repeatCfg();
    if (cfg.quickSetting !== 'CUSTOM' || cfg.repeatCycle !== 'WEEKLY') {
      return false;
    }
    return !WEEKDAY_KEYS.some((day) => cfg[day]);
  });

  repeatCfgId = computed(() => {
    const cfg = this.repeatCfg();
    if ('id' in cfg && cfg.id) {
      return cfg.id;
    }
    return this._data.repeatCfg?.id || this._data.task?.repeatCfgId || null;
  });

  essentialFormFields = signal<FormlyFieldConfig[]>([]);
  advancedFormFields = signal<FormlyFieldConfig[]>(TASK_REPEAT_CFG_ADVANCED_FORM_CFG);

  formGroup1 = signal(new UntypedFormGroup({}));
  formGroup2 = signal(new UntypedFormGroup({}));
  tagSuggestions = toSignal(this._tagService.tagsNoMyDayAndNoList$, { initialValue: [] });
  canRemoveInstance = signal<boolean>(false);
  skipInstanceButtonText = computed(() => {
    if (!this._data.targetDate) {
      return this._translateService.instant(T.F.TASK_REPEAT.F.SKIP_INSTANCE);
    }

    // Format date using same logic as ShortDate2Pipe
    const date = isDBDateStr(this._data.targetDate)
      ? dateStrToUtcDate(this._data.targetDate)
      : new Date(this._data.targetDate);

    const formattedDate = formatMonthDay(
      date,
      this._dateTimeFormatService.currentLocale(),
    );

    return this._translateService.instant(T.F.TASK_REPEAT.F.SKIP_FOR_DATE, {
      date: formattedDate,
    });
  });

  constructor() {
    // Initialize form config
    this._initializeFormConfig();

    // Set up effect to load task repeat config if editing
    effect(() => {
      if (this.isEdit() && this._data.task?.repeatCfgId) {
        this.isLoading.set(true);
        this._taskRepeatCfgService
          .getTaskRepeatCfgByIdAllowUndefined$(this._data.task.repeatCfgId)
          .pipe(first())
          .subscribe((cfg) => {
            // Repeat config was deleted (e.g. via cross-client sync) but the task
            // still references it — abort editing instead of crashing. (#8715)
            if (!cfg) {
              this.isLoading.set(false);
              this.close();
              return;
            }
            this._setRepeatCfgInitiallyForEditOnly(cfg);
            this._checkCanRemoveInstance();
            this.isLoading.set(false);
          });
      }
      this._checkCanRemoveInstance();
    });
  }

  private _initializeRepeatCfg(): Omit<TaskRepeatCfgCopy, 'id'> | TaskRepeatCfg {
    if (this._data.repeatCfg) {
      // Process the repeat config to determine if quickSetting needs to be changed to CUSTOM
      const processedCfg = this._processQuickSettingForDate({ ...this._data.repeatCfg });
      if (processedCfg.startTime && processedCfg.remindAt === undefined) {
        processedCfg.remindAt =
          this._data.defaultRemindOption ??
          this._globalConfigService.cfg()?.reminder.defaultTaskRemindOption ??
          DEFAULT_GLOBAL_CONFIG.reminder.defaultTaskRemindOption!;
      }

      // Set initial value for comparison
      this.repeatCfgInitial.set({ ...this._data.repeatCfg });
      return processedCfg;
    } else if (this._data.task) {
      const startTime = this._data.task.dueWithTime
        ? clockStringFromDate(this._data.task.dueWithTime)
        : undefined;
      return {
        ...DEFAULT_TASK_REPEAT_CFG,
        startDate:
          this._data.task.dueDay ??
          getDbDateStr(this._data.task.dueWithTime || undefined),
        startTime,
        remindAt: startTime
          ? (this._data.defaultRemindOption ??
            this._globalConfigService.cfg()?.reminder.defaultTaskRemindOption ??
            DEFAULT_GLOBAL_CONFIG.reminder.defaultTaskRemindOption!)
          : undefined,
        shouldInheritSubtasks: this._data.task.subTaskIds.length > 0,
        title: this._data.task.title,
        notes: this._data.task.notes || undefined,
        tagIds: unique(this._data.task.tagIds),
        defaultEstimate: this._data.task.timeEstimate,
      };
    } else {
      throw new Error('Invalid params given for repeat dialog!');
    }
  }

  private _initializeFormConfig(): void {
    const translateService = this._translateService;

    const buildOptions = (refDate: Date): { value: string; label: string }[] =>
      // Read currentLocale() reactively each time options are built so the
      // correct locale is used even when the config store hasn't emitted yet
      // at construction time (previously captured once as a const → en-GB).
      buildRepeatQuickSettingOptions(
        refDate,
        this._dateTimeFormatService.currentLocale(),
        translateService,
      );

    const formConfig = TASK_REPEAT_CFG_ESSENTIAL_FORM_CFG.map((field) => ({
      ...field,
    }));

    // Clamp logic for startDate is now handled reactively by calendarMinDate signal

    // Deep-clone the quickSetting field to avoid mutating the shared constant
    const quickSettingIdx = formConfig.findIndex((f) => f.key === 'quickSetting');
    if (quickSettingIdx === -1) {
      throw new Error(
        'quickSetting field not found in TASK_REPEAT_CFG_ESSENTIAL_FORM_CFG',
      );
    }
    const quickSettingField: FormlyFieldConfig = {
      ...formConfig[quickSettingIdx],
      templateOptions: { ...formConfig[quickSettingIdx].templateOptions },
    };
    formConfig[quickSettingIdx] = quickSettingField;

    // Set initial options
    quickSettingField.templateOptions!.options = buildOptions(this._getReferenceDate());

    // Memoize to avoid rebuilding options on every formly change cycle
    let lastStartDate: string | undefined;
    let lastLocale: string | undefined;
    let cachedOptions: { value: string; label: string }[];

    // Update options reactively when startDate or locale changes
    quickSettingField.expressionProperties = {
      ...quickSettingField.expressionProperties,
      ['templateOptions.options']: (model: Record<string, unknown>) => {
        const sd = model['startDate'] as string | undefined;
        const currentLocale = this._dateTimeFormatService.currentLocale();
        if (sd !== lastStartDate || currentLocale !== lastLocale || !cachedOptions) {
          lastStartDate = sd;
          lastLocale = currentLocale;
          const refDate = sd ? dateStrToUtcDate(sd) : this._getReferenceDate();
          cachedOptions = buildOptions(refDate);
        }
        return cachedOptions;
      },
    };

    this.essentialFormFields.set(formConfig);
  }

  save(): void {
    const formGroup1 = this.formGroup1();
    const formGroup2 = this.formGroup2();

    // Check if both forms are valid
    if (!formGroup1.valid || !formGroup2.valid) {
      // Mark all fields as touched to show validation errors
      formGroup1.markAllAsTouched();
      formGroup2.markAllAsTouched();
      Log.err('Form validation failed', {
        form1Errors: formGroup1.errors,
        form2Errors: formGroup2.errors,
      });
      return;
    }

    // Enter-key submit bypasses the disabled Save button, so re-check here (#8025).
    if (this.isWeekdaySelectionInvalid()) {
      return;
    }

    const currentRepeatCfg = this.repeatCfg();

    // workaround for formly not always updating hidden fields correctly (in time??)
    if (currentRepeatCfg.quickSetting !== 'CUSTOM') {
      // Pass startDate to use correct weekday for WEEKLY_CURRENT_WEEKDAY (fixes #5806)
      const referenceDate = currentRepeatCfg.startDate
        ? dateStrToUtcDate(currentRepeatCfg.startDate)
        : undefined;
      const updatesForQuickSetting = getQuickSettingUpdates(
        currentRepeatCfg.quickSetting,
        referenceDate,
      );
      if (updatesForQuickSetting) {
        this.repeatCfg.update((cfg) => ({ ...cfg, ...updatesForQuickSetting }));
      }
    }

    // Normalize the monthly anchor fields at the boundary: convert the form's
    // `null` sentinel to `undefined`, and strip a stale `monthlyLastDay` flag.
    const finalRepeatCfg = this._normalizeMonthlyAnchor(this.repeatCfg());

    if (this.isEdit()) {
      const initial = this.repeatCfgInitial();
      if (!initial) {
        throw new Error('Initial task repeat cfg missing (code error)');
      }
      // Pass only the fields that actually changed. Sending the whole config
      // would make rescheduleTaskOnRepeatCfgUpdate$ fire on every save (its
      // filter checks `field in changes`), pushing today's task to tomorrow
      // when only the time was edited (issue #7373).
      const changes = getTaskRepeatCfgChanges(initial, finalRepeatCfg);
      const isRelevantChangesForUpdateAllTasks = RELEVANT_KEYS_FOR_UPDATE_ALL_TASKS.some(
        (k) => k in changes,
      );

      this._taskRepeatCfgService.updateTaskRepeatCfg(
        exists((finalRepeatCfg as TaskRepeatCfg).id),
        changes,
        isRelevantChangesForUpdateAllTasks,
      );
      this.close();
    } else {
      this._taskRepeatCfgService.addTaskRepeatCfgToTask(
        (this._data.task as Task).id,
        (this._data.task as Task).projectId || null,
        finalRepeatCfg,
      );
      this.close();
    }
  }

  private _normalizeMonthlyAnchor<
    T extends {
      monthlyWeekOfMonth?: unknown;
      monthlyLastDay?: boolean;
      quickSetting?: string;
    },
  >(cfg: T): T {
    let result = cfg;
    // The form uses `null` as the "(Day of month)" sentinel on the
    // monthlyWeekOfMonth select. Persisted cfgs use `undefined` for absent
    // optional fields (project convention). Normalizing here keeps existing
    // day-of-month cfgs from producing spurious change diffs.
    if (result.monthlyWeekOfMonth === null) {
      result = { ...result, monthlyWeekOfMonth: undefined };
    }
    // `monthlyLastDay` has no CUSTOM-mode form control, so a flag left over
    // from the MONTHLY_LAST_DAY preset would silently override the
    // day-of-month a CUSTOM cfg shows. It is only ever valid for that
    // preset — strip it for any other quick setting (#7726).
    if (result.monthlyLastDay && result.quickSetting !== 'MONTHLY_LAST_DAY') {
      result = { ...result, monthlyLastDay: undefined };
    }
    return result;
  }

  remove(): void {
    const currentRepeatCfg = this.repeatCfg();
    this._taskRepeatCfgService.deleteTaskRepeatCfgWithDialog(
      exists((currentRepeatCfg as TaskRepeatCfg).id),
    );
    this.close();
  }

  deleteInstance(): void {
    if (!this._data.targetDate || !this.canRemoveInstance()) {
      return;
    }

    const currentRepeatCfg = this.repeatCfg() as TaskRepeatCfg;
    const targetDate = this._data.targetDate;

    this._matDialog
      .open(DialogConfirmComponent, {
        restoreFocus: true,
        data: {
          message: this._translateService.instant(T.F.TASK_REPEAT.D_SKIP_INSTANCE.MSG, {
            date: new Date(targetDate).toLocaleDateString(
              this._dateTimeFormatService.currentLocale(),
            ),
          }),
          okTxt: this._translateService.instant(T.F.TASK_REPEAT.D_SKIP_INSTANCE.OK),
        },
      })
      .afterClosed()
      .subscribe((isConfirm: boolean) => {
        if (isConfirm) {
          this._taskRepeatCfgService.deleteTaskRepeatCfgInstance(
            exists(currentRepeatCfg.id),
            targetDate,
          );
          this.close();
        }
      });
  }

  close(): void {
    this._matDialogRef.close();
  }

  addTag(id: string): void {
    this.repeatCfg.update((cfg) => ({
      ...cfg,
      tagIds: unique([...cfg.tagIds, id]),
    }));
  }

  addNewTag(title: string): void {
    const id = this._tagService.addTag({ title });
    this.repeatCfg.update((cfg) => ({
      ...cfg,
      tagIds: unique([...cfg.tagIds, id]),
    }));
  }

  removeTag(id: string): void {
    this.repeatCfg.update((cfg) => ({
      ...cfg,
      tagIds: cfg.tagIds.filter((tagId) => tagId !== id),
    }));
  }

  private _setRepeatCfgInitiallyForEditOnly(repeatCfg: TaskRepeatCfg): void {
    const processedCfg = this._processQuickSettingForDate(repeatCfg);
    this.repeatCfg.set(processedCfg);
    this.repeatCfgInitial.set({ ...repeatCfg });
  }

  private _getReferenceDate(): Date {
    if (this._data.task?.dueDay) {
      return dateStrToUtcDate(this._data.task.dueDay);
    }
    if (this._data.repeatCfg?.startDate) {
      return dateStrToUtcDate(this._data.repeatCfg.startDate);
    }
    const d = this._dateService.getLogicalTodayDate();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private _processQuickSettingForDate<
    TCfg extends { quickSetting?: string; startDate?: string },
  >(cfg: TCfg): TCfg {
    const SETTINGS_WITHOUT_START_DATE = new Set(['DAILY', 'MONDAY_TO_FRIDAY', 'CUSTOM']);
    if (cfg.quickSetting && !SETTINGS_WITHOUT_START_DATE.has(cfg.quickSetting)) {
      if (!cfg.startDate) {
        return { ...cfg, quickSetting: 'CUSTOM' };
      }
    }
    return cfg;
  }

  private _checkCanRemoveInstance(): void {
    if (!this._data.targetDate) {
      this.canRemoveInstance.set(false);
      return;
    }
    const todayStr = this._dateService.todayStr();
    const isTargetTodayOrPast = this._data.targetDate <= todayStr;
    this.canRemoveInstance.set(!isTargetTodayOrPast);
  }
}
