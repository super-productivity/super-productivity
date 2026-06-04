import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { CollapsibleComponent } from '../../../../ui/collapsible/collapsible.component';
import { T } from '../../../../t.const';
import { dateStrToUtcDate } from '../../../../util/date-str-to-utc-date';
import {
  defaultRRuleFormModel,
  formModelToRRule,
  RRULE_WEEKDAYS,
  RRuleFormModel,
  RRuleNthDay,
  RRuleSetPos,
  RRuleWeekday,
  rruleToFormModel,
} from '../../util/rrule-form.util';

interface SelectOpt<V> {
  value: V;
  label: string;
}

// Translation keys ordered to match RRULE_WEEKDAYS (MO..SU) and months 1..12.
const WEEKDAY_T_KEYS = [
  T.F.TASK_REPEAT.F.MONDAY,
  T.F.TASK_REPEAT.F.TUESDAY,
  T.F.TASK_REPEAT.F.WEDNESDAY,
  T.F.TASK_REPEAT.F.THURSDAY,
  T.F.TASK_REPEAT.F.FRIDAY,
  T.F.TASK_REPEAT.F.SATURDAY,
  T.F.TASK_REPEAT.F.SUNDAY,
];
const MONTH_T_KEYS = [
  T.F.TASK_REPEAT.F.RRULE_MONTH_1,
  T.F.TASK_REPEAT.F.RRULE_MONTH_2,
  T.F.TASK_REPEAT.F.RRULE_MONTH_3,
  T.F.TASK_REPEAT.F.RRULE_MONTH_4,
  T.F.TASK_REPEAT.F.RRULE_MONTH_5,
  T.F.TASK_REPEAT.F.RRULE_MONTH_6,
  T.F.TASK_REPEAT.F.RRULE_MONTH_7,
  T.F.TASK_REPEAT.F.RRULE_MONTH_8,
  T.F.TASK_REPEAT.F.RRULE_MONTH_9,
  T.F.TASK_REPEAT.F.RRULE_MONTH_10,
  T.F.TASK_REPEAT.F.RRULE_MONTH_11,
  T.F.TASK_REPEAT.F.RRULE_MONTH_12,
];

/**
 * Purpose-built, readable RRULE editor. Renders weekdays/months as toggle
 * buttons and arranges the rest as short labelled rows. All recurrence logic
 * lives in `rrule-form.util` (shared with the @+ parser and the engine); this
 * component only owns the view + emits the assembled rrule string.
 */
