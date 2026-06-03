import { RRule } from 'rrule';

/**
 * Lightweight English → RFC 5545 RRULE parser for the `@+<phrase>` inline short
 * syntax. Hand-rolled (no binary, no WASM) — covers the common day-oriented
 * phrasings; anything it can't read returns null and the caller leaves the title
 * untouched. Output is validated through rrule before being returned.
 *
 * Examples:
 *   "every day"                          → FREQ=DAILY
 *   "every 3 days"                       → FREQ=DAILY;INTERVAL=3
 *   "weekdays"                           → FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR
 *   "every other tuesday"               → FREQ=WEEKLY;INTERVAL=2;BYDAY=TU
 *   "every monday and wednesday"        → FREQ=WEEKLY;BYDAY=MO,WE
 *   "first monday of the month"         → FREQ=MONTHLY;BYDAY=1MO
 *   "last day of the month"             → FREQ=MONTHLY;BYMONTHDAY=-1
 *   "monthly on the 15th"               → FREQ=MONTHLY;BYMONTHDAY=15
 *   "every saturday from march to november" → FREQ=YEARLY;BYMONTH=3,4,5,6,7,8,9,10,11;BYDAY=SA
 *   "every day for 10 times"            → FREQ=DAILY;COUNT=10
 */

const WEEKDAY_TO_RR: Record<string, string> = {
  monday: 'MO',
  mon: 'MO',
  tuesday: 'TU',
  tue: 'TU',
  tues: 'TU',
  wednesday: 'WE',
  wed: 'WE',
  thursday: 'TH',
  thu: 'TH',
  thur: 'TH',
  thurs: 'TH',
  friday: 'FR',
  fri: 'FR',
  saturday: 'SA',
  sat: 'SA',
  sunday: 'SU',
  sun: 'SU',
};
const RR_ORDER = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

const MONTH_TO_NUM: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const ORDINAL_TO_N = new Map<string, number>([
  ['first', 1],
  ['1st', 1],
  ['second', 2],
  ['2nd', 2],
  ['third', 3],
  ['3rd', 3],
  ['fourth', 4],
  ['4th', 4],
  ['last', -1],
]);

const WD = `(${Object.keys(WEEKDAY_TO_RR).join('|')})`;
const MO = `(${Object.keys(MONTH_TO_NUM).join('|')})`;

/** All weekday names mentioned, deduped, in RRULE order (MO…SU). */
const extractWeekdays = (s: string): string[] => {
  const found = new Set<string>();
  const re = new RegExp(`\\b${WD}s?\\b`, 'g'); // optional plural: "mondays"
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) found.add(WEEKDAY_TO_RR[m[1]]);
  return RR_ORDER.filter((d) => found.has(d));
};

