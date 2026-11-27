import { SimpleCounterCopy } from './simple-counter.model';
import { getDbDateStr } from '../../util/get-db-date-str';

type AvoidDayFields = Pick<SimpleCounterCopy, 'countOnDay' | 'streakMinValue'>;

/**
 * Returns a check whether a day of an 'avoid' habit is clean: its value stays below
 * the limit (streakMinValue; 1 = any occurrence breaks it). An empty day counts as
 * clean. Days before the earliest countOnDay entry don't count (the habit didn't
 * exist yet), and neither do today and later days: today is clean only once it's over.
 * Build it once and reuse it for many days.
 */
export const getAvoidDayCleanCheck = (
  simpleCounter: AvoidDayFields,
  todayStr: string,
): ((dayStr: string) => boolean) => {
  const countOnDay = simpleCounter.countOnDay || {};
  const startDayStr = getAvoidStartDayStr(countOnDay);
  const limit = simpleCounter.streakMinValue || 1;
  return (dayStr) =>
    !!startDayStr &&
    dayStr >= startDayStr &&
    dayStr < todayStr &&
    (countOnDay[dayStr] || 0) < limit;
};

/** Earliest day key; 'YYYY-MM-DD' strings sort chronologically. */
const getAvoidStartDayStr = (countOnDay: {
  [key: string]: number;
}): string | undefined => {
  let start: string | undefined;
  for (const dayStr of Object.keys(countOnDay)) {
    if (start === undefined || dayStr < start) {
      start = dayStr;
    }
  }
  return start;
};

/**
 * @param startOfNextDayDiffMs the "start of next day" offset (DateService.getStartOfNextDayDiffMs()),
 * so the streak is keyed on the same logical day the counter ticks are stored on
 */
export const getSimpleCounterStreakDuration = (
  simpleCounter: SimpleCounterCopy,
  startOfNextDayDiffMs: number = 0,
): number => {
  const countOnDay = simpleCounter.countOnDay || {};
  const today = new Date(Date.now() - startOfNextDayDiffMs);

  if (!simpleCounter.streakMinValue) {
    return 0;
  }

  const isAvoid = simpleCounter.streakDirection === 'avoid';
  const todayStr = getDbDateStr(today);

  // Handle weekly frequency mode
  if (simpleCounter.streakMode === 'weekly-frequency') {
    const minValue = simpleCounter.streakMinValue;
    return calculateWeeklyFrequencyStreak(
      simpleCounter,
      today,
      isAvoid
        ? getAvoidDayCleanCheck(simpleCounter, todayStr)
        : (dateStr) => !!countOnDay[dateStr] && countOnDay[dateStr] >= minValue,
    );
  }

  // Handle specific days mode (existing logic)
  if (!simpleCounter.streakWeekDays) {
    return 0;
  }

  if (isAvoid) {
    return calculateAvoidSpecificDaysStreak(
      simpleCounter,
      simpleCounter.streakWeekDays,
      today,
      todayStr,
    );
  }

  const date = new Date(today);
  // set date to last weekday set in streakWeekDays
  setDayToLastConsideredWeekday(date, simpleCounter.streakWeekDays);

  if (
    getDbDateStr(date) === getDbDateStr(today) &&
    (!countOnDay[getDbDateStr(date)] ||
      countOnDay[getDbDateStr(date)] < simpleCounter.streakMinValue)
  ) {
    date.setDate(date.getDate() - 1);
    setDayToLastConsideredWeekday(date, simpleCounter.streakWeekDays);
  }

  const minValue = simpleCounter.streakMinValue;
  return countConsecutiveWeekdays(
    date,
    simpleCounter.streakWeekDays,
    (dateStr) => countOnDay[dateStr] >= minValue,
  );
};

