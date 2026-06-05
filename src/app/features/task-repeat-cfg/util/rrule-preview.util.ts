import { RRule } from 'rrule';
import { T } from '../../../t.const';
import { noonUtc, toLocalNoon } from '../store/rrule-occurrence.util';
import { toNumArray } from './rrule-weekday.util';
import { safeParseRRuleOptions } from './rrule-parse.util';

export interface RRulePreview {
  /** Canonical RRULE body the form produced. */
  rrule: string;
  /** Humanized English reading via rrule.toText(), e.g. "every 2 weeks on Monday". */
  human: string;
  /**
   * Next few concrete occurrences of the rule (local noon), for a "Fixed dates"
   * preview. Empty if the rule is finished/unparseable.
   */
  upcoming: Date[];
  /**
   * Illustration for the "After completion" schedule type: if you complete the
   * first upcoming occurrence, when the next one lands. Re-anchors the rule to the
   * completion day exactly like the engine. Null when there's no next occurrence.
   */
  completionExample: { done: Date; next: Date } | null;
}

/**
 * Localization hooks for the human reading. `gettext` maps rrule.js's English
 * connective tokens ('every', 'on the', 'and', …) to translations; `language`
 * supplies localized day/month names. Omitted → English (used by tests / REST).
 */
export interface RRuleHumanizeOpts {
  gettext: (id: string) => string;
  language: { dayNames: string[]; monthNames: string[]; tokens: unknown };
  andWord: string;
  toWord: string;
}

/**
 * Build the localized humanizer for `getRRulePreview` from a translate function
 * (e.g. `(k) => translateService.instant(k)`). Day/month names come from existing
 * T keys; the rrule.js connective tokens map to `RRULE_NLP_*` keys, each falling
 * back to its English token when a locale lacks the key (never a raw key).
 */
export const buildRRuleHumanizeOpts = (
  translate: (key: string) => string,
): RRuleHumanizeOpts => {
  const tt = (key: string, english: string): string => {
    const v = translate(key);
    return v && v !== key ? v : english;
  };
  const F = T.F.TASK_REPEAT.F;
  const EN_DAYS = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];
  const dayKeys = [
    F.SUNDAY,
    F.MONDAY,
    F.TUESDAY,
    F.WEDNESDAY,
    F.THURSDAY,
    F.FRIDAY,
    F.SATURDAY,
  ];
  const monthKeys = [
    F.RRULE_MONTH_1,
    F.RRULE_MONTH_2,
    F.RRULE_MONTH_3,
    F.RRULE_MONTH_4,
    F.RRULE_MONTH_5,
    F.RRULE_MONTH_6,
    F.RRULE_MONTH_7,
    F.RRULE_MONTH_8,
    F.RRULE_MONTH_9,
    F.RRULE_MONTH_10,
    F.RRULE_MONTH_11,
    F.RRULE_MONTH_12,
  ];
  const dayNames = dayKeys.map((k, i) => tt(k, EN_DAYS[i]));
  const monthNames = monthKeys.map((k, i) => tt(k, MONTH_NAMES[i]));
  // Map (not an object literal) so the multi-word token "on the" is allowed.
  const vocab = new Map<string, string>([
    ['every', tt(F.RRULE_NLP_EVERY, 'every')],
    ['day', tt(F.RRULE_NLP_DAY, 'day')],
    ['days', tt(F.RRULE_NLP_DAYS, 'days')],
    ['week', tt(F.RRULE_NLP_WEEK, 'week')],
    ['weeks', tt(F.RRULE_NLP_WEEKS, 'weeks')],
    ['month', tt(F.RRULE_NLP_MONTH, 'month')],
    ['months', tt(F.RRULE_NLP_MONTHS, 'months')],
    ['year', tt(F.RRULE_NLP_YEAR, 'year')],
    ['years', tt(F.RRULE_NLP_YEARS, 'years')],
    ['on', tt(F.RRULE_NLP_ON, 'on')],
    ['on the', tt(F.RRULE_NLP_ON_THE, 'on the')],
    ['the', tt(F.RRULE_NLP_THE, 'the')],
    ['and', tt(F.RRULE_NLP_AND, 'and')],
    ['or', tt(F.RRULE_NLP_OR, 'or')],
    ['for', tt(F.RRULE_NLP_FOR, 'for')],
    ['time', tt(F.RRULE_NLP_TIME, 'time')],
    ['times', tt(F.RRULE_NLP_TIMES, 'times')],
    ['until', tt(F.RRULE_NLP_UNTIL, 'until')],
    ['weekday', tt(F.RRULE_NLP_WEEKDAY, 'weekday')],
    ['weekdays', tt(F.RRULE_NLP_WEEKDAYS, 'weekdays')],
    ['in', tt(F.RRULE_NLP_IN, 'in')],
    ['last', tt(F.RRULE_NLP_LAST, 'last')],
    ['st', tt(F.RRULE_NLP_ST, 'st')],
    ['nd', tt(F.RRULE_NLP_ND, 'nd')],
    ['rd', tt(F.RRULE_NLP_RD, 'rd')],
    ['th', tt(F.RRULE_NLP_TH, 'th')],
  ]);
  return {
    gettext: (id: string): string => vocab.get(id) ?? id,
    language: { dayNames, monthNames, tokens: {} },
    andWord: tt(F.RRULE_NLP_AND, 'and'),
    toWord: tt(F.RRULE_NLP_TO, 'to'),
  };
};

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Deduped, ascending BYMONTH list (engine-shared toNumArray + order for range compression). */
const toMonthArray = (v: unknown): number[] =>
  [...new Set(toNumArray(v))].sort((a, b) => a - b);

