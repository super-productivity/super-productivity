import { RRule, RRuleSet } from 'rrule';
import { Log } from '../../../core/log';
import { safeParseRRuleOptions } from '../util/rrule-parse.util';

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

/**
 * True when `rrule` is a parseable RFC 5545 recurrence with a FREQ. Cheap,
 * throws nothing, used as a guard everywhere.
 */
export const isRRuleValid = (rrule: string | undefined): rrule is string => {
  if (!rrule || !rrule.trim()) return false;
  const cached = _validityCache.get(rrule);
  if (cached !== undefined) return cached;

  let valid = false;
  const options = safeParseRRuleOptions(rrule);
  if (options) {
    try {
      // Construct + probe once so deeper invalids (bad BYDAY etc.) surface here.
      new RRule({ ...options, dtstart: noonUtc('2020-01-01') }).after(
        _midnightUtc('2019-01-01'),
        false,
      );
      valid = true;
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
 * No production caller yet — exercised by the engine invariant/day-march specs
 * and intended for a future calendar/heatmap projection of recurring series.
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
