import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Task, TaskReminderOptionId } from '../../tasks/task.model';
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
  QUICK_SETTING_PRESETS,
  TaskRepeatCfg,
  TaskRepeatCfgCopy,
  toSyncSafeQuickSetting,
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
import { SnackService } from '../../../core/snack/snack.service';
import {
  getFirstRRuleOccurrence,
  getRRuleOccurrencesInRange,
  isRRuleValid,
} from '../store/rrule-occurrence.util';
import { getEffectiveRepeatStartDate } from '../store/get-effective-repeat-start-date.util';
import { FREQ_TO_CYCLE, safeParseRRuleOptions } from '../util/rrule-parse.util';
import {
  getAlignedStartDate,
  legacyTaskRepeatCfgToRRule,
  rruleToLegacyTaskRepeatCfg,
} from '../util/legacy-cfg-to-rrule.util';
import { RruleBuilderComponent } from './rrule-builder/rrule-builder.component';
import { buildRRuleHumanizeOpts, getRRulePreview } from '../util/rrule-preview.util';
import { DatePipe } from '@angular/common';
import { clockStringFromDate } from '../../../ui/duration/clock-string-from-date';
import { ChipListInputComponent } from '../../../ui/chip-list-input/chip-list-input.component';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { Log } from '../../../core/log';
import { toSignal } from '@angular/core/rxjs-interop';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';
import { GlobalConfigService } from '../../config/global-config.service';
import { DEFAULT_GLOBAL_CONFIG } from '../../config/default-global-config.const';
import { DateTimeFormatService } from 'src/app/core/date-time-format/date-time-format.service';
import { RepeatTaskHeatmapComponent } from '../repeat-task-heatmap/repeat-task-heatmap.component';
import { CollapsibleComponent } from '../../../ui/collapsible/collapsible.component';
import { DateAdapter } from '@angular/material/core';
import { DayData, HeatmapViewData } from '../../../ui/heatmap/heatmap.component';
import { HeatmapSwitcherComponent } from '../../../ui/heatmap/heatmap-switcher.component';
import {
  buildHeatmapMonths,
  buildHeatmapWeeks,
  buildProjectionDayMap,
  heatmapOccurrenceTotal,
} from '../../../ui/heatmap/build-heatmap-data.util';

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

// The RRULE builder is a dedicated child component (rrule-builder) that owns its
// own form state and emits the assembled `rrule` string; the dialog only stores
// that string on the working cfg.
type RepeatCfgWorking = Omit<TaskRepeatCfgCopy, 'id'> | TaskRepeatCfg;

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
    MatIconButton,
    MatIcon,
    RepeatTaskHeatmapComponent,
    HeatmapSwitcherComponent,
    CollapsibleComponent,
    RruleBuilderComponent,
    DatePipe,
  ],
})
export class DialogEditTaskRepeatCfgComponent {
  private _globalConfigService = inject(GlobalConfigService);
  private _dateAdapter = inject(DateAdapter);
  private _tagService = inject(TagService);
  private _taskRepeatCfgService = inject(TaskRepeatCfgService);
  private _matDialog = inject(MatDialog);
  private _matDialogRef =
    inject<MatDialogRef<DialogEditTaskRepeatCfgComponent>>(MatDialogRef);
  private _translateService = inject(TranslateService);
  private _dateTimeFormatService = inject(DateTimeFormatService);
  private _snackService = inject(SnackService);
  private _data = inject<{
    task?: Task;
    repeatCfg?: TaskRepeatCfg;
    targetDate?: string;
    defaultRemindOption?: TaskReminderOptionId;
    /** Preselect a quick setting for a NEW cfg — e.g. the add-task-bar's
     *  "Custom recurring config" entry opens straight into the RRULE builder. */
    initialQuickSetting?: TaskRepeatCfgCopy['quickSetting'];
  }>(MAT_DIALOG_DATA);

  T: typeof T = T;
  // Optionally start with the Activity section open (Settings → Tasks).
  isHeatmapExpanded =
    !!this._globalConfigService.cfg()?.tasks?.isExpandActivityForRepeatEdit;

