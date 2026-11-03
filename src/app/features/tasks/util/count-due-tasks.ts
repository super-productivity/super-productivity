import { Task } from '../task.model';
import { getDbDateStr } from '../../../util/get-db-date-str';

type DueTask = Pick<Task, 'id' | 'isDone' | 'dueDay' | 'dueWithTime'> & {
  parentId?: string | null;
};

/**
 * Count scheduled rows through today, matching Today and overdue nesting.
 * A subtask appears separately when its parent is absent from its day group.
 * Earlier dates share one overdue group; timed tasks later today count too.
 */
export const countDueTasks = (
  tasks: readonly DueTask[],
  today: string,
  startOfNextDayDiffMs: number,
): number => {
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

  return dueTasks.reduce(
    (count, { task, groupIds }) =>
      count + Number(!task.isDone && (!task.parentId || !groupIds.has(task.parentId))),
    0,
  );
};
