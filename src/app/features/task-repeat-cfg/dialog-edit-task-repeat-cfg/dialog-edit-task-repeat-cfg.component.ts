import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
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
  RepeatQuickSetting,
  TaskRepeatCfg,
  TaskRepeatCfgCopy,
} from '../task-repeat-cfg.model';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { UntypedFormGroup } from '@angular/forms';
import {
  TASK_REPEAT_CFG_ADVANCED_FORM_CFG,
  TASK_REPEAT_CFG_BEHAVIOUR_FORM_CFG,
  withRepeatCycleUnits,
  withWeekdayShortLabels,
  TASK_REPEAT_CFG_END_FORM_CFG,
  TASK_REPEAT_CFG_ESSENTIAL_FORM_CFG,
} from './task-repeat-cfg-form.const';
import { buildRepeatQuickSettingOptions } from './build-repeat-quick-setting-options';
import { IconSelectOption } from '../../../ui/formly-icon-select/formly-icon-select.component';
import { T } from '../../../t.const';
import { TagService } from '../../tag/tag.service';
import { unique } from '../../../util/unique';
import { exists } from '../../../util/exists';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { getDbDateStr, isDBDateStr } from '../../../util/get-db-date-str';
import { formatMonthDay } from '../../../util/format-month-day.util';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { getDeadlineOffsetDays } from '../store/get-repeat-deadline-day.util';
import { first } from 'rxjs/operators';
import { getQuickSettingUpdates } from './get-quick-setting-updates';
import { getDefaultSkipOverdue } from './get-default-skip-overdue';
import { getTaskRepeatCfgChanges } from './get-task-repeat-cfg-changes';
import { clockStringFromDate } from '../../../ui/duration/clock-string-from-date';
import { ChipListInputComponent } from '../../../ui/chip-list-input/chip-list-input.component';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatFormField, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
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
import { TASK_REMINDER_OPTIONS_WITHOUT_LONG_LEAD } from '../../planner/dialog-schedule-task/task-reminder-options.const';
import { getRepeatDueWithTime } from '../store/get-repeat-due-with-time.util';
import { remindOptionToMilliseconds } from '../../tasks/util/remind-option-to-milliseconds';
import { isValidSplitTime } from '../../../util/is-valid-split-time';
import { DateService } from '../../../core/date/date.service';
import { MAT_SELECT_CONFIG } from '@angular/material/select';
import { getNextCreatedOccurrence } from '../store/get-next-created-occurrence.util';
import { getNewestPossibleDueDate } from '../store/get-newest-possible-due-date.util';
import { SCHEDULE_AFFECTING_FIELDS } from '../store/schedule-affecting-fields.const';
import { getTaskPriority } from '../../tasks/task-priority.const';
import {
  AFTER_COMPLETION_PRESET,
  AfterCompletionModeState,
  isCustomOrAfterCompletionPreset,
  keepUneditedAfterCompletionSchedule,
  RepeatCfgFormModel,
  syncAfterCompletionMode,
  toRepeatCfgFormModel,
  toStoredRepeatCfg,
} from './after-completion-form-mapping';
import { getResumeCursorChanges } from './get-resume-cursor-changes';
import { getRulePreviewDates } from './get-rule-preview-dates';
import { getRuleSentence } from './get-rule-sentence';
import { getTaskRepeatInfoText } from '../../tasks/task-detail-panel/get-task-repeat-info-text.util';
import {
  FallBehindChoice,
  fromFallBehindChoice,
  toFallBehindChoice,
} from './fall-behind-choice';

type StoredRepeatCfg = Omit<TaskRepeatCfgCopy, 'id'> | TaskRepeatCfg;
// The dialog's model may carry the dialog-only "After I complete it…" preset
// and "If you fall behind" choice; _getFinalRepeatCfg turns it back into a
// persistable config.
type RepeatCfgModel = (
  | RepeatCfgFormModel<Omit<TaskRepeatCfgCopy, 'id'>>
  | RepeatCfgFormModel<TaskRepeatCfg>
) & { fallBehind?: FallBehindChoice };

const FALL_BEHIND_HINTS: Record<FallBehindChoice, string> = {
  KEEP: T.F.TASK_REPEAT.F.FALL_BEHIND_KEEP_HINT,
  LATEST: T.F.TASK_REPEAT.F.FALL_BEHIND_LATEST_HINT,
  WAIT: T.F.TASK_REPEAT.F.FALL_BEHIND_WAIT_HINT,
};

