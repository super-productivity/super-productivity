import { SimpleCounterCopy } from './simple-counter.model';
import { getDbDateStr } from '../../util/get-db-date-str';

export const getSimpleCounterStreakDuration = (
  simpleCounter: SimpleCounterCopy,
): number => {
  const countOnDay = simpleCounter.countOnDay;

  if (!simpleCounter.streakMinValue) {
    return 0;
  }

  // Handle weekly frequency mode
  if (simpleCounter.streakMode === 'weekly-frequency') {
    return calculateWeeklyFrequencyStreak(simpleCounter);
  }

  // Handle specific days mode (existing logic)
  if (!simpleCounter.streakWeekDays) {
    return 0;
  }

  let streak = 0;
  const date = new Date();
  // set date to last weekday set in streakWeekDays
  setDayToLastConsideredWeekday(date, simpleCounter.streakWeekDays);

  if (
    getDbDateStr(date) === getDbDateStr(new Date()) &&
    (!countOnDay[getDbDateStr(date)] ||
      countOnDay[getDbDateStr(date)] < simpleCounter.streakMinValue)
  ) {
    date.setDate(date.getDate() - 1);
    setDayToLastConsideredWeekday(date, simpleCounter.streakWeekDays);
  }

  while (countOnDay[getDbDateStr(date)] >= simpleCounter.streakMinValue) {
    streak++;
    date.setDate(date.getDate() - 1);
    setDayToLastConsideredWeekday(date, simpleCounter.streakWeekDays);
  }

  return streak;
};

const calculateWeeklyFrequencyStreak = (simpleCounter: SimpleCounterCopy): number => {
  const { countOnDay, streakMinValue, streakWeeklyFrequency } = simpleCounter;

  if (!streakWeeklyFrequency || streakWeeklyFrequency < 1) {
    return 0;
  }

  const today = new Date();
  const currentWeekStart = getWeekStart(today);

  // Check if current week has met the frequency requirement
  const currentWeekCount = getWeekCompletionCount(
    currentWeekStart,
    countOnDay,
    streakMinValue!,
  );

  let totalCompletedDays = 0;
  const weekStart = new Date(currentWeekStart);

  // If current week hasn't met the requirement yet, start from previous week
  const isCurrentWeekMet = currentWeekCount >= streakWeeklyFrequency;
  if (!isCurrentWeekMet) {
    weekStart.setDate(weekStart.getDate() - 7);
  }

  // Count consecutive weeks that met the requirement
  while (true) {
    const weekCount = getWeekCompletionCount(weekStart, countOnDay, streakMinValue!);

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
  countOnDay: { [key: string]: number },
  minValue: number,
): number => {
  let count = 0;
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6); // Sunday

  for (let i = 0; i < 7; i++) {
    const checkDate = new Date(weekStart);
    checkDate.setDate(checkDate.getDate() + i);
    const dateStr = getDbDateStr(checkDate);

    if (countOnDay[dateStr] && countOnDay[dateStr] >= minValue) {
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
