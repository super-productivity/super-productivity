import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
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
  RepeatQuickSetting,
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
import { first, filter, switchMap } from 'rxjs/operators';
import { from as fromPromise } from 'rxjs';
import { TaskService } from '../../tasks/task.service';
import { TaskArchiveService } from '../../archive/task-archive.service';
import { calcRepeatTaskSeriesTimeSpent } from '../calc-repeat-task-series-time-spent.util';
import { msToString } from '../../../ui/duration/ms-to-string.pipe';
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
  isRRuleLegacyRepresentable,
  legacyTaskRepeatCfgToRRule,
  rruleToLegacyTaskRepeatCfg,
} from '../util/legacy-cfg-to-rrule.util';
import { RruleBuilderComponent } from './rrule-builder/rrule-builder.component';
import { RepeatFreqPickerComponent } from './repeat-freq-picker/repeat-freq-picker.component';
import { buildRRuleHumanizeOpts, getRRulePreview } from '../util/rrule-preview.util';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { clockStringFromDate } from '../../../ui/duration/clock-string-from-date';
import { ChipListInputComponent } from '../../../ui/chip-list-input/chip-list-input.component';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { Log } from '../../../core/log';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';
import { GlobalConfigService } from '../../config/global-config.service';
import { DEFAULT_GLOBAL_CONFIG } from '../../config/default-global-config.const';
import { DateTimeFormatService } from 'src/app/core/date-time-format/date-time-format.service';
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
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import {
  clearMonths,
  setEnd as setEndInRRule,
  setUntil as setUntilInRRule,
  setYearDay,
  toggleByDay,
  toggleByMonth,
  toggleMonthDay,
  toggleNthDay,
  weekdayAnnotations,
} from '../util/rrule-calendar-ops.util';
import { rruleToFormModel, RRULE_WEEKDAYS, RRuleWeekday } from '../util/rrule-form.util';
import {
  SegmentedButtonGroupComponent,
  SegmentedButtonOption,
} from '../../../ui/segmented-button-group/segmented-button-group.component';

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
    HeatmapSwitcherComponent,
    CollapsibleComponent,
    RruleBuilderComponent,
    RepeatFreqPickerComponent,
    DatePipe,
    NgTemplateOutlet,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    MatTooltip,
    SegmentedButtonGroupComponent,
  ],
})
export class DialogEditTaskRepeatCfgComponent {
  private _globalConfigService = inject(GlobalConfigService);
  private _dateAdapter = inject(DateAdapter);
  private _tagService = inject(TagService);
  private _taskRepeatCfgService = inject(TaskRepeatCfgService);
  private _taskService = inject(TaskService);
  private _taskArchiveService = inject(TaskArchiveService);
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

  // --- Activity overlay: tracked time of the saved series, merged into the
  // preview calendar as a GREEN spectrum (distinct from the blue projection).
  // Only an existing cfg has history; new ones show projection only. Togglable —
  // OFF hides the green cells, the time summary, and the activity legend. ---
  private readonly _seriesTasks = toSignal(
    toObservable(this.repeatCfgId).pipe(
      filter((id): id is string => !!id),
      switchMap((id) => fromPromise(this._loadSeriesTasks(id))),
    ),
    { initialValue: [] as Task[] },
  );
  /** Total tracked ms per `YYYY-MM-DD` across the whole series. */
  readonly activityByDay = computed<Map<string, number>>(() => {
    const m = new Map<string, number>();
    for (const t of this._seriesTasks() ?? []) {
      for (const [d, ms] of Object.entries(t.timeSpentOnDay ?? {})) {
        if (ms > 0) {
          m.set(d, (m.get(d) ?? 0) + ms);
        }
      }
    }
    return m;
  });
  readonly hasActivity = computed(() => this.activityByDay().size > 0);
  readonly showActivity = signal(true);
  readonly activitySummary = computed<{
    total: string;
    thisWeek: string;
    thisMonth: string;
  } | null>(() => {
    if (!this.hasActivity()) {
      return null;
    }
    const s = calcRepeatTaskSeriesTimeSpent(this._seriesTasks() ?? []);
    return {
      total: msToString(s.total),
      thisWeek: msToString(s.thisWeek),
      thisMonth: msToString(s.thisMonth),
    };
  });

  private async _loadSeriesTasks(id: string): Promise<Task[]> {
    const [archive, currentTasks] = await Promise.all([
      this._taskArchiveService.load(),
      this._taskService.allTasks$.pipe(first()).toPromise(),
    ]);
    const out: Task[] = [];
    for (const t of currentTasks ?? []) {
      if (t.repeatCfgId === id) {
        out.push(t);
      }
    }
    if (archive?.ids) {
      for (const tid of archive.ids) {
        const a = archive.entities[tid];
        if (a && a.repeatCfgId === id) {
          out.push(a as Task);
        }
      }
    }
    return out;
  }

  essentialFormFields = signal<FormlyFieldConfig[]>([]);
  advancedFormFields = signal<FormlyFieldConfig[]>(TASK_REPEAT_CFG_ADVANCED_FORM_CFG);

  formGroup1 = signal(new UntypedFormGroup({}));
  formGroup2 = signal(new UntypedFormGroup({}));
  tagSuggestions = toSignal(this._tagService.tagsNoMyDayAndNoList$, { initialValue: [] });

  // The RRULE builder (shown when quickSetting === 'RRULE') is a child component
  // with its own live preview; the dialog only needs to know when to render it.
  // quickSetting now lives on the working cfg (driven by the chip picker), not
  // a formly control, so read it directly.
  isRRuleMode = computed(() => this.repeatCfg().quickSetting === 'RRULE');