  repeatCfgInitial = signal<TaskRepeatCfgCopy | undefined>(undefined);
  repeatCfg = signal<RepeatCfgWorking>(this._initializeRepeatCfg());
  isLoading = signal<boolean>(false);
  isEdit = computed(() => {
    if (this._data.repeatCfg) return true;
    if (this._data.task?.repeatCfgId) return true;
    return false;
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

  // The RRULE builder (shown when quickSetting === 'RRULE') is a child component
  // with its own live preview; the dialog only needs to know when to render it.
  private _formValue = toSignal(this.formGroup1().valueChanges, {
    initialValue: null as { quickSetting?: string } | null,
  });
  isRRuleMode = computed(
    () => (this._formValue()?.quickSetting ?? this.repeatCfg().quickSetting) === 'RRULE',
  );
  // Live result/preview shown at the dialog bottom in RRULE mode. The builder
  // keeps `repeatCfg().rrule` up to date via onRRuleChange, so this stays live.
  private _humanize = buildRRuleHumanizeOpts(
    (k) => this._translateService.instant(k) as string,
  );
  rrulePreview = computed(() =>
    this.isRRuleMode()
      ? getRRulePreview(
          this.repeatCfg().rrule,
          this.repeatCfg().startDate,
          this._humanize,
        )
      : null,
  );

  // Togglable calendar (heatmap) preview of the next year's occurrences for the
  // live rule — built from the in-progress rrule, no saved cfg required (so it
  // works while authoring a brand-new recurrence).
  private readonly _PREVIEW_HEATMAP_DAYS = 365;
  showResultHeatmap = signal(false);
  // Year-window navigation: 0 = the next 365 days from today; ±n shifts the
  // window by whole years, unbounded in both directions (the projection is
  // computed per window, so any year is reachable).
  previewYearOffset = signal(0);
  previewPrevYear(): void {
    this.previewYearOffset.update((o) => o - 1);
  }
  previewNextYear(): void {
    this.previewYearOffset.update((o) => o + 1);
  }
  previewNavLabel = computed(() => {
    const hd = this.resultHeatmapData();
    if (!hd) {
      return '';
    }
    const a = hd.rangeStart.getFullYear();
    const b = hd.rangeEnd.getFullYear();
    return a === b ? `${a}` : `${a} – ${b}`;
  });
  // The month view navigates without walls; once the shown month leaves the
  // current window, shift the window a year so its data follows.
  onPreviewMonthChange(vm: { y: number; m: number }): void {
    const hd = this.resultHeatmapData();
    if (!hd) {
      return;
    }
    const monthStart = new Date(vm.y, vm.m, 1);
    const monthEnd = new Date(vm.y, vm.m + 1, 0, 23, 59, 59);
    if (monthEnd < hd.rangeStart) {
      this.previewYearOffset.update((o) => o - 1);
    } else if (monthStart > hd.rangeEnd) {
      this.previewYearOffset.update((o) => o + 1);
    }
  }
  // A clicked projected day (YYYY-MM-DD): "simulate completing here" → for a
  // repeat-from-completion schedule the rule re-anchors from that day (the
  // After-completion behavior, made interactive).
  simulatedCompletion = signal<string | null>(null);
  // Fullscreen: a manual toggle in the title bar; opening the calendar preview
  // auto-expands the dialog, and closing the preview shrinks it back ONLY when
  // the preview caused the expansion (a manual toggle takes ownership).
  isFullScreen = signal(false);
  private _fullScreenOwnedByCalendar = false;
  toggleFullScreen(): void {
    this._setFullScreen(!this.isFullScreen());
    this._fullScreenOwnedByCalendar = false;
  }
  private _setFullScreen(isFullScreen: boolean): void {
    this.isFullScreen.set(isFullScreen);
    if (isFullScreen) {
      this._matDialogRef.addPanelClass('dialog-fullscreen');
    } else {
      this._matDialogRef.removePanelClass('dialog-fullscreen');
    }
  }
  private readonly _calRef = viewChild('calRef', { read: ElementRef });
  toggleResultHeatmap(): void {
    this.showResultHeatmap.update((v) => !v);
    if (this.showResultHeatmap()) {
      // Expand only when needed: measure AFTER the calendar has rendered and
      // go fullscreen only if it doesn't fit the dialog as-is (clipped
      // vertically, or the year strip has to scroll sideways).
      setTimeout(() => this._expandIfCalendarDoesNotFit());
    } else {
      this.simulatedCompletion.set(null);
      this.previewYearOffset.set(0);
      if (this._fullScreenOwnedByCalendar) {
        this._setFullScreen(false);
      }
      this._fullScreenOwnedByCalendar = false;
    }
  }
  private _expandIfCalendarDoesNotFit(): void {
    const el = this._calRef()?.nativeElement as HTMLElement | undefined;
    if (!el || !this.showResultHeatmap() || this.isFullScreen()) {
      return;
    }
    const rect = el.getBoundingClientRect();
    // Vertically clipped: the calendar (or the action row after it) extends
    // past the viewport — the 85vh dialog cap couldn't absorb it.
    const isClippedVertically = rect.bottom > window.innerHeight || rect.top < 0;
    // The year strip scrolls horizontally inside its own block row — if it has
    // to, fullscreen buys it the missing width (when there IS more width).
    const blocks = el.querySelector('.heatmap-month-blocks');
    const needsHorizontalScroll =
      !!blocks &&
      blocks.scrollWidth > blocks.clientWidth + 1 &&
      window.innerWidth > el.clientWidth + 1;
    if (isClippedVertically || needsHorizontalScroll) {
      this._setFullScreen(true);
      this._fullScreenOwnedByCalendar = true;
    }
  }
  clearSimulation(): void {
    this.simulatedCompletion.set(null);
  }
  onPreviewDayClick(day: DayData): void {
    if (!day?.dateStr) {
      return;
    }
    // Only a "repeat from completion" schedule re-anchors when a task is
    // completed — for a fixed-calendar schedule completing a day never shifts
    // the rest, so there is nothing to simulate: ignore the click instead of
    // rendering a misleading "completed" marker on a day the rule never fires.
    if (!this.repeatCfg().repeatFromCompletionDate) {
      return;
    }
    // Tap the already-simulated day again to clear it. Otherwise simulate
    // completing on the clicked day — ANY day, not only scheduled occurrences:
    // re-anchoring to an on-schedule day is a no-op (next = same grid), so the
    // series only visibly rebuilds when you complete off-schedule (early/late),
    // which is exactly the "repeat from completion" what-if.
    this.simulatedCompletion.set(
      day.dateStr === this.simulatedCompletion() ? null : day.dateStr,
    );
  }
  // Only the schedule-relevant slice of the working cfg, with value equality —
  // formly emits a CLONED model on every keystroke in ANY field (title, notes,
  // …), so hanging the projection directly off `repeatCfg()` rebuilt the full
  // 365-day calendar per character typed. This memo recomputes downstream only
  // when a field that actually changes the projection changes.
  private readonly _previewScheduleCfg = computed(
    () => {
      const cfg = this.repeatCfg();
      return {
        rrule: cfg.rrule,
        startDate: cfg.startDate,
        lastTaskCreationDay: cfg.lastTaskCreationDay,
        repeatFromCompletionDate: cfg.repeatFromCompletionDate,
        // join: the cloned model produces a NEW array reference per keystroke,
        // so compare by content.
        exdatesKey: (cfg.deletedInstanceDates ?? []).join(','),
      };
    },
    {
      equal: (a, b) =>
        a.rrule === b.rrule &&
        a.startDate === b.startDate &&
        a.lastTaskCreationDay === b.lastTaskCreationDay &&
        a.repeatFromCompletionDate === b.repeatFromCompletionDate &&
        a.exdatesKey === b.exdatesKey,
    },
  );
  resultHeatmapData = computed<HeatmapViewData | null>(() => {
    if (!this.isRRuleMode() || !this.showResultHeatmap()) {
      return null;
    }
    const cfg = this._previewScheduleCfg();
    if (!isRRuleValid(cfg.rrule)) {
      return null;
    }
    const rrule = cfg.rrule as string;
    // Per-instance overrides (moves / RDATE) are Phase 8; here only EXDATE skips
    // (deletedInstanceDates) apply to the projection.
    const exdates = cfg.exdatesKey ? cfg.exdatesKey.split(',') : [];
    // The window: a 365-day span anchored at today, shifted by whole years via
    // the ‹ › navigation, then padded to full calendar months so the month
    // view never shows a half-covered month. Projection starts at TODAY in the
    // home window (no "projected" marks on days already past); shifted windows
    // show the full pattern.
    const offset = this.previewYearOffset();
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const anchor = new Date(today);
    anchor.setFullYear(anchor.getFullYear() + offset);
    const anchorEnd = new Date(anchor);
    anchorEnd.setDate(anchorEnd.getDate() + this._PREVIEW_HEATMAP_DAYS);
    const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12, 0, 0);
    const to = new Date(anchorEnd.getFullYear(), anchorEnd.getMonth() + 1, 0, 12, 0, 0);
    const occFrom = offset === 0 ? today : from;
    // The util only reads repeatFromCompletionDate / lastTaskCreationDay /
    // startDate — all carried by the narrow schedule slice.
    const baseStart = getEffectiveRepeatStartDate(cfg);
    const sim = this.simulatedCompletion();
    // Only a "repeat from completion" schedule re-anchors when you finish a task
    // (the completion effect rewrites startDate/lastTaskCreationDay to the
    // completion day). A fixed-calendar schedule keeps its dates, so completing a
    // day must NOT shift the rest.
    const reAnchors = !!cfg.repeatFromCompletionDate;

    let occ: Date[];
    if (sim && reAnchors) {
      // Keep the original occurrences up to the completion day, then re-anchor
      // the rest of the series to that day (next fires from the completion).
      const [y, m, d] = sim.split('-').map(Number);
      const simDay = new Date(y, m - 1, d, 12, 0, 0);
      const beforeEnd = new Date(simDay);
      beforeEnd.setDate(beforeEnd.getDate() - 1);
      const afterFrom = new Date(simDay);
      afterFrom.setDate(afterFrom.getDate() + 1);
      const before = getRRuleOccurrencesInRange(
        { rrule, startDate: baseStart, exdates },
        occFrom,
        beforeEnd,
      );
      const after = getRRuleOccurrencesInRange(
        { rrule, startDate: sim, exdates },
        afterFrom,
        to,
      );
      occ = [...before, ...after];
    } else {
      // No re-anchor: calendar stays fixed (no simulation, or a non
      // from-completion schedule where finishing a task never shifts dates).
      occ = getRRuleOccurrencesInRange(
        { rrule, startDate: baseStart, exdates },
        occFrom,
        to,
      );
    }
    // Hide an all-empty preview only in the HOME window: a navigated window may
    // legitimately be empty (e.g. before the start date), and returning null
    // there would tear down the calendar — and its ‹ › nav — mid-navigation.
    if (!occ.length && !sim && offset === 0) {
      return null;
    }

    const dayMap = buildProjectionDayMap(occ, from, to);
    if (sim) {
      const day = dayMap.get(sim);
      if (day) {
        day.isProjected = false;
        day.isCompleted = true;
        day.level = 4;
      }
    }
    const firstDay = this._dateAdapter.getFirstDayOfWeek();
    const monthNames = this._dateAdapter.getMonthNames('short');
    return {
      ...buildHeatmapWeeks(dayMap, from, to, firstDay, monthNames),
      months: buildHeatmapMonths(
        dayMap,
        from,
        to,
        firstDay,
        monthNames,
        heatmapOccurrenceTotal,
      ),
      dayMap,
      rangeStart: from,
      rangeEnd: to,
    };
  });

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
          .getTaskRepeatCfgById$(this._data.task.repeatCfgId)
          .pipe(first())
          .subscribe((cfg) => {
            this._setRepeatCfgInitiallyForEditOnly(cfg);
            this._checkCanRemoveInstance();
            this.isLoading.set(false);
          });
      }
      this._checkCanRemoveInstance();
    });

    // A simulation belongs to the exact schedule it was clicked on — ANY
    // schedule edit (rule, start date, excluded days, schedule type) reshapes
    // the projected series, so a sim day picked for the old schedule would
    // silently distort the preview. rrule / schedule-type edits already clear
    // synchronously in their handlers; startDate and exdate edits arrive only
    // as a new formly model, so watch the schedule slice and drop the sim on
    // any change. (`_previewScheduleCfg` is value-equal, so the reference only
    // changes when a schedule-relevant field actually changes.)
    let lastScheduleSlice = this._previewScheduleCfg();
    effect(() => {
      const slice = this._previewScheduleCfg();
      if (slice !== lastScheduleSlice) {
        lastScheduleSlice = slice;
        this.simulatedCompletion.set(null);
      }
    });
  }

  private _initializeRepeatCfg(): RepeatCfgWorking {
    if (this._data.repeatCfg) {
      // Process the repeat config to determine if quickSetting needs to be changed to CUSTOM
      const processedCfg = this._processQuickSettingForDate(this._data.repeatCfg);

      // Diff against the PROCESSED cfg, not the stored one: open-time
      // adjustments (lazy legacy→rrule migration, preset inference) must not
      // leak into the change set of an unrelated edit — `rrule` is a
      // SCHEDULE_AFFECTING_FIELD, so persisting it from a title-only save
      // would relocate today's live instance. The migration only persists
      // once the user actually touches the schedule.
      this.repeatCfgInitial.set({ ...processedCfg });
      return processedCfg;
    } else if (this._data.task) {
      const startTime = this._data.task.dueWithTime
        ? clockStringFromDate(this._data.task.dueWithTime)
        : undefined;
      return {
        ...DEFAULT_TASK_REPEAT_CFG,
        ...(this._data.initialQuickSetting
          ? { quickSetting: this._data.initialQuickSetting }
          : {}),
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

  /** The RRULE builder emits a new rule string; store it + keep repeatCycle in sync. */
  onRRuleChange(rrule: string): void {
    // A simulation belongs to the rule it was clicked on — keeping it across an
    // edit would split/re-anchor the NEW rule's series at a day picked for the
    // old one, silently distorting the preview.
    if (this.repeatCfg().rrule !== rrule) {
      this.simulatedCompletion.set(null);
    }
    this.repeatCfg.update((cfg) => ({
      ...cfg,
      rrule,
      // Keep the legacy schedule fields (cycle / interval / weekday flags /
      // monthly anchors) in sync so older sync clients — which ignore `rrule` —
      // fall back to a faithful recurrence. Pass startDate so a BYDAY-less
      // weekly rule maps onto the start weekday (else old clients never fire).
      // startDate alignment intentionally happens at SAVE only (see save()) —
      // doing it here would silently rewrite the visible start-date field on
      // every builder interaction.
      ...rruleToLegacyTaskRepeatCfg(rrule, cfg.startDate),
    }));
  }

  // Schedule-type toggle lives in the rrule-builder (RRULE mode). It's separate
  // from the rrule string — re-anchors the interval to the completion day.
  onRepeatFromCompletionChange(repeatFromCompletionDate: boolean): void {
    // Switching schedule type changes what a simulation MEANS — drop it.
    this.simulatedCompletion.set(null);
    this.repeatCfg.update((cfg) => ({ ...cfg, repeatFromCompletionDate }));
  }

  private _initializeFormConfig(): void {
    const _locale = this._dateTimeFormatService.currentLocale();
    const translateService = this._translateService;

    // The 'RRULE' option ("Custom recurring config") is ALWAYS offered: it
    // replaced the legacy Custom UI, so omitting it on engine-flag-off devices
    // would leave them with fixed presets only. With the flag off, the
    // occurrence engine schedules from the legacy mirror fields that save()
    // derives from the rule (rruleToLegacyTaskRepeatCfg) — the same
    // best-effort fallback older sync clients rely on. (This supersedes the
    // upstream flag-gated includeRRule — always-offered makes that moot.)
    const buildOptions = (refDate: Date): { value: string; label: string }[] =>
      buildRepeatQuickSettingOptions(refDate, _locale, translateService);

    const formConfig = TASK_REPEAT_CFG_ESSENTIAL_FORM_CFG.map((field) => ({
      ...field,
    }));

    // Clamp startDate to today as a floor for NEW configs and recent ones
    // (#7768 Bug 4). For configs whose startDate is already in the past, the
    // existing value is the floor — users can still keep or adjust it.
    const startDateIdx = formConfig.findIndex((f) => f.key === 'startDate');
    if (startDateIdx !== -1) {
      const startDateField: FormlyFieldConfig = {
        ...formConfig[startDateIdx],
        templateOptions: { ...formConfig[startDateIdx].templateOptions },
      };
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const initialStartDate = this._data.repeatCfg?.startDate
        ? dateStrToUtcDate(this._data.repeatCfg.startDate)
        : this._data.task?.dueDay
          ? dateStrToUtcDate(this._data.task.dueDay)
          : today;
      // Formly types templateOptions.min as number, but the formly-date-picker
      // passes it through to date-picker-input which accepts Date | string.
      // Use the YYYY-MM-DD string form so the cast is just a type concern.
      const minFloor = initialStartDate < today ? initialStartDate : today;
      (startDateField.templateOptions as Record<string, unknown>).min =
        getDbDateStr(minFloor);
      formConfig[startDateIdx] = startDateField;
    }

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
    let cachedOptions: { value: string; label: string }[];

    // Update options reactively when startDate changes
    quickSettingField.expressionProperties = {
      ...quickSettingField.expressionProperties,
      ['templateOptions.options']: (model: Record<string, unknown>) => {
        const sd = model['startDate'] as string | undefined;
        if (sd !== lastStartDate || !cachedOptions) {
          lastStartDate = sd;
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

    const currentRepeatCfg = this.repeatCfg();

    // workaround for formly not always updating hidden fields correctly (in time??)
    if (currentRepeatCfg.quickSetting !== 'RRULE') {
      // Pass startDate to use correct weekday for WEEKLY_CURRENT_WEEKDAY (fixes #5806)
      const referenceDate = currentRepeatCfg.startDate
        ? dateStrToUtcDate(currentRepeatCfg.startDate)
        : undefined;
      const updatesForQuickSetting = getQuickSettingUpdates(
        currentRepeatCfg.quickSetting,
        referenceDate,
      );
      if (updatesForQuickSetting) {
        this.repeatCfg.update((cfg) => ({
          ...cfg,
          ...updatesForQuickSetting,
          // A preset is always start-date-relative: the "from completion"
          // toggle lives ONLY inside the RRULE builder, which a preset hides.
          // So a stale `repeatFromCompletionDate` left over from a previous
          // RRULE cfg would persist with no visible control and silently keep
          // firing relative to completion. Clear it — but only when actually
          // set, so an untouched preset save stays an empty-diff no-op (#7373)
          // instead of dispatching a spurious undefined→false change.
          ...(cfg.repeatFromCompletionDate ? { repeatFromCompletionDate: false } : {}),
        }));
      }
    }

    // RRULE mode: the rrule string is already on the cfg (kept live by the
    // rrule-builder child via onRRuleChange). Just guard it before persisting.
    const working = this.repeatCfg();
    if (working.quickSetting === 'RRULE') {
      if (!isRRuleValid(working.rrule)) {
        this._snackService.open({ type: 'ERROR', msg: T.F.TASK_REPEAT.F.RRULE_INVALID });
        formGroup1.markAllAsTouched();
        return;
      }
      const parsedRule = safeParseRRuleOptions(working.rrule);
      // The engine is day-granular (every occurrence resolves to local noon),
      // so a sub-daily FREQ (HOURLY/…, reachable via the raw override) would
      // be accepted but silently collapse to ~daily firing — and it has no
      // legacy repeatCycle equivalent for old clients. Reject until sub-daily
      // support actually exists.
      if (!parsedRule || FREQ_TO_CYCLE[parsedRule.freq] == null) {
        this._snackService.open({
          type: 'ERROR',
          msg: T.F.TASK_REPEAT.F.RRULE_FREQ_UNSUPPORTED,
        });
        formGroup1.markAllAsTouched();
        return;
      }
      // COUNT has no stable origin together with "repeat from completion":
      // completing an instance re-anchors startDate AND lastTaskCreationDay to
      // the completion day (task-repeat-cfg.effects), which restarts the COUNT
      // window — the series would never terminate. Reject the combination.
      if (working.repeatFromCompletionDate && parsedRule.count != null) {
        this._snackService.open({
          type: 'ERROR',
          msg: T.F.TASK_REPEAT.F.RRULE_COUNT_WITH_COMPLETION,
        });
        formGroup1.markAllAsTouched();
        return;
      }
      // Align startDate for date-anchored rules: old clients read the monthly
      // day (and yearly month+day) from startDate, so it must sit on the
      // rule's day. Done once at save — and ONLY when the schedule actually
      // changed in this dialog session: realigning an untouched stored cfg
      // would put startDate into the change diff, and startDate is a
      // SCHEDULE_AFFECTING_FIELD that makes rescheduleTaskOnRepeatCfgUpdate$
      // move today's live instance on an unrelated title/notes edit (#7373).
      const initialForAlign = this.repeatCfgInitial();
      const scheduleTouched =
        !this.isEdit() ||
        !initialForAlign ||
        initialForAlign.rrule !== working.rrule ||
        initialForAlign.startDate !== working.startDate;
      if (scheduleTouched && working.startDate) {
        const aligned = getAlignedStartDate(working.rrule as string, working.startDate);
        const finalStartDate = aligned ?? working.startDate;
        // A rule can parse fine yet match no real date (e.g. raw override
        // FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30) — persisting it would create a
        // recurrence that silently never fires, with the legacy fallback
        // bypassed because the rule IS valid. Probe the first occurrence
        // against the startDate actually being persisted.
        if (
          !getFirstRRuleOccurrence({
            rrule: working.rrule as string,
            startDate: finalStartDate,
          })
        ) {
          this._snackService.open({
            type: 'ERROR',
            msg: T.F.TASK_REPEAT.F.RRULE_NO_OCCURRENCE,
          });
          formGroup1.markAllAsTouched();
          return;
        }
        // ALWAYS re-derive the legacy fallback fields against the final
        // startDate — not only when alignment moved it. The builder emits on
        // rule edits only, so a startDate change made after the last builder
        // emit (e.g. a BYDAY-less weekly rule, where no alignment applies)
        // would otherwise persist a new dtstart alongside legacy weekday
        // booleans still derived from the old start date.
        this.repeatCfg.update((cfg) => ({
          ...cfg,
          startDate: finalStartDate,
          ...rruleToLegacyTaskRepeatCfg(cfg.rrule as string, finalStartDate),
        }));
      }
    }
    // NOTE: switching from builder mode to a preset needs no rrule cleanup —
    // every preset's getQuickSettingUpdates() OVERWRITES `rrule` with its own
    // canonical rule (applied above), so presets stay rrule-backed. Clearing
    // it here would (a) break the "every saved cfg carries its rrule" contract
    // and (b) not even propagate: an `rrule: undefined` change is dropped by
    // the op-log's JSON wire, leaving remote clients scheduling from the old
    // rule.

    // Normalize the monthly anchor fields at the boundary: convert the form's
    // `null` sentinel to `undefined`, and strip a stale `monthlyLastDay` flag.
    // The in-memory quickSetting (incl. 'RRULE' / newer presets) is left as-is;
    // the addTaskRepeatCfgToTask / updateTaskRepeatCfg action creators clamp it
    // to a sync-safe value at the persist boundary, so the op payload that
    // old/mobile clients replay never carries an out-of-union value.
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
      if (Object.keys(changes).length === 0) {
        // Nothing changed (e.g. a migrated legacy cfg opened and saved as-is)
        // — don't dispatch an empty update that would still create a sync op.
        this.close();
        return;
      }
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
    // Legacy form models used `null` as the "(Day of month)" sentinel on the
    // monthlyWeekOfMonth select. Persisted cfgs use `undefined` for absent
    // optional fields — and `null` is NOT master-safe for this field (released
    // clients' typia schema only allows absent-or-numeric), so it must never
    // be persisted. Normalizing also keeps existing day-of-month cfgs from
    // producing spurious change diffs.
    if (result.monthlyWeekOfMonth === null) {
      result = { ...result, monthlyWeekOfMonth: undefined };
    }
    // `monthlyLastDay` has no CUSTOM-mode form control, so a flag left over
    // from the MONTHLY_LAST_DAY preset would silently override the
    // day-of-month a CUSTOM cfg shows. Strip it for other quick settings
    // (#7726) — EXCEPT 'RRULE', where it is derived from the rule itself
    // (rruleToLegacyTaskRepeatCfg, BYMONTHDAY=-1) as the old-client fallback
    // for month-end semantics; stripping it would make old clients fall back
    // to the startDate's numeric day.
    if (
      result.monthlyLastDay &&
      result.quickSetting !== 'MONTHLY_LAST_DAY' &&
      result.quickSetting !== 'RRULE'
    ) {
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
    // Processed, not stored — see _initializeRepeatCfg for why.
    this.repeatCfgInitial.set({ ...processedCfg });
  }

  private _getReferenceDate(): Date {
    if (this._data.task?.dueDay) {
      return dateStrToUtcDate(this._data.task.dueDay);
    }
    if (this._data.repeatCfg?.startDate) {
      return dateStrToUtcDate(this._data.repeatCfg.startDate);
    }
    return new Date();
  }

  private _processQuickSettingForDate<TCfg extends RepeatCfgWorking>(cfg: TCfg): TCfg {
    // Completion-relative schedules must open in builder mode regardless of rrule
    // presence or any matching preset: the schedule-type toggle ("from completion")
    // only exists inside the RRULE builder, so a preset label would hide the one
    // control that explains — and can change — how the cfg actually fires. Checked
    // BEFORE the rrule branch on purpose: a no-rrule completion cfg (any pre-RRULE
    // or imported cfg, since migration is lazy/save-only) whose quickSetting is a
    // kept preset (DAILY / MONDAY_TO_FRIDAY, or any preset carrying a startDate)
    // would otherwise fall through to `needsMigration === false`, open under its
    // preset label with the toggle hidden, and then on ANY save run the preset
    // branch that clears repeatFromCompletionDate — silently flipping the task
    // from "repeat after completion" to "repeat from start date". Force builder
    // mode (migrating to an rrule when absent) so the toggle is always visible and
    // quickSetting === 'RRULE' skips that reset.
    if (cfg.repeatFromCompletionDate) {
      if (cfg.rrule) {
        return cfg.quickSetting === 'RRULE' ? cfg : { ...cfg, quickSetting: 'RRULE' };
      }
      return {
        ...cfg,
        rrule: legacyTaskRepeatCfgToRRule(cfg as TaskRepeatCfg),
        quickSetting: 'RRULE',
      };
    }
    // Presets now carry an rrule too (rrule presets), so an rrule alone no longer
    // means "builder mode". Keep the friendly preset label only while its rrule
    // still matches what that preset produces; a builder- / @+- / migration-built
    // or otherwise diverged rule opens the dedicated 'RRULE' builder.
    if (cfg.rrule) {
      const qs = cfg.quickSetting;
      const isFaithfulPreset =
        !!qs &&
        qs !== 'RRULE' &&
        qs !== 'CUSTOM' &&
        legacyTaskRepeatCfgToRRule(cfg as TaskRepeatCfg) === cfg.rrule;
      if (isFaithfulPreset) {
        return cfg;
      }
      // The persist boundary clamps non-master presets (Weekends, Every other
      // day, …) to 'CUSTOM' for old-client sync safety — only the rrule
      // identifies them on reopen. Infer the preset back by matching the
      // stored rule against what each clamped preset would produce for this
      // start date (each yields a distinct rule per date), so the friendly
      // label survives a save/reopen round-trip instead of degrading to the
      // generic builder.
      if (qs === 'CUSTOM') {
        const refDate = cfg.startDate
          ? dateStrToUtcDate(cfg.startDate)
          : this._getReferenceDate();
        const inferred = QUICK_SETTING_PRESETS.filter(
          (p) => toSyncSafeQuickSetting(p) === 'CUSTOM',
        ).find((p) => getQuickSettingUpdates(p, refDate)?.rrule === cfg.rrule);
        if (inferred) {
          return { ...cfg, quickSetting: inferred };
        }
      }
      return { ...cfg, quickSetting: 'RRULE' };
    }
    // The legacy "Custom" recurrence UI has been removed. Migrate such cfgs (and
    // any cfg that no longer maps to a kept preset) to an equivalent RRULE so they
    // open in the builder. This is lazy: the occurrence engine still fires
    // un-opened legacy cfgs via their repeatCycle path, so the conversion only
    // persists if the user saves.
    const PRESETS_WITHOUT_START_DATE = new Set(['DAILY', 'MONDAY_TO_FRIDAY']);
    const needsMigration =
      cfg.quickSetting === 'CUSTOM' ||
      !cfg.quickSetting ||
      (!PRESETS_WITHOUT_START_DATE.has(cfg.quickSetting) && !cfg.startDate);
    if (needsMigration) {
      return {
        ...cfg,
        rrule: legacyTaskRepeatCfgToRRule(cfg as TaskRepeatCfg),
        quickSetting: 'RRULE',
      };
    }
    return cfg;
  }

  private _checkCanRemoveInstance(): void {
    if (!this._data.targetDate) {
      this.canRemoveInstance.set(false);
      return;
    }
    const todayStr = getDbDateStr(new Date());
    const isTargetTodayOrPast = this._data.targetDate <= todayStr;
    this.canRemoveInstance.set(!isTargetTodayOrPast);
  }
}
