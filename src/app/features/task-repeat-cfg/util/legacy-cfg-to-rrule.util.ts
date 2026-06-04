import { Frequency, RRule } from 'rrule';
import {
  MonthlyWeekOfMonth,
  MonthlyWeekday,
  RepeatCycleOption,
  TaskRepeatCfg,
  TaskRepeatCfgCopy,
} from '../task-repeat-cfg.model';
import { normalizeWeekdays, toNumArray } from './rrule-weekday.util';
import { getFirstRRuleOccurrence } from '../store/rrule-occurrence.util';
import { getDbDateStr } from '../../../util/get-db-date-str';

/**
 * Converts a legacy (pre-RRULE) TaskRepeatCfg — `repeatCycle` + `repeatEvery` +
 * weekday flags + monthly anchors — into an equivalent RFC 5545 RRULE body, so
 * old "Custom" recurrences open and keep firing in the RRULE builder after the
 * legacy custom UI was removed.
 *
 * The mapping mirrors the legacy occurrence engine (`get-next-repeat-occurrence`):
 *   DAILY   → FREQ=DAILY[;INTERVAL=n]
 *   WEEKLY  → FREQ=WEEKLY[;INTERVAL=n];BYDAY=<selected weekdays | start weekday>
 *   MONTHLY → nth-weekday  → ;BYDAY=<pos><weekday>     (e.g. 2TU = 2nd Tuesday)
 *             last day     → ;BYMONTHDAY=-1
 *             day-of-month → ;BYMONTHDAY=<startDate day>
 *   YEARLY  → FREQ=YEARLY[;INTERVAL=n];BYMONTH=<m>;BYMONTHDAY=<d>   (from startDate)
 *
 * Known edge differences from the legacy engine (both rare): legacy clamps a
 * day-of-month past month-end to the last day (e.g. 31 → Feb 28) and Feb 29 to
 * Feb 28 in non-leap years, whereas RRULE simply skips months that lack the day.
 */

// Date.getUTCDay() index (0=Sun) → RRULE weekday code.
const JS_DAY_TO_RRULE = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

// Weekday boolean fields in RRULE (Mon-first) output order.
const WEEKLY_FIELDS: { field: keyof TaskRepeatCfg; code: string }[] = [
  { field: 'monday', code: 'MO' },
  { field: 'tuesday', code: 'TU' },
  { field: 'wednesday', code: 'WE' },
  { field: 'thursday', code: 'TH' },
  { field: 'friday', code: 'FR' },
  { field: 'saturday', code: 'SA' },
  { field: 'sunday', code: 'SU' },
];

