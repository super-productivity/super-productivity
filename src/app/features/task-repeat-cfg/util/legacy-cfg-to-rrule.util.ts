import { Frequency, RRule } from 'rrule';
import {
  MonthlyWeekOfMonth,
  MonthlyWeekday,
  RepeatCycleOption,
  TaskRepeatCfg,
  TaskRepeatCfgCopy,
} from '../task-repeat-cfg.model';

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
      return `FREQ=MONTHLY${intervalPart};BYMONTHDAY=${day}`;
    }

    case 'YEARLY':
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

/** Normalize rrule's `byweekday` option to `{ weekday, n }` records. */
const _normalizeWeekdays = (v: unknown): { weekday: number; n?: number }[] => {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr
    .map((w) => {
      if (typeof w === 'number') return { weekday: w };
      if (w && typeof w === 'object' && 'weekday' in w) {
        const wd = w as { weekday: number; n?: number };
        return { weekday: wd.weekday, n: wd.n ?? undefined };
      }
      return null;
    })
    .filter((x): x is { weekday: number; n?: number } => x !== null);
};

const _toNumArray = (v: unknown): number[] => {
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter((x): x is number => typeof x === 'number');
  return typeof v === 'number' ? [v] : [];
};

/**
 * Best-effort inverse of `legacyTaskRepeatCfgToRRule`: derives the legacy schedule
 * fields (`repeatCycle`, `repeatEvery`, weekday flags, monthly anchors) from an
 * RRULE body. Used to keep those fields populated alongside `rrule` so older sync
 * clients — which ignore the unknown `rrule` field — still get a faithful
 * recurrence to fall back on (plan P1.3 reverse direction).
 *
 * Returns `{}` for an unparseable or sub-daily rule (legacy fields left untouched).
 * Day-of-month is intentionally not emitted: legacy MONTHLY day recurrence reads
 * the day from `startDate`, so the caller keeps `startDate` aligned instead.
 */
export const rruleToLegacyTaskRepeatCfg = (rrule: string): Partial<TaskRepeatCfg> => {
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
  };

  const weekdays = _normalizeWeekdays(opts.byweekday);

  if (cycle === 'WEEKLY') {
    // Reset all flags, then enable the rule's weekdays (Mon-indexed).
    RRULE_IDX_TO_FIELD.forEach((field) => {
      (out as Record<string, unknown>)[field] = false;
    });
    weekdays.forEach((w) => {
      const field = RRULE_IDX_TO_FIELD[w.weekday];
      if (field) (out as Record<string, unknown>)[field] = true;
    });
  } else if (cycle === 'MONTHLY') {
    if (weekdays.length && weekdays[0].n != null) {
      // "2nd Tuesday" → BYDAY=2TU. legacy monthlyWeekday is 0=Sun…6=Sat.
      out.monthlyWeekOfMonth = weekdays[0].n as MonthlyWeekOfMonth;
      out.monthlyWeekday = ((weekdays[0].weekday + 1) % 7) as MonthlyWeekday;
    } else if (_toNumArray(opts.bymonthday).includes(-1)) {
      out.monthlyLastDay = true;
    }
  }

  return out;
};
