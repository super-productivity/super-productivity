import { RRule } from 'rrule';
import { normalizeWeekdays, toNumArray } from './rrule-weekday.util';
import { FREQ_TO_CYCLE, safeParseRRuleOptions } from './rrule-parse.util';

/**
 * Bidirectional bridge between the structured RRULE builder form (a dropdown per
 * RFC 5545 field) and the opaque `rrule` string stored on the TaskRepeatCfg.
 *
 *  - `formModelToRRule` builds the string deterministically from the dropdowns.
 *  - `rruleToFormModel` parses an existing string back into dropdown values for
 *    editing (falling back to sane defaults for anything missing/unparseable).
 *
 * Scope — the structured builder covers every day-meaningful RFC 5545 rule part:
 *   FREQ     → DAILY | WEEKLY | MONTHLY | YEARLY (sub-daily survives via raw override)
 *   INTERVAL, COUNT (after N), UNTIL (on date)
 *   BYMONTH  → seasonal constraint on ANY frequency (e.g. daily in Jan–Apr)
 *   WEEKLY   → BYDAY (weekday multi-select)
 *   MONTHLY  → day-of-month | nth-weekday (2MO) | weekday-set + BYSETPOS (last weekday) | last-day
 *   YEARLY   → on a date (BYMONTH + BYMONTHDAY) | weekdays within months (BYMONTH + BYDAY)
 *   advanced → WKST, BYSETPOS, multi/negative BYMONTHDAY, raw override,
 *              BYWEEKNO / BYYEARDAY (shown only for YEARLY per RFC 5545 §3.3.10)
 *
 * Anything the structured fields can't model (time-of-day parts, or a BYDAY with
 * different ordinals per weekday) is preserved verbatim via the raw override —
 * guaranteed by the canonical round-trip guard in rruleToFormModel.
 */

export const RRULE_WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type RRuleWeekday = (typeof RRULE_WEEKDAYS)[number];

export type RRuleFreq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
export type RRuleMonthlyMode = 'DAY_OF_MONTH' | 'NTH_WEEKDAY' | 'WEEKDAYS';
/** YEARLY: a date (BYMONTHDAY), a weekday set within months (BYDAY[+BYSETPOS]),
 *  or per-weekday ordinals (BYDAY=3MO,4SU). */
export type RRuleYearlyMode = 'DAY_OF_MONTH' | 'NTH_WEEKDAY' | 'WEEKDAYS';
export type RRuleEndType = 'NEVER' | 'COUNT' | 'UNTIL';
/** The predefined ordinal dropdown values: 1..4 = 1st–4th occurrence; -1 = last. */
export type RRuleSetPos = 1 | 2 | 3 | 4 | -1;
/** One ordinal row applied to a set of weekdays, e.g. `{ pos: 3, days: ['MO',
 *  'TU'] }` = the 3rd Monday and 3rd Tuesday → BYDAY=3MO,3TU. `pos` is usually
 *  one of the predefined `RRuleSetPos` values, but the custom ordinal input
 *  allows any non-zero RFC 5545 ordinal (±1..±53), e.g. -2 = 2nd-to-last. */
export interface RRuleNthDay {
  pos: number;
  days: RRuleWeekday[];
}

export interface RRuleFormModel {
  freq: RRuleFreq;
  interval: number;
  byDay: RRuleWeekday[]; // WEEKLY
  monthlyMode: RRuleMonthlyMode; // MONTHLY
  monthDays: number[]; // MONTHLY/YEARLY day-of-month; -1 = last day; multiple allowed
  // MONTHLY/YEARLY nth-weekday rows (per-weekday ordinals), e.g. [{3,MO},{4,SU}].
  nthDays: RRuleNthDay[];
  byMonth: number[]; // YEARLY months (1..12)
  yearlyMode: RRuleYearlyMode; // YEARLY: date vs weekdays-within-months
  endType: RRuleEndType;
  count: number; // COUNT
  until: string; // UNTIL, 'YYYY-MM-DD'
  // --- advanced (collapsed section) ---
  wkst: RRuleWeekday | ''; // week start; '' = library default (Monday)
  // Comma-separated integer lists ('' = omitted). Cover the remaining RRULE
  // BY* rule parts as structured inputs.
  bySetPos: string; // BYSETPOS for the weekday-set "which occurrence" (single value)
  byWeekNo: string; // BYWEEKNO (ISO week numbers, 1..53 / negative)
  byYearDay: string; // BYYEARDAY (1..366 / negative)
  showAdvanced: boolean; // whether the advanced section is expanded
  rawOverride: string; // raw RRULE body that overrides the builder when set
}