@Component({
  selector: 'rrule-builder',
  templateUrl: './rrule-builder.component.html',
  styleUrls: ['./rrule-builder.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, CollapsibleComponent],
})
export class RruleBuilderComponent implements OnInit {
  private _translateService = inject(TranslateService);
  T: typeof T = T;

  rrule = input<string>('');
  startDate = input<string | undefined>(undefined);
  repeatFromCompletion = input<boolean>(false);
  rruleChange = output<string>();
  repeatFromCompletionChange = output<boolean>();

  private _model = signal<RRuleFormModel>(defaultRRuleFormModel());
  model = this._model.asReadonly();
  // Orthogonal to the rrule string: re-anchors the interval to the completion
  // day. Owned here (not in the rrule body) and surfaced to the dialog via output.
  private _fromCompletion = signal(false);
  fromCompletion = this._fromCompletion.asReadonly();

  // Toggle data — short label for the button, full name for the tooltip.
  weekdays = RRULE_WEEKDAYS.map((value, i) => {
    const full = this._translateService.instant(WEEKDAY_T_KEYS[i]) as string;
    return { value: value as RRuleWeekday, full, short: full.slice(0, 2) };
  });
  months = MONTH_T_KEYS.map((key, i) => {
    const full = this._translateService.instant(key) as string;
    return { value: i + 1, full, short: full.slice(0, 3) };
  });

  freqOpts: SelectOpt<RRuleFormModel['freq']>[] = [
    { value: 'DAILY', label: T.F.TASK_REPEAT.F.C_DAY },
    { value: 'WEEKLY', label: T.F.TASK_REPEAT.F.C_WEEK },
    { value: 'MONTHLY', label: T.F.TASK_REPEAT.F.C_MONTH },
    { value: 'YEARLY', label: T.F.TASK_REPEAT.F.C_YEAR },
  ];
  monthlyModeOpts: SelectOpt<RRuleFormModel['monthlyMode']>[] = [
    { value: 'DAY_OF_MONTH', label: T.F.TASK_REPEAT.F.RRULE_MODE_DAY_OF_MONTH },
    { value: 'NTH_WEEKDAY', label: T.F.TASK_REPEAT.F.RRULE_MODE_NTH_WEEKDAY },
    { value: 'WEEKDAYS', label: T.F.TASK_REPEAT.F.RRULE_MODE_WEEKDAYS },
  ];
  // Day-of-month grid (1..31) plus "from the end" toggles.
  dayGrid = Array.from({ length: 31 }, (_, i) => i + 1);
  negativeDays: SelectOpt<number>[] = [
    { value: -1, label: T.F.TASK_REPEAT.F.RRULE_DAY_LAST },
    { value: -2, label: T.F.TASK_REPEAT.F.RRULE_DAY_2ND_LAST },
    { value: -3, label: T.F.TASK_REPEAT.F.RRULE_DAY_3RD_LAST },
  ];
  yearlyModeOpts: SelectOpt<RRuleFormModel['yearlyMode']>[] = [
    { value: 'DAY_OF_MONTH', label: T.F.TASK_REPEAT.F.RRULE_MODE_ON_DATE },
    { value: 'NTH_WEEKDAY', label: T.F.TASK_REPEAT.F.RRULE_MODE_NTH_WEEKDAY },
    { value: 'WEEKDAYS', label: T.F.TASK_REPEAT.F.RRULE_MODE_ON_WEEKDAYS },
  ];
  ordinalOpts: SelectOpt<RRuleSetPos>[] = [
    { value: 1, label: T.F.TASK_REPEAT.F.ORD_FIRST },
    { value: 2, label: T.F.TASK_REPEAT.F.ORD_SECOND },
    { value: 3, label: T.F.TASK_REPEAT.F.ORD_THIRD },
    { value: 4, label: T.F.TASK_REPEAT.F.ORD_FOURTH },
    { value: -1, label: T.F.TASK_REPEAT.F.ORD_LAST },
  ];
  /** Sentinel select value for the per-row custom ordinal input. */
  readonly ORD_CUSTOM = 'CUSTOM';
  endOpts: SelectOpt<RRuleFormModel['endType']>[] = [
    { value: 'NEVER', label: T.F.TASK_REPEAT.F.RRULE_END_NEVER },
    { value: 'UNTIL', label: T.F.TASK_REPEAT.F.RRULE_END_UNTIL },
    { value: 'COUNT', label: T.F.TASK_REPEAT.F.RRULE_END_COUNT },
  ];
  weekdaySelectOpts: SelectOpt<RRuleWeekday>[] = this.weekdays.map((w) => ({
    value: w.value,
    label: w.full,
  }));

  constructor() {
    // Emit the assembled rule once after the first render (outputs are wired,
    // no change-after-checked) so a fresh builder gives the dialog a valid rrule
    // even before the user touches anything.
    afterNextRender(() => this.rruleChange.emit(formModelToRRule(this._model())));
  }

  // Start month (1..12) — seeds BYMONTH when switching to YEARLY (see setFreq).
  private _refMonth = new Date().getMonth() + 1;

  ngOnInit(): void {
    const ref = this.startDate()
      ? dateStrToUtcDate(this.startDate() as string)
      : new Date();
    this._refMonth = ref.getMonth() + 1;
    this._model.set(rruleToFormModel(this.rrule(), ref));
    this._fromCompletion.set(this.repeatFromCompletion());
  }

  private _patch(patch: Partial<RRuleFormModel>): void {
    this._model.update((m) => ({ ...m, ...patch }));
    this.rruleChange.emit(formModelToRRule(this._model()));
  }

  // --- field setters (kept out of the template for type-safety) ---
  setFreq(v: string): void {
    const freq = v as RRuleFormModel['freq'];
    // YEARLY date/weekday modes need BYMONTH: per RFC 5545, FREQ=YEARLY with a
    // bare BYMONTHDAY (or ordinal BYDAY) expands across every month of the
    // year — i.e. fires monthly. Seed the start month so a fresh yearly rule
    // means "once a year" until the user picks other months.
    if (freq === 'YEARLY' && !this._model().byMonth.length) {
      this._patch({ freq, byMonth: [this._refMonth] });
      return;
    }
    this._patch({ freq });
  }
  setInterval(v: string): void {
    this._patch({ interval: Math.max(1, Math.floor(+v) || 1) });
  }
  toggleDay(d: RRuleWeekday): void {
    const cur = this._model().byDay;
    this._patch({ byDay: cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d] });
  }
  toggleMonth(m: number): void {
    const cur = this._model().byMonth;
    this._patch({ byMonth: cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m] });
  }
  setMonthlyMode(v: string): void {
    this._patch({ monthlyMode: v as RRuleFormModel['monthlyMode'] });
  }
  setYearlyMode(v: string): void {
    this._patch({ yearlyMode: v as RRuleFormModel['yearlyMode'] });
  }
  // --- nth-weekday rows (per-weekday ordinals → BYDAY=3MO,4SU) ---
  /** True while either the monthly or yearly nth-weekday mode is active. */
  isNthMode(): boolean {
    const m = this._model();
    return (
      (m.freq === 'MONTHLY' && m.monthlyMode === 'NTH_WEEKDAY') ||
      (m.freq === 'YEARLY' && m.yearlyMode === 'NTH_WEEKDAY')
    );
  }
  // Rows explicitly switched to the custom ordinal input (kept out of the form
  // model — pure view state). Rows whose pos has no predefined option are
  // custom implicitly (e.g. a parsed `BYDAY=-2MO`).
  private _customNthRows = signal<ReadonlySet<number>>(new Set());

  private _patchNthDay(i: number, patch: Partial<RRuleNthDay>): void {
    this._patch({
      nthDays: this._model().nthDays.map((d, idx) =>
        idx === i ? { ...d, ...patch } : d,
      ),
    });
  }
  isNthRowCustom(i: number): boolean {
    if (this._customNthRows().has(i)) return true;
    const pos = this._model().nthDays[i]?.pos;
    return pos != null && !this.ordinalOpts.some((o) => o.value === pos);
  }
  setNthDayPos(i: number, v: string): void {
    if (v === this.ORD_CUSTOM) {
      // Switch the row to the free-form ordinal input; keep the current pos as
      // its starting value.
      this._customNthRows.update((s) => new Set(s).add(i));
      return;
    }
    this._customNthRows.update((s) => {
      const next = new Set(s);
      next.delete(i);
      return next;
    });
    this._patchNthDay(i, { pos: +v });
  }
  /** Free-form ordinal (custom input): any non-zero integer, ±1..±53 (RFC 5545). */
  setNthDayCustomPos(i: number, v: string): void {
    const n = Math.trunc(+v);
    if (!Number.isInteger(n) || n === 0) return; // ignore invalid/zero input
    this._patchNthDay(i, { pos: Math.max(-53, Math.min(53, n)) });
  }
  /** Multi-select a weekday within an ordinal row; keep it Mon-first. */
  toggleNthDayWeekday(i: number, d: RRuleWeekday): void {
    const cur = this._model().nthDays[i]?.days ?? [];
    const next = cur.includes(d)
      ? cur.filter((x) => x !== d)
      : RRULE_WEEKDAYS.filter((w) => cur.includes(w) || w === d);
    this._patchNthDay(i, { days: next });
  }
  /** Ordinal options for a row = all minus the positions used by OTHER rows, so
   *  each ordinal ("first", "last", …) anchors at most one row. */
  availableOrdinalOpts(i: number): SelectOpt<RRuleSetPos>[] {
    const usedElsewhere = new Set(
      this._model()
        .nthDays.filter((_, idx) => idx !== i)
        .map((d) => d.pos),
    );
    return this.ordinalOpts.filter((o) => !usedElsewhere.has(o.value));
  }
  /** A new row can be added while an unused ordinal position remains. */
  canAddNthDay(): boolean {
    return this._model().nthDays.length < this.ordinalOpts.length;
  }
  addNthDay(): void {
    const used = new Set(this._model().nthDays.map((d) => d.pos));
    const next = this.ordinalOpts.map((o) => o.value).find((p) => !used.has(p));
    if (next == null) return; // every ordinal already anchors a row
    this._patch({ nthDays: [...this._model().nthDays, { pos: next, days: [] }] });
  }
  removeNthDay(i: number): void {
    const cur = this._model().nthDays;
    if (cur.length <= 1) return; // keep at least one row
    // Row indices shift down past the removed row — remap the custom-row set.
    this._customNthRows.update(
      (s) => new Set([...s].filter((x) => x !== i).map((x) => (x > i ? x - 1 : x))),
    );
    this._patch({ nthDays: cur.filter((_, idx) => idx !== i) });
  }
  toggleMonthDay(n: number): void {
    const cur = this._model().monthDays;
    this._patch({
      monthDays: cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n],
    });
  }
  /** Custom override for the day list — accepts any valid day, e.g. "1,15,-5". */
  setMonthDays(v: string): void {
    const nums = v
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n !== 0 && n >= -31 && n <= 31);
    this._patch({ monthDays: nums });
  }
  setEndType(v: string): void {
    this._patch({ endType: v as RRuleFormModel['endType'] });
  }
  setCount(v: string): void {
    this._patch({ count: Math.max(1, Math.floor(+v) || 1) });
  }
  setUntil(v: string): void {
    this._patch({ until: v });
  }
  setShowAdvanced(v: boolean): void {
    this._patch({ showAdvanced: v });
  }
  setWkst(v: string): void {
    this._patch({ wkst: v as RRuleFormModel['wkst'] });
  }
  // --- weekday-set "which occurrence" (BYSETPOS, multi-select toggles) ---
  // The custom input was explicitly opened. Values with no predefined toggle
  // (e.g. a parsed "5") keep it visible implicitly — see isSetPosCustom().
  private _customSetPos = signal(false);

  /** The current BYSETPOS values (parsed from the comma-separated model field). */
  setPosValues(): number[] {
    return this._model()
      .bySetPos.split(',')
      .map((s) => Math.trunc(+s.trim()))
      .filter((n) => Number.isInteger(n) && n !== 0);
  }
  isSetPosActive(v: number): boolean {
    return this.setPosValues().includes(v);
  }
  /** "Every" = no BYSETPOS narrowing at all. */
  isSetPosEvery(): boolean {
    return !this.setPosValues().length && !this._customSetPos();
  }
  isSetPosCustom(): boolean {
    return (
      this._customSetPos() ||
      this.setPosValues().some((v) => !this.ordinalOpts.some((o) => o.value === v))
    );
  }
  /** Keep toggles tidy: predefined positions in dropdown order, then customs. */
  private _normalizeSetPos(vals: number[]): number[] {
    const pre = this.ordinalOpts
      .map((o) => o.value as number)
      .filter((v) => vals.includes(v));
    const rest = vals.filter((v) => !pre.includes(v)).sort((a, b) => a - b);
    return [...pre, ...rest];
  }
  toggleSetPos(v: number): void {
    const cur = this.setPosValues();
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    this._patch({ bySetPos: this._normalizeSetPos(next).join(',') });
  }
  clearSetPos(): void {
    this._customSetPos.set(false);
    this._patch({ bySetPos: '' });
  }
  toggleSetPosCustomMode(): void {
    this._customSetPos.update((v) => !v);
  }
  /** Free-form BYSETPOS (custom input): comma-separated non-zero integers,
   *  each clamped to ±366 (RFC 5545). Invalid tokens are dropped. */
  setCustomBySetPos(v: string): void {
    const nums = v
      .split(',')
      .map((s) => Math.trunc(+s.trim()))
      .filter((n) => Number.isInteger(n) && n !== 0)
      .map((n) => Math.max(-366, Math.min(366, n)));
    this._patch({ bySetPos: nums.join(',') });
  }
  setByWeekNo(v: string): void {
    this._patch({ byWeekNo: v });
  }
  setByYearDay(v: string): void {
    this._patch({ byYearDay: v });
  }
  setRawOverride(v: string): void {
    this._patch({ rawOverride: v });
  }
  setRepeatFromCompletion(v: boolean): void {
    this._fromCompletion.set(v);
    this.repeatFromCompletionChange.emit(v);
  }
}
