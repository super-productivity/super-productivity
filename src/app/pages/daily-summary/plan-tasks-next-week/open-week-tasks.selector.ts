import { createSelector } from '@ngrx/store';
import { Dictionary } from '@ngrx/entity';
import { Task } from '../../../features/tasks/task.model';
import {
  selectOverdueTaskIds,
  selectTaskEntities,
} from '../../../features/tasks/store/task.selectors';
import { selectUndoneTodayTaskIds } from '../../../features/work-context/store/work-context.selectors';
import { selectTodayStr } from '../../../root-store/app-state/app-state.selectors';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { getWorkWeekStart } from '../finish-week.util';

/**
 * Unfinished one-off tasks left from this week (due since its Monday): today's
 * and overdue ones, plus their subtasks due today. Left out:
 * - repeating-task instances and their subtasks: next week creates its own, so
 *   moving these would duplicate them
 * - tasks with a time: planning a task for a day drops its time and reminder
 * - tasks overdue from before this week: an older backlog is not "this week"
 *
 * Subtasks come before their parent: planning the parent collapses its subtasks
 * under it on that day, while a subtask planned after its parent would show as an
 * extra row next to it.
 */
export const selectOpenWeekTasks = createSelector(
  selectUndoneTodayTaskIds,
  selectOverdueTaskIds,
  selectTaskEntities,
  selectTodayStr,
  (
    todayIds: string[],
    overdueIds: string[],
    entities: Dictionary<Task>,
    todayStr: string,
  ): Task[] => {
    const weekStartStr = getDbDateStr(getWorkWeekStart(dateStrToUtcDate(todayStr)));
    const overdueIdSet = new Set(overdueIds);
    const isCarried = (t: Task | undefined): t is Task =>
      !!t &&
      !t.isDone &&
      !t.repeatCfgId &&
      !t.dueWithTime &&
      (!t.dueDay || t.dueDay >= weekStartStr);
    const seen = new Set<string>();
    const result: Task[] = [];
    const add = (t: Task): void => {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        result.push(t);
      }
    };
    for (const id of [...todayIds, ...overdueIds]) {
      const task = entities[id];
      if (!isCarried(task)) continue;
      if (task.parentId && entities[task.parentId]?.repeatCfgId) continue;
      for (const subId of task.subTaskIds) {
        const sub = entities[subId];
        if (isCarried(sub) && (sub.dueDay === todayStr || overdueIdSet.has(sub.id))) {
          add(sub);
        }
      }
      add(task);
    }
    return result;
  },
);
