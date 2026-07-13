import { BatchedTimeSyncEntry } from '../../../core/util/batched-time-sync-accumulator';
import { TaskState } from '../task.model';
import { updateTimeSpentForTask } from '../store/task.reducer.util';

/**
 * Removes locally accumulated task-time deltas from an op-log snapshot.
 *
 * The live store is updated on every timer tick, while the corresponding persistent
 * operation is intentionally batched. Persisting the live total during that window
 * would make the later delta overlap the snapshot and double-count on replay.
 */
export const projectPendingTimeFromTaskState = (
  state: TaskState,
  pendingEntries: readonly BatchedTimeSyncEntry[],
): TaskState => {
  let projectedState = state;

  for (const { id, date, duration } of pendingEntries) {
    const task = projectedState.entities[id];
    if (!task || !Number.isFinite(duration) || duration <= 0) {
      continue;
    }

    const currentForDay = task.timeSpentOnDay?.[date] || 0;
    const projectedForDay = Math.max(0, currentForDay - duration);
    const timeSpentOnDay = { ...task.timeSpentOnDay };
    if (projectedForDay > 0) {
      timeSpentOnDay[date] = projectedForDay;
    } else {
      delete timeSpentOnDay[date];
    }

    projectedState = updateTimeSpentForTask(id, timeSpentOnDay, projectedState);
  }

  return projectedState;
};
