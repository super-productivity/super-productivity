import { Task } from '../task.model';
import { getDbDateStr } from '../../../util/get-db-date-str';

type DueTask = Pick<Task, 'isDone' | 'dueDay' | 'dueWithTime'> & {
  parentId?: string | null;
};

/** Count scheduled main tasks, once each, through the current logical day. */
export const countDueTasks = (
  tasks: readonly DueTask[],
  today: string,
  startOfNextDayDiffMs: number,
): number =>
  tasks.reduce((count, task) => {
    if (task.isDone || task.parentId) return count;
    const dueDay = task.dueWithTime
      ? getDbDateStr(new Date(task.dueWithTime - startOfNextDayDiffMs))
      : task.dueDay;
    return count + Number(!!dueDay && dueDay <= today);
  }, 0);
