import { RRule, RRuleSet } from 'rrule';
import { Log } from '../../../core/log';
import { RRuleParsedOptions, safeParseRRuleOptions } from '../util/rrule-parse.util';

/**
 * Day-granular, DST-safe occurrence engine for RFC 5545 RRULE strings.
 *
 * Provides four contracts (next / newest / first / validity) that the
 * day-granular recurrence machinery routes to whenever a cfg carries an
 * `rrule` string, in place of the legacy repeatCycle calculation.
 *
 * Two properties that make this engine robust, both *structural* here:
 *
 *  1. DST-safety. All recurrence math runs in pure UTC, which has no DST. The
 *     resolved calendar day is only re-expressed at LOCAL noon at the very end
 *     (`toLocalNoon`). Local noon is invariant under DST (transitions happen
 *     ~02:00–03:00), so `getDbDateStr()` of the result is timezone-stable. The
 *     cron engine had to avoid `prev()` because it skipped the spring-forward
 *     midnight; in UTC space `.before()` is safe, so we can use it directly.
 *  2. Fail-soft. A malformed RRULE never throws out of these functions: it logs
 *     (id/expression only — never user content) and returns `null`, exactly
 *     like `safeParse` in the cron engine.
 *
 * RRULE is stored as an opaque string, so adopting it never grows the
 * `repeatCycle` enum — older sync clients that validate against a fixed enum
 * set keep accepting the data (forward-compatible, unlike a new `'CRON'` value).
 */

export interface RRuleOccurrenceInput {
  /** RFC 5545 RRULE body, e.g. `"FREQ=WEEKLY;BYDAY=MO"` (no `RRULE:` prefix needed). */
  rrule: string;
  /** Effective recurrence start, `YYYY-MM-DD`. Anchors INTERVAL / COUNT / UNTIL. */
  startDate: string;
  /** Last day a task was created, `YYYY-MM-DD`; occurrences must be strictly after it. */
  lastTaskCreationDay?: string;
  /** Skipped dates (`YYYY-MM-DD`), RFC 5545 EXDATE. Removed from the occurrence set. */
  exdates?: string[];
}

const DAY_MS = 86_400_000;
const FALLBACK_LAST_CREATION = '1970-01-01';

/** Noon UTC instant for a `YYYY-MM-DD` string — the canonical occurrence time. */
export const noonUtc = (dateStr: string): Date => new Date(`${dateStr}T12:00:00Z`);

/** UTC-midnight instant for a `YYYY-MM-DD` string. */
const _midnightUtc = (dateStr: string): Date => new Date(`${dateStr}T00:00:00Z`);

/** A Date's LOCAL calendar day pinned to UTC midnight (drops time + tz for clean UTC math). */
const _localDayAsUtc = (d: Date): Date =>
  new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));

/**
 * Re-express a UTC occurrence (noon UTC of the intended day) as that same
 * calendar day at LOCAL noon, matching the cron engine's day-granular output.
 * Exported (with `noonUtc`) so the preview util anchors occurrences on the
 * exact same instants as the engine — they must never diverge.
 */
export const toLocalNoon = (utcOcc: Date): Date =>
  new Date(utcOcc.getUTCFullYear(), utcOcc.getUTCMonth(), utcOcc.getUTCDate(), 12, 0, 0);

/** Parse + anchor an RRULE into a set (with EXDATEs), or null if malformed. */
const _buildRuleSet = (input: RRuleOccurrenceInput): RRuleSet | null => {
  const options = safeParseRRuleOptions(input.rrule);
  if (!options) return null;
  try {
    const set = new RRuleSet();
    set.rrule(new RRule({ ...options, dtstart: noonUtc(input.startDate) }));
    for (const ex of input.exdates ?? []) {
      set.exdate(noonUtc(ex));
    }
    return set;
  } catch (e) {
    // Never log the rule body — the raw-override field makes it free-text user
    // input, and the log history is exportable.
    Log.warn('Invalid RRULE', (e as Error)?.name);
    return null;
  }
};

// isRRuleValid is called as a routing guard for EVERY repeat cfg on every
// overdue/day-change scan; the construct + probe below is the expensive part.
// Rule strings are few and immutable, so a tiny memo makes repeat calls free.
const _validityCache = new Map<string, boolean>();

