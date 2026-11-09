import { Action } from '@ngrx/store';
import { TaskCopy } from '../../tasks/task.model';
import { PlannerActions } from '../store/planner.actions';
import { OVERDUE_LIST_ID } from '../planner.model';
import { moveTaskInTodayList } from '../../work-context/store/work-context-meta.actions';
import { WorkContextType } from '../../work-context/work-context.model';
import { TODAY_TAG } from '../../tag/tag.const';
import { unique } from '../../../util/unique';

/** Where a selected planner card sits: a day column (or Overdue), and which list. */
export interface PlannerGroupSource {
  day: string | typeof OVERDUE_LIST_ID;
  isScheduled: boolean;
}

export interface PlannerGroupDrop {
  /** The group in visual order; the leader is the card under the pointer. */
  ids: readonly string[];
  leaderId: string;
  /** The target day's unscheduled cards after CDK moved the leader alone. */
  orderedIds: readonly string[];
  /** The same list before the drop, to skip a placement that changes nothing. */
  currentIds: readonly string[];
  targetDay: string;
  todayStr: string;
  sources: ReadonlyMap<string, PlannerGroupSource>;
  tasks: Readonly<Record<string, TaskCopy | undefined>>;
  /** `planner.days[targetDay]`, which `transferTask` indexes into. */
  targetDayIds: readonly string[];
}

/**
 * Places a selected group as one block at the drop slot, in visual order, using
 * only the per-task actions a single-card drop already dispatches, so released
 * clients replay every op unchanged:
 * - `transferTask` moves a card onto the day (and, for a day other than
 *   today, also positions it in `planner.days`);
 * - today's column is ordered by the TODAY tag, so `moveTaskInTodayList`
 *   places each card after the previous one, as the Today list does.
 *
 * Returns `null` when a member can't be resolved (deleted, or not on screen):
 * the whole drop is refused rather than leaving part of the group behind.
 */
export const getPlannerGroupDropActions = ({
  ids,
  leaderId,
  orderedIds,
  currentIds,
  targetDay,
  todayStr,
  sources,
  tasks,
  targetDayIds,
}: PlannerGroupDrop): Action[] | null => {
  if (ids.length < 2 || !ids.includes(leaderId)) return null;
  if (ids.some((id) => !tasks[id] || !sources.has(id))) return null;

  const selected = new Set(ids);
  const leaderIndex = orderedIds.indexOf(leaderId);
  let anchorIndex = leaderIndex - 1;
  while (anchorIndex >= 0 && selected.has(orderedIds[anchorIndex])) anchorIndex--;
  const anchor = anchorIndex < 0 ? null : orderedIds[anchorIndex];

  const isInTargetList = (id: string): boolean => {
    const source = sources.get(id)!;
    return source.day === targetDay && !source.isScheduled;
  };
  if (ids.every(isInTargetList)) {
    const remaining = currentIds.filter((id) => !selected.has(id));
    const intended = [...remaining];
    intended.splice(anchor === null ? 0 : remaining.indexOf(anchor) + 1, 0, ...ids);
    if (intended.every((id, index) => id === currentIds[index])) return [];
  }

  const isToday = targetDay === todayStr;
  const actions: Action[] = [];
  let afterTaskId = anchor;
  let dayIds = [...targetDayIds];
  for (const id of ids) {
    const task = tasks[id]!;
    const prevDay = sources.get(id)!.day;
    if (isToday) {
      if (!isInTargetList(id)) {
        actions.push(
          PlannerActions.transferTask({
            task,
            prevDay,
            newDay: targetDay,
            targetIndex: 0,
            today: todayStr,
          }),
        );
      }
      actions.push(
        moveTaskInTodayList({
          taskId: id,
          afterTaskId,
          src: 'UNDONE',
          target: 'UNDONE',
          workContextId: TODAY_TAG.id,
          workContextType: WorkContextType.TAG,
        }),
      );
    } else {
      // Mirror transferTask's planner.days update to index the next card.
      const without = dayIds.filter((dayId) => dayId !== id);
      const targetIndex = afterTaskId === null ? 0 : without.indexOf(afterTaskId) + 1;
      actions.push(
        PlannerActions.transferTask({
          task,
          prevDay,
          newDay: targetDay,
          targetIndex,
          today: todayStr,
        }),
      );
      dayIds = unique([
        ...without.slice(0, targetIndex),
        id,
        ...without.slice(targetIndex),
      ]).filter((dayId) => !task.subTaskIds.includes(dayId));
    }
    afterTaskId = id;
  }
  return actions;
};
