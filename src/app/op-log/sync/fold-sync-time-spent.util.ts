import { extractActionPayload } from '@sp/sync-core';
import { ActionType, Operation } from '../core/operation.types';
import { TimeSpentOnDay } from '../../features/tasks/task.model';
import { calcTotalTimeSpent } from '../../features/tasks/util/calc-total-time-spent';

/** True for a `syncTimeSpent` op: an additive delta, not a field write. */
export const isSyncTimeSpentOp = (op: Operation): boolean =>
  op.actionType === ActionType.TIME_TRACKING_SYNC_TIME_SPENT;

/**
 * Adds the `syncTimeSpent` deltas targeting `taskId` to a projection of the
 * task's time fields, mirroring the replay reducer (`[date] += duration`,
 * `timeSpent` recomputed, non-finite durations skipped).
 *
 * Used when a local snapshot of the time fields is re-emitted with a clock
 * that dominates a winning delta: the snapshot is read before the delta is
 * applied, so without folding it in, every receiver would overwrite the
 * tracked time with the pre-delta value (#10215). Fields absent from
 * `changes` are left absent.
 */
export const foldSyncTimeSpentDeltas = (
  taskId: string,
  changes: Record<string, unknown>,
  deltaOps: Operation[],
): Record<string, unknown> => {
  const current = changes['timeSpentOnDay'];
  if (typeof current !== 'object' || current === null) {
    return changes;
  }
  let timeSpentOnDay = current as TimeSpentOnDay;
  for (const op of deltaOps) {
    if (!isSyncTimeSpentOp(op)) {
      continue;
    }
    // Remote input: stay total on a malformed payload.
    const payload = extractActionPayload(op.payload) ?? {};
    const { taskId: opTaskId, date, duration } = payload;
    if (
      opTaskId !== taskId ||
      typeof date !== 'string' ||
      typeof duration !== 'number' ||
      !Number.isFinite(duration)
    ) {
      continue;
    }
    timeSpentOnDay = {
      ...timeSpentOnDay,
      [date]: (+timeSpentOnDay[date] || 0) + duration,
    };
  }
  if (timeSpentOnDay === current) {
    return changes;
  }
  return {
    ...changes,
    timeSpentOnDay,
    ...('timeSpent' in changes ? { timeSpent: calcTotalTimeSpent(timeSpentOnDay) } : {}),
  };
};
