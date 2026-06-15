import {
  MonthlyWeekOfMonth,
  MonthlyWeekday,
  RepeatCycleOption,
  TaskRepeatCfg,
  TaskRepeatCfgCopy,
} from '../task-repeat-cfg.model';
import { normalizeWeekdays, toNumArray } from './rrule-weekday.util';
import {
  FREQ_TO_CYCLE,
  RRuleParsedOptions,
  safeParseRRuleOptions,
} from './rrule-parse.util';
import { getFirstRRuleOccurrence } from '../store/rrule-occurrence.util';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { assertNever } from '../../../util/assert-never';

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

/**
 * Parse 'YYYY-MM-DD' into 1-based month, day, and UTC day-of-week.
 *
 * Fallback for a missing/invalid startDate is the epoch (1970-01-01 = month 1,
 * day 1, Thursday), NOT today. Two reasons: (1) the legacy occurrence engine
 * treats a start-less MONTHLY/YEARLY cfg as day-1, so encoding today's
 * day-of-month here would silently change the schedule on migration; (2)
 * `new Date()` would make the produced rrule depend on WHEN the dialog is opened,
 * so two devices migrating the same legacy cfg on different days would diverge.
 * A fixed anchor keeps the conversion deterministic. UI paths always set
 * startDate, so the fallback is only a safety net.
 */
const _parseStart = (startDate?: string): { month: number; day: number; dow: number } => {
  const ds =
    startDate && /^\d{4}-\d{1,2}-\d{1,2}/.test(startDate) ? startDate : '1970-01-01';
  const [y, m, d] = ds.split('-').map(Number);
  return { month: m, day: d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
};

/**
 * BYMONTHDAY rule part with legacy clamp semantics. The legacy engine clamps a
 * day past month-end to the month's last day (31 → Feb 28), while a plain
 * BYMONTHDAY=31 would SKIP those months. For day > 28 emit the RFC clamp idiom
 * instead: BYMONTHDAY=<d>,-1;BYSETPOS=1 = "the day, or the last day of a
 * shorter month" — behavior-identical to the legacy clamp.
 */
const _clampedMonthDayPart = (day: number): string =>
  day > 28 ? `BYMONTHDAY=${day},-1;BYSETPOS=1` : `BYMONTHDAY=${day}`;

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
      return `FREQ=MONTHLY${intervalPart};${_clampedMonthDayPart(day)}`;
    }

    case 'YEARLY':
      // Same clamp consideration as MONTHLY: legacy clamps Feb 29 → Feb 28 in
      // non-leap years (and day 29/30/31 in shorter months generally).
      return `FREQ=YEARLY${intervalPart};BYMONTH=${month};${_clampedMonthDayPart(day)}`;

    default:
      // Unknown/legacy-less cfg — fall back to a weekly rule on the start weekday.
      return `FREQ=WEEKLY${intervalPart};BYDAY=${JS_DAY_TO_RRULE[dow]}`;
  }
};