  // Value-equal key for the chip-picker options: only the reference DAY and the
  // locale change the date-aware labels (e.g. "Monthly on the 13th"). formly
  // emits a CLONED model — and thus a new `repeatCfg()` — on every keystroke in
  // ANY field, so reading `repeatCfg()` directly rebuilt the whole option list
  // (16 `translate.instant` + 4 `toLocaleDateString`) per character. Mirrors
  // `_previewScheduleCfg`'s custom `equal` for the same reason.
  private readonly _quickSettingOptionsKey = computed(
    () => {
      const sd = this.repeatCfg().startDate as string | Date | undefined;
      const refDate =
        sd instanceof Date ? sd : sd ? dateStrToUtcDate(sd) : this._getReferenceDate();
      return {
        refDateStr: getDbDateStr(refDate),
        locale: this._dateTimeFormatService.currentLocale(),
      };
    },
    { equal: (a, b) => a.refDateStr === b.refDateStr && a.locale === b.locale },
  );
  // Options for the TickTick-style chip picker (replaces the dropdown). Tracks
  // only the value-equal key above; the build itself reads `repeatCfg()` for the
  // start date `untracked`, so an unrelated-field keystroke never rebuilds it.
  quickSettingOptions = computed(() => {
    this._quickSettingOptionsKey();
    return untracked(() => this._buildQuickSettingOptions());
  });

  // Common presets shown by default in the dropdown (in this order); the rest
  // hide behind "More options". Order: every day, weekly, monthly, yearly, every
  // weekday — then "Custom" and "More options" are appended by the picker.
  readonly quickSettingCommon: readonly string[] = [
    'DAILY',
    'WEEKLY_CURRENT_WEEKDAY',
    'MONTHLY_CURRENT_DATE',
    'YEARLY_CURRENT_DATE',
    'MONDAY_TO_FRIDAY',
  ];
  // Live result/preview shown at the dialog bottom in RRULE mode. The builder
  // keeps `repeatCfg().rrule` up to date via onRRuleChange, so this stays live.
  private _humanize = buildRRuleHumanizeOpts(
    (k) => this._translateService.instant(k) as string,
  );
  // Gated on isRRuleValid like the save path — getRRulePreview's
  // rule.after() walk is otherwise unbounded for a never-firing rule
  // (e.g. raw override FREQ=DAILY;BYWEEKNO=53;BYMONTH=2: a multi-second
  // main-thread freeze PER KEYSTROKE). isRRuleValid is memoised and pre-screens
  // exactly that class, the same guard the save path applies.
  // True once the working cfg carries a fireable rule. Presets carry their own
  // canonical rrule too, so the calendar/preview now shows in EVERY mode, not
  // only the RRULE builder — the start date is picked there for all of them.
  readonly hasRule = computed(() => isRRuleValid(this.repeatCfg().rrule));
  rrulePreview = computed(() =>
    isRRuleValid(this.repeatCfg().rrule)
      ? getRRulePreview(
          this.repeatCfg().rrule,
          this.repeatCfg().startDate,
          this._humanize,
        )
      : null,
  );
  // Sentinel warning: this rule is outside what the legacy fallback fields can
  // represent, so the save writes the never-fires sentinel
  // (LEGACY_NEVER_FIRES_FALLBACK) — devices on older app versions (and
  // flag-off devices, which also route the legacy engine) will create no tasks
  // for it. Decided contract: absent tasks beat fabricated wrong-day tasks
  // that would sync back to every device.
  rruleLegacyIncompat = computed(
    () =>
      isRRuleValid(this.repeatCfg().rrule) &&
      !isRRuleLegacyRepresentable(this.repeatCfg().rrule),
  );