/** Months mentioned, with "X to/through/- Y" expanded to an inclusive range. */
const extractMonths = (s: string): number[] => {
  const range = s.match(
    new RegExp(`\\b${MO}\\s*(?:to|through|thru|-|–|until)\\s*${MO}\\b`),
  );
  if (range) {
    const a = MONTH_TO_NUM[range[1]];
    const b = MONTH_TO_NUM[range[2]];
    if (a <= b) return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  }
  const found = new Set<number>();
  const re = new RegExp(`\\b${MO}\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) found.add(MONTH_TO_NUM[m[1]]);
  return [...found].sort((x, y) => x - y);
};

/** "first monday", "2nd tuesday", "last friday" → { n, weekday }. */
const extractOrdinalWeekday = (s: string): { n: number; weekday: string } | null => {
  const ords = [...ORDINAL_TO_N.keys()].join('|');
  const m = s.match(new RegExp(`\\b(${ords})\\s+${WD}s?\\b`));
  if (!m) return null;
  return { n: ORDINAL_TO_N.get(m[1])!, weekday: WEEKDAY_TO_RR[m[2]] };
};

/** "the 15th", "on the 1st", "15th" → day-of-month number (1–31). */
const extractDayOfMonth = (s: string): number | null => {
  const m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)\b/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 1 && n <= 31 ? n : null;
};

/** Loose date → RFC 5545 UNTIL value (noon UTC), or null. */
const parseLooseUntil = (str: string): string | null => {
  const s = str.trim();
  // Parse a bare ISO date as LOCAL (Date.parse treats it as UTC → off-by-one in
  // negative-offset zones); everything else via Date.parse.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = iso ? new Date(+iso[1], +iso[2] - 1, +iso[3]) : new Date(Date.parse(s));
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}T120000Z`;
};

export const naturalLanguageToRRule = (input: string): string | null => {
  if (!input || !input.trim()) return null;
  let s = ` ${input.trim().toLowerCase().replace(/\s+/g, ' ')} `;

  // --- end condition (strip so it doesn't pollute structural parsing) ---
  let end: string | null = null;
  const countM = s.match(/\b(?:for\s+)?(\d+)\s+times\b/);
  if (countM) {
    end = `COUNT=${countM[1]}`;
    s = s.replace(countM[0], ' ');
  } else {
    const untilM = s.match(/\b(?:until|till|ending on|ends on|end on)\s+(.+?)\s*$/);
    if (untilM) {
      const u = parseLooseUntil(untilM[1]);
      if (u) {
        end = `UNTIL=${u}`;
        s = s.replace(untilM[0], ' ');
      }
    }
  }

  // --- interval ---
  let interval = 1;
  if (/\bevery other\b/.test(s) || /\b(biweekly|fortnightly)\b/.test(s)) interval = 2;
  const everyN = s.match(/\bevery (\d+)\b/);
  if (everyN) interval = parseInt(everyN[1], 10);

  const weekdays = extractWeekdays(s);
  const months = extractMonths(s);
  const ordinal = extractOrdinalWeekday(s);
  const dom = extractDayOfMonth(s);

  let freq: string | null = null;
  const by: string[] = [];
  // "every day", "everyday", "every 3 days" — note "everyday" has no \bday\b
  // boundary, so it needs its own alternative.
  const isDaily = /\b(daily|everyday|days?)\b/.test(s);

  if (ordinal) {
    freq = 'MONTHLY';
    by.push(`BYDAY=${ordinal.n}${ordinal.weekday}`);
  } else if (/\blast day\b/.test(s)) {
    freq = 'MONTHLY';
    by.push('BYMONTHDAY=-1');
  } else if (isDaily) {
    // Daily, optionally bounded to months: "every day from January to April"
    // → daily within those months (FREQ=DAILY;BYMONTH=1,2,3,4).
    freq = 'DAILY';
    if (months.length) by.push(`BYMONTH=${months.join(',')}`);
  } else if (months.length && weekdays.length) {
    freq = 'YEARLY';
    by.push(`BYMONTH=${months.join(',')}`, `BYDAY=${weekdays.join(',')}`);
  } else if (/\bweekdays?\b/.test(s)) {
    freq = 'WEEKLY';
    by.push('BYDAY=MO,TU,WE,TH,FR');
    if (months.length) by.push(`BYMONTH=${months.join(',')}`);
  } else if (/\bweekends?\b/.test(s)) {
    freq = 'WEEKLY';
    by.push('BYDAY=SA,SU');
    if (months.length) by.push(`BYMONTH=${months.join(',')}`);
  } else if (weekdays.length) {
    freq = 'WEEKLY';
    by.push(`BYDAY=${weekdays.join(',')}`);
    if (months.length) by.push(`BYMONTH=${months.join(',')}`);
  } else if (months.length) {
    // months only, no daily/weekly/weekday word → yearly in those months
    freq = 'YEARLY';
    by.push(`BYMONTH=${months.join(',')}`);
    if (dom) by.push(`BYMONTHDAY=${dom}`);
  } else if (/\b(weekly|weeks?|biweekly|fortnightly)\b/.test(s)) {
    freq = 'WEEKLY';
  } else if (/\b(monthly|months?)\b/.test(s)) {
    freq = 'MONTHLY';
    if (dom) by.push(`BYMONTHDAY=${dom}`);
  } else if (/\b(yearly|years?|annually|annual)\b/.test(s)) {
    freq = 'YEARLY';
  }

  if (!freq) return null;

  const parts = [`FREQ=${freq}`];
  if (interval > 1) parts.push(`INTERVAL=${interval}`);
  parts.push(...by);
  if (end) parts.push(end);
  const result = parts.join(';');

  // Final guard: never emit something rrule itself rejects.
  try {
    const opts = RRule.parseString(result);
    if (opts.freq == null) return null;
  } catch {
    return null;
  }
  return result;
};