/** Max day-of-month per month (Feb leap-permissive at 29). */
const _MONTH_MAX_DAY = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Cumulative days at each month's end, non-leap / leap. */
const _CUM_DAYS = [31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];
const _CUM_DAYS_LEAP = [31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335, 366];

/** Months (1-12) a positive year-day can fall in, across leap AND non-leap
 *  years (the boundary shifts by one day after February). Out-of-year days
 *  (<1, >366) wrap to the adjacent year's Dec/Jan — used for week spans that
 *  straddle a year boundary. */
const _monthsOfYearDay = (yearDay: number): number[] => {
  if (yearDay < 1) return [12];
  if (yearDay > 366) return [1];
  const months = new Set<number>();
  for (const cum of [_CUM_DAYS, _CUM_DAYS_LEAP]) {
    const m = cum.findIndex((c) => yearDay <= c);
    if (m !== -1) months.add(m + 1);
  }
  return [...months];
};

/** Months an ISO-numbered week `n` (positive) can overlap, across all years,
 *  leap shifts, and WKST choices. Week n's Monday sits at year-day
 *  `(n-1)*7 + 4 - wd(Jan4)` with `wd ∈ [1,7]`, the week spans 7 days, and a
 *  non-Monday WKST shifts boundaries by at most ±6 days — so year-days
 *  `[(n-1)*7 - 9, (n-1)*7 + 16]` are a strict superset of every day week `n`
 *  can contain. Superset = conservative: it can only ADD possible months,
 *  never miss one, so the never-fire flag below stays free of false positives. */
const _monthsOfWeekNo = (weekNo: number): Set<number> => {
  const months = new Set<number>();
  const base = (weekNo - 1) * 7;
  for (let d = base - 9; d <= base + 16; d++) {
    for (const m of _monthsOfYearDay(d)) months.add(m);
  }
  return months;
};

const _asArray = (v: number | number[] | null | undefined): number[] =>
  v == null ? [] : Array.isArray(v) ? v : [v];

/** True only when a non-empty constraint has EVERY value outside the RFC range
 *  (`[lo,hi]`, plus `[-hi,-lo]` when `allowNeg`) — i.e. it can match nothing. An
 *  empty constraint (no values) is no constraint, so never "all out of range". */
const _allOutOfRange = (
  vals: number[],
  lo: number,
  hi: number,
  allowNeg = false,
): boolean => {
  if (!vals.length) return false;
  const inRange = (n: number): boolean =>
    (n >= lo && n <= hi) || (allowNeg && n <= -lo && n >= -hi);
  return vals.every((n) => !inRange(n));
};

/**
 * Detect a parseable rule whose BY-constraints are contradictory and can produce
 * NO occurrence — the case rrule.js "handles" by walking day-by-day to its
 * year-275760 ceiling (a multi-second main-thread freeze) before yielding
 * nothing. We catch the realistic vectors (out-of-range BY values like
 * `BYMONTH=13`; impossible `BYMONTH` × `BYMONTHDAY` / `BYYEARDAY` / `BYWEEKNO`
 * combos like Feb-30, Feb × yearday 200, Feb × week 53) up front so
 * isRRuleValid can reject without iterating.
 *
 * Conservative by construction: it flags a rule ONLY when an entire constraint
 * is unsatisfiable, so a sound rule is never mis-flagged (a false positive would
 * wrongly drop a good cfg to the legacy fallback and reschedule it). Exotic
 * never-firing rules it doesn't recognise (e.g. a `BYSETPOS` larger than its
 * occurrence set) still fall through to the probe below, which now returns false
 * for them too — just after a one-time (memoised) walk.
 */
