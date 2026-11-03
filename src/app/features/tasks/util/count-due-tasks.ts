import { Task } from '../task.model';
import { getDbDateStr } from '../../../util/get-db-date-str';

type DueTask = Pick<Task, 'id' | 'isDone' | 'dueDay' | 'dueWithTime'> & {
  parentId?: string | null;
};

export interface DueTaskCounts {
  today: number;
  overdue: number;
  total: number;
}

/**
 * Count scheduled rows through today, matching Today and overdue nesting.
 * A subtask appears separately when its parent is absent from its day group.
 * Earlier dates share one overdue group; timed tasks later today count too.
 */
export const getDueTaskCounts = (
  tasks: readonly DueTask[],
  today: string,
  startOfNextDayDiffMs: number,
): DueTaskCounts => {
  const todayIds = new Set<string>();
  const overdueIds = new Set<string>();
  const dueTasks: { task: DueTask; groupIds: Set<string> }[] = [];

  for (const task of tasks) {
    const dueDay = task.dueWithTime
      ? getDbDateStr(new Date(task.dueWithTime - startOfNextDayDiffMs))
      : task.dueDay;
    if (!dueDay || dueDay > today) continue;

    const groupIds = dueDay === today ? todayIds : overdueIds;
    // Include completed parents here: the list also nests their children.
    groupIds.add(task.id);
    dueTasks.push({ task, groupIds });
  }

  let todayCount = 0;
  let overdueCount = 0;
  for (const { task, groupIds } of dueTasks) {
    if (task.isDone || (task.parentId && groupIds.has(task.parentId))) continue;
    if (groupIds === todayIds) todayCount++;
    else overdueCount++;
  }
  return { today: todayCount, overdue: overdueCount, total: todayCount + overdueCount };
};

export const countDueTasks = (
  tasks: readonly DueTask[],
  today: string,
  startOfNextDayDiffMs: number,
): number => getDueTaskCounts(tasks, today, startOfNextDayDiffMs).total;
