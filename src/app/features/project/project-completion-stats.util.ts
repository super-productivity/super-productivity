import { Task } from '../tasks/task.model';

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

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const _toLocalMidnight = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

// timeSpentOnDay keys are 'YYYY-MM-DD'. Parse as LOCAL midnight — `new
// Date('YYYY-MM-DD')` is UTC midnight, which shifts the calendar day in
// non-UTC zones and would skew the duration math.
const _parseDayStr = (dayStr: string): number => {
  const [y, m, d] = dayStr.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};

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
  const startedOn = nrOfDaysWorked ? _parseDayStr(sortedDays[0]) : null;
  const durationDays =
    startedOn !== null
      ? Math.round((_toLocalMidnight(doneOn) - startedOn) / MS_PER_DAY) + 1
      : 0;

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
