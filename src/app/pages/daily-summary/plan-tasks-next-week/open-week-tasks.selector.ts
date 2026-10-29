import { createSelector } from '@ngrx/store';
import { Dictionary } from '@ngrx/entity';
import { Task } from '../../../features/tasks/task.model';
import {
  selectOverdueTaskIds,
  selectTaskEntities,
} from '../../../features/tasks/store/task.selectors';
import { selectUndoneTodayTaskIds } from '../../../features/work-context/store/work-context.selectors';
import { selectTodayStr } from '../../../root-store/app-state/app-state.selectors';

/**
 * Unfinished one-off tasks left from this week: today's and overdue ones, plus
 * their subtasks due today. Repeating-task instances are left out: next week
 * creates its own, so moving these would duplicate them.
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
    const overdueIdSet = new Set(overdueIds);
    const isOpen = (t: Task | undefined): t is Task => !!t && !t.isDone && !t.repeatCfgId;
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
      if (!isOpen(task)) continue;
      for (const subId of task.subTaskIds) {
        const sub = entities[subId];
        if (isOpen(sub) && (sub.dueDay === todayStr || overdueIdSet.has(sub.id))) {
          add(sub);
        }
      }
      add(task);
    }
    return result;
  },
);