const _canNeverFire = (o: RRuleParsedOptions): boolean => {
  const byMonth = _asArray(o.bymonth);
  const byMonthDay = _asArray(o.bymonthday);
  if (
    _allOutOfRange(byMonth, 1, 12) ||
    _allOutOfRange(byMonthDay, 1, 31, true) ||
    _allOutOfRange(_asArray(o.byyearday), 1, 366, true) ||
    _allOutOfRange(_asArray(o.byweekno), 1, 53, true) ||
    _allOutOfRange(_asArray(o.bysetpos), 1, 366, true)
  ) {
    return true;
  }
  // Impossible month/day intersection, e.g. BYMONTH=2;BYMONTHDAY=30. Only
  // positive month-days are positional from the start; a negative day (-1 =
  // last) always exists, so a rule with ANY negative day can fire — skip the
  // combo check then. Flag only when no (valid-month, positive-day) pair fits.
  const validMonths = byMonth.filter((m) => m >= 1 && m <= 12);
  const posDays = byMonthDay.filter((d) => d > 0);
  const hasNegDay = byMonthDay.some((d) => d < 0);
  if (byMonth.length && posDays.length && !hasNegDay) {
    const anyPairFits = validMonths.some((m) =>
      posDays.some((d) => d <= _MONTH_MAX_DAY[m - 1]),
    );
    if (!anyPairFits) return true;
  }
  // Impossible month × year-day / week-number intersections, e.g.
  // BYMONTH=2;BYYEARDAY=200 or BYMONTH=2;BYWEEKNO=53. Same shape as above:
  // negative values count from the year's end (year-length-dependent), so any
  // negative skips the check; flag only when NO value can touch a valid month
  // under either leap layout.
  const posYearDays = _asArray(o.byyearday).filter((d) => d > 0);
  if (byMonth.length && posYearDays.length && !_asArray(o.byyearday).some((d) => d < 0)) {
    const anyDayFits = posYearDays.some((d) =>
      _monthsOfYearDay(d).some((m) => validMonths.includes(m)),
    );
    if (!anyDayFits) return true;
  }
  const posWeekNos = _asArray(o.byweekno).filter((n) => n > 0);
  if (byMonth.length && posWeekNos.length && !_asArray(o.byweekno).some((n) => n < 0)) {
    const anyWeekFits = posWeekNos.some((n) => {
      const months = _monthsOfWeekNo(n);
      return validMonths.some((m) => months.has(m));
    });
    if (!anyWeekFits) return true;
  }
  return false;
};

/**
 * True when `rrule` is a parseable RFC 5545 recurrence that actually fires.
 * Cheap, throws nothing, used as a routing guard everywhere.
 *
 * Two correctness points beyond "does it parse":
 *  1. It must FIRE. A rule that yields no occurrence (contradictory BY parts) is
 *     invalid → the engine falls back to legacy repeatCycle instead of deferring
 *     to a rule that silently never creates a task. `_canNeverFire` rejects the
 *     realistic such rules without iterating (avoiding rrule.js's year-275760
 *     freeze); the `.after()` non-null check covers the rest.
 *  2. UNTIL/COUNT are stripped for the probe. They are anchor-relative end
 *     conditions; a rule whose window already closed relative to the fixed probe
 *     anchor still has a sound PATTERN, and the engine applies the real
 *     start/UNTIL/COUNT per cfg. Keeping them here would mark such a rule invalid
 *     and resurrect it forever via the UNTIL-less legacy fallback.
 */
export const isRRuleValid = (rrule: string | undefined): rrule is string => {
  if (!rrule || !rrule.trim()) return false;
  const cached = _validityCache.get(rrule);
  if (cached !== undefined) return cached;

  let valid = false;
  const options = safeParseRRuleOptions(rrule);
  if (options && !_canNeverFire(options)) {
    try {
      // First occurrence on/after the probe anchor. For a firing rule this
      // returns immediately; the construct + probe also surfaces deeper invalids
      // (bad BYDAY etc.) that parsing alone misses. `valid` requires a real hit,
      // so a never-firing rule that slipped past `_canNeverFire` resolves to
      // false (after a one-time, memoised walk) rather than a spurious true.
      const occ = new RRule({
        ...options,
        dtstart: noonUtc('2020-01-01'),
        until: null,
        count: null,
      }).after(_midnightUtc('2019-01-01'), false);
      valid = occ != null;
    } catch {
      // construct/probe failed → invalid
    }
  }
  if (_validityCache.size > 200) _validityCache.clear();
  _validityCache.set(rrule, valid);
  return valid;
};

/**
 * Next occurrence strictly after `fromDate`'s day, on/after `startDate`, and
 * strictly after `lastTaskCreationDay`. Returned at local noon, or null.
 *
 * With `inclusive` the occurrence may fall ON `fromDate`'s day and the
 * prior-creation gating is ignored — mirroring the legacy engine's inclusive
 * mode used when relocating an existing live instance on a schedule edit
 * (#7951): today may still be a valid occurrence and must not be skipped.
 */