// RepeatCycleOption and RRuleFreq are the same four literals — reuse the
// shared Frequency map instead of maintaining a second copy.
const FREQ_TO_STR: Partial<Record<number, RRuleFreq>> = FREQ_TO_CYCLE;

/** JS `Date.getDay()` (0=Sun) → RRULE weekday index (0=Mon). */
const jsDayToRRuleIdx = (jsDay: number): number => (jsDay + 6) % 7;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' → RFC 5545 UNTIL value at noon UTC (matches engine occurrence instants). */
const untilToRRule = (dateStr: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!m) return '';
  return `${m[1]}${m[2]}${m[3]}T120000Z`;
};

/** A UTC Date → 'YYYY-MM-DD' using UTC parts (no timezone drift). */
const utcDateToDbStr = (d: Date): string =>
  `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

/** Defaults for a fresh RRULE builder, seeded from `refDate` (the start date). */
export const defaultRRuleFormModel = (refDate: Date = new Date()): RRuleFormModel => {
  const rruleWeekday = RRULE_WEEKDAYS[jsDayToRRuleIdx(refDate.getDay())];
  return {
    freq: 'WEEKLY',
    interval: 1,
    byDay: [rruleWeekday],
    monthlyMode: 'DAY_OF_MONTH',
    monthDays: [refDate.getDate()],
    nthDays: [
      {
        pos: Math.min(Math.floor((refDate.getDate() - 1) / 7) + 1, 4),
        days: [rruleWeekday],
      },
    ],
    byMonth: [],
    yearlyMode: 'DAY_OF_MONTH',
    endType: 'NEVER',
    count: 10,
    until: '',
    wkst: '',
    bySetPos: '',
    byWeekNo: '',
    byYearDay: '',
    showAdvanced: false,
    rawOverride: '',
  };
};

/** "3MO,4SU" / "1MO,1TU" — each row's ordinal applied to each of its weekdays
 *  (Mon-first within a row). Deduped: two rows with the same (custom) ordinal
 *  and overlapping weekdays must not emit the same token twice. */
const nthDaysToByDay = (rows: RRuleNthDay[]): string =>
  [
    ...new Set(
      (rows ?? []).flatMap((r) =>
        RRULE_WEEKDAYS.filter((d) => (r.days ?? []).includes(d)).map(
          (d) => `${r.pos}${d}`,
        ),
      ),
    ),
  ].join(',');

/** Build the RFC 5545 RRULE body (no `RRULE:` prefix) from the dropdown model. */
export const formModelToRRule = (m: RRuleFormModel): string => {
  // A raw override (advanced) wins over the structured builder entirely.
  if (m.rawOverride && m.rawOverride.trim()) {
    return m.rawOverride.trim();
  }
  const parts: string[] = [`FREQ=${m.freq}`];
  if (m.interval && m.interval > 1) parts.push(`INTERVAL=${m.interval}`);

  const pushByDaySet = (): void => {
    if (m.byDay?.length) {
      const ordered = RRULE_WEEKDAYS.filter((d) => m.byDay.includes(d));
      parts.push(`BYDAY=${ordered.join(',')}`);
    }
  };
  const pushBySetPos = (): void => {
    if (m.bySetPos && m.bySetPos.trim()) {
      parts.push(`BYSETPOS=${m.bySetPos.replace(/\s+/g, '')}`);
    }
  };

  // BYMONTH is a seasonal constraint valid for ANY frequency — e.g. daily in
  // Jan–Apr, weekly Mondays in June, or yearly within the chosen months.
  if (m.byMonth?.length) {
    parts.push(`BYMONTH=${[...m.byMonth].sort((a, b) => a - b).join(',')}`);
  }

  if (m.freq === 'WEEKLY') {
    pushByDaySet();
  }

  if (m.freq === 'MONTHLY') {
    if (m.monthlyMode === 'NTH_WEEKDAY') {
      // Per-weekday ordinals (the 3rd Monday and 4th Sunday → BYDAY=3MO,4SU).
      const byDay = nthDaysToByDay(m.nthDays);
      if (byDay) parts.push(`BYDAY=${byDay}`);
    } else if (m.monthlyMode === 'WEEKDAYS') {
      // A weekday set (e.g. Mon–Fri), optionally narrowed to one occurrence via
      // the "which occurrence" toggles (BYSETPOS) → "last weekday of month".
      pushByDaySet();
      pushBySetPos();
    } else if (m.monthDays?.length) {
      // Day(s) of the month (-1 = last day); selected via the day grid.
      parts.push(`BYMONTHDAY=${m.monthDays.join(',')}`);
      // BYSETPOS narrows the day set too — used by the migration clamp idiom
      // (BYMONTHDAY=31,-1;BYSETPOS=1 = "31st or last day of shorter months").
      // Emitting it keeps such rules round-tripping structurally.
      pushBySetPos();
    }
  }

  if (m.freq === 'YEARLY') {
    if (m.yearlyMode === 'NTH_WEEKDAY') {
      // Per-weekday ordinals within the chosen month(s), e.g. BYDAY=3MO,4SU.
      const byDay = nthDaysToByDay(m.nthDays);
      if (byDay) parts.push(`BYDAY=${byDay}`);
    } else if (m.yearlyMode === 'WEEKDAYS') {
      // A weekday set within the chosen month(s), optionally narrowed to one
      // occurrence via "which" (BYSETPOS) → e.g. the 2nd Saturday of June.
      pushByDaySet();
      pushBySetPos();
    } else if (m.monthDays?.length && m.byMonth?.length) {
      // Date mode REQUIRES BYMONTH: per RFC 5545, FREQ=YEARLY with a bare
      // BYMONTHDAY expands across every month — i.e. fires monthly. With no
      // months selected, omit BYMONTHDAY too: a plain FREQ=YEARLY anchors to
      // the start date's month+day, which is truly yearly. Parsed bare yearly
      // rules can't round-trip through this and fall back to the raw override,
      // preserving their (monthly-firing) semantics verbatim.
      parts.push(`BYMONTHDAY=${m.monthDays.join(',')}`);
      // Same as MONTHLY: keep the clamp idiom (e.g. Feb-29 yearly) round-tripping.
      pushBySetPos();
    }
  }

  // Advanced parts apply whenever they have a value — `showAdvanced` only drives
  // the collapsible's open/closed state, never the resulting rule.
  // BYWEEKNO / BYYEARDAY are YEARLY-only (RFC 5545 §3.3.10), so they're surfaced
  // in the yearly section and only emitted for YEARLY — a value left over after
  // switching frequency must not leak onto a non-yearly rule.
  const clean = (v: string): string => v.replace(/\s+/g, '');
  if (m.freq === 'YEARLY' && m.byWeekNo && m.byWeekNo.trim()) {
    parts.push(`BYWEEKNO=${clean(m.byWeekNo)}`);
  }
  if (m.freq === 'YEARLY' && m.byYearDay && m.byYearDay.trim()) {
    parts.push(`BYYEARDAY=${clean(m.byYearDay)}`);
  }
  if (m.wkst) parts.push(`WKST=${m.wkst}`);
  if (m.endType === 'COUNT' && m.count > 0) parts.push(`COUNT=${m.count}`);
  if (m.endType === 'UNTIL' && m.until) parts.push(`UNTIL=${untilToRRule(m.until)}`);

  return parts.join(';');
};

/** Parse an RRULE body back into dropdown values; unparseable → defaults. */
export const rruleToFormModel = (
  rrule: string | undefined,
  refDate: Date = new Date(),
): RRuleFormModel => {
  const model = defaultRRuleFormModel(refDate);
  if (!rrule || !rrule.trim()) return model;

  const opts = safeParseRRuleOptions(rrule);
  if (!opts) return model;
  const freqStr = FREQ_TO_STR[opts.freq];
  if (freqStr == null) {
    // Sub-daily / unsupported FREQ (the day-granular engine has no UI for it) →
    // preserve the rule verbatim via the raw override.
    model.showAdvanced = true;
    model.rawOverride = rrule.trim();
    return model;
  }

  model.freq = freqStr;
  model.interval = opts.interval && opts.interval > 0 ? opts.interval : 1;

  const weekdays = normalizeWeekdays(opts.byweekday);
  const monthDays = toNumArray(opts.bymonthday);
  const months = toNumArray(opts.bymonth);
  // BYMONTH applies to any frequency.
  model.byMonth = months;
  // BYMONTHDAY (the day-of-month grid) — used by MONTHLY/YEARLY day modes.
  if (monthDays.length) model.monthDays = monthDays;

  if (model.freq === 'WEEKLY' && weekdays.length) {
    model.byDay = weekdays.map((w) => RRULE_WEEKDAYS[w.weekday]).filter(Boolean);
  }

  // When every weekday carries an ordinal (e.g. 3MO,4SU) it's the nth-weekday
  // mode; a plain set (MO,TU) or one with BYSETPOS stays the weekday-set mode.
  // Weekdays that share an ordinal collapse into one row: 1MO,1TU,3WE →
  // [{pos:1,days:[MO,TU]},{pos:3,days:[WE]}] (Mon-first within each row).
  const toNthDays = (): RRuleNthDay[] => {
    const byPos = new Map<number, RRuleWeekday[]>();
    for (const wd of weekdays) {
      const day = RRULE_WEEKDAYS[wd.weekday];
      const list = byPos.get(wd.n as number) ?? [];
      if (!list.includes(day)) list.push(day);
      byPos.set(wd.n as number, list);
    }
    return [...byPos.entries()].map(([pos, days]) => ({
      pos,
      days: RRULE_WEEKDAYS.filter((d) => days.includes(d)),
    }));
  };

  if (model.freq === 'MONTHLY') {
    if (weekdays.length && weekdays.every((w) => w.n != null)) {
      model.monthlyMode = 'NTH_WEEKDAY';
      model.nthDays = toNthDays();
    } else if (weekdays.length) {
      // Weekday set with no per-day ordinal (pairs with BYSETPOS for "last weekday").
      model.monthlyMode = 'WEEKDAYS';
      model.byDay = weekdays.map((w) => RRULE_WEEKDAYS[w.weekday]).filter(Boolean);
    } else if (monthDays.length) {
      model.monthlyMode = 'DAY_OF_MONTH';
    }
  }

  if (model.freq === 'YEARLY') {
    if (weekdays.length && weekdays.every((w) => w.n != null)) {
      model.yearlyMode = 'NTH_WEEKDAY';
      model.nthDays = toNthDays();
    } else if (weekdays.length) {
      model.yearlyMode = 'WEEKDAYS';
      model.byDay = weekdays.map((w) => RRULE_WEEKDAYS[w.weekday]).filter(Boolean);
    } else if (monthDays.length) {
      model.yearlyMode = 'DAY_OF_MONTH';
    }
  }

  if (opts.count != null) {
    model.endType = 'COUNT';
    model.count = opts.count;
  } else if (opts.until instanceof Date) {
    model.endType = 'UNTIL';
    model.until = utcDateToDbStr(opts.until);
  }

  // --- advanced: WKST + remaining BY* rule parts as structured fields ---
  const w = opts.wkst as number | { weekday: number } | null | undefined;
  const wkstNum =
    typeof w === 'number' ? w : w && typeof w === 'object' ? w.weekday : undefined;
  if (wkstNum != null && wkstNum >= 0 && wkstNum < 7) {
    model.wkst = RRULE_WEEKDAYS[wkstNum];
    model.showAdvanced = true;
  }
  // BYSETPOS drives the weekday-set "which occurrence" toggles (a main control,
  // not advanced). Values outside the predefined options — including multi-value
  // lists like "2,-1" — render via the custom input. Zeros are dropped:
  // RRule.parseString accepts BYSETPOS=0 but re-emitting it produces an
  // RFC-invalid rule the occurrence engine silently treats as dead.
  const setPosArr = toNumArray(opts.bysetpos).filter((n) => n !== 0);
  if (setPosArr.length) model.bySetPos = setPosArr.join(',');
  const weekNo = toNumArray(opts.byweekno).join(',');
  const yearDay = toNumArray(opts.byyearday).join(',');
  if (weekNo) {
    model.byWeekNo = weekNo;
    model.showAdvanced = true;
  }
  if (yearDay) {
    model.byYearDay = yearDay;
    model.showAdvanced = true;
  }

  // Round-trip guard: if the structured + advanced fields cannot faithfully
  // reproduce the input (param combos the builder doesn't model, time-of-day
  // parts, etc.), fall back to a raw override so nothing is silently lost.
  // BYSETPOS zeros are ignored in the comparison: the mapping above drops them
  // deliberately, and treating that as a mismatch would store the original
  // rule as a raw override — re-emitting the dead BYSETPOS=0 verbatim and
  // undoing the cleanup.
  const canon = (str: string): string => {
    try {
      const o = RRule.parseString(str);
      const sp = toNumArray(o.bysetpos).filter((n) => n !== 0);
      o.bysetpos = sp.length ? sp : null;
      return new RRule(o).toString();
    } catch {
      return str;
    }
  };
  if (canon(formModelToRRule(model)) !== canon(rrule)) {
    model.showAdvanced = true;
    model.rawOverride = rrule.trim();
    model.wkst = '';
    model.bySetPos = '';
    model.byWeekNo = '';
    model.byYearDay = '';
  }

  return model;
};
