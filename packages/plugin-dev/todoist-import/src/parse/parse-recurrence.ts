import { PluginTaskRepeatCfgSchedule } from '@super-productivity/plugin-api';

/** By `Date#getUTCDay()` index. */
const WEEKDAY_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

// Maps, not object literals: a rule word like "constructor" must not match
const WEEKDAY_BY_NAME = new Map<string, number>(
  [
    ['sun', 'sunday'],
    ['mon', 'monday'],
    ['tue', 'tues', 'tuesday'],
    ['wed', 'wednesday'],
    ['thu', 'thur', 'thurs', 'thursday'],
    ['fri', 'friday'],
    ['sat', 'saturday'],
  ].flatMap((names, day) => names.map((name): [string, number] => [name, day])),
);

const MONTH_BY_NAME = new Map<string, number>([
  ...[
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ].flatMap((name, month): [string, number][] => [
    [name, month],
    [name.slice(0, 3), month],
  ]),
  ['sept', 8],
]);

const ORDINAL = new Map<string, number>([
  ['first', 1],
  ['1st', 1],
  ['second', 2],
  ['2nd', 2],
  ['third', 3],
  ['3rd', 3],
  ['fourth', 4],
  ['4th', 4],
]);

const UNIT_CYCLE = {
  day: 'DAILY',
  week: 'WEEKLY',
  month: 'MONTHLY',
  year: 'YEARLY',
} as const;

const PRESET_BY_UNIT = {
  day: 'DAILY',
  week: 'WEEKLY_CURRENT_WEEKDAY',
  month: 'MONTHLY_CURRENT_DATE',
  year: 'YEARLY_CURRENT_DATE',
} as const;

const SHORTHAND = new Map<string, string>([
  ['daily', 'every day'],
  ['weekly', 'every week'],
  ['monthly', 'every month'],
  ['yearly', 'every year'],
  ['annually', 'every year'],
]);

/** The repeat dialog's limit for "repeat every". */
const MAX_REPEAT_EVERY = 1000;

type Schedule = PluginTaskRepeatCfgSchedule;

const utcDate = (day: string): Date => new Date(`${day}T00:00:00Z`);

const toDayStr = (year: number, month: number, day: number): string | null => {
  const date = new Date(Date.UTC(year, month, day));
  return date.getUTCMonth() === month && date.getUTCDate() === day
    ? date.toISOString().slice(0, 10)
    : null;
};

/** "jan 5", "january 5th", "5 jan" → [month, day]. */
const parseMonthDay = (text: string): [number, number] | null => {
  const monthFirst = /^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?$/.exec(text);
  const dayFirst = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)$/.exec(text);
  const [monthName, day] = monthFirst
    ? [monthFirst[1], monthFirst[2]]
    : dayFirst
      ? [dayFirst[2], dayFirst[1]]
      : [];
  const month = monthName === undefined ? undefined : MONTH_BY_NAME.get(monthName);
  return month === undefined ? null : [month, Number(day)];
};

/**
 * The end day of "until <date>": `2027-03-01`, `mar 1 2027`, or `mar 1`
 * (the first one on or after `startDay`).
 */
const parseEndDay = (text: string, startDay: string): string | null => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [y, m, d] = text.split('-').map(Number);
    return toDayStr(y, m - 1, d);
  }
  const withYear = /^(.+?),? (\d{4})$/.exec(text);
  const monthDay = parseMonthDay(withYear ? withYear[1] : text);
  if (!monthDay) {
    return null;
  }
  if (withYear) {
    return toDayStr(Number(withYear[2]), ...monthDay);
  }
  const startYear = utcDate(startDay).getUTCFullYear();
  const sameYear = toDayStr(startYear, ...monthDay);
  return sameYear && sameYear >= startDay
    ? sameYear
    : toDayStr(startYear + 1, ...monthDay);
};

/** "every 3 weeks", "every other month", "every year" (after `every `). */
const parseInterval = (
  body: string,
  startDay: string,
  isFromCompletion: boolean,
): Schedule | null => {
  const match = /^(?:(\d+|other) )?(day|week|month|year)s?$/.exec(body);
  if (!match) {
    return null;
  }
  const unit = match[2] as keyof typeof UNIT_CYCLE;
  const every = match[1] === 'other' ? 2 : Number(match[1] ?? 1);
  if (!Number.isInteger(every) || every < 1 || every > MAX_REPEAT_EVERY) {
    return null;
  }
  if (isFromCompletion) {
    return {
      quickSetting: 'CUSTOM',
      repeatCycle: UNIT_CYCLE[unit],
      repeatEvery: every,
      repeatFromCompletionDate: true,
    };
  }
  if (every === 1) {
    return { quickSetting: PRESET_BY_UNIT[unit] };
  }
  return {
    quickSetting: 'CUSTOM',
    repeatCycle: UNIT_CYCLE[unit],
    repeatEvery: every,
    // a weekly custom schedule needs a weekday: the one of the next date
    ...(unit === 'week' ? { [WEEKDAY_KEYS[utcDate(startDay).getUTCDay()]]: true } : {}),
  };
};

