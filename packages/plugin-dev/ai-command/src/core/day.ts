// Logical-day helpers. "Today" always comes from the host's getDayContext(),
// never from new Date(), so a late-night request after midnight still means
// the user's current day.

import type { Day, TaskLike } from './types';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
// The Planner's default work day; the plugin cannot read work hours yet.
// shortcut: a fixed 8 h — read the user's work hours once the API exposes them.
export const DEFAULT_DAY_MIN = 8 * 60;

const pad = (n: number): string => String(n).padStart(2, '0');

const toUtc = (dayStr: string): Date => new Date(`${dayStr}T00:00:00Z`);

export const isDayStr = (value: string): boolean =>
  DAY_RE.test(value) &&
  !Number.isNaN(toUtc(value).getTime()) &&
  toUtc(value).toISOString().startsWith(value);

export const addDays = (dayStr: string, n: number): string => {
  const d = toUtc(dayStr);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const weekdayOf = (dayStr: string): string => WEEKDAYS[toUtc(dayStr).getUTCDay()];

/** The logical day a timestamp falls on, honouring the start-of-next-day offset. */
export const logicalDayOf = (ts: number, startOfNextDayDiffMs: number): string => {
  const d = new Date(ts - startOfNextDayDiffMs);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** The day a task is planned for: a fixed time wins over a plain day. */
export const plannedDayOf = (task: TaskLike, day: Day): string | null =>
  task.dueWithTime
    ? logicalDayOf(task.dueWithTime, day.startOfNextDayDiffMs)
    : task.dueDay || null;

/** Not for done tasks, nor fixed-time ones: moving the plain day would drop their time. */
export const canAddToToday = (task: TaskLike | undefined, day: Day): boolean =>
  !!task && !task.isDone && !task.dueWithTime && plannedDayOf(task, day) !== day.todayStr;

export const deadlineDayOf = (task: TaskLike, day: Day): string | null =>
  task.deadlineWithTime
    ? logicalDayOf(task.deadlineWithTime, day.startOfNextDayDiffMs)
    : task.deadlineDay || null;

export const whenOf = (
  task: TaskLike,
  day: Day,
): 'today' | 'overdue' | 'later' | 'unplanned' => {
  const planned = plannedDayOf(task, day);
  if (!planned) return 'unplanned';
  if (planned === day.todayStr) return 'today';
  return planned < day.todayStr ? 'overdue' : 'later';
};

/** "Today", "Tomorrow", a weekday within the week, else "Nov 12". */
export const dayLabel = (dayStr: string | null, todayStr: string): string => {
  if (!dayStr) return 'No day';
  if (dayStr === todayStr) return 'Today';
  if (dayStr === addDays(todayStr, 1)) return 'Tomorrow';
  if (dayStr > todayStr && dayStr <= addDays(todayStr, 6))
    return weekdayOf(dayStr).slice(0, 3);
  const d = toUtc(dayStr);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
};

export const minutesLabel = (min: number): string => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
};

const remainingMin = (t: TaskLike): number =>
  Math.max(0, (t.timeEstimate || 0) - (t.timeSpent || 0)) / 60000;

/**
 * Free minutes today: the default work day minus time tracked today, minus the
 * remaining estimates of timed tasks still ahead today. Tracked time counts
 * subtasks, estimates count top-level tasks: a parent holds both sums.
 */
export const freeMinutesToday = (tasks: TaskLike[], day: Day): number => {
  const trackedMs = tasks
    .filter((t) => !t.subTaskIds?.length)
    .reduce((sum, t) => sum + (t.timeSpentOnDay?.[day.todayStr] || 0), 0);
  const timedAheadMin = tasks
    .filter((t) => !t.isDone && !t.parentId && t.dueWithTime && t.dueWithTime > day.nowMs)
    .filter((t) => plannedDayOf(t, day) === day.todayStr)
    .reduce((sum, t) => sum + remainingMin(t), 0);
  return Math.max(0, Math.round(DEFAULT_DAY_MIN - trackedMs / 60000 - timedAheadMin));
};

/**
 * Remaining estimated minutes of open untimed tasks planned for today. Timed
 * tasks are already taken off the free minutes; a parent's estimate covers its
 * subtasks, so only top-level tasks count.
 */
export const plannedMinutesToday = (tasks: TaskLike[], day: Day): number =>
  Math.round(
    tasks
      .filter((t) => !t.isDone && !t.parentId && !t.dueWithTime)
      .filter((t) => plannedDayOf(t, day) === day.todayStr)
      .reduce((sum, t) => sum + remainingMin(t), 0),
  );
