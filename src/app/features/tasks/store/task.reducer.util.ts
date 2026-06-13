// HELPER
// ------
import {
  Task,
  TaskCopy,
  TaskState,
  TaskWithSubTasks,
  TimeSpentOnDay,
} from '../task.model';
import { calcTotalTimeSpent } from '../util/calc-total-time-spent';
import { taskAdapter } from './task.adapter';
import { filterOutId } from '../../../util/filter-out-id';
import { Update } from '@ngrx/entity';
import { TaskLog } from '../../../core/log';
import { devError } from '../../../util/dev-error';
import { getDbDateStr } from '../../../util/get-db-date-str';

export const getTaskById = (taskId: string, state: TaskState): Task => {
  if (!state.entities[taskId]) {
    throw new Error('Task not found: ' + taskId);
  } else {
    return state.entities[taskId] as Task;
  }
};

// SHARED REDUCER ACTIONS
// ----------------------
export const reCalcTimesForParentIfParent = (
  parentId: string,
  state: TaskState,
): TaskState => {
  // Roll up estimate + spent for the parent AND every ancestor above it, bottom-up
  // so each level reads its children's already-recalculated values (#2657).
  let s = state;
  let currentId: string | undefined = parentId;
  const visited = new Set<string>();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    s = reCalcTimeEstimateForParentIfParent(currentId, s);
    s = reCalcTimeSpentForParentIfParent(currentId, s);
    currentId = s.entities[currentId]?.parentId;
  }
  return s;
};

export const reCalcTimeSpentForParentIfParent = (
  parentId: string,
  state: TaskState,
): TaskState => {
  if (parentId) {
    const parentTask = state.entities[parentId];
    if (!parentTask) {
      TaskLog.err(
        `Parent task ${parentId} not found in reCalcTimeSpentForParentIfParent`,
      );
      return state;
    }

    const subTasks = parentTask.subTaskIds
      .map((id) => state.entities[id])
      .filter((task): task is Task => !!task);

    const timeSpentOnDayParent: { [key: string]: number } = {};

    subTasks.forEach((subTask: Task) => {
      if (subTask.timeSpentOnDay) {
        Object.keys(subTask.timeSpentOnDay).forEach((strDate) => {
          if (subTask.timeSpentOnDay[strDate]) {
            if (!timeSpentOnDayParent[strDate]) {
              timeSpentOnDayParent[strDate] = 0;
            }
            timeSpentOnDayParent[strDate] += subTask.timeSpentOnDay[strDate];
          }
        });
      }
    });
    return taskAdapter.updateOne(
      {
        id: parentId,
        changes: {
          timeSpentOnDay: timeSpentOnDayParent,
          timeSpent: calcTotalTimeSpent(timeSpentOnDayParent),
        },
      },
      state,
    );
  } else {
    return state;
  }
};

export const reCalcTimeEstimateForParentIfParent = (
  parentId: string,
  state: TaskState,
  upd?: Update<TaskCopy>,
): TaskState => {
  const parentTask = state.entities[parentId];
  if (!parentTask) {
    TaskLog.err(
      `Parent task ${parentId} not found in reCalcTimeEstimateForParentIfParent`,
    );
    return state;
  }

  const subTasks = parentTask.subTaskIds
    .map((id) => {
      const task = state.entities[id];
      if (!task) return null;
      // we do this since we also need to consider the done value of the update
      return upd && upd.id === id ? { ...task, ...upd.changes } : task;
    })
    .filter((task): task is Task => !!task);
  // TaskLog.log(
  //   subTasks.reduce((acc: number, st: Task) => {
  //     TaskLog.log(
  //       (st.isDone ? 0 : Math.max(0, st.timeEstimate - st.timeSpent)) / 60 / 1000,
  //     );
  //
  //     return acc + (st.isDone ? 0 : Math.max(0, st.timeEstimate - st.timeSpent));
  //   }, 0) /
  //     60 /
  //     1000,
  // );

  return taskAdapter.updateOne(
    {
      id: parentId,
      changes: {
        timeEstimate: subTasks.reduce((acc: number, st: Task) => {
          if (st.isDone) {
            return acc;
          }
          // A non-leaf child's timeEstimate is ALREADY its rolled-up remaining
          // estimate (sum of its own children's remaining); subtracting its
          // also-rolled-up timeSpent again would double-count. Only leaves
          // compute remaining as est - spent. (#2657)
          const remaining = st.subTaskIds?.length
            ? st.timeEstimate
            : Math.max(0, st.timeEstimate - st.timeSpent);
          return acc + remaining;
        }, 0),
      },
    },
    state,
  );
};

