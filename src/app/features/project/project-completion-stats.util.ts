import { Task } from '../tasks/task.model';
import { getDiffInDays } from '../../util/get-diff-in-days';
import { dateStrToUtcDate } from '../../util/date-str-to-utc-date';

export interface ProjectCompletionStats {
  nrOfTasksDone: number;
  nrOfTasksTotal: number;
  /** Sum of tracked time in ms (0 when time tracking is unused). */
  timeSpent: number;
  nrOfDaysWorked: number;
  /** Local-midnight ms of the earliest worked day, or null if never worked. */
  startedOn: number | null;
  doneOn: number;
  /** Calendar days from first worked day to completion, inclusive (0 if never worked). */
  durationDays: number;
}

/**
 * Live completion stats for the celebration + trophy view.
 *
 * Computed from the still-live store (completing a project only sets a flag — it
 * does NOT move tasks to the archive store), so this is accurate at completion
 * time. It can drift if tasks are later deleted/manually-archived — an accepted
 * tradeoff of computing live instead of snapshotting.
 *
 * @param topLevelTasks the project's parent tasks (taskIds + backlogTaskIds)
 * @param allTasks parents + subtasks — used only to union worked-day keys
 * @param doneOn completion timestamp (ms)
 */
export const getProjectCompletionStats = (
  topLevelTasks: Task[],
  allTasks: Task[],
  doneOn: number,
): ProjectCompletionStats => {
  const nrOfTasksTotal = topLevelTasks.length;
  const nrOfTasksDone = topLevelTasks.filter((t) => t.isDone).length;
  // A parent's timeSpent already aggregates its subtasks, so sum top-level only
  // — summing subtasks too would double-count.
  const timeSpent = topLevelTasks.reduce((acc, t) => acc + (t.timeSpent || 0), 0);

  const workedDays = new Set<string>();
  allTasks.forEach((t) => {
    Object.keys(t.timeSpentOnDay || {}).forEach((dayStr) => {
      if ((t.timeSpentOnDay[dayStr] || 0) > 0) {
        workedDays.add(dayStr);
      }
    });
  });
  const sortedDays = Array.from(workedDays).sort();
  const nrOfDaysWorked = sortedDays.length;
  // timeSpentOnDay keys are 'YYYY-MM-DD'. dateStrToUtcDate parses them as LOCAL
  // midnight (avoids the UTC-midnight day-shift in non-UTC zones); getDiffInDays
  // rounds the calendar-day delta (DST-safe).
  const startedOn = nrOfDaysWorked ? dateStrToUtcDate(sortedDays[0]).getTime() : null;
  const durationDays =
    startedOn !== null ? getDiffInDays(new Date(startedOn), new Date(doneOn)) + 1 : 0;

  return {
    nrOfTasksDone,
    nrOfTasksTotal,
    timeSpent,
    nrOfDaysWorked,
    startedOn,
    doneOn,
    durationDays,
  };
};
