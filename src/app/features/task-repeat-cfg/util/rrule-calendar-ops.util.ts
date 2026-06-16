import {
  formModelToRRule,
  RRULE_WEEKDAYS,
  RRuleFormModel,
  RRuleWeekday,
  rruleToFormModel,
} from './rrule-form.util';

/**
 * Pure edit operations that let the preview calendar manipulate the RRULE string
 * directly (click a day / weekday / month → patch the rule). Every op is
 * `(rrule, refDate, …) => newRrule`: parse the current rule into the structured
 * form model, patch one field, and re-serialize — so all rule logic stays in
 * `rrule-form.util.ts` (shared with the builder) and is never duplicated.
 *
 * The calendar and the builder therefore edit the SAME rule: the dialog routes
 * these results through its `onRRuleChange`, the builder re-syncs from the input.
 */

type MonthlyOrYearly = 'MONTHLY' | 'YEARLY';
type ByDayFreq = 'WEEKLY' | 'MONTHLY' | 'YEARLY';

const edit = (
  rrule: string | undefined,
  refDate: Date,
  patch: (m: RRuleFormModel) => void,
): string => {
  const model = rruleToFormModel(rrule, refDate);
  patch(model);
  // A calendar click is an explicit intent to define the rule structurally, so
  // never let a parse-time raw override (set by the round-trip guard for rules
  // the structured form can't reproduce verbatim) short-circuit serialization.
  model.rawOverride = '';
  return formModelToRRule(model);
};

/** Order a weekday list Mon-first so the emitted BYDAY is canonical. */
const monFirst = (days: RRuleWeekday[]): RRuleWeekday[] =>
  RRULE_WEEKDAYS.filter((d) => days.includes(d));

/** Toggle a day-of-month (1..31, or -1 last) in MONTHLY day-of-month mode. */
export const toggleMonthDay = (
  rrule: string | undefined,
  refDate: Date,
  day: number,
): string =>
  edit(rrule, refDate, (m) => {
    // Switching INTO day-of-month from another mode starts a fresh set (don't
    // inherit the refDate-seeded default day); within the mode, toggle.
    const wasMode = m.freq === 'MONTHLY' && m.monthlyMode === 'DAY_OF_MONTH';
    m.freq = 'MONTHLY';
    m.monthlyMode = 'DAY_OF_MONTH';
    if (!wasMode) {
      m.monthDays = [day];
    } else {
      m.monthDays = m.monthDays.includes(day)
        ? m.monthDays.filter((d) => d !== day)
        : [...m.monthDays, day].sort((a, b) => a - b);
    }
  });

/** Set the single YEARLY date (month 1..12 + day 1..31). Re-click a different
 *  day to move it; clicking the active date again clears it back to start-anchored. */
export const setYearDay = (
  rrule: string | undefined,
  refDate: Date,
  month: number,
  day: number,
): string =>
  edit(rrule, refDate, (m) => {
    m.freq = 'YEARLY';
    m.yearlyMode = 'DAY_OF_MONTH';
    const isActive =
      m.byMonth.length === 1 &&
      m.byMonth[0] === month &&
      m.monthDays.length === 1 &&
      m.monthDays[0] === day;
    if (isActive) {
      m.byMonth = [];
      m.monthDays = [];
    } else {
      m.byMonth = [month];
      m.monthDays = [day];
    }
  });

/** Set UNTIL (end on date) and flip the end-type to UNTIL. */
export const setUntil = (
  rrule: string | undefined,
  refDate: Date,
  dateStr: string,
): string =>
  edit(rrule, refDate, (m) => {
    m.endType = 'UNTIL';
    m.until = dateStr;
  });

/** Set the end condition: NEVER / after COUNT / UNTIL a date. */
export const setEnd = (
  rrule: string | undefined,
  refDate: Date,
  endType: 'NEVER' | 'COUNT' | 'UNTIL',
  value?: string | number,
): string =>
  edit(rrule, refDate, (m) => {
    m.endType = endType;
    if (endType === 'COUNT' && value != null) {
      m.count = Math.max(1, Math.trunc(Number(value)) || 1);
    }
    if (endType === 'UNTIL' && value != null) {
      m.until = String(value);
    }
  });

/** Toggle a plain weekday in the "selected days of the week" set, in WEEKLY /
 *  MONTHLY / YEARLY mode (WEEKLY = the native weekly BYDAY; MONTHLY/YEARLY =
 *  their WEEKDAYS mode). */