const FALL_BEHIND_SUMMARY: Record<FallBehindChoice, string> = {
  KEEP: T.F.TASK_REPEAT.D_EDIT.RULE_KEEPS_EVERY_COPY,
  LATEST: T.F.TASK_REPEAT.D_EDIT.RULE_ONLY_LATEST,
  WAIT: T.F.TASK_REPEAT.D_EDIT.RULE_WAITS,
};

const withFallBehind = <TModel extends RepeatCfgModel>(
  model: TModel,
): TModel & { fallBehind: FallBehindChoice } => ({
  ...model,
  fallBehind: toFallBehindChoice(model),
});

// Fields whose change requires offering "Update all task instances?" — covers
// what propagates to existing tasks (vs. schedule fields, which only affect
// future occurrences).
const RELEVANT_KEYS_FOR_UPDATE_ALL_TASKS: (keyof TaskRepeatCfgCopy)[] = [
  'title',
  'defaultEstimate',
  'priority',
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

// Unsaved edits to these would move the next occurrence. quickSetting is only
// expanded into the pattern fields on save, repeatFromCompletionDate moves the
// anchor and repeatUntilDay can leave no next occurrence, so they count here
// although the reschedule effect ignores them.
const NEXT_OCCURRENCE_FIELDS: (keyof TaskRepeatCfgCopy)[] = [
  ...SCHEDULE_AFFECTING_FIELDS,
  'quickSetting',
  'repeatFromCompletionDate',
  'repeatUntilDay',
];

interface RuleSummary {
  /** The rule as a sentence, read to screen readers when `line` lacks it. */
  rule: string;
  fallsOn: string | null;
  /** The visible line, or null when the fields above say it all. */
  line: string | null;
}

// TASK_REPEAT_CFG_FORM_CFG
@Component({
  selector: 'dialog-edit-task-repeat-cfg',
  templateUrl: './dialog-edit-task-repeat-cfg.component.html',
  styleUrls: ['./dialog-edit-task-repeat-cfg.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: MAT_SELECT_CONFIG,
      useValue: { canSelectNullableOptions: true },
    },
  ],
  imports: [
    MatDialogTitle,
    TranslatePipe,
    MatDialogContent,
    FormlyModule,
    ChipListInputComponent,
    MatDialogActions,
    MatButton,
    MatIconButton,
    MatFormField,
    MatLabel,
    MatSuffix,
    MatInput,
    MatIcon,
    RepeatTaskHeatmapComponent,
    CollapsibleComponent,
  ],
})
export class DialogEditTaskRepeatCfgComponent {
  private _globalConfigService = inject(GlobalConfigService);
  private _tagService = inject(TagService);
  private _dateService = inject(DateService);
  private _elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private _injector = inject(Injector);
  private _document = inject(DOCUMENT);