  // Calendar (heatmap) preview of the next year's occurrences for the live rule
  // — built from the in-progress rrule, no saved cfg required (so it works while
  // authoring a brand-new recurrence). Always shown for a valid rule (it doubles
  // as the start-date picker), gated only on `hasRule()` / `resultHeatmapData()`.
  private readonly _PREVIEW_HEATMAP_DAYS = 365;
  // Months of look-back included in the home/shifted window so recent tracked
  // time (the green Activity overlay) shows alongside the upcoming occurrences.
  private readonly _PREVIEW_PAST_MONTHS = 3;
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
  // True when the rendered window holds no occurrence (and no sim) — the grid
  // alone would read as broken, so the template adds an explanatory hint.
  previewWindowEmpty = computed(() => {
    const hd = this.resultHeatmapData();
    return !!hd && ![...hd.dayMap.values()].some((d) => d.isProjected || d.isCompleted);
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
  // Fullscreen: a manual toggle in the title bar (the dialog already widens
  // dynamically via `dialog-recurring`; this is the user's escape hatch for the
  // full-width year strip).
  isFullScreen = signal(false);
  toggleFullScreen(): void {
    this._setFullScreen(!this.isFullScreen());
  }
  private _setFullScreen(isFullScreen: boolean): void {
    this.isFullScreen.set(isFullScreen);
    if (isFullScreen) {
      this._matDialogRef.addPanelClass('dialog-fullscreen');
    } else {
      this._matDialogRef.removePanelClass('dialog-fullscreen');
    }
  }
  clearSimulation(): void {
    this.simulatedCompletion.set(null);
  }

  // ---- Calendar context menus (direct-manipulation rule editing) ----
  // A click on a day / weekday header / month label opens a contextual MatMenu
  // (hidden trigger positioned at the pointer) whose actions edit the SAME rule
  // the builder edits, via the pure rrule-calendar-ops helpers + onRRuleChange.
  readonly menuDay = signal<DayData | null>(null);
  readonly menuWeekdayIdx = signal<number | null>(null);
  /** Which frequency the (shared) nth-weekday submenu currently targets — set when
   *  its trigger opens, so the 1st/2nd/…/Last items apply to the right freq. */
  readonly menuNthFreq = signal<'MONTHLY' | 'YEARLY'>('MONTHLY');
  /** Which "switch to …" frequency the bottom icon row has expanded INLINE inside
   *  the current menu (null = collapsed). Click an icon to open it, click the same
   *  icon again to close — a plain toggle, not a hover-opened sub-menu. Reset every
   *  time a menu opens. */
  readonly expandedSwitch = signal<'WEEKLY' | 'MONTHLY' | 'YEARLY' | null>(null);
  toggleSwitchExpand(freq: 'WEEKLY' | 'MONTHLY' | 'YEARLY'): void {
    this.expandedSwitch.update((cur) => (cur === freq ? null : freq));
  }
  readonly menuPos = signal<{ x: string; y: string }>({ x: '0px', y: '0px' });
  /** The month (0=Jan … 11=Dec) the month-label menu targets — set from the click
   *  (the month view's title, or a year-view month block). */
  readonly menuMonthIdx = signal<number>(new Date().getMonth());

  private readonly _dayMenuTrigger = viewChild('dayMenuTrigger', {
    read: MatMenuTrigger,
  });
  private readonly _weekdayMenuTrigger = viewChild('weekdayMenuTrigger', {
    read: MatMenuTrigger,
  });
  private readonly _monthMenuTrigger = viewChild('monthMenuTrigger', {
    read: MatMenuTrigger,
  });

  // The live structured model parsed from the working rule — drives menu-item
  // visibility (freq/mode) and the weekday-header annotation glyphs.
  private readonly _previewModel = computed(() =>
    rruleToFormModel(this.repeatCfg().rrule, this._previewRefDate()),
  );
  // Current frequency of the working rule — drives which calendar-menu options are
  // "native" (shown at the top) vs which SWITCH the frequency (grouped under a
  // per-target-freq icon button in the menu's bottom row).
  readonly isWeeklyRule = computed(() => this._previewModel().freq === 'WEEKLY');
  readonly isMonthlyRule = computed(() => this._previewModel().freq === 'MONTHLY');
  readonly isYearlyRule = computed(() => this._previewModel().freq === 'YEARLY');
  // Per-weekday header glyphs (Mon=0 … Sun=6): nth ordinal (top), selected-day
  // dot (mid), in-months grid (bottom) — the generic shape the calendar renders.
  readonly weekdayHeaderGlyphs = computed(() => {
    const ann = weekdayAnnotations(this._previewModel());
    const out = new Map<number, { top?: string; mid?: string; bottom?: string }>();
    ann.forEach((a, idx) => {
      out.set(idx, {
        top: a.nth.length ? a.nth.join(',') : undefined,
        mid: a.selected ? '●' : undefined,
        bottom: a.inMonths ? '▦' : undefined,
      });
    });
    return out;
  });
  // Human-readable per-weekday tooltip (Mon=0 … Sun=6) spelling out what the
  // glyphs mean — shown on hover over a weekday header that has something set.
  readonly weekdayHeaderTooltips = computed(() => {
    const ann = weekdayAnnotations(this._previewModel());
    const inst = (k: string): string => this._translateService.instant(k) as string;
    const ord = new Map<string, string>([
      ['1', T.F.TASK_REPEAT.F.ORD_FIRST],
      ['2', T.F.TASK_REPEAT.F.ORD_SECOND],
      ['3', T.F.TASK_REPEAT.F.ORD_THIRD],
      ['4', T.F.TASK_REPEAT.F.ORD_FOURTH],
      ['L', T.F.TASK_REPEAT.F.ORD_LAST],
    ]);
    const out = new Map<number, string>();
    ann.forEach((a, idx) => {
      const parts: string[] = [];
      if (a.nth.length) {
        const ords = a.nth.map((g) => (ord.has(g) ? inst(ord.get(g)!) : g)).join(', ');
        parts.push(`${inst(T.F.TASK_REPEAT.F.RRULE_MODE_NTH_WEEKDAY)}: ${ords}`);
      }
      if (a.selected) {
        parts.push(inst(T.F.TASK_REPEAT.F.CAL_MENU_SELECTED_DAYS));
      }
      if (a.inMonths) {
        parts.push(inst(T.F.TASK_REPEAT.F.CAL_TIP_IN_MONTHS));
      }
      if (parts.length) {
        out.set(idx, parts.join(' · '));
      }
    });
    return out;
  });
  // Tooltip for the month label/title when BYMONTH limits the rule — lists them.
  readonly monthTooltip = computed(() =>
    this.hasMonthLimits()
      ? (this._translateService.instant(T.F.TASK_REPEAT.F.CAL_TIP_LIMITED_MONTHS, {
          months: this.limitedMonthNames(),
        }) as string)
      : '',
  );

  private _previewRefDate(): Date {
    const sd = this.repeatCfg().startDate as string | Date | undefined;
    if (sd instanceof Date) return sd;
    if (sd) return dateStrToUtcDate(sd);
    return new Date();
  }
  private _setMenuPos(event: MouseEvent): void {
    this.menuPos.set({ x: event.clientX + 'px', y: event.clientY + 'px' });
  }

  onPreviewDayMenu({ data, event }: { data: DayData; event: MouseEvent }): void {
    if (!data?.dateStr) {
      return;
    }
    event.preventDefault();
    this.menuDay.set(data);
    this.expandedSwitch.set(null);
    this._setMenuPos(event);
    this._dayMenuTrigger()?.openMenu();
  }
  onWeekdayHeaderMenu({
    weekdayIdx,
    event,
  }: {
    weekdayIdx: number;
    event: MouseEvent;
  }): void {
    event.preventDefault();
    this.menuWeekdayIdx.set(weekdayIdx);
    this.expandedSwitch.set(null);
    this._setMenuPos(event);
    this._weekdayMenuTrigger()?.openMenu();
  }
  onMonthLabelMenu({ month, event }: { month: number; event: MouseEvent }): void {
    event.preventDefault();
    this.menuMonthIdx.set(month);
    this._setMenuPos(event);
    this._monthMenuTrigger()?.openMenu();
  }

  // --- day-menu actions ---
  /** True when the clicked day is strictly after the start (so "ends on" applies). */
  readonly menuDayAfterStart = computed(() => {
    const d = this.menuDay()?.dateStr;
    const s = this.repeatCfg().startDate as string | undefined;
    return !!d && !!s && d > s;
  });
  // Whether the clicked day is ALREADY the target of each settable action. When it
  // is, the menu item flips to "Remove …" and the action toggles off (the day-of-
  // month / day-of-year / simulate ops already add-or-remove; only the end date
  // needs the handler to branch). Mirrors the month menu's Limit/Unlimit pattern.
  readonly menuDayIsEnd = computed(() => {
    const d = this.menuDay()?.dateStr;
    return !!d && this.endType() === 'UNTIL' && d === this.endUntil();
  });
  readonly menuDayMonthActive = computed(() => {
    const day = this.menuDay()?.date?.getDate();
    const m = this._previewModel();
    return (
      day != null &&
      m.freq === 'MONTHLY' &&
      m.monthlyMode === 'DAY_OF_MONTH' &&
      m.monthDays.includes(day)
    );
  });
  readonly menuDayYearActive = computed(() => {
    const dt = this.menuDay()?.date;
    const m = this._previewModel();
    return (
      !!dt &&
      m.freq === 'YEARLY' &&
      m.yearlyMode === 'DAY_OF_MONTH' &&
      m.byMonth.length === 1 &&
      m.byMonth[0] === dt.getMonth() + 1 &&
      m.monthDays.length === 1 &&
      m.monthDays[0] === dt.getDate()
    );
  });
  readonly menuDayIsSim = computed(() => {
    const d = this.menuDay()?.dateStr;
    return !!d && d === this.simulatedCompletion();
  });
  /** "Simulate completing here" only makes sense for a repeat-from-completion
   *  schedule — that's the only kind whose later occurrences re-anchor when you
   *  finish one (a start-anchored series stays fixed to the calendar, so a
   *  completion shifts nothing). So it's offered only on/after the start of such
   *  a schedule (a completion can't precede the rule's start), and never for a
   *  COUNT rule — completion + COUNT is the unsupported, never-terminating
   *  combination the save path rejects, and re-anchoring it would render up to
   *  ~2×COUNT marks. Presets are always start-anchored, so this also keeps
   *  simulate out of the preset (non-RRULE) calendar entirely. */
  readonly menuDaySimAllowed = computed(() => {
    const cfg = this.repeatCfg();
    const d = this.menuDay()?.dateStr;
    const s = cfg.startDate as string | undefined;
    return (
      !!d && !!s && d >= s && !!cfg.repeatFromCompletionDate && this.endType() !== 'COUNT'
    );
  });
  menuSetStart(): void {
    const d = this.menuDay()?.dateStr;
    // Floor at today (new-cfg rule) and skip a no-op re-pick.
    if (!d || d < getDbDateStr(new Date()) || d === this.repeatCfg().startDate) {
      return;
    }
    this._applyStartDate(d);
  }
  /** Apply an explicit start-date pick (M/D/Y fields or the "Set start" menu).
   *  A "repeat from completion" schedule that has already run anchors its
   *  preview and next-occurrence on `lastTaskCreationDay`; an explicit start
   *  edit re-defines that anchor, so the stale runtime marker is dropped — else
   *  the new start has no visible (or real) effect. Fixed schedules ignore it. */
  private _applyStartDate(dateStr: string): void {
    this.repeatCfg.update((cfg) => ({
      ...cfg,
      startDate: dateStr,
      ...(cfg.repeatFromCompletionDate && cfg.lastTaskCreationDay
        ? { lastTaskCreationDay: undefined }
        : {}),
    }));
    this._clearEndIfBeforeStart(dateStr);
    const sim = this.simulatedCompletion();
    if (sim) {
      if (sim < dateStr) {
        // The new start moved PAST the sim — a completion can't precede the
        // rule's start, so the sim no longer makes sense; drop it.
        this.simulatedCompletion.set(null);
      } else {
        // The sim still sits on/after the new start, so it stays valid. Moving
        // the start changes the schedule slice, which the sim-watcher effect
        // would otherwise treat as an edit and clear — advance its tracker in
        // lockstep so the kept sim survives the start change.
        this._lastScheduleSlice = this._previewScheduleCfg();
      }
    }
    this.focusStart.set(dateStr);
  }
  menuEndsOn(): void {
    const d = this.menuDay()?.dateStr;
    if (!d) {
      return;
    }
    // Toggle: clicking the day that's already the end clears the end back to Never.
    this.onRRuleChange(
      this.menuDayIsEnd()
        ? setEndInRRule(this.repeatCfg().rrule, this._previewRefDate(), 'NEVER')
        : setUntilInRRule(this.repeatCfg().rrule, this._previewRefDate(), d),
    );
  }
  menuToggleMonthDay(): void {
    const d = this.menuDay()?.date;
    if (!d) {
      return;
    }
    this.onRRuleChange(
      toggleMonthDay(this.repeatCfg().rrule, this._previewRefDate(), d.getDate()),
    );
  }
  menuSetYearDay(): void {
    const d = this.menuDay()?.date;
    if (!d) {
      return;
    }
    this.onRRuleChange(
      setYearDay(
        this.repeatCfg().rrule,
        this._previewRefDate(),
        d.getMonth() + 1,
        d.getDate(),
      ),
    );
  }
  menuSimulate(): void {
    const d = this.menuDay()?.dateStr;
    if (!d) {
      return;
    }
    const turningOn = d !== this.simulatedCompletion();
    // Defensive guard mirroring the template's `@if`: a sim can only be SET where
    // it's offered (on/after the start of a from-completion, non-COUNT schedule);
    // turning the active one OFF is always allowed. Simulation is a pure preview —
    // it never mutates the persisted schedule type. The cfg here is already
    // from-completion (the guard guarantees it), so resultHeatmapData re-anchors
    // off the existing flag; there is nothing to flip.
    if (turningOn && !this.menuDaySimAllowed()) {
      return;
    }
    this.simulatedCompletion.set(turningOn ? d : null);
  }

  // --- weekday-header-menu actions ---
  private _menuWeekday(): RRuleWeekday | null {
    const i = this.menuWeekdayIdx();
    return i == null ? null : (RRULE_WEEKDAYS[i] ?? null);
  }
  // The menu's weekday is already in the CURRENT frequency's selected-days set →
  // the native item flips to "Remove from selected days" (the switch variants
  // always add, since the weekday can't already be selected in another freq).
  readonly menuWeekdaySelectedActive = computed(() => {
    const wd = this._menuWeekday();
    if (!wd) {
      return false;
    }
    const m = this._previewModel();
    const inSet =
      m.freq === 'WEEKLY' ||
      (m.freq === 'MONTHLY' && m.monthlyMode === 'WEEKDAYS') ||
      (m.freq === 'YEARLY' && m.yearlyMode === 'WEEKDAYS');
    return inSet && m.byDay.includes(wd);
  });
  /** True when the menu's weekday already sits at ordinal `ord` in the nth-weekday
   *  mode the open sub-menu targets (menuNthFreq) — flips that ordinal to "Remove". */
  menuNthActive(ord: number): boolean {
    const wd = this._menuWeekday();
    if (!wd) {
      return false;
    }
    const m = this._previewModel();
    const freq = this.menuNthFreq();
    const inNth =
      (freq === 'MONTHLY' && m.freq === 'MONTHLY' && m.monthlyMode === 'NTH_WEEKDAY') ||
      (freq === 'YEARLY' && m.freq === 'YEARLY' && m.yearlyMode === 'NTH_WEEKDAY');
    return inNth && m.nthDays.some((r) => r.pos === ord && r.days.includes(wd));
  }
  menuToggleNth(ordinal: number, freq: 'MONTHLY' | 'YEARLY'): void {
    const wd = this._menuWeekday();
    if (!wd) {
      return;
    }
    this.onRRuleChange(
      toggleNthDay(this.repeatCfg().rrule, this._previewRefDate(), wd, ordinal, freq),
    );
  }
  // "Selected days of the week" targets BYDAY in an EXPLICIT frequency — the menu
  // offers a weekly / monthly / yearly variant of the same label, each switching
  // to that freq (grey hint shown when it differs from the current rule).
  menuToggleSelectedDay(freq: 'WEEKLY' | 'MONTHLY' | 'YEARLY'): void {
    const wd = this._menuWeekday();
    if (!wd) {
      return;
    }
    this.onRRuleChange(
      toggleByDay(this.repeatCfg().rrule, this._previewRefDate(), wd, freq),
    );
  }

  // --- month-label-menu action ---
  readonly menuMonth = computed(() => this.menuMonthIdx() + 1); // 1..12
  readonly menuMonthName = computed(
    () => (this._dateAdapter.getMonthNames('long') as string[])[this.menuMonthIdx()],
  );
  readonly menuMonthActive = computed(() =>
    this._previewModel().byMonth.includes(this.menuMonth()),
  );
  menuToggleMonth(): void {
    this.onRRuleChange(
      toggleByMonth(this.repeatCfg().rrule, this._previewRefDate(), this.menuMonth()),
    );
  }
  /** Months (0=Jan … 11=Dec) currently limited via BYMONTH — fed to the calendar
   *  so it can chip the limited month(s). */
  readonly limitedMonths = computed(() => this._previewModel().byMonth.map((m) => m - 1));
  readonly hasMonthLimits = computed(() => this._previewModel().byMonth.length > 0);
  /** Short names of the limited months, e.g. "Jan, Jun" — shown in the
   *  "remove all month limits" item. */
  readonly limitedMonthNames = computed(() => {
    const names = this._dateAdapter.getMonthNames('short') as string[];
    return this._previewModel()
      .byMonth.map((m) => names[m - 1])
      .join(', ');
  });
  menuClearMonthLimits(): void {
    this.onRRuleChange(clearMonths(this.repeatCfg().rrule, this._previewRefDate()));
  }

  // ---- Ends + Schedule type (dialog-level — apply to presets AND custom, not
  // just the builder; extracted from rrule-builder). Ends edits the rrule via
  // setEnd; Schedule type is the separate repeatFromCompletionDate flag. ----
  readonly endOptions: readonly SegmentedButtonOption[] = [
    { id: 'NEVER', labelKey: T.F.TASK_REPEAT.F.RRULE_END_NEVER },
    { id: 'UNTIL', labelKey: T.F.TASK_REPEAT.F.RRULE_END_UNTIL },
    { id: 'COUNT', labelKey: T.F.TASK_REPEAT.F.RRULE_END_COUNT },
  ];
  readonly scheduleTypeOptions: readonly SegmentedButtonOption[] = [
    { id: 'START', labelKey: T.F.TASK_REPEAT.F.RRULE_SCHEDULE_FROM_START },
    { id: 'COMPLETION', labelKey: T.F.TASK_REPEAT.F.RRULE_SCHEDULE_FROM_COMPLETION },
  ];
  readonly endType = computed(() => this._previewModel().endType); // NEVER|COUNT|UNTIL
  readonly endCount = computed(() => this._previewModel().count);
  readonly endUntil = computed(() => this._previewModel().until);
  readonly scheduleSelectedId = computed(() =>
    this.repeatCfg().repeatFromCompletionDate ? 'COMPLETION' : 'START',
  );
  /** A year past the start — the default UNTIL when switching to "On date" with no
   *  date yet, so the rule gets a real UNTIL (empty wouldn't round-trip → NEVER). */
  private _defaultUntil(): string {
    const u = this._previewRefDate();
    const d = new Date(u);
    d.setFullYear(d.getFullYear() + 1);
    return getDbDateStr(d);
  }
  onEndTypeChange(id: string | number): void {
    const t = String(id) as 'NEVER' | 'COUNT' | 'UNTIL';
    const value =
      t === 'COUNT'
        ? this.endCount() || 10
        : t === 'UNTIL'
          ? this.endUntil() || this._defaultUntil()
          : undefined;
    this.onRRuleChange(
      setEndInRRule(this.repeatCfg().rrule, this._previewRefDate(), t, value),
    );
  }
  setEndCount(v: string): void {
    this.onRRuleChange(
      setEndInRRule(this.repeatCfg().rrule, this._previewRefDate(), 'COUNT', v),
    );
  }
  setEndUntil(v: string): void {
    if (!v) {
      return;
    }
    this.onRRuleChange(
      setEndInRRule(this.repeatCfg().rrule, this._previewRefDate(), 'UNTIL', v),
    );
  }
  onScheduleTypeChange(id: string | number): void {
    this.onRepeatFromCompletionChange(id === 'COMPLETION');
  }
  /** A start moved on/after the end (UNTIL) leaves the series empty — drop the end
   *  back to "Never" so the rule still fires. Call AFTER the startDate update. */
  private _clearEndIfBeforeStart(startDate: string): void {
    const until = this.endUntil();
    if (until && until <= startDate) {
      this.onRRuleChange(
        setEndInRRule(this.repeatCfg().rrule, this._previewRefDate(), 'NEVER'),
      );
    }
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
    const cfg = this._previewScheduleCfg();
    if (!isRRuleValid(cfg.rrule)) {
      return null;
    }
    const rrule = cfg.rrule as string;
    // Per-instance overrides (moves / RDATE) are Phase 8; here only EXDATE skips
    // (deletedInstanceDates) apply to the projection.
    const exdates = cfg.exdatesKey ? cfg.exdatesKey.split(',') : [];
    // The window: a look-back of a few months plus a ~365-day forward span,
    // shifted by whole years via the ‹ › navigation and padded to full calendar
    // months so the month view never shows a half-covered month. The look-back
    // is what surfaces the GREEN activity overlay — tracked time lives in the
    // PAST, so a purely forward window would never show any of it. Projection
    // (blue) still starts at TODAY in the home window (no "projected" marks on
    // days already past); shifted windows show the full pattern.
    const offset = this.previewYearOffset();
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const anchor = new Date(today);
    anchor.setFullYear(anchor.getFullYear() + offset);
    const backStart = new Date(anchor);
    backStart.setMonth(backStart.getMonth() - this._PREVIEW_PAST_MONTHS);
    const anchorEnd = new Date(anchor);
    anchorEnd.setDate(anchorEnd.getDate() + this._PREVIEW_HEATMAP_DAYS);
    const from = new Date(backStart.getFullYear(), backStart.getMonth(), 1, 12, 0, 0);
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
    // An empty window — home included — still renders: a valid rule can have
    // no occurrence in the next 365 days (multi-year intervals, a far-future
    // start), and returning null would also drop the ‹ › nav, stranding the
    // user with no way to reach the window where it DOES fire. The template
    // shows an explanatory hint instead of a bare grid (previewWindowEmpty).
    const dayMap = buildProjectionDayMap(occ, from, to);
    if (sim) {
      const day = dayMap.get(sim);
      if (day) {
        day.isProjected = false;
        day.isCompleted = true;
        day.level = 4;
      }
    }
    // --- preview-only flourishes (the Activity heatmap never sets these) ---
    // Occurrence order within the window → the tooltip's "occurrence #N" label.
    occ.forEach((d, i) => {
      const day = dayMap.get(getDbDateStr(d));
      if (day) {
        day.occurrenceIndex = i;
      }
    });
    // Today's ring — only when today falls inside the rendered window.
    const todayDay = dayMap.get(getDbDateStr(new Date()));
    if (todayDay) {
      todayDay.isToday = true;
    }
    // Spotlight the next upcoming occurrence — only in the HOME window, where
    // occ[0] is the true next from today. Derived from the occurrence set this
    // computed already built (NOT from rrulePreview/repeatCfg), so an unrelated
    // field keystroke never rebuilds the projection.
    if (offset === 0 && occ.length) {
      const nextDay = dayMap.get(getDbDateStr(occ[0]));
      if (nextDay?.isProjected) {
        nextDay.isNext = true;
      }
    }
    // Mark the start / anchor day — the click-to-set target (Option A). baseStart
    // is the effective anchor the projection above is computed from.
    const startDay = dayMap.get(baseStart);
    if (startDay) {
      startDay.isStart = true;
    }
    // Mark the end (UNTIL) day specially when the rule has one and it falls in
    // the window — so "Ends on this date" reads as a distinct boundary marker.
    const until = safeParseRRuleOptions(rrule)?.until;
    if (until instanceof Date) {
      const endDay = dayMap.get(getDbDateStr(until));
      if (endDay) {
        endDay.isEnd = true;
      }
    }
    // Activity overlay (GREEN) — merge the saved series' tracked time into the
    // same window when enabled. Levels are relative to the busiest tracked day in
    // view, mirroring the standalone Activity heatmap this replaces.
    if (this.showActivity()) {
      const act = this.activityByDay();
      let maxMs = 0;
      act.forEach((ms, d) => {
        if (dayMap.has(d)) {
          maxMs = Math.max(maxMs, ms);
        }
      });
      if (maxMs > 0) {
        act.forEach((ms, d) => {
          const day = dayMap.get(d);
          if (day) {
            day.timeSpent = ms;
            const ratio = ms / maxMs;
            day.activityLevel = ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1;
          }
        });
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

  // The true next upcoming occurrence (from now, independent of the viewed year)
  // — drives the "Next: … in N days" chip and the spotlight in resultHeatmapData.
  readonly nextOccurrence = computed<{
    dateStr: string;
    date: Date;
    daysAway: number;
  } | null>(() => {
    const next = this.rrulePreview()?.upcoming?.[0];
    if (!next) {
      return null;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(next);
    d.setHours(0, 0, 0, 0);
    const daysAway = Math.round((d.getTime() - today.getTime()) / 86_400_000);
    return { dateStr: getDbDateStr(next), date: next, daysAway };
  });

  // The chosen start broken into editable Month / Day / Year parts. The dedicated
  // start-date form field is hidden in RRULE mode (the calendar below IS the
  // picker — Option A); these three fields, shown above the calendar, are the
  // precise alternative to clicking a day. Both write the same
  // `repeatCfg().startDate`, so the calendar and the fields stay in sync.
  // Set to the new start date whenever the user DELIBERATELY picks one (the M/D/Y
  // fields or the "Set start" menu) so the calendar jumps/scrolls to it. A plain
  // mirror of startDate would also fire on unrelated rebuilds and on open; this
  // only changes on an explicit pick, leaving the default view alone otherwise.
  readonly focusStart = signal<string | null>(null);
  readonly startParts = computed<{ y: number; m: number; d: number } | null>(() => {
    const sd = this.repeatCfg().startDate as string | Date | undefined;
    if (!sd) {
      return null;
    }
    if (sd instanceof Date) {
      return { y: sd.getFullYear(), m: sd.getMonth() + 1, d: sd.getDate() };
    }
    const [y, m, d] = sd.split('-').map(Number);
    if (!y || !m || !d) {
      return null;
    }
    return { y, m, d };
  });
  // Localized month names for the month <select> (1-based value).
  readonly monthOptions = computed<{ value: number; name: string }[]>(() =>
    (this._dateAdapter.getMonthNames('long') as string[]).map((name, i) => ({
      value: i + 1,
      name,
    })),
  );
  setStartMonth(m: number): void {
    const p = this.startParts();
    if (p && m >= 1 && m <= 12) {
      this._commitStartParts(p.y, m, p.d);
    }
  }
  setStartDay(d: number): void {
    const p = this.startParts();
    if (p && d >= 1) {
      this._commitStartParts(p.y, p.m, d);
    }
  }
  setStartYear(y: number): void {
    const p = this.startParts();
    if (p && y >= 1970 && y <= 2999) {
      this._commitStartParts(y, p.m, p.d);
    }
  }
  // Reassemble a valid YYYY-MM-DD from edited parts: the day is clamped to the
  // month's real length (so e.g. switching Feb→a 31-day entry can't yield an
  // invalid date), then written back as the single source of truth.
  private _commitStartParts(y: number, m: number, d: number): void {
    const maxDay = new Date(y, m, 0).getDate();
    const day = Math.min(Math.max(1, d), maxDay);
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (dateStr === this.repeatCfg().startDate) {
      return;
    }
    this._applyStartDate(dateStr);
  }

  // Rhythm summary shown above the open calendar: how many occurrences are in the
  // viewed window, their average spacing, and when the series ends.
  readonly previewStats = computed<{
    count: number;
    avgGapDays: number | null;
    end: string;
  } | null>(() => {
    const hd = this.resultHeatmapData();
    if (!hd) {
      return null;
    }
    const dates = [...hd.dayMap.values()]
      .filter((d) => d.isProjected || d.isCompleted)
      .map((d) => d.date)
      .sort((a, b) => a.getTime() - b.getTime());
    let avgGapDays: number | null = null;
    if (dates.length >= 2) {
      let sum = 0;
      for (let i = 1; i < dates.length; i++) {
        sum += (dates[i].getTime() - dates[i - 1].getTime()) / 86_400_000;
      }
      avgGapDays = Math.round(sum / (dates.length - 1));
    }
    return { count: dates.length, avgGapDays, end: this._previewEndLabel() };
  });

  /** "ends after N" / "until <date>" / "runs forever" from the rule's COUNT/UNTIL. */
  private _previewEndLabel(): string {
    const opts = safeParseRRuleOptions(this.repeatCfg().rrule);
    if (opts?.count) {
      return this._translateService.instant(T.F.TASK_REPEAT.F.RRULE_PREVIEW_ENDS_AFTER, {
        nr: opts.count,
      });
    }
    if (opts?.until) {
      const date = new Date(opts.until).toLocaleDateString(
        this._dateTimeFormatService.currentLocale(),
        { dateStyle: 'medium' },
      );
      return this._translateService.instant(T.F.TASK_REPEAT.F.RRULE_PREVIEW_ENDS_UNTIL, {
        date,
      });
    }
    return this._translateService.instant(T.F.TASK_REPEAT.F.RRULE_PREVIEW_ENDS_NEVER);
  }

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

  // Last schedule slice the sim-watcher effect saw. A field (not an effect-local
  // `let`) so `_applyStartDate` can advance it in lockstep when an explicit
  // start-date pick keeps a still-valid sim — otherwise that start change's slice
  // change would trip the watcher and wipe the sim we mean to keep.
  private _lastScheduleSlice!: ReturnType<
    DialogEditTaskRepeatCfgComponent['_previewScheduleCfg']
  >;

  constructor() {
    // Size the dialog surface responsively (widens with the viewport up to a
    // cap, lifts Material's 80vw default so mobile isn't clipped). Fullscreen's
    // panel class overrides this. See `.dialog-recurring` in _overwrite-material.
    this._matDialogRef.addPanelClass('dialog-recurring');

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
    this._lastScheduleSlice = this._previewScheduleCfg();
    effect(() => {
      const slice = this._previewScheduleCfg();
      if (slice !== this._lastScheduleSlice) {
        this._lastScheduleSlice = slice;
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
      const freshCfg: RepeatCfgWorking = {
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
      // Populate the preset's canonical rrule (same processing as the edit path)
      // so the calendar/preview renders for a brand-new recurrence too. A new cfg
      // has no stored initial to diff against, so this is free of #7373 concerns.
      return this._processQuickSettingForDate(freshCfg);
    } else {
      throw new Error('Invalid params given for repeat dialog!');
    }
  }

  /**
   * Chip-picker selection. Mirrors the old formly select `change` handler: set
   * the chosen quickSetting and apply that preset's schedule updates (a preset
   * carries its own canonical rrule; 'RRULE'/Custom keeps the current rule so
   * the builder opens from it). All sync-safe persistence stays in save().
   */
  onQuickSettingSelect(value: string): void {
    this.repeatCfg.update((cfg) => {
      const sd = cfg.startDate as string | Date | undefined;
      const referenceDate =
        sd instanceof Date ? sd : sd ? dateStrToUtcDate(sd) : undefined;
      const updates = getQuickSettingUpdates(value as RepeatQuickSetting, referenceDate);
      return { ...cfg, quickSetting: value as RepeatQuickSetting, ...(updates ?? {}) };
    });
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
      // Editing the rule (builder OR calendar menus) makes it a custom rule —
      // switch the quick-setting to RRULE so the builder shows and a preset label
      // no longer misrepresents the now-edited schedule.
      quickSetting: 'RRULE' as RepeatQuickSetting,
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
      // The in-modal calendar IS the start picker whenever the cfg has a fireable
      // rule (every preset + the builder), so hide this redundant field then;
      // keep it only as a fallback when there is no rule yet to drive a calendar.
      startDateField.hideExpression = (m: Record<string, unknown>) =>
        isRRuleValid(m['rrule'] as string | undefined);
      formConfig[startDateIdx] = startDateField;
    }

    // quickSetting is no longer a formly field — the chip picker
    // (repeat-freq-picker) drives it via onQuickSettingSelect, with options
    // from quickSettingOptions(). formly here only renders title + startDate.

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
      if (scheduleTouched) {
        // Alignment and the no-occurrence probe both need a concrete startDate.
        // The form always sets one, so the absent case is latent — but if it
        // ever happens we still fall through to the legacy re-derivation below
        // (unconditional within `scheduleTouched`), so a non-representable rule
        // can never persist with STALE legacy fields instead of the never-fires
        // sentinel (old/flag-off clients would otherwise fire it on wrong days,
        // contradicting the authoring warning).
        let finalStartDate = working.startDate;
        if (working.startDate) {
          const aligned = getAlignedStartDate(working.rrule as string, working.startDate);
          finalStartDate = aligned ?? working.startDate;
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
        }
        // ALWAYS re-derive the legacy fallback fields against the final
        // startDate — not only when alignment moved it. The builder emits on
        // rule edits only, so a startDate change made after the last builder
        // emit (e.g. a BYDAY-less weekly rule, where no alignment applies)
        // would otherwise persist a new dtstart alongside legacy weekday
        // booleans still derived from the old start date. With no startDate the
        // derivation still runs — `rruleToLegacyTaskRepeatCfg` writes the
        // sentinel for non-representable rules regardless of start.
        this.repeatCfg.update((cfg) => ({
          ...cfg,
          ...(finalStartDate ? { startDate: finalStartDate } : {}),
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

  private _buildQuickSettingOptions(): { value: RepeatQuickSetting; label: string }[] {
    const sd = this.repeatCfg().startDate as string | Date | undefined;
    const refDate =
      sd instanceof Date ? sd : sd ? dateStrToUtcDate(sd) : this._getReferenceDate();
    return buildRepeatQuickSettingOptions(
      refDate,
      this._dateTimeFormatService.currentLocale(),
      this._translateService,
    );
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
    // A kept preset with no stored rrule yet (e.g. a fresh DAILY default, or an
    // older preset cfg): fill in its canonical rrule so the calendar/preview
    // renders immediately for it — the calendar is the start picker for EVERY
    // repeat setting now. repeatCfgInitial mirrors this processed cfg, so the
    // populated rrule is baseline (no change-diff), and the save path overwrites
    // it with the same canonical rule anyway.
    const presetRefDate = cfg.startDate
      ? dateStrToUtcDate(cfg.startDate)
      : this._getReferenceDate();
    const presetRrule = getQuickSettingUpdates(
      cfg.quickSetting as RepeatQuickSetting,
      presetRefDate,
    )?.rrule;
    return presetRrule ? { ...cfg, rrule: presetRrule } : cfg;
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
