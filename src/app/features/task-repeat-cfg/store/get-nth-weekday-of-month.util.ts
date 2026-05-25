import {
  MonthlyWeekOfMonth,
  MonthlyWeekday,
  TaskRepeatCfg,
} from '../task-repeat-cfg.model';

// Noon (12:00) is used throughout to dodge DST transitions, matching the
// convention used elsewhere in the recurrence calc utils.
export const getNthWeekdayOfMonth = (
  year: number,
  month: number,
  weekday: MonthlyWeekday,
  n: MonthlyWeekOfMonth,
): Date => {
  if (n === -1) {
    const result = new Date(year, month + 1, 0);
    const offset = (result.getDay() - weekday + 7) % 7;
    result.setDate(result.getDate() - offset);
    result.setHours(12, 0, 0, 0);
    return result;
  }
  // For n in 1..4, the resulting day is always ≤ 28 (max offset 6 + (4-1)*7 +
  // 1 = 28), which fits even in a 28-day February — so no overflow check is
  // needed.
  const firstDay = new Date(year, month, 1);
  const offset = (weekday - firstDay.getDay() + 7) % 7;
  const weeksToAdd = (n - 1) * 7;
  const result = new Date(year, month, 1 + offset + weeksToAdd);
  result.setHours(12, 0, 0, 0);
  return result;
};

type AnchorFields = Pick<TaskRepeatCfg, 'monthlyWeekOfMonth' | 'monthlyWeekday'>;
type AnchorPresent = Required<AnchorFields>;

/**
 * Anchor presence (both fields set and in range) is the single source of
 * truth for "Nth weekday" recurrence. Out-of-range values from a malformed
 * sync payload make callers fall back to legacy day-of-month behavior
 * instead of silently producing wrong dates.
 */
export const hasNthWeekdayAnchor = (cfg: AnchorFields): cfg is AnchorPresent => {
  const w = cfg.monthlyWeekOfMonth;
  const d = cfg.monthlyWeekday;
  return (
    Number.isInteger(w) &&
    (w === -1 || (w! >= 1 && w! <= 4)) &&
    Number.isInteger(d) &&
    d! >= 0 &&
    d! <= 6
  );
};

/**
 * Walks `maxMonths` calendar months starting from `fromDate` (anchored to day
 * 1 of that month) in `direction` (+1 forward / -1 backward), computing each
 * month's Nth-weekday candidate and returning the first one that `accept`
 * approves. Used by all three monthly recurrence calc utils to share the
 * cursor-walking loop without duplicating the logic.
 */
export const findMonthlyNthWeekdayOccurrence = (
  cfg: AnchorPresent,
  fromDate: Date,
  options: {
    direction: 1 | -1;
    maxMonths: number;
    accept: (candidate: Date, cursor: Date) => boolean;
  },
): Date | null => {
  const cursor = new Date(fromDate);
  cursor.setDate(1);
  for (let i = 0; i < options.maxMonths; i++) {
    const candidate = getNthWeekdayOfMonth(
      cursor.getFullYear(),
      cursor.getMonth(),
      cfg.monthlyWeekday,
      cfg.monthlyWeekOfMonth,
    );
    if (options.accept(candidate, cursor)) {
      return candidate;
    }
    cursor.setMonth(cursor.getMonth() + options.direction);
  }
  return null;
};