/** Parse 'YYYY-MM-DD' into 1-based month, day, and UTC day-of-week (today as fallback). */
const _parseStart = (startDate?: string): { month: number; day: number; dow: number } => {
  if (startDate && /^\d{4}-\d{2}-\d{2}/.test(startDate)) {
    const [y, m, d] = startDate.split('-').map(Number);
    return { month: m, day: d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
  }
  const now = new Date();
  return { month: now.getMonth() + 1, day: now.getDate(), dow: now.getDay() };
};

export const legacyTaskRepeatCfgToRRule = (cfg: TaskRepeatCfg): string => {
  const interval =
    Number.isInteger(cfg.repeatEvery) && cfg.repeatEvery > 0 ? cfg.repeatEvery : 1;
  const intervalPart = interval > 1 ? `;INTERVAL=${interval}` : '';
  const { month, day, dow } = _parseStart(cfg.startDate);

  switch (cfg.repeatCycle) {
    case 'DAILY':
      return `FREQ=DAILY${intervalPart}`;

    case 'WEEKLY': {
      const selected = WEEKLY_FIELDS.filter(({ field }) => cfg[field] === true).map(
        (w) => w.code,
      );
      const byDay = selected.length ? selected.join(',') : JS_DAY_TO_RRULE[dow];
      return `FREQ=WEEKLY${intervalPart};BYDAY=${byDay}`;
    }

    case 'MONTHLY': {
      if (cfg.monthlyWeekOfMonth != null && cfg.monthlyWeekday != null) {
        // Nth-weekday anchor, e.g. "2nd Tuesday" → BYDAY=2TU, "last Monday" → -1MO.
        const code = JS_DAY_TO_RRULE[cfg.monthlyWeekday];
        return `FREQ=MONTHLY${intervalPart};BYDAY=${cfg.monthlyWeekOfMonth}${code}`;
      }
      if (cfg.monthlyLastDay) {
        return `FREQ=MONTHLY${intervalPart};BYMONTHDAY=-1`;
      }
      // Clamp semantics: the legacy engine clamps a day past month-end to the
      // month's last day (31 → Feb 28), while a plain BYMONTHDAY=31 would SKIP
      // those months. For day > 28 emit the RFC clamp idiom instead:
      // BYMONTHDAY=<d>,-1;BYSETPOS=1 = "the day, or the last day of a shorter
      // month" — behavior-identical to the legacy clamp.
      if (day > 28) {
        return `FREQ=MONTHLY${intervalPart};BYMONTHDAY=${day},-1;BYSETPOS=1`;
      }
      return `FREQ=MONTHLY${intervalPart};BYMONTHDAY=${day}`;
    }

    case 'YEARLY':
      // Same clamp consideration as MONTHLY: legacy clamps Feb 29 → Feb 28 in
      // non-leap years (and day 29/30/31 in shorter months generally).
      if (day > 28) {
        return `FREQ=YEARLY${intervalPart};BYMONTH=${month};BYMONTHDAY=${day},-1;BYSETPOS=1`;
      }
      return `FREQ=YEARLY${intervalPart};BYMONTH=${month};BYMONTHDAY=${day}`;

    default:
      // Unknown/legacy-less cfg — fall back to a weekly rule on the start weekday.
      return `FREQ=WEEKLY${intervalPart};BYDAY=${JS_DAY_TO_RRULE[dow]}`;
  }
};

const FREQ_TO_CYCLE: Partial<Record<number, RepeatCycleOption>> = {
  [Frequency.DAILY]: 'DAILY',
  [Frequency.WEEKLY]: 'WEEKLY',
  [Frequency.MONTHLY]: 'MONTHLY',
  [Frequency.YEARLY]: 'YEARLY',
};

/** RRULE weekday index (0=Mon … 6=Sun) → legacy weekday boolean field name. */
const RRULE_IDX_TO_FIELD: (keyof TaskRepeatCfg)[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

/**
 * Best-effort inverse of `legacyTaskRepeatCfgToRRule`: derives the legacy schedule
 * fields (`repeatCycle`, `repeatEvery`, weekday flags, monthly anchors) from an
 * RRULE body. Used to keep those fields populated alongside `rrule` so older sync
 * clients — which ignore the unknown `rrule` field — still get a faithful
 * recurrence to fall back on (plan P1.3 reverse direction).
 *
 * Returns `{}` for an unparseable or sub-daily rule (legacy fields left untouched).
 * Day-of-month has no legacy field: legacy MONTHLY day recurrence (and YEARLY)
 * reads the day/month from `startDate`, so for date-anchored rules an aligned
 * `startDate` (first occurrence on/after the current one) is emitted instead.
 */
export const rruleToLegacyTaskRepeatCfg = (
  rrule: string,
  startDate?: string,
): Partial<TaskRepeatCfg> => {
  let opts: Partial<ReturnType<typeof RRule.parseString>>;
  try {
    opts = RRule.parseString(rrule);
  } catch {
    return {};
  }
  if (opts.freq == null) return {};
  const cycle = FREQ_TO_CYCLE[opts.freq];
  if (!cycle) return {}; // sub-daily — no legacy equivalent

  // Build on the mutable copy type — TaskRepeatCfg is Readonly.
  const out: Partial<TaskRepeatCfgCopy> = {
    repeatCycle: cycle,
    repeatEvery: opts.interval && opts.interval > 0 ? opts.interval : 1,
    // Monthly anchors discriminate the legacy MONTHLY paths — always reset so a
    // stale nth-weekday/last-day anchor from a previous preset or rule can't
    // override the new rule's semantics on old clients. They are re-set below
    // only when this rule actually encodes them.
    monthlyWeekOfMonth: undefined,
    monthlyWeekday: undefined,
    monthlyLastDay: undefined,
  };

  const weekdays = normalizeWeekdays(opts.byweekday);
  const monthDays = toNumArray(opts.bymonthday);

  if (cycle === 'WEEKLY') {
    // Reset all flags, then enable the rule's weekdays (Mon-indexed).
    RRULE_IDX_TO_FIELD.forEach((field) => {
      (out as Record<string, unknown>)[field] = false;
    });
    if (weekdays.length) {
      weekdays.forEach((w) => {
        const field = RRULE_IDX_TO_FIELD[w.weekday];
        if (field) (out as Record<string, unknown>)[field] = true;
      });
    } else if (startDate) {
      // A BYDAY-less FREQ=WEEKLY means "weekly on the start weekday" — set that
      // flag (mirroring the forward converter), so the legacy WEEKLY engine
      // still fires on older clients instead of having every flag false.
      const idx = (_parseStart(startDate).dow + 6) % 7; // UTC 0=Sun → RRULE 0=Mon
      const field = RRULE_IDX_TO_FIELD[idx];
      if (field) (out as Record<string, unknown>)[field] = true;
    }
  } else if (cycle === 'MONTHLY') {
    if (weekdays.length && weekdays[0].n != null) {
      // "2nd Tuesday" → BYDAY=2TU. legacy monthlyWeekday is 0=Sun…6=Sat.
      out.monthlyWeekOfMonth = weekdays[0].n as MonthlyWeekOfMonth;
      out.monthlyWeekday = ((weekdays[0].weekday + 1) % 7) as MonthlyWeekday;
    } else if (monthDays.length === 1 && monthDays[0] === -1) {
      // Pure "last day of month". NOT set for the clamp idiom
      // (BYMONTHDAY=<d>,-1;BYSETPOS=1) — there the legacy day comes from the
      // aligned startDate below, and the legacy engine clamps it natively.
      out.monthlyLastDay = true;
    }
  }

  // Legacy MONTHLY day-of-month and YEARLY recurrence read the day (and month)
  // from `startDate`, so it must sit on an occurrence of the rule. Align it to
  // the first occurrence on/after the current start — e.g. BYMONTHDAY=15 with a
  // startDate on the 3rd must move the start to the 15th, else old clients fire
  // on the 3rd.
  const isDateAnchored = monthDays.length > 0 && !weekdays.length;
  if (
    startDate &&
    ((cycle === 'MONTHLY' && isDateAnchored && !out.monthlyLastDay) || cycle === 'YEARLY')
  ) {
    const first = getFirstRRuleOccurrence({ rrule, startDate });
    if (first) {
      const aligned = getDbDateStr(first);
      if (aligned !== startDate) out.startDate = aligned;
    }
  }

  return out;
};