const calculateAvoidSpecificDaysStreak = (
  simpleCounter: SimpleCounterCopy,
  streakWeekDays: Record<number, boolean>,
  today: Date,
  todayStr: string,
): number => {
  // Reaching the limit on a scheduled today breaks the streak right away
  if (
    streakWeekDays[today.getDay()] &&
    (simpleCounter.countOnDay?.[todayStr] || 0) >= simpleCounter.streakMinValue!
  ) {
    return 0;
  }

  const date = new Date(today);
  date.setDate(date.getDate() - 1);
  setDayToLastConsideredWeekday(date, streakWeekDays);
  // ends at the earliest countOnDay entry at the latest (no clean day before it)
  return countConsecutiveWeekdays(
    date,
    streakWeekDays,
    getAvoidDayCleanCheck(simpleCounter, todayStr),
  );
};

/** Walks back from date (a considered weekday) while isDayMet holds; mutates date. */
const countConsecutiveWeekdays = (
  date: Date,
  streakWeekDays: Record<number, boolean>,
  isDayMet: (dateStr: string) => boolean,
): number => {
  let streak = 0;
  while (isDayMet(getDbDateStr(date))) {
    streak++;
    date.setDate(date.getDate() - 1);
    setDayToLastConsideredWeekday(date, streakWeekDays);
  }
  return streak;
};

const calculateWeeklyFrequencyStreak = (
  simpleCounter: SimpleCounterCopy,
  today: Date,
  isDayMet: (dateStr: string) => boolean,
): number => {
  const { streakWeeklyFrequency } = simpleCounter;

  if (!streakWeeklyFrequency || streakWeeklyFrequency < 1) {
    return 0;
  }

  const currentWeekStart = getWeekStart(today);

  // Check if current week has met the frequency requirement
  const currentWeekCount = getWeekCompletionCount(currentWeekStart, isDayMet);

  let totalCompletedDays = 0;
  const weekStart = new Date(currentWeekStart);

  // If current week hasn't met the requirement yet, start from previous week
  const isCurrentWeekMet = currentWeekCount >= streakWeeklyFrequency;
  if (!isCurrentWeekMet) {
    weekStart.setDate(weekStart.getDate() - 7);
  }

  // Count consecutive weeks that met the requirement
  while (true) {
    const weekCount = getWeekCompletionCount(weekStart, isDayMet);

    if (weekCount >= streakWeeklyFrequency) {
      totalCompletedDays += weekCount;
      weekStart.setDate(weekStart.getDate() - 7);
    } else {
      break;
    }
  }

  if (totalCompletedDays > 0 && !isCurrentWeekMet) {
    return totalCompletedDays + currentWeekCount;
  }

  // When no weeks have met the frequency requirement yet (totalCompletedDays = 0),
  // we intentionally return the current week's count to encourage users.
  // This shows progress even when they haven't completed a full week yet,
  // providing positive reinforcement for building the habit.
  // Example: With streakWeeklyFrequency=5 and only 2 completions this week,
  // this returns 2 (not 0) to show the user they're making progress.
  return totalCompletedDays || currentWeekCount;
};

const getWeekStart = (date: Date): Date => {
  const result = new Date(date);
  const day = result.getDay();
  const diff = day === 0 ? 6 : day - 1; // Monday as week start
  result.setDate(result.getDate() - diff);
  result.setHours(0, 0, 0, 0);
  return result;
};

const getWeekCompletionCount = (
  weekStart: Date,
  isDayMet: (dateStr: string) => boolean,
): number => {
  let count = 0;

  for (let i = 0; i < 7; i++) {
    const checkDate = new Date(weekStart);
    checkDate.setDate(checkDate.getDate() + i);

    if (isDayMet(getDbDateStr(checkDate))) {
      count++;
    }
  }

  return count;
};

const setDayToLastConsideredWeekday = (
  date: Date,
  streakWeekDays: Record<number, boolean>,
): void => {
  let i = 0;
  while (!streakWeekDays[date.getDay()]) {
    date.setDate(date.getDate() - 1);
    i++;
    // fail-safe to avoid infinite loop when all values are false
    if (i > 7) {
      break;
    }
  }
  return undefined;
};