/**
 * Roll up the time *estimate* for `parentId` and every ancestor above it. `upd`
 * (a pending child change not yet in state, e.g. an isDone toggle) is only
 * considered at the immediate-parent level. Bottom-up so each level reads its
 * children's freshly-rolled-up estimate. (#2657)
 */
export const reCalcTimeEstimateForAncestors = (
  parentId: string,
  state: TaskState,
  upd?: Update<TaskCopy>,
): TaskState => {
  let s = state;
  let currentId: string | undefined = parentId;
  let pendingUpd = upd;
  const visited = new Set<string>();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    s = reCalcTimeEstimateForParentIfParent(currentId, s, pendingUpd);
    pendingUpd = undefined;
    currentId = s.entities[currentId]?.parentId;
  }
  return s;
};

/** Roll up the time *spent* for `parentId` and every ancestor above it. (#2657) */
export const reCalcTimeSpentForAncestors = (
  parentId: string,
  state: TaskState,
): TaskState => {
  let s = state;
  let currentId: string | undefined = parentId;
  const visited = new Set<string>();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    s = reCalcTimeSpentForParentIfParent(currentId, s);
    currentId = s.entities[currentId]?.parentId;
  }
  return s;
};

export const updateDoneOnForTask = (
  upd: Update<Task>,
  state: TaskState,
  todayStr: string,
): TaskState => {
  const task = state.entities[upd.id] as Task;
  const isToDone = upd.changes.isDone === true;
  const isToUnDone = upd.changes.isDone === false;
  if (isToDone || isToUnDone) {
    const hasExistingSchedule =
      typeof task.dueDay === 'string' || typeof task.dueWithTime === 'number';
    const hasScheduleInUpdate =
      Object.prototype.hasOwnProperty.call(upd.changes, 'dueDay') ||
      Object.prototype.hasOwnProperty.call(upd.changes, 'dueWithTime');
    const doneOn =
      typeof upd.changes.doneOn === 'number' ? upd.changes.doneOn : Date.now();
    const completionDay =
      typeof upd.changes.doneOn === 'number'
        ? getDbDateStr(upd.changes.doneOn)
        : todayStr;
    const changes = {
      ...(isToDone
        ? {
            doneOn,
            ...(!task.parentId && !hasExistingSchedule && !hasScheduleInUpdate
              ? { dueDay: completionDay }
              : {}),
          }
        : {}),
      ...(isToUnDone ? { doneOn: undefined } : {}),
    };
    return taskAdapter.updateOne(
      {
        id: task.id,
        changes,
      },
      state,
    );
  } else {
    return state;
  }
};

export const updateStartDateForRepeatableTask = (
  upd: Update<Task>,
  state: TaskState,
): TaskState => {
  const task = state.entities[upd.id] as Task;
  const isToDone = upd.changes.isDone === true;
  const isToUnDone = upd.changes.isDone === false;

  if (isToDone || isToUnDone) {
    const changes = {
      ...(isToDone ? { doneOn: Date.now(), dueDay: undefined } : {}),
      ...(isToUnDone ? { doneOn: undefined } : {}),
    };
    return taskAdapter.updateOne(
      {
        id: task.id,
        changes,
      },
      state,
    );
  } else {
    return state;
  }
};

