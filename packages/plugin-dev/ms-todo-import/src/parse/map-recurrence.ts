import { PluginTaskRepeatCfgSchedule } from '@super-productivity/plugin-api';

type Schedule = PluginTaskRepeatCfgSchedule;

/** Microsoft Graph `patternedRecurrence` (only the fields To Do uses). */
export interface RawRecurrence {
  pattern?: {
    type?: string;
    interval?: number;
    daysOfWeek?: string[];
    dayOfMonth?: number;
    month?: number;
    index?: string;
    firstDayOfWeek?: string;
  };
  range?: {
    type?: string;
    endDate?: string;
    numberOfOccurrences?: number;
  };
}

const WEEKDAY_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

const WORK_WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

const INDEX_NTH: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4 };

/** The repeat dialog's limit for "repeat every". */
const MAX_REPEAT_EVERY = 1000;

const utcDate = (day: string): Date => new Date(`${day}T00:00:00Z`);

const isWeekday = (day: string): day is (typeof WEEKDAY_KEYS)[number] =>
  (WEEKDAY_KEYS as readonly string[]).includes(day);

const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && b.every((d) => a.includes(d));

/**
 * To Do counts "every N weeks" in weeks that begin on `firstDayOfWeek`; Super
 * Productivity counts 7-day blocks from the start date. They agree only when
 * no repeat day falls before the start's weekday within To Do's week.
 */
const keepsWeekBoundaries = (days: string[], start: Date, firstDay: string): boolean => {
  const first = WEEKDAY_KEYS.indexOf(isWeekday(firstDay) ? firstDay : 'sunday');
  const offset = (day: number): number => (day - first + 7) % 7;
  const startOffset = offset(start.getUTCDay());
  return days.every(
    (d) =>
      offset(WEEKDAY_KEYS.indexOf(d as (typeof WEEKDAY_KEYS)[number])) >= startOffset,
  );
};

const mapWeekly = (
  pattern: NonNullable<RawRecurrence['pattern']>,
  every: number,
  start: Date,
): Schedule | null => {
  const days = pattern.daysOfWeek ?? [];
  if (!days.length || !days.every(isWeekday)) {
    return null;
  }
  if (
    every > 1 &&
    !keepsWeekBoundaries(days, start, pattern.firstDayOfWeek ?? 'sunday')
  ) {
    return null;
  }
  if (every === 1 && sameSet(days, WORK_WEEK)) {
    return { quickSetting: 'MONDAY_TO_FRIDAY' };
  }
  if (every === 1 && sameSet(days, [WEEKDAY_KEYS[start.getUTCDay()]])) {
    return { quickSetting: 'WEEKLY_CURRENT_WEEKDAY' };
  }
  const schedule: Schedule = {
    quickSetting: 'CUSTOM',
    repeatCycle: 'WEEKLY',
    repeatEvery: every,
  };
  days.forEach((day) => (schedule[day as (typeof WEEKDAY_KEYS)[number]] = true));
  return schedule;
};

/** The presets derive the day from the start date, so it must be that day. */
const mapAnchored = (
  type: string,
  pattern: NonNullable<RawRecurrence['pattern']>,
  every: number,
  start: Date,
): Schedule | null => {
  const isStartDayOfMonth = pattern.dayOfMonth === start.getUTCDate();
  if (type === 'absoluteMonthly' && isStartDayOfMonth) {
    return every === 1
      ? { quickSetting: 'MONTHLY_CURRENT_DATE' }
      : { quickSetting: 'CUSTOM', repeatCycle: 'MONTHLY', repeatEvery: every };
  }
  if (
    type === 'absoluteYearly' &&
    isStartDayOfMonth &&
    pattern.month === start.getUTCMonth() + 1
  ) {
    return every === 1
      ? { quickSetting: 'YEARLY_CURRENT_DATE' }
      : { quickSetting: 'CUSTOM', repeatCycle: 'YEARLY', repeatEvery: every };
  }
  const nth = INDEX_NTH[pattern.index ?? 'first'];
  const days = pattern.daysOfWeek ?? [];
  if (
    type === 'relativeMonthly' &&
    every === 1 &&
    nth &&
    days.length === 1 &&
    days[0] === WEEKDAY_KEYS[start.getUTCDay()] &&
    Math.ceil(start.getUTCDate() / 7) === nth
  ) {
    return { quickSetting: 'MONTHLY_NTH_WEEKDAY' };
  }
  return null;
};

/**
 * Maps a To Do recurrence to a repeat schedule for a task due on `startDay`
 * (YYYY-MM-DD). Returns null for anything that would repeat differently from
 * the original (e.g. "last friday", a fixed number of occurrences) so the
 * caller keeps the rule as text instead.
 */
export const mapRecurrence = (raw: RawRecurrence, startDay: string): Schedule | null => {
  const pattern = raw.pattern;
  const every = pattern?.interval ?? 1;
  if (
    !pattern?.type ||
    !Number.isInteger(every) ||
    every < 1 ||
    every > MAX_REPEAT_EVERY
  ) {
    return null;
  }
  const start = utcDate(startDay);
  let schedule: Schedule | null;
  if (pattern.type === 'daily') {
    schedule =
      every === 1
        ? { quickSetting: 'DAILY' }
        : { quickSetting: 'CUSTOM', repeatCycle: 'DAILY', repeatEvery: every };
  } else if (pattern.type === 'weekly') {
    schedule = mapWeekly(pattern, every, start);
  } else {
    schedule = mapAnchored(pattern.type, pattern, every, start);
  }
  if (!schedule) {
    return null;
  }

  const range = raw.range;
  if (range?.type === 'numbered') {
    return null;
  }
  if (range?.type === 'endDate' && range.endDate) {
    return range.endDate >= startDay
      ? { ...schedule, repeatUntilDay: range.endDate }
      : null;
  }
  return schedule;
};

const UNIT_BY_TYPE: Record<string, string> = {
  daily: 'day',
  weekly: 'week',
  absoluteMonthly: 'month',
  relativeMonthly: 'month',
  absoluteYearly: 'year',
  relativeYearly: 'year',
};

/** A short English description for the notes, e.g. "every 2 weeks on monday, friday". */
export const describeRecurrence = (raw: RawRecurrence): string => {
  const pattern = raw.pattern ?? {};
  const unit = UNIT_BY_TYPE[pattern.type ?? ''] ?? pattern.type ?? 'unknown';
  const every = pattern.interval ?? 1;
  const parts = [every === 1 ? `every ${unit}` : `every ${every} ${unit}s`];
  if (pattern.type?.startsWith('relative')) {
    parts.push(
      `on the ${pattern.index ?? 'first'} ${(pattern.daysOfWeek ?? []).join(', ')}`,
    );
  } else if (pattern.daysOfWeek?.length && pattern.type === 'weekly') {
    parts.push(`on ${pattern.daysOfWeek.join(', ')}`);
  } else if (pattern.dayOfMonth) {
    const month =
      pattern.type === 'absoluteYearly' && pattern.month ? `${pattern.month}/` : '';
    parts.push(`on day ${month}${pattern.dayOfMonth}`);
  }
  if (raw.range?.type === 'endDate' && raw.range.endDate) {
    parts.push(`until ${raw.range.endDate}`);
  } else if (raw.range?.type === 'numbered' && raw.range.numberOfOccurrences) {
    parts.push(`${raw.range.numberOfOccurrences} times`);
  }
  return parts.join(' ');
};