/** True when `n` fits the legacy `MonthlyWeekOfMonth` union (1..4 | -1). */
const _isLegacyMonthlyOrdinal = (n: number): n is MonthlyWeekOfMonth =>
  n === -1 || (Number.isInteger(n) && n >= 1 && n <= 4);

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
 * Legacy-field payload that makes old / flag-off clients create NOTHING for
 * this cfg: the legacy WEEKLY engine requires at least one weekday flag to be
 * `true` (`get-next-repeat-occurrence` / `get-newest-possible-due-date` scan
 * loops), so an all-false WEEKLY never fires — deterministically and on every
 * released version. Written for rules the legacy fields CANNOT faithfully
 * represent (decided policy): a fabricated wrong-day task syncs back to every
 * device and is worse than an absent one. Every value is wire-stable (`false`
 * survives the op-log's JSON partial update; `'WEEKLY'`/`1` are in-union), and
 * `repeatCycle: 'WEEKLY'` also sidesteps any stale monthly anchor a remote
 * client may hold — anchors are only read in the legacy MONTHLY branch.
 */
export const LEGACY_NEVER_FIRES_FALLBACK: Readonly<Partial<TaskRepeatCfgCopy>> = {
  repeatCycle: 'WEEKLY',
  repeatEvery: 1,
  monday: false,
  tuesday: false,
  wednesday: false,
  thursday: false,
  friday: false,
  saturday: false,
  sunday: false,
  monthlyWeekOfMonth: undefined,
  monthlyWeekday: undefined,
  monthlyLastDay: false,
};

/**
 * Exact-or-null inverse mapping: the legacy schedule fields that fire on the
 * SAME days as the rule, or `null` when the legacy field set cannot express
 * the rule (end conditions, seasonal BYMONTH, BYWEEKNO/BYYEARDAY, multi-day
 * lists, out-of-union ordinals, …). `null` is the sentinel trigger — never a
 * best-effort approximation; see `rruleToLegacyTaskRepeatCfg`.
 *
 * Known accepted divergences (the lazy-migrate class, NOT sentinel material):
 * WEEKLY INTERVAL>1 week-grouping vs rolling 7-day blocks (+ WKST phase), and
 * the day>28 clamp-vs-skip edge — pattern and cadence match; only rare edge
 * days differ.
 */
const _legacyEquivalent = (
  opts: RRuleParsedOptions,
  cycle: RepeatCycleOption,
  startDate?: string,
): Partial<TaskRepeatCfgCopy> | null => {
  // COUNT/UNTIL have no legacy field: old clients would resurrect an ended
  // series forever — strictly worse than creating nothing.
  if (opts.count != null || opts.until != null) return null;
  // Week-number / year-day constraints have no legacy notion at all.
  if (toNumArray(opts.byweekno).length || toNumArray(opts.byyearday).length) {
    return null;
  }

  const interval = opts.interval && opts.interval > 0 ? opts.interval : 1;
  // Build on the mutable copy type — TaskRepeatCfg is Readonly.
  const out: Partial<TaskRepeatCfgCopy> = {
    repeatCycle: cycle,
    repeatEvery: interval,
    // Monthly anchors discriminate the legacy MONTHLY paths — always reset so a
    // stale nth-weekday/last-day anchor from a previous preset or rule can't
    // override the new rule's semantics. They are re-set below only when this
    // rule actually encodes them. The numeric anchors reset to `undefined`:
    // released clients' typia schema allows these fields only absent-or-numeric,
    // so a `null` must never reach the wire (it would trip their validation /
    // repair flow). The cost: a partial update can't clear a stale anchor on
    // REMOTE clients (JSON.stringify drops undefined keys) — see the
    // `task-repeat-cfg.model.ts` anchor comment for the full gap analysis.
    // `monthlyLastDay` resets to `false`, a master-safe value that DOES survive
    // the JSON wire.
    monthlyWeekOfMonth: undefined,
    monthlyWeekday: undefined,
    monthlyLastDay: false,
  };

  const weekdays = normalizeWeekdays(opts.byweekday);
  const monthDays = toNumArray(opts.bymonthday);
  const setPos = toNumArray(opts.bysetpos);
  const months = toNumArray(opts.bymonth);

  const setWeekdayFlags = (days: { weekday: number }[]): void => {
    RRULE_IDX_TO_FIELD.forEach((field) => {
      (out as Record<string, unknown>)[field] = false;
    });
    days.forEach((w) => {
      const field = RRULE_IDX_TO_FIELD[w.weekday];
      if (field) (out as Record<string, unknown>)[field] = true;
    });
  };

  switch (cycle) {
    case 'DAILY': {
      // Seasonal/positional daily (BYMONTH window, BYMONTHDAY, BYSETPOS) has no
      // legacy DAILY notion.
      if (monthDays.length || setPos.length || months.length) return null;
      if (!weekdays.length) return out;
      // FREQ=DAILY;BYDAY=… at INTERVAL=1 is exactly "weekly on those days" —
      // legacy WEEKLY interval 1 is a pure weekday filter, so this maps
      // losslessly. With an interval the daily step is filtered THROUGH the
      // weekday set, which weekly fields cannot express.
      if (interval !== 1 || weekdays.some((w) => w.n != null)) return null;
      out.repeatCycle = 'WEEKLY';
      setWeekdayFlags(weekdays);
      return out;
    }

    case 'WEEKLY': {
      // Seasonal weekly (BYMONTH) and positional parts have no legacy notion.
      if (monthDays.length || setPos.length || months.length) return null;
      if (weekdays.some((w) => w.n != null)) return null;
      setWeekdayFlags(weekdays);
      if (!weekdays.length && startDate) {
        // A BYDAY-less FREQ=WEEKLY means "weekly on the start weekday" — set
        // that flag (mirroring the forward converter), so the legacy WEEKLY
        // engine still fires on older clients instead of having every flag
        // false.
        const idx = (_parseStart(startDate).dow + 6) % 7; // UTC 0=Sun → RRULE 0=Mon
        const field = RRULE_IDX_TO_FIELD[idx];
        if (field) (out as Record<string, unknown>)[field] = true;
      }
      return out;
    }

    case 'MONTHLY': {
      // A BYMONTH window on a monthly rule (fire only some months) has no
      // legacy notion.
      if (months.length) return null;
      const nthOrdinal = weekdays.length ? weekdays[0].n : undefined;
      if (nthOrdinal != null) {
        // "2nd Tuesday" → BYDAY=2TU. legacy monthlyWeekday is 0=Sun…6=Sat.
        // Ordinals outside the model union (BYDAY=5MO, -2MO — the builder's
        // custom input allows ±5) must NOT be persisted: released clients
        // typia-validate monthlyWeekOfMonth against 1|2|3|4|-1, and an
        // out-of-union value trips their repair flow.
        if (
          weekdays.length !== 1 ||
          !_isLegacyMonthlyOrdinal(nthOrdinal) ||
          monthDays.length ||
          setPos.length
        ) {
          return null;
        }
        out.monthlyWeekOfMonth = nthOrdinal;
        out.monthlyWeekday = ((weekdays[0].weekday + 1) % 7) as MonthlyWeekday;
        return out;
      }
      if (weekdays.length) {
        // The builder's weekday-set form of the same anchor: BYDAY=FR;
        // BYSETPOS=-1 ("last Friday") is losslessly equivalent to BYDAY=-1FR.
        // Multi-weekday sets and out-of-range ordinals have no single legacy
        // anchor.
        if (
          weekdays.length === 1 &&
          monthDays.length === 0 &&
          setPos.length === 1 &&
          _isLegacyMonthlyOrdinal(setPos[0])
        ) {
          out.monthlyWeekOfMonth = setPos[0] as MonthlyWeekOfMonth;
          out.monthlyWeekday = ((weekdays[0].weekday + 1) % 7) as MonthlyWeekday;
          return out;
        }
        return null;
      }
      if (monthDays.length === 1 && monthDays[0] === -1) {
        // Pure "last day of month". NOT set for the clamp idiom
        // (BYMONTHDAY=<d>,-1;BYSETPOS=1) — there the legacy day comes from the
        // aligned startDate (see getAlignedStartDate), and the legacy engine
        // clamps it natively.
        if (setPos.length) return null;
        out.monthlyLastDay = true;
        return out;
      }
      // Plain day-of-month forms — legacy reads the day from startDate, which
      // the save path aligns onto the rule's day (getAlignedStartDate):
      // no BYMONTHDAY (= dtstart's day), a single positive day, or the clamp
      // idiom BYMONTHDAY=<d>,-1;BYSETPOS=1.
      if (!monthDays.length) return setPos.length ? null : out;
      if (monthDays.length === 1 && monthDays[0] > 0 && !setPos.length) return out;
      if (_isClampIdiom(monthDays, setPos)) return out;
      return null;
    }

    case 'YEARLY': {
      // Legacy YEARLY is exactly "once a year on startDate's month+day" —
      // weekday modes (e.g. weekdays-within-months) have no legacy notion.
      if (weekdays.length) return null;
      if (!months.length) {
        // No BYMONTH: with any BYMONTHDAY the rule fires that day EVERY month
        // (RFC expansion) — not a yearly legacy schedule. Bare FREQ=YEARLY is
        // the dtstart anniversary.
        return monthDays.length || setPos.length ? null : out;
      }
      if (months.length !== 1) return null; // multi-month = several firings/year
      if (!monthDays.length) {
        // BYMONTH without BYMONTHDAY: the engine fires in the rule's month,
        // but old clients read BOTH month and day from startDate, which the
        // aligner does not move for this shape — they would fire in the
        // start month. Not representable.
        return null;
      }
      if (monthDays.length === 1 && monthDays[0] > 0 && !setPos.length) return out;
      if (_isClampIdiom(monthDays, setPos)) return out;
      return null;
    }
    default:
      // Exhaustiveness guard: a new RepeatCycleOption must get an explicit
      // branch here. Without it the value would fall through to the sentinel
      // (null → LEGACY_NEVER_FIRES_FALLBACK), silently making old/flag-off
      // clients create nothing for a real schedule — a compile error is far
      // safer than that silent data divergence.
      return assertNever(cycle);
  }
};

/** BYMONTHDAY=<d>,-1;BYSETPOS=1 — the RFC clamp idiom emitted by the forward
 *  converter for day>28 (see `_clampedMonthDayPart`). */
const _isClampIdiom = (monthDays: number[], setPos: number[]): boolean =>
  monthDays.length === 2 &&
  monthDays.filter((d) => d > 0).length === 1 &&
  monthDays.includes(-1) &&
  setPos.length === 1 &&
  setPos[0] === 1;

/**
 * Inverse of `legacyTaskRepeatCfgToRRule`: derives the legacy schedule fields
 * (`repeatCycle`, `repeatEvery`, weekday flags, monthly anchors) from an RRULE
 * body. Used to keep those fields populated alongside `rrule` as the wire
 * format for older sync clients — which ignore the unknown `rrule` field and
 * schedule from the legacy fields.
 *
 * Contract (decided policy, not best-effort): when the rule is within legacy
 * expressiveness the fields fire on the SAME days (modulo the documented
 * WEEKLY-interval / clamp divergences); when it is NOT —
 * COUNT/UNTIL, seasonal BYMONTH, BYWEEKNO/BYYEARDAY, multi-day lists,
 * out-of-union ordinals — the `LEGACY_NEVER_FIRES_FALLBACK` sentinel is
 * written instead, so old clients create NO tasks rather than tasks on wrong
 * days that would sync back to every device. The dialog surfaces this state
 * to the user via `isRRuleLegacyRepresentable`.
 *
 * Returns `{}` for an unparseable or sub-daily rule (legacy fields left
 * untouched — both are rejected at the save/persist boundary anyway).
 * Day-of-month has no legacy field: legacy MONTHLY day recurrence (and YEARLY)
 * reads the day/month from `startDate` — callers that persist must pair this
 * with `getAlignedStartDate` (the dialog does so once at save; doing it here
 * per call would mutate the user's visible start date on every keystroke).
 */
export const rruleToLegacyTaskRepeatCfg = (
  rrule: string,
  startDate?: string,
): Partial<TaskRepeatCfg> => {
  const opts = safeParseRRuleOptions(rrule);
  if (!opts) return {};
  const cycle = FREQ_TO_CYCLE[opts.freq];
  if (!cycle) return {}; // sub-daily — no legacy equivalent, rejected upstream

  return _legacyEquivalent(opts, cycle, startDate) ?? { ...LEGACY_NEVER_FIRES_FALLBACK };
};

/**
 * True when the rule maps onto legacy fields that fire on the same days —
 * i.e. `rruleToLegacyTaskRepeatCfg` will NOT write the never-fires sentinel.
 * Unparseable / sub-daily rules return `true`: they never reach persistence
 * (save-path rejects), so there is nothing to warn about.
 */
export const isRRuleLegacyRepresentable = (rrule: string | undefined): boolean => {
  const opts = safeParseRRuleOptions(rrule);
  if (!opts) return true;
  const cycle = FREQ_TO_CYCLE[opts.freq];
  if (!cycle) return true;
  return _legacyEquivalent(opts, cycle) != null;
};

const _pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * startDate alignment for the legacy fallback. Old clients read the monthly
 * day (and yearly month+day) from `startDate`, so for date-anchored rules it
 * should sit on the rule's day — e.g. BYMONTHDAY=15 anchored on the 3rd must
 * move the start to the 15th, else old clients fire on the 3rd.
 *
 * `startDate` is also the rule's dtstart (it anchors the INTERVAL phase and
 * COUNT), so alignment must never change the occurrence set. The only move
 * that is guaranteed occurrence-neutral is re-anchoring onto the rule's own
 * FIRST occurrence on/after the current start: an occurrence is always
 * in-phase for any INTERVAL, and nothing before it is dropped, so COUNT and
 * UNTIL semantics are preserved too.
 *
 * Returns that first occurrence as 'YYYY-MM-DD' when it falls on the rule's
 * target day, or undefined when no alignment applies or the start already
 * matches. Alignment applies only to:
 *  - WEEKLY with exactly one plain BYDAY (see below), or
 *  - a single positive BYMONTHDAY, or
 *  - the clamp idiom BYMONTHDAY=<d>,-1;BYSETPOS=1 → target day is <d>.
 * For the clamp idiom the first occurrence can be a clamped month-end day
 * (e.g. Feb 29 for a day-31 rule): aligning PAST it would make the engine skip
 * a valid occurrence, and aligning ONTO it would corrupt the day the legacy
 * engine needs — such starts stay unaligned (old clients keep the start day as
 * a best-effort approximation).
 *
 * WEEKLY: the engine groups weeks by WKST while the legacy fallback counts
 * rolling 7-day blocks from startDate. For INTERVAL > 1 they disagree on
 * WHICH alternating week fires whenever the start doesn't sit on the rule's
 * weekday — and WKST shifts the engine's phase, which legacy cannot express.
 * Re-anchoring onto the first occurrence makes a single-weekday cadence
 * exactly interval*7 days in both engines, WKST-proof. Multi-weekday sets
 * stay approximate (no single anchor day); BYDAY-less rules already anchor
 * on the start weekday.
 *
 * Monthly/yearly weekday-anchored rules use the anchor fields and stay
 * unaligned; multi-day lists have no single-day legacy equivalent — the
 * user's start date is left alone for those.
 */