/**
 * Incrementally updates parent's timeSpentOnDay based on delta from subtask change.
 * Much faster than full recalculation when only one day changed.
 */
const updateParentTimeSpentIncremental = (
  parentId: string,
  oldTimeSpentOnDay: TimeSpentOnDay | undefined,
  newTimeSpentOnDay: TimeSpentOnDay,
  state: TaskState,
): TaskState => {
  const parent = state.entities[parentId];
  if (!parent) return state;

  // Find what days changed and by how much
  const allDays = new Set([
    ...Object.keys(oldTimeSpentOnDay || {}),
    ...Object.keys(newTimeSpentOnDay),
  ]);

  let totalDelta = 0;
  const parentTimeSpentOnDay = { ...parent.timeSpentOnDay };

  for (const day of allDays) {
    const oldVal = oldTimeSpentOnDay?.[day] || 0;
    const newVal = newTimeSpentOnDay[day] || 0;
    const delta = newVal - oldVal;

    if (delta !== 0) {
      totalDelta += delta;
      const currentParentVal = parentTimeSpentOnDay[day] || 0;
      const newParentVal = currentParentVal + delta;

      if (newParentVal > 0) {
        parentTimeSpentOnDay[day] = newParentVal;
      } else {
        delete parentTimeSpentOnDay[day];
      }
    }
  }

  return taskAdapter.updateOne(
    {
      id: parentId,
      changes: {
        timeSpentOnDay: parentTimeSpentOnDay,
        timeSpent: parent.timeSpent + totalDelta,
      },
    },
    state,
  );
};

export const updateTimeSpentForTask = (
  id: string,
  newTimeSpentOnDay: TimeSpentOnDay,
  state: TaskState,
): TaskState => {
  if (!newTimeSpentOnDay) {
    return state;
  }

  const task = getTaskById(id, state);
  const oldTimeSpentOnDay = task.timeSpentOnDay;
  const timeSpent = calcTotalTimeSpent(newTimeSpentOnDay);

  let stateAfterUpdate = taskAdapter.updateOne(
    {
      id,
      changes: {
        timeSpentOnDay: newTimeSpentOnDay,
        timeSpent,
      },
    },
    state,
  );

  // Use incremental update instead of full recalculation, climbing the whole
  // ancestor chain — the per-day delta propagates equally to every ancestor (#2657).
  let parentId = task.parentId;
  const visited = new Set<string>([id]);
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    stateAfterUpdate = updateParentTimeSpentIncremental(
      parentId,
      oldTimeSpentOnDay,
      newTimeSpentOnDay,
      stateAfterUpdate,
    );
    parentId = stateAfterUpdate.entities[parentId]?.parentId;
  }
  return stateAfterUpdate;
};

export const updateTimeEstimateForTask = (
  upd: Update<TaskCopy>,
  newEstimate: number | null = null,
  state: TaskState,
): TaskState => {
  if (typeof newEstimate === 'number' || 'isDone' in upd.changes) {
    const task = getTaskById(upd.id as string, state);
    const stateAfterUpdate =
      typeof newEstimate === 'number'
        ? taskAdapter.updateOne(
            {
              id: upd.id as string,
              changes: {
                timeEstimate: newEstimate,
              },
            },
            state,
          )
        : state;
    return task.parentId
      ? reCalcTimeEstimateForAncestors(task.parentId, stateAfterUpdate, upd)
      : stateAfterUpdate;
  }
  return state;
};

