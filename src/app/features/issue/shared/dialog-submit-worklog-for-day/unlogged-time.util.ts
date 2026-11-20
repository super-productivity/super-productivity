import { IssueTaskTimeTracked, TimeSpentOnDay } from '../../../tasks/task.model';

const getUnloggedOnDay = (
  timeSpentOnDay: TimeSpentOnDay,
  logged: IssueTaskTimeTracked | null | undefined,
  day: string,
): number => Math.max(0, (timeSpentOnDay[day] ?? 0) - (logged?.[day] ?? 0));

/** Tracked time not yet submitted to the issue provider, summed over all days. */
export const getUnloggedTimeMs = (
  timeSpentOnDay: TimeSpentOnDay,
  logged: IssueTaskTimeTracked | null | undefined,
): number =>
  Object.keys(timeSpentOnDay).reduce(
    (acc, day) => acc + getUnloggedOnDay(timeSpentOnDay, logged, day),
    0,
  );

/** Whether the unlogged total includes time from a day other than `day`. */
export const hasUnloggedTimeOnOtherDays = (
  timeSpentOnDay: TimeSpentOnDay,
  logged: IssueTaskTimeTracked | null | undefined,
  day: string,
): boolean =>
  Object.keys(timeSpentOnDay).some(
    (d) => d !== day && getUnloggedOnDay(timeSpentOnDay, logged, d) > 0,
  );