export const getAlignedStartDate = (
  rrule: string,
  startDate: string,
): string | undefined => {
  const opts = safeParseRRuleOptions(rrule);
  if (!opts) return undefined;
  const cycle = FREQ_TO_CYCLE[opts.freq];
  if (cycle !== 'WEEKLY' && cycle !== 'MONTHLY' && cycle !== 'YEARLY') {
    return undefined;
  }

  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(startDate);
  if (!m) return undefined;
  const startPadded = `${m[1]}-${_pad2(+m[2])}-${_pad2(+m[3])}`;

  if (cycle === 'WEEKLY') {
    const wd = normalizeWeekdays(opts.byweekday);
    if (wd.length !== 1 || wd[0].n != null) return undefined;
    if (
      toNumArray(opts.bymonthday).length ||
      toNumArray(opts.bysetpos).length ||
      toNumArray(opts.bymonth).length
    ) {
      return undefined;
    }
    const firstWeekly = getFirstRRuleOccurrence({ rrule, startDate: startPadded });
    if (!firstWeekly) return undefined;
    const alignedWeekly = getDbDateStr(firstWeekly);
    return alignedWeekly === startDate ? undefined : alignedWeekly;
  }

  if (normalizeWeekdays(opts.byweekday).length) return undefined;

  // Target day: a single positive day, or the clamp idiom {d,-1} + BYSETPOS=1.
  const monthDays = toNumArray(opts.bymonthday);
  const setPos = toNumArray(opts.bysetpos);
  const positives = monthDays.filter((d) => d > 0);
  let day: number | undefined;
  if (monthDays.length === 1 && positives.length === 1) {
    day = positives[0];
  } else if (
    monthDays.length === 2 &&
    positives.length === 1 &&
    monthDays.includes(-1) &&
    setPos.length === 1 &&
    setPos[0] === 1
  ) {
    day = positives[0];
  }
  if (day == null || day > 31) return undefined;

  // YEARLY needs a single BYMONTH — old clients read the month from startDate.
  if (cycle === 'YEARLY' && toNumArray(opts.bymonth).length !== 1) return undefined;

  // The actual first occurrence with the CURRENT start as dtstart (local noon).
  const first = getFirstRRuleOccurrence({ rrule, startDate: startPadded });
  if (!first) return undefined;
  // Not on the target day → a clamped/short-month occurrence comes first;
  // aligning would skip it or corrupt the legacy day. Leave the start alone.
  if (first.getDate() !== day) return undefined;

  const aligned = getDbDateStr(first);
  return aligned === startDate ? undefined : aligned;
};