export const deleteTaskHelper = (
  state: TaskState,
  taskToDelete: TaskWithSubTasks | Task,
): TaskState => {
  let stateCopy: TaskState = taskAdapter.removeOne(taskToDelete.id, state);

  let currentTaskId =
    state.currentTaskId === taskToDelete.id ? null : state.currentTaskId;

  // PARENT TASK side effects
  // also delete from parent task if any
  if (taskToDelete.parentId) {
    stateCopy = removeTaskFromParentSideEffects(stateCopy, taskToDelete, true);
  }

  // SUB TASK side effects — recursively delete the WHOLE subtree (#2657), not
  // just direct children.
  const payloadSubTaskIds = taskToDelete.subTaskIds || [];

  // Build a parent→children index from state once, then BFS the full subtree.
  // We walk parentId back-references (the source of truth for membership, even
  // when a parent's subTaskIds is stale after a sync race) so no descendant is
  // left orphaned at any depth.
  const childrenByParent = new Map<string, string[]>();
  for (const id of state.ids as string[]) {
    const pid = state.entities[id]?.parentId;
    if (pid) {
      const siblings = childrenByParent.get(pid);
      if (siblings) {
        siblings.push(id);
      } else {
        childrenByParent.set(pid, [id]);
      }
    }
  }

  const stateSubTaskIds: string[] = [];
  const visited = new Set<string>([taskToDelete.id]);
  let frontier: string[] = [taskToDelete.id];
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const childId of childrenByParent.get(id) ?? []) {
        if (!visited.has(childId)) {
          visited.add(childId);
          stateSubTaskIds.push(childId);
          next.push(childId);
        }
      }
    }
    frontier = next;
  }

  // DEFENSIVE diagnostic: direct subtasks present in state but missing from the
  // payload's subTaskIds indicate a sync race (subtask added but parent's
  // subTaskIds not synced before a SYNC_IMPORT + moveToArchive). Scoped to
  // DIRECT children so legitimately-nested grandchildren don't trip the warning.
  const directStateChildren = childrenByParent.get(taskToDelete.id) ?? [];
  const orphanSubTaskIds = directStateChildren.filter(
    (id) => !payloadSubTaskIds.includes(id),
  );
  if (orphanSubTaskIds.length > 0) {
    devError(
      `[deleteTaskHelper] Found ${orphanSubTaskIds.length} orphan subtask(s) not in parent's subTaskIds. ` +
        `Parent: ${taskToDelete.id}, Orphans: ${orphanSubTaskIds.join(', ')}. ` +
        `This indicates a sync race condition - subtasks added but parent.subTaskIds not updated before archive.`,
    );
  }

  // Combine both lists to ensure all subtasks (at any depth) are removed
  const allSubTaskIds = [...new Set([...payloadSubTaskIds, ...stateSubTaskIds])];

  if (allSubTaskIds.length > 0) {
    stateCopy = taskAdapter.removeMany(allSubTaskIds, stateCopy);
    // unset current if one of them is the current task
    currentTaskId =
      !!currentTaskId && allSubTaskIds.includes(currentTaskId) ? null : currentTaskId;
  }

  return {
    ...stateCopy,
    currentTaskId,
  };
};

export const removeTaskFromParentSideEffects = (
  state: TaskState,
  taskToRemove: Task,
  isCopyTimesAfterLast: boolean = false,
): TaskState => {
  const parentId: string = taskToRemove.parentId as string;
  const parentTask = state.entities[parentId] as Task;

  if (!parentTask) {
    TaskLog.err(`Parent task ${parentId} not found in removeTaskFromParentSideEffects`);
    return state;
  }

  const isWasLastSubTask = parentTask.subTaskIds.length === 1;

  let newState = taskAdapter.updateOne(
    {
      id: parentId,
      changes: {
        subTaskIds: parentTask.subTaskIds.filter(filterOutId(taskToRemove.id)),

        // copy over sub task time stuff if it was the last sub task
        ...(isWasLastSubTask && isCopyTimesAfterLast
          ? {
              timeSpentOnDay: taskToRemove.timeSpentOnDay,
              timeEstimate: taskToRemove.timeEstimate,
            }
          : {}),
      },
    },
    state,
  );
  // also update time spent for parent (and all ancestors) if it was not copied
  // over from sub task
  if (!isWasLastSubTask || !isCopyTimesAfterLast) {
    newState = reCalcTimesForParentIfParent(parentId, newState);
  }
  return newState;
};