export const getNextRRuleOccurrence = (
  input: RRuleOccurrenceInput,
  fromDate: Date,
  { inclusive = false }: { inclusive?: boolean } = {},
): Date | null => {
  const set = _buildRuleSet(input);
  if (!set) return null;

  const startDay = _midnightUtc(input.startDate);
  const lastCreation = _midnightUtc(input.lastTaskCreationDay || FALLBACK_LAST_CREATION);

  // Earliest eligible DAY: strictly after fromDate's day and the last-created
  // day, and on/after the start day (whole-day reasoning, like the cron engine).
  // Inclusive keeps fromDate's own day eligible and drops the creation gate.
  let lowerBound = inclusive
    ? _localDayAsUtc(fromDate)
    : new Date(_localDayAsUtc(fromDate).getTime() + DAY_MS);
  if (!inclusive) {
    const afterLastCreation = new Date(lastCreation.getTime() + DAY_MS);
    if (afterLastCreation > lowerBound) lowerBound = afterLastCreation;
  }
  if (startDay > lowerBound) lowerBound = startDay;

  try {
    // `.after()` is exclusive of the seed; step back 1 ms so an occurrence at
    // noon ON the lower-bound day stays eligible (parity with the cron engine's
    // midnight-boundary seeding).
    const occ = set.after(new Date(lowerBound.getTime() - 1), false);
    return occ ? toLocalNoon(occ) : null;
  } catch (e) {
    Log.warn(`RRULE next() failed`, (e as Error)?.name);
    return null;
  }
};

/**
 * Most recent firing day on/before `today`, on/after `startDate`, and strictly
 * after `lastTaskCreationDay` — the day a task should be created for if not yet
 * created. Returned at local noon, or null.
 */
export const getNewestPossibleRRuleDueDate = (
  input: RRuleOccurrenceInput,
  today: Date,
): Date | null => {
  const set = _buildRuleSet(input);
  if (!set) return null;

  const startDay = _midnightUtc(input.startDate);
  const lastCreation = _midnightUtc(input.lastTaskCreationDay || FALLBACK_LAST_CREATION);
  const todayDay = _localDayAsUtc(today);

  if (startDay > todayDay) return null;

  try {
    // Newest occurrence strictly before tomorrow's midnight = on/before today.
    // `.before()` is DST-safe here because the whole set lives in UTC.
    const occ = set.before(new Date(todayDay.getTime() + DAY_MS), false);
    if (!occ) return null;

    const occDay = new Date(
      Date.UTC(occ.getUTCFullYear(), occ.getUTCMonth(), occ.getUTCDate()),
    );
    if (occDay < startDay) return null;
    // Strictly after the last created day — otherwise it was already created.
    if (occDay <= lastCreation) return null;
    return toLocalNoon(occ);
  } catch (e) {
    Log.warn(`RRULE before() failed`, (e as Error)?.name);
    return null;
  }
};

/**
 * First firing on/after `startDate` (ignoring `lastTaskCreationDay`) — used to
 * decide when a recurring task's first instance should be scheduled. Returned at
 * local noon, or null.
 */
export const getFirstRRuleOccurrence = (input: RRuleOccurrenceInput): Date | null => {
  const set = _buildRuleSet(input);
  if (!set) return null;

  const startDay = _midnightUtc(input.startDate);
  try {
    // Seed 1 ms before the start-day midnight so a fire at start-day noon counts.
    const occ = set.after(new Date(startDay.getTime() - 1), false);
    return occ ? toLocalNoon(occ) : null;
  } catch (e) {
    Log.warn(`RRULE first() failed`, (e as Error)?.name);
    return null;
  }
};

/**
 * All occurrences whose calendar day falls within `[from, to]` (inclusive),
 * returned at local noon. EXDATEs are honored. Empty for a malformed rule.
 * Drives the repeat-task heatmap's future-occurrence overlay and the edit
 * dialog's live calendar preview; also exercised by the engine
 * invariant/day-march specs.
 */
export const getRRuleOccurrencesInRange = (
  input: RRuleOccurrenceInput,
  from: Date,
  to: Date,
): Date[] => {
  const set = _buildRuleSet(input);
  if (!set) return [];
  // Whole-day bounds: from-day start … to-day end, so noon-UTC occurrences on
  // both boundary days are included regardless of timezone.
  const lower = _localDayAsUtc(from);
  const upper = new Date(_localDayAsUtc(to).getTime() + DAY_MS);
  try {
    return set.between(lower, upper, true).map(toLocalNoon);
  } catch (e) {
    Log.warn(`RRULE between() failed`, (e as Error)?.name);
    return [];
  }
};
