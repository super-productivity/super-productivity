import { RepeatDuePeriod, RepeatDueType, TaskRepeatCfg } from '../task-repeat-cfg.model';

/**
 * Pure derivation of a recurring instance's DUE day from its APPEARS day.
 *
 * Every generated recurring task has two dates:
 *   - "appears" = the RFC 5545 occurrence day (stored as the task's `created`),
 *   - "due"     = the deadline (`dueDay` / `dueWithTime`).
 *
 * Historically Due always equalled appears. `TaskRepeatCfg.dueType` (+ params)
 * lets Due be derived instead. This util is the single source of truth: the
 * occurrence engine calls it to stamp `dueDay` when materializing an instance,
 * and the dialog preview calls it to project Due days without creating tasks
 * (recompute-on-read). All math is whole-day UTC, so it is timezone-stable like
 * the occurrence engine (`rrule-occurrence.util`).
 *
 * Returns a `YYYY-MM-DD` string, or `null` when there is no due day (the `NONE`
 * type, or a dynamic type whose context is missing).
 */

export interface RecurringDueCtx {
  /** The instance's appears/occurrence day, `YYYY-MM-DD`. */
  appearsDate: string;
  /** The next occurrence day after this one, `YYYY-MM-DD` — for UNTIL_NEXT. */
  nextAppearsDate?: string;
  /** Actual completion day, `YYYY-MM-DD` — for FROM_COMPLETION (else projected). */
  completionDate?: string;
  /**
   * Days between the template task's own creation and its due day, applied as
   * the OFFSET gap when no explicit `dueOffset` is set (the iCal DURATION idea).
   */
  inheritedOffsetDays?: number;
  /** Week start (0=Sun … 6=Sat) for PERIOD_END='WEEK'. Defaults to Monday. */
  firstDayOfWeek?: number;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DD` → UTC-midnight Date, or null if unparseable. */
const _toUtc = (dateStr: string | undefined): Date | null => {
  if (!dateStr) return null;
  const m = DATE_RE.exec(dateStr);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
};

/** UTC Date → `YYYY-MM-DD`. */
const _toStr = (d: Date): string =>
  `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

const _addDays = (d: Date, n: number): Date => {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
};

/** Add `n` business days (skip Sat/Sun). `n` may be negative; n=0 is a no-op. */
const _addBusinessDays = (d: Date, n: number): Date => {
  if (n === 0) return new Date(d);
  const step = n > 0 ? 1 : -1;
  let remaining = Math.abs(n);
  let cur = new Date(d);
  while (remaining > 0) {
    cur = _addDays(cur, step);
    const dow = cur.getUTCDay(); // 0=Sun, 6=Sat
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return cur;
};

/** Last day of the week/month/quarter/year containing `d`. */
const _periodEnd = (d: Date, period: RepeatDuePeriod, firstDayOfWeek: number): Date => {
  const y = d.getUTCFullYear();
  const mIdx = d.getUTCMonth(); // 0-based
  switch (period) {
    case 'WEEK': {
      // Days from the week start to `d`, then jump to the 7th day of that week.
      const offset = (d.getUTCDay() - firstDayOfWeek + 7) % 7;
      return _addDays(d, 6 - offset);
    }
    case 'MONTH':
      // Day 0 of the next month = last day of this month.
      return new Date(Date.UTC(y, mIdx + 1, 0));
    case 'QUARTER': {
      // First month of the quarter (0-based: 0, 3, 6, 9), then jump 3 months on
      // and back a day → the quarter's last day.
      const firstMonthOfQuarter = Math.floor(mIdx / 3) * 3;
      return new Date(Date.UTC(y, firstMonthOfQuarter + 3, 0));
    }
    case 'YEAR':
      return new Date(Date.UTC(y, 12, 0)); // Dec 31
  }
};

/** Resolve the OFFSET gap and unit into a shifted date. */
const _applyOffset = (
  base: Date,
  offset: number,
  unit: TaskRepeatCfg['dueOffsetUnit'],
): Date => {
  switch (unit) {
    case 'BUSINESS_DAY':
      return _addBusinessDays(base, offset);
    case 'WEEK':
      return _addDays(base, offset * 7);
    case 'DAY':
    default:
      return _addDays(base, offset);
  }
};

/**
 * Derive the DUE day (`YYYY-MM-DD`) for one recurring instance, or `null` for no
 * due day. `ctx.appearsDate` is required; the other context fields back the
 * dynamic / inherited types and may be omitted (the function falls back safely).
 */
export const getRecurringInstanceDueDate = (
  cfg: Pick<
    TaskRepeatCfg,
    'dueType' | 'dueAnchor' | 'dueOffset' | 'dueOffsetUnit' | 'dueFixedDate' | 'duePeriod'
  >,
  ctx: RecurringDueCtx,
): string | null => {
  const appears = _toUtc(ctx.appearsDate);
  if (!appears) return null;
  const type: RepeatDueType = cfg.dueType ?? 'ON_OCCURRENCE';

  switch (type) {
    case 'ON_OCCURRENCE':
      return ctx.appearsDate;

    case 'NONE':
      return null;

    case 'FIXED':
      return cfg.dueFixedDate ?? null;

    case 'PERIOD_END':
      return _toStr(
        _periodEnd(appears, cfg.duePeriod ?? 'MONTH', ctx.firstDayOfWeek ?? 1),
      );

    case 'UNTIL_NEXT': {
      // Rolling deadline: due the day before the next occurrence spawns. The
      // final instance (no next occurrence) falls back to its own appears day.
      const next = _toUtc(ctx.nextAppearsDate);
      return next ? _toStr(_addDays(next, -1)) : ctx.appearsDate;
    }

    case 'OFFSET': {
      // Lead-time mode (anchor=DUE): the RRULE day already IS the due day; the
      // task merely appears earlier (handled by the scheduler, not here).
      if (cfg.dueAnchor === 'DUE') return ctx.appearsDate;
      const offset = cfg.dueOffset ?? ctx.inheritedOffsetDays ?? 0;
      return _toStr(_applyOffset(appears, offset, cfg.dueOffsetUnit ?? 'DAY'));
    }

    case 'FROM_COMPLETION': {
      // Due = completion day + offset. In a preview (no actual completion yet)
      // fall back to the appears day as the assumed on-time completion.
      const base = _toUtc(ctx.completionDate) ?? appears;
      const offset = cfg.dueOffset ?? ctx.inheritedOffsetDays ?? 0;
      return _toStr(_applyOffset(base, offset, cfg.dueOffsetUnit ?? 'DAY'));
    }

    default:
      return ctx.appearsDate;
  }
};

/**
 * For lead-time (OFFSET + anchor=DUE): given the DUE day produced by the RRULE,
 * the day the task should APPEAR (= due − offset). Returns the due day unchanged
 * for every other configuration. Lets the scheduler surface a task ahead of its
 * deadline without changing the occurrence math.
 */
export const getRecurringInstanceAppearsShift = (
  cfg: Pick<TaskRepeatCfg, 'dueType' | 'dueAnchor' | 'dueOffset' | 'dueOffsetUnit'>,
  dueDate: string,
): string => {
  if (cfg.dueType !== 'OFFSET' || cfg.dueAnchor !== 'DUE') return dueDate;
  const due = _toUtc(dueDate);
  if (!due) return dueDate;
  const offset = cfg.dueOffset ?? 0;
  return _toStr(_applyOffset(due, -offset, cfg.dueOffsetUnit ?? 'DAY'));
};