/**
 * rrule.toText() spells out every month ("March, April … and November"). Collapse
 * runs of 3+ consecutive months into "March to November" for a shorter reading.
 */
const compressMonthRanges = (
  text: string,
  bymonth: unknown,
  monthNames: string[],
  andWord: string,
  toWord: string,
): string => {
  const months = toMonthArray(bymonth);
  let result = text;
  let i = 0;
  while (i < months.length) {
    let j = i;
    while (j + 1 < months.length && months[j + 1] === months[j] + 1) j++;
    if (j - i >= 2) {
      const names = months.slice(i, j + 1).map((m) => monthNames[m - 1]);
      const last = names[names.length - 1];
      const listStr = `${names.slice(0, -1).join(', ')} ${andWord} ${last}`;
      result = result.replace(listStr, `${names[0]} ${toWord} ${last}`);
    }
    i = j + 1;
  }
  return result;
};

/** Parse a rrule body and anchor it at `dtstart`, or null if unparseable. */
const _ruleAnchoredAt = (rrule: string, dtstart: Date): RRule | null => {
  const opts = safeParseRRuleOptions(rrule);
  if (!opts) return null;
  try {
    return new RRule({ ...opts, dtstart });
  } catch {
    return null;
  }
};

/** The next `count` occurrences (local noon) on/after the later of start date and now. */
const _getUpcoming = (
  rrule: string,
  startDate: string | undefined,
  count: number,
): Date[] => {
  const anchor = startDate ? noonUtc(startDate) : new Date();
  const rule = _ruleAnchoredAt(rrule, anchor);
  if (!rule) return [];
  const out: Date[] = [];
  // Seed just before the later of the anchor and now so we show FUTURE instances
  // (a rule whose start is in the past should preview from today, not its origin).
  let seed = new Date(Math.max(anchor.getTime(), Date.now()) - 1);
  for (let k = 0; k < count; k++) {
    let occ: Date | null;
    try {
      occ = rule.after(seed, false);
    } catch {
      break;
    }
    if (!occ) break;
    out.push(toLocalNoon(occ));
    seed = occ;
  }
  return out;
};

/** Re-anchor the rule to `done`'s day and return the next occurrence (engine parity). */
const _getCompletionNext = (rrule: string, done: Date): Date | null => {
  const start = new Date(
    Date.UTC(done.getFullYear(), done.getMonth(), done.getDate(), 12, 0, 0),
  );
  const rule = _ruleAnchoredAt(rrule, start);
  if (!rule) return null;
  try {
    const occ = rule.after(start, false);
    return occ ? toLocalNoon(occ) : null;
  } catch {
    return null;
  }
};

/**
 * Resolves an RRULE body to a humanized reading + concrete upcoming dates for the
 * dialog's live preview. `startDate` anchors the occurrence examples (defaults to
 * today). Returns null when empty or unparseable.
 */
export const getRRulePreview = (
  rrule: string | undefined,
  startDate?: string,
  humanize?: RRuleHumanizeOpts,
): RRulePreview | null => {
  if (typeof rrule !== 'string' || !rrule.trim()) return null;
  const body = rrule.trim();
  try {
    const rule = RRule.fromString(body);
    if (rule.options.freq == null) return null;
    const text = humanize
      ? rule.toText(humanize.gettext as never, humanize.language as never)
      : rule.toText();
    const human = compressMonthRanges(
      text,
      rule.options.bymonth,
      humanize?.language.monthNames ?? MONTH_NAMES,
      humanize?.andWord ?? 'and',
      humanize?.toWord ?? 'to',
    );
    const upcoming = _getUpcoming(body, startDate, 3);
    const next = upcoming.length ? _getCompletionNext(body, upcoming[0]) : null;
    const completionExample = next ? { done: upcoming[0], next } : null;
    return {
      rrule: body,
      human: human.charAt(0).toUpperCase() + human.slice(1),
      upcoming,
      completionExample,
    };
  } catch {
    return null;
  }
};
