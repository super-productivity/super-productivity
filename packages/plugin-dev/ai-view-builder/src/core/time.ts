import type { PluginDayContext, Task } from '@super-productivity/plugin-api';
import { addDays, weekRange } from './query';

// Time tracked per logical day. `timeSpentOnDay` keys are logical days, so a
// range is a pair of date strings and sums compare them as text.

export interface DayRange {
  start: string;
  end: string;
}

export const rangeOfWeek = (day: PluginDayContext): DayRange => weekRange(day);

export const rangeOfLastDays = (days: number, day: PluginDayContext): DayRange => ({
  start: addDays(day.todayStr, -(days - 1)),
  end: day.todayStr,
});

/** Every date from start to end, inclusive. */
export const daysIn = (range: DayRange): string[] => {
  const out: string[] = [];
  for (let d = range.start; d <= range.end; d = addDays(d, 1)) out.push(d);
  return out;
};

export const timeSpentIn = (task: Task, range: DayRange): number =>
  Object.entries(task.timeSpentOnDay ?? {}).reduce(
    (sum, [date, ms]) => (date >= range.start && date <= range.end ? sum + ms : sum),
    0,
  );