export const toggleByDay = (
  rrule: string | undefined,
  refDate: Date,
  weekday: RRuleWeekday,
  freq: ByDayFreq,
): string =>
  edit(rrule, refDate, (m) => {
    const wasMode =
      freq === 'WEEKLY'
        ? m.freq === 'WEEKLY'
        : freq === 'MONTHLY'
          ? m.freq === 'MONTHLY' && m.monthlyMode === 'WEEKDAYS'
          : m.freq === 'YEARLY' && m.yearlyMode === 'WEEKDAYS';
    m.freq = freq;
    if (freq === 'MONTHLY') {
      m.monthlyMode = 'WEEKDAYS';
    } else if (freq === 'YEARLY') {
      m.yearlyMode = 'WEEKDAYS';
    }
    const base = wasMode ? m.byDay : [];
    const has = base.includes(weekday);
    m.byDay = monFirst(has ? base.filter((d) => d !== weekday) : [...base, weekday]);
  });

/** Toggle a weekday at a given ordinal (1..4, -1 last) in nth-weekday mode. */
export const toggleNthDay = (
  rrule: string | undefined,
  refDate: Date,
  weekday: RRuleWeekday,
  ordinal: number,
  freq: MonthlyOrYearly,
): string =>
  edit(rrule, refDate, (m) => {
    const wasMode =
      freq === 'MONTHLY'
        ? m.freq === 'MONTHLY' && m.monthlyMode === 'NTH_WEEKDAY'
        : m.freq === 'YEARLY' && m.yearlyMode === 'NTH_WEEKDAY';
    m.freq = freq;
    if (freq === 'MONTHLY') {
      m.monthlyMode = 'NTH_WEEKDAY';
    } else {
      m.yearlyMode = 'NTH_WEEKDAY';
    }
    const rows = wasMode ? m.nthDays.map((r) => ({ pos: r.pos, days: [...r.days] })) : [];
    const row = rows.find((r) => r.pos === ordinal);
    if (row) {
      row.days = monFirst(
        row.days.includes(weekday)
          ? row.days.filter((d) => d !== weekday)
          : [...row.days, weekday],
      );
    } else {
      rows.push({ pos: ordinal, days: [weekday] });
    }
    m.nthDays = rows.filter((r) => r.days.length > 0);
  });

/** Toggle a month (1..12) in the BYMONTH seasonal constraint. */
export const toggleByMonth = (
  rrule: string | undefined,
  refDate: Date,
  month: number,
): string =>
  edit(rrule, refDate, (m) => {
    const has = m.byMonth.includes(month);
    m.byMonth = has
      ? m.byMonth.filter((x) => x !== month)
      : [...m.byMonth, month].sort((a, b) => a - b);
  });

/** Clear ALL BYMONTH limits (the rule fires in every month again). */
export const clearMonths = (rrule: string | undefined, refDate: Date): string =>
  edit(rrule, refDate, (m) => {
    m.byMonth = [];
  });

/** Per-weekday annotation glyph state, derived from the live rule. Keyed by the
 *  RRULE weekday index (0=Mon … 6=Sun) so the calendar can map its columns. */
export interface WeekdayAnnotation {
  /** Ordinal labels for nth-weekday mode, e.g. ['2','L'] for 2nd + last. */
  nth: string[];
  /** Member of the MONTHLY "selected days of the week" set. */
  selected: boolean;
  /** Member of the YEARLY "days of the week in months" set. */
  inMonths: boolean;
}

/** Short ordinal glyph: 1..4 → "1".."4"; -1 → "L"; other → the signed number. */
const ordinalGlyph = (pos: number): string => (pos === -1 ? 'L' : String(pos));

/** Build per-weekday annotations from a parsed model (pure; used by the dialog to
 *  feed the calendar's weekday-header glyphs). Only the active mode contributes. */
export const weekdayAnnotations = (
  model: RRuleFormModel,
): Map<number, WeekdayAnnotation> => {
  const map = new Map<number, WeekdayAnnotation>();
  const ensure = (idx: number): WeekdayAnnotation => {
    let a = map.get(idx);
    if (!a) {
      a = { nth: [], selected: false, inMonths: false };
      map.set(idx, a);
    }
    return a;
  };
  const idxOf = (wd: RRuleWeekday): number => RRULE_WEEKDAYS.indexOf(wd);

  const nthActive =
    (model.freq === 'MONTHLY' && model.monthlyMode === 'NTH_WEEKDAY') ||
    (model.freq === 'YEARLY' && model.yearlyMode === 'NTH_WEEKDAY');
  if (nthActive) {
    for (const row of model.nthDays) {
      for (const d of row.days) {
        ensure(idxOf(d)).nth.push(ordinalGlyph(row.pos));
      }
    }
  }

  if (
    model.freq === 'WEEKLY' ||
    (model.freq === 'MONTHLY' && model.monthlyMode === 'WEEKDAYS')
  ) {
    for (const d of model.byDay) {
      ensure(idxOf(d)).selected = true;
    }
  }
  if (model.freq === 'YEARLY' && model.yearlyMode === 'WEEKDAYS') {
    for (const d of model.byDay) {
      ensure(idxOf(d)).inMonths = true;
    }
  }
  return map;
};