  plannedStartDateStr = computed(() => {
    const d = this.repeatCfg().startDate;
    // The field's label already names it.
    if (!d) return '';
    const date = dateStrToUtcDate(d);
    // Spelled-out weekday/month names follow the UI language under the ISO 8601
    // option (the `sv` sentinel would otherwise leak Swedish, e.g. "ons 15 juli
    // 2026"). The clock time below keeps currentLocale() so 24h is preserved.
    // The year only when it isn't this one, so date and time fit beside "Ends on".
    const formattedDate = date.toLocaleDateString(
      this._dateTimeFormatService.textLocale(),
      {
        weekday: 'short',
        year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
        month: 'short',
        day: 'numeric',
      },
    );
    const time = this.repeatCfg().startTime;
    if (time && isValidSplitTime(time)) {
      const [hours, minutes] = time.split(':').map(Number);
      const safeTimeDate = new Date(2000, 0, 1, hours, minutes, 0, 0);
      const formattedTime = this._dateTimeFormatService.formatTime(
        safeTimeDate.getTime(),
        this._dateTimeFormatService.currentLocale(),
      );
      return `${formattedDate}, ${formattedTime}`;
    }
    return formattedDate;
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
      const dt = getRepeatDueWithTime(
        currentCfg.startTime!,
        dateStrToUtcDate(currentCfg.startDate),
        this._dateService.getStartOfNextDayDiffMs(),
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
          reminderOptions: TASK_REMINDER_OPTIONS_WITHOUT_LONG_LEAD,
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
    initialStartDate?: string;
    defaultRemindOption?: TaskReminderOptionId;
    isRemoveConfirmationRequired?: boolean;
  }>(MAT_DIALOG_DATA);

  T: typeof T = T;
  isHeatmapExpanded = false;

  repeatCfgInitial = signal<TaskRepeatCfgCopy | undefined>(undefined);
  repeatCfg = signal<RepeatCfgModel>(this._initializeRepeatCfg());
  // Preset and after-completion flag before the latest form change. Formly writes into
  // the model object it was given, so the previous signal value can't be used.
  private _modeSnapshot: AfterCompletionModeState = this._toModeState(this.repeatCfg());
  private _fallBehindSnapshot = this.repeatCfg().fallBehind;
  // Waiting behaviour to restore when the user leaves "After I complete it…":
  // the latest one of a fixed schedule, none for a config that opened as after
  // completion (where waiting was implied).
  private _fixedWaitForCompletion = this._toFixedWaitForCompletion(this.repeatCfg());
  // Until the user picks a choice, a new config follows the schedule's default.
  private _isFallBehindTouched = false;
  isAfterCompletion = computed(
    () => this.repeatCfg().quickSetting === AFTER_COMPLETION_PRESET,
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

  // Computed from the saved config, like the recurring overview's "Next" tooltip.
  // Unsaved schedule edits are applied by the reschedule effect on save, which
  // can also relocate the live instance, so no date is shown for them.
  nextOccurrenceText = computed<string | null>(() => {
    const saved = this.repeatCfgInitial();
    const cfg = this.repeatCfg();
    if (!this.isEdit() || !saved || cfg.isPaused) {
      return null;
    }
    if (this.hasUnsavedScheduleChanges()) {
      return this._translateService.instant(
        T.F.TASK_REPEAT.D_EDIT.NEXT_OCCURRENCE_UNSAVED,
      );
    }
    const now = new Date();
    // After completion also waits, but completing re-anchors the schedule
    // instead of releasing a held-back copy (updateStartDateOnComplete$).
    if (cfg.waitForCompletion && !cfg.repeatFromCompletionDate) {
      // An occurrence that is already due is held back until the live instance
      // is done and is created at that moment, so its date is not predictable.
      const due = getNewestPossibleDueDate(saved as TaskRepeatCfg, now);
      if (due && !saved.deletedInstanceDates?.includes(getDbDateStr(due))) {
        return this._translateService.instant(
          T.F.TASK_REPEAT.D_EDIT.NEXT_OCCURRENCE_AFTER_COMPLETION,
        );
      }
    }
    const next = getNextCreatedOccurrence(saved as TaskRepeatCfg, now);
    if (!next) {
      return null;
    }
    const date = next.toLocaleDateString(this._dateTimeFormatService.textLocale(), {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    const key = cfg.repeatFromCompletionDate
      ? T.F.TASK_REPEAT.D_EDIT.NEXT_OCCURRENCE_FROM_COMPLETION
      : cfg.waitForCompletion
        ? T.F.TASK_REPEAT.D_EDIT.NEXT_OCCURRENCE_WAIT_FOR_COMPLETION
        : T.F.TASK_REPEAT.D_EDIT.NEXT_OCCURRENCE;
    return this._translateService.instant(key, { date });
  });

  // What the rule means, below the start and end dates. Only shown when it says
  // more than the preset label does. `rule` is the sentence; `line` is what is
  // shown: the dates and any non-default policy, or the sentence itself when
  // there are no dates (the fields above already say it otherwise).
  ruleSummary = computed<RuleSummary | null>(() => {
    const model = this.repeatCfg();
    const cfg = this._getPreviewRepeatCfg();
    const isAfterCompletion = model.quickSetting === AFTER_COMPLETION_PRESET;
    const choice = toFallBehindChoice(cfg);
    const defaultChoice: FallBehindChoice = getDefaultSkipOverdue(cfg)
      ? 'LATEST'
      : 'KEEP';
    const isNonDefaultPolicy = !isAfterCompletion && choice !== defaultChoice;
    const isShown =
      isCustomOrAfterCompletionPreset(model.quickSetting) ||
      !!cfg.repeatUntilDay ||
      isNonDefaultPolicy ||
      cfg.isPaused;
    // Not for input the form rejects, e.g. "Every 0 days".
    const isEveryValid = Number.isInteger(cfg.repeatEvery) && cfg.repeatEvery >= 1;
    if (!isShown || !isEveryValid || this.isWeekdaySelectionInvalid()) {
      return null;
    }
    const translate = this._translateService;
    // A full sentence where the shared chip text is shorthand ("Mo, We").
    const ruleStr =
      getRuleSentence(cfg, this._dateTimeFormatService, translate) ??
      translate.instant(
        ...getTaskRepeatInfoText(
          cfg,
          this._dateTimeFormatService.currentLocale(),
          this._dateTimeFormatService,
          translate,
        ),
      );
    // Paused keeps the rule in view, so resuming needs no guessing.
    const policyKey = cfg.isPaused
      ? T.F.TASK_REPEAT.D_EDIT.RULE_PAUSED
      : isNonDefaultPolicy
        ? FALL_BEHIND_SUMMARY[choice]
        : null;
    const withPolicy = (str: string): string =>
      policyKey
        ? translate.instant(T.F.TASK_REPEAT.D_EDIT.RULE_WITH_POLICY, {
            ruleStr: str,
            policyStr: translate.instant(policyKey),
          })
        : str;
    if (cfg.isPaused) {
      return { rule: ruleStr, fallsOn: null, line: withPolicy(ruleStr) };
    }

    // After completion has no fixed dates; every single day needs no list.
    const isPlainDaily = cfg.repeatCycle === 'DAILY' && cfg.repeatEvery === 1;
    const dates =
      isAfterCompletion || isPlainDaily
        ? []
        : getRulePreviewDates(cfg, this._getPreviewStartDate(), !this.isEdit());
    // With the year once a date leaves this one, or yearly rules read as the
    // same date three times.
    const thisYear = new Date().getFullYear();
    const isOtherYear = dates.some((date) => date.getFullYear() !== thisYear);
    const fallsOn = dates.length
      ? translate.instant(T.F.TASK_REPEAT.D_EDIT.RULE_FALLS_ON, {
          dates: dates
            .map((date) =>
              date.toLocaleDateString(this._dateTimeFormatService.textLocale(), {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                year: isOtherYear ? 'numeric' : undefined,
              }),
            )
            .join(' · '),
        })
      : null;
    // Without dates the sentence only repeats the fields, unless a policy
    // from the collapsed Options needs saying.
    const line = fallsOn ? withPolicy(fallsOn) : policyKey ? withPolicy(ruleStr) : null;
    return { rule: ruleStr, fallsOn, line };
  });

  hasUnsavedScheduleChanges = computed(() => {
    const saved = this.repeatCfgInitial();
    if (!saved) {
      return false;
    }
    const changes = getTaskRepeatCfgChanges(saved, this._getFinalRepeatCfg());
    return NEXT_OCCURRENCE_FIELDS.some((field) => field in changes);
  });

  inheritedSubtaskTitles = computed(() => {
    const cfg = this.repeatCfg();
    // Enabling inheritance replaces the templates on save with a snapshot of the
    // newest instance's subtasks, so the stored templates would be stale here.
    const saved = this.repeatCfgInitial();
    const isNewlyInherited = !!saved && !saved.shouldInheritSubtasks;
    return cfg.shouldInheritSubtasks && !isNewlyInherited
      ? (cfg.subTaskTemplates ?? []).map((subTask) => subTask.title)
      : [];
  });

  // The fields in dialog order: the rule, the end date beside the start date,
  // then in Options how the series behaves and what new copies get.
  essentialFormFields = signal<FormlyFieldConfig[]>([]);
  endFormFields = signal<FormlyFieldConfig[]>(TASK_REPEAT_CFG_END_FORM_CFG);
  behaviourFormFields = signal<FormlyFieldConfig[]>([]);
  advancedFormFields = signal<FormlyFieldConfig[]>(TASK_REPEAT_CFG_ADVANCED_FORM_CFG);

  formGroup1 = signal(new UntypedFormGroup({}));
  formGroup2 = signal(new UntypedFormGroup({}));
  formGroupEnd = signal(new UntypedFormGroup({}));
  formGroupBehaviour = signal(new UntypedFormGroup({}));
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

  /**
   * @param isBehaviourForm the emitting form holds "If you fall behind".
   */
  onModelChange(emitted: RepeatCfgModel, isBehaviourForm = false): void {
    // waitForCompletion and skipOverdue are no form control, and fallBehind is
    // one only in the behaviour form. Formly can emit a copy of its model that
    // predates the dialog's last adjustment (e.g. a second emission when a field
    // hides), so these come from the dialog's own state.
    const current = this.repeatCfg();
    const isStale =
      emitted.waitForCompletion !== current.waitForCompletion ||
      emitted.skipOverdue !== current.skipOverdue ||
      (!isBehaviourForm && emitted.fallBehind !== current.fallBehind);
    const model: RepeatCfgModel = isStale
      ? {
          ...emitted,
          waitForCompletion: current.waitForCompletion,
          skipOverdue: current.skipOverdue,
          fallBehind: isBehaviourForm ? emitted.fallBehind : current.fallBehind,
        }
      : emitted;
    let synced = syncAfterCompletionMode(
      this._modeSnapshot,
      model,
      this._fixedWaitForCompletion,
    );
    if (synced.fallBehind && synced.fallBehind !== this._fallBehindSnapshot) {
      this._isFallBehindTouched = true;
      synced = { ...synced, ...fromFallBehindChoice(synced.fallBehind) };
    } else if (
      !this._isFallBehindTouched &&
      !this.isEdit() &&
      synced.quickSetting !== AFTER_COMPLETION_PRESET
    ) {
      // Re-seed the schedule's default live while it is visible and untouched.
      const skipOverdue = getDefaultSkipOverdue(
        synced as Pick<TaskRepeatCfgCopy, 'quickSetting' | 'repeatCycle' | 'repeatEvery'>,
      );
      if (skipOverdue !== !!synced.skipOverdue) {
        synced = { ...synced, skipOverdue };
      }
    }
    if (synced.fallBehind !== toFallBehindChoice(synced)) {
      synced = withFallBehind(synced);
    }
    if (synced !== emitted) {
      this._keepFocusAcrossRebuild();
    }
    this._modeSnapshot = this._toModeState(synced);
    this._fallBehindSnapshot = synced.fallBehind;
    if (synced.quickSetting !== AFTER_COMPLETION_PRESET) {
      this._fixedWaitForCompletion = !!synced.waitForCompletion;
    }
    this.repeatCfg.set(synced);
  }

  /**
   * A model the dialog adjusted is a new object, so formly (extras.immutable)
   * rebuilds the fields and keyboard focus drops to <body>, e.g. after
   * switching the preset with the arrow keys. The new object is still
   * needed: fields that are no form control (waitForCompletion, skipOverdue)
   * only reach formly's own model copy that way. Formly keeps field ids across
   * rebuilds, so focus goes back to the element with the same id.
   */
  private _keepFocusAcrossRebuild(): void {
    const host = this._elementRef.nativeElement;
    const active = this._document.activeElement as HTMLElement | null;
    if (!active?.id || !host.contains(active)) {
      return;
    }
    const id = active.id;
    afterNextRender(
      () => {
        const el = host.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
        if (el && el !== this._document.activeElement) {
          el.focus();
        }
      },
      { injector: this._injector },
    );
  }

  private _initializeRepeatCfg(): RepeatCfgModel {
    if (this._data.repeatCfg) {
      // Process the repeat config to determine if quickSetting needs to be changed to CUSTOM
      const processedCfg = this._processQuickSettingForDate({ ...this._data.repeatCfg });
      processedCfg.priority = getTaskPriority(processedCfg.priority);
      if (processedCfg.startTime && processedCfg.remindAt === undefined) {
        processedCfg.remindAt =
          this._data.defaultRemindOption ??
          this._globalConfigService.cfg()?.reminder.defaultTaskRemindOption ??
          DEFAULT_GLOBAL_CONFIG.reminder.defaultTaskRemindOption!;
      }

      // Set initial value for comparison
      this.repeatCfgInitial.set({
        ...this._data.repeatCfg,
        priority: getTaskPriority(this._data.repeatCfg.priority),
      });
      return withFallBehind(toRepeatCfgFormModel(processedCfg));
    } else if (this._data.task) {
      const startTime = this._data.task.dueWithTime
        ? clockStringFromDate(this._data.task.dueWithTime)
        : undefined;
      const startOfNextDayDiffMs = this._dateService.getStartOfNextDayDiffMs();
      const startDate =
        this._data.initialStartDate ??
        this._data.task.dueDay ??
        // the logical day, so a late-night time keeps its night (#3378)
        (this._data.task.dueWithTime
          ? getDbDateStr(this._data.task.dueWithTime - startOfNextDayDiffMs)
          : this._dateService.todayStr());
      const deadlineDay =
        this._data.task.deadlineDay ??
        (this._data.task.deadlineWithTime
          ? getDbDateStr(this._data.task.deadlineWithTime - startOfNextDayDiffMs)
          : undefined);
      return withFallBehind({
        ...DEFAULT_TASK_REPEAT_CFG,
        // New configs open on the "Daily" quick setting, where collapsing empty
        // overdue instances is both useful and safe; see getDefaultSkipOverdue.
        // Re-derived from the final schedule on save in case the user switches.
        skipOverdue: getDefaultSkipOverdue(DEFAULT_TASK_REPEAT_CFG),
        startDate,
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
        priority: getTaskPriority(this._data.task.priority),
        // Keep the task's due→deadline gap for every occurrence (#10983).
        deadlineOffsetDays: getDeadlineOffsetDays(startDate, deadlineDay),
      });
    } else {
      throw new Error('Invalid params given for repeat dialog!');
    }
  }

  private _initializeFormConfig(): void {
    const translateService = this._translateService;

    const buildOptions = (refDate: Date): IconSelectOption[] => {
      // Read currentLocale() reactively each time options are built so the
      // correct locale is used even when the config store hasn't emitted yet
      // at construction time (previously captured once as a const → en-GB).
      // textLocale() localizes the spelled-out weekday name (UI language under
      // the ISO option), while numeric day/month keep currentLocale().
      const options: IconSelectOption[] = buildRepeatQuickSettingOptions(
        refDate,
        this._dateTimeFormatService.currentLocale(),
        translateService,
        this._dateTimeFormatService.textLocale(),
      );
      // Dialog-only entry (#5388), just above Custom. The add-task bar shares the
      // builder but has no after-completion flow, so it is added here.
      const customIdx = options.findIndex((o) => o.value === 'CUSTOM');
      options.splice(customIdx, 0, {
        value: AFTER_COMPLETION_PRESET,
        label: translateService.instant(T.F.TASK_REPEAT.F.Q_AFTER_COMPLETION),
        icon: 'task_alt',
      });
      return options;
    };

    // Making a task recurring keeps that task's title, so the field only shows
    // when editing a series: it is the one place to rename future copies, since
    // renaming a copy renames just that copy.
    const formConfig = TASK_REPEAT_CFG_ESSENTIAL_FORM_CFG.map((field) =>
      field.key === 'title' && !this.isEdit() ? { ...field, hide: true } : { ...field },
    );

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
    let lastLocaleKey: string | undefined;
    let cachedOptions: IconSelectOption[];

    // Update options when startDate or either locale changes. The key must track
    // textLocale, not just currentLocale: under the ISO option currentLocale()
    // stays 'sv' while textLocale() carries the UI language for the weekday
    // label. Those move independently — applyLanguageFromState$ deliberately
    // applies the UI language from remote sync too, so lng can change while this
    // dialog is open, shifting textLocale() with currentLocale() frozen at 'sv'.
    // A currentLocale-only key would serve a stale weekday label there.
    quickSettingField.expressionProperties = {
      ...quickSettingField.expressionProperties,
      ['templateOptions.options']: (model: Record<string, unknown>) => {
        const sd = model['startDate'] as string | undefined;
        const currentLocale = this._dateTimeFormatService.currentLocale();
        const textLocale = this._dateTimeFormatService.textLocale();
        const localeKey = `${currentLocale}|${textLocale}`;
        if (sd !== lastStartDate || localeKey !== lastLocaleKey || !cachedOptions) {
          lastStartDate = sd;
          lastLocaleKey = localeKey;
          const refDate = sd ? dateStrToUtcDate(sd) : this._getReferenceDate();
          cachedOptions = buildOptions(refDate);
        }
        return cachedOptions;
      },
    };

    this.essentialFormFields.set(
      withRepeatCycleUnits(
        withWeekdayShortLabels(formConfig, this._dateTimeFormatService.textLocale()),
        (key) => translateService.instant(key),
      ),
    );

    // The hint follows the picked "If you fall behind" option.
    this.behaviourFormFields.set(
      TASK_REPEAT_CFG_BEHAVIOUR_FORM_CFG.map((field) =>
        field.key === 'fallBehind'
          ? {
              ...field,
              expressionProperties: {
                ...field.expressionProperties,
                ['templateOptions.description']: (model: RepeatCfgModel) =>
                  translateService.instant(
                    FALL_BEHIND_HINTS[model.fallBehind ?? toFallBehindChoice(model)],
                  ),
              },
            }
          : field,
      ),
    );
  }

  areFormsValid(): boolean {
    return this._getFormGroups().every((formGroup) => formGroup.valid);
  }

  save(): void {
    if (!this.areFormsValid()) {
      // Mark all fields as touched to show validation errors
      this._getFormGroups().forEach((formGroup) => formGroup.markAllAsTouched());
      Log.err('Form validation failed', {
        formErrors: this._getFormGroups().map((formGroup) => formGroup.errors),
      });
      return;
    }

    // Enter-key submit bypasses the disabled Save button, so re-check here (#8025).
    if (this.isWeekdaySelectionInvalid()) {
      return;
    }

    const currentRepeatCfg = this.repeatCfg();

    // workaround for formly not always updating hidden fields correctly (in time??)
    if (!isCustomOrAfterCompletionPreset(currentRepeatCfg.quickSetting)) {
      // Pass startDate to use correct weekday for WEEKLY_CURRENT_WEEKDAY (fixes #5806)
      const referenceDate = currentRepeatCfg.startDate
        ? dateStrToUtcDate(currentRepeatCfg.startDate)
        : undefined;
      const updatesForQuickSetting = getQuickSettingUpdates(
        currentRepeatCfg.quickSetting as RepeatQuickSetting,
        referenceDate,
      );
      if (updatesForQuickSetting) {
        this.repeatCfg.update((cfg) => ({ ...cfg, ...updatesForQuickSetting }));
      }
    }

    const finalRepeatCfg = this._getFinalRepeatCfg();

    if (this.isEdit()) {
      const initial = this.repeatCfgInitial();
      if (!initial) {
        throw new Error('Initial task repeat cfg missing (code error)');
      }
      // Pass only the fields that actually changed. Sending the whole config
      // would make rescheduleTaskOnRepeatCfgUpdate$ fire on every save (its
      // filter checks `field in changes`), pushing today's task to tomorrow
      // when only the time was edited (issue #7373).
      const logicalYesterday = new Date(this._dateService.getLogicalTodayDate());
      logicalYesterday.setDate(logicalYesterday.getDate() - 1);
      const changes = {
        ...getTaskRepeatCfgChanges(initial, finalRepeatCfg),
        // Resuming must not add the dates missed while paused (same op).
        ...getResumeCursorChanges(
          initial,
          finalRepeatCfg,
          getDbDateStr(logicalYesterday),
        ),
      };
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
      // Seed skipOverdue from the FINAL schedule (the initial default assumed
      // Daily; the user may have switched to e.g. Monthly), the same default
      // "If you fall behind" shows while untouched. A picked choice is honoured.
      const newRepeatCfg = this._isFallBehindTouched
        ? finalRepeatCfg
        : { ...finalRepeatCfg, skipOverdue: getDefaultSkipOverdue(finalRepeatCfg) };
      const createdRepeatCfgId = this._taskRepeatCfgService.addTaskRepeatCfgToTask(
        (this._data.task as Task).id,
        (this._data.task as Task).projectId || null,
        newRepeatCfg,
      );
      this.close(createdRepeatCfgId);
    }
  }

  /**
   * The config as it will be stored: the dialog-only fields are dropped (the
   * fall-behind choice is already mapped onto waitForCompletion/skipOverdue)
   * or resolved (toStoredRepeatCfg), then the monthly anchor fields are normalized at the
   * boundary: the form's `null` sentinels (incl. a cleared end date) become
   * `undefined`, and a stale `monthlyLastDay` flag is stripped.
   */
  private _getFinalRepeatCfg(): StoredRepeatCfg {
    const model = { ...this.repeatCfg() };
    delete model.fallBehind;
    const initial = this.repeatCfgInitial();
    const stored = toStoredRepeatCfg(model) as StoredRepeatCfg;
    return this._normalizeMonthlyAnchor(
      initial
        ? keepUneditedAfterCompletionSchedule<StoredRepeatCfg>(
            initial,
            model as RepeatCfgFormModel<StoredRepeatCfg>,
            stored,
          )
        : stored,
    );
  }

  // An existing series already has today's copy (or skipped it), so its
  // preview starts tomorrow, in line with "Next new copy".
  private _getPreviewStartDate(): Date {
    const day = new Date(this._dateService.getLogicalTodayDate());
    if (this.isEdit()) {
      day.setDate(day.getDate() + 1);
    }
    return day;
  }

  // The final config with the preset expanded, as save() does, so the summary
  // describes the pattern fields a preset only writes on save.
  private _getPreviewRepeatCfg(): TaskRepeatCfg {
    const quickSetting = this.repeatCfg().quickSetting;
    const cfg = this._getFinalRepeatCfg();
    const presetUpdates = isCustomOrAfterCompletionPreset(quickSetting)
      ? undefined
      : getQuickSettingUpdates(
          quickSetting as RepeatQuickSetting,
          cfg.startDate ? dateStrToUtcDate(cfg.startDate) : undefined,
        );
    return { ...cfg, ...presetUpdates } as TaskRepeatCfg;
  }

  private _getFormGroups(): UntypedFormGroup[] {
    return [
      this.formGroup1(),
      this.formGroupEnd(),
      this.formGroupBehaviour(),
      this.formGroup2(),
    ];
  }

  private _toModeState(model: RepeatCfgModel): AfterCompletionModeState {
    return {
      quickSetting: model.quickSetting,
      repeatFromCompletionDate: model.repeatFromCompletionDate,
    };
  }

  private _toFixedWaitForCompletion(model: RepeatCfgModel): boolean {
    return model.quickSetting !== AFTER_COMPLETION_PRESET && !!model.waitForCompletion;
  }

  private _normalizeMonthlyAnchor<
    T extends {
      monthlyWeekOfMonth?: unknown;
      monthlyLastDay?: boolean;
      quickSetting?: string;
      repeatUntilDay?: string | null;
      deadlineOffsetDays?: number | null;
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
    // A cleared end-date picker can leave `null`; persist `undefined` so the
    // clear is sent via `clearedFields` (#10091).
    if (result.repeatUntilDay === null) {
      result = { ...result, repeatUntilDay: undefined };
    }
    // A cleared number input leaves `null`; the model only allows `undefined`.
    if (result.deadlineOffsetDays === null) {
      result = { ...result, deadlineOffsetDays: undefined };
    }
    return result;
  }

  remove(): void {
    const currentRepeatCfg = this.repeatCfg();
    const repeatCfgId = exists((currentRepeatCfg as TaskRepeatCfg).id);
    if (this._data.isRemoveConfirmationRequired !== false) {
      this._taskRepeatCfgService.deleteTaskRepeatCfgWithDialog(repeatCfgId);
    } else {
      this._taskRepeatCfgService.deleteTaskRepeatCfg(repeatCfgId);
    }
    this.close();
  }

  deleteInstance(): void {
    if (!this._data.targetDate || !this.canRemoveInstance()) {
      return;
    }

    const currentRepeatCfg = this.repeatCfg() as TaskRepeatCfg;
    const targetDate = this._data.targetDate;
    const confirmationDate = isDBDateStr(targetDate)
      ? dateStrToUtcDate(targetDate)
      : new Date(targetDate);

    this._matDialog
      .open(DialogConfirmComponent, {
        restoreFocus: true,
        data: {
          message: this._translateService.instant(T.F.TASK_REPEAT.D_SKIP_INSTANCE.MSG, {
            date: confirmationDate.toLocaleDateString(
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

  close(createdRepeatCfgId?: string): void {
    this._matDialogRef.close(createdRepeatCfgId);
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
    const normalizedCfg = { ...repeatCfg, priority: getTaskPriority(repeatCfg.priority) };
    const processedCfg = withFallBehind(
      toRepeatCfgFormModel(this._processQuickSettingForDate(normalizedCfg)),
    );
    this.repeatCfg.set(processedCfg);
    this._modeSnapshot = this._toModeState(processedCfg);
    this._fallBehindSnapshot = processedCfg.fallBehind;
    this._fixedWaitForCompletion = this._toFixedWaitForCompletion(processedCfg);
    this.repeatCfgInitial.set(normalizedCfg);
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