/** "monday", "mon, wed and fri", "other tuesday", "weekend". */
const parseWeekdays = (body: string): Schedule | null => {
  const isOther = body.startsWith('other ');
  const list = isOther ? body.slice('other '.length) : body;
  const names = list === 'weekend' ? ['sat', 'sun'] : list.split(/, ?and |, ?| and /);
  const days = names.map((name) => WEEKDAY_BY_NAME.get(name));
  if (days.some((day) => day === undefined)) {
    return null;
  }
  const schedule: Schedule = {
    quickSetting: 'CUSTOM',
    repeatCycle: 'WEEKLY',
    repeatEvery: isOther ? 2 : 1,
  };
  days.forEach((day) => (schedule[WEEKDAY_KEYS[day as number]] = true));
  return schedule;
};

/**
 * Rules anchored to a day of the month or year. The presets derive that day
 * from the task's date, so they only apply when the date is that day.
 */
const parseAnchoredDay = (body: string, startDay: string): Schedule | null => {
  const start = utcDate(startDay);
  if (body === 'last day') {
    return { quickSetting: 'MONTHLY_LAST_DAY' };
  }
  const nthWeekday = /^([a-z0-9]+) ([a-z]+)$/.exec(body);
  const nth = nthWeekday && ORDINAL.get(nthWeekday[1]);
  const weekday = nthWeekday && WEEKDAY_BY_NAME.get(nthWeekday[2]);
  if (nth && weekday !== undefined && weekday !== null) {
    const isStartDay =
      weekday === start.getUTCDay() && Math.ceil(start.getUTCDate() / 7) === nth;
    return isStartDay ? { quickSetting: 'MONTHLY_NTH_WEEKDAY' } : null;
  }
  const dayOfMonth = /^(\d{1,2})(?:st|nd|rd|th)?$/.exec(body);
  if (dayOfMonth) {
    return Number(dayOfMonth[1]) === start.getUTCDate()
      ? { quickSetting: 'MONTHLY_CURRENT_DATE' }
      : null;
  }
  const monthDay = parseMonthDay(body);
  if (monthDay) {
    const [month, day] = monthDay;
    return month === start.getUTCMonth() && day === start.getUTCDate()
      ? { quickSetting: 'YEARLY_CURRENT_DATE' }
      : null;
  }
  return null;
};

const parseBody = (
  body: string,
  startDay: string,
  isFromCompletion: boolean,
): Schedule | null => {
  const interval = parseInterval(body, startDay, isFromCompletion);
  if (interval || isFromCompletion) {
    return interval;
  }
  if (body === 'weekday' || body === 'workday') {
    return { quickSetting: 'MONDAY_TO_FRIDAY' };
  }
  return parseWeekdays(body) ?? parseAnchoredDay(body, startDay);
};

/**
 * Maps an English Todoist recurrence (`due.string`, e.g. "every! 3 days",
 * "every mon, fri at 9am", "every 2nd tuesday until dec 31") to a repeat
 * schedule for a task whose next date is `startDay` (YYYY-MM-DD).
 *
 * Returns null for anything it does not fully understand — hourly rules,
 * other languages, "every last friday" — so the caller keeps the rule as
 * text instead of creating a repeat that differs from the original.
 */
export const parseTodoistRecurrence = (
  rule: string,
  startDay: string,
): Schedule | null => {
  const [first, ...rest] = rule.toLowerCase().trim().split(/\s+/);
  let text = [SHORTHAND.get(first) ?? first, ...rest].join(' ');

  let repeatUntilDay: string | null = null;
  const until = /^(.+?) (?:until|till|ending) (.+)$/.exec(text);
  if (until) {
    repeatUntilDay = parseEndDay(until[2], startDay);
    if (!repeatUntilDay || repeatUntilDay < startDay) {
      return null;
    }
    text = until[1];
  }
  // the next date already is the start; the time comes with the task's date
  text = text
    .replace(/ (?:starting|from) .+$/, '')
    .replace(/ (?:at |@ ?)?(?:\d{1,2}(?::\d{2})? ?(?:am|pm)|\d{1,2}:\d{2})$/, '')
    .replace(/ at (?:\d{1,2}|noon|midnight)$/, '');

  const head = /^(every!?) (.+)$/.exec(text);
  if (!head) {
    return null;
  }
  const schedule = parseBody(head[2], startDay, head[1] === 'every!');
  if (!schedule) {
    return null;
  }
  return repeatUntilDay ? { ...schedule, repeatUntilDay } : schedule;
};
