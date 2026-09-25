import { extractActionPayload } from '@sp/sync-core';
import { ActionType, isLwwUpdatePayload, Operation } from '../core/operation.types';
import { Task, TimeSpentOnDay } from '../../features/tasks/task.model';
import { calcTotalTimeSpent } from '../../features/tasks/util/calc-total-time-spent';
import type { MixedSourceOperationBatch } from '../persistence/operation-log-store.service';

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
 * `changes` are left absent. A child's delta also increments its parent's
 * aggregate, so parent projections must include their current subtask ids.
 */
export const foldSyncTimeSpentDeltas = (
  taskId: string,
  changes: Record<string, unknown>,
  deltaOps: Operation[],
  subTaskIds: readonly string[] = [],
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
      typeof opTaskId !== 'string' ||
      (opTaskId !== taskId && !subTaskIds.includes(opTaskId)) ||
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

/**
 * A local winner can share an entity with an incoming nonconflicting timer
 * delta. Its snapshot must include that delta, and durable replay must put the
 * delta BEFORE the snapshot; the reverse order would count it twice on restart.
 * Keep both decisions together. Live apply still uses the written remote rows
 * and only the local snapshots needed for compensation.
 */
export const buildTimeAwareResolutionBatches = async ({
  unappliedRemoteLosers,
  compensatedRemoteOps,
  newLocalWinOps,
  remoteWinsOps,
  localMultiReconciliationOps,
  nonConflictingTimeOps,
  getTask,
}: {
  unappliedRemoteLosers: Operation[];
  compensatedRemoteOps: Operation[];
  newLocalWinOps: Operation[];
  remoteWinsOps: Operation[];
  localMultiReconciliationOps: Operation[];
  nonConflictingTimeOps: Operation[];
  getTask: (taskId: string) => Promise<unknown>;
}): Promise<{ batches: MixedSourceOperationBatch[]; foldedTimeOps: Operation[] }> => {
  const foldedIds = new Set<string>();
  const foldSnapshots = (ops: Operation[]): Promise<Operation[]> =>
    Promise.all(
      ops.map(async (op) => {
        if (op.entityType !== 'TASK' || !op.entityId || !isLwwUpdatePayload(op.payload)) {
          return op;
        }
        const fields = op.payload.actionPayload;
        if (!('timeSpentOnDay' in fields) || nonConflictingTimeOps.length === 0)
          return op;
        const subTaskIds =
          (fields as Partial<Task>).subTaskIds ??
          ((await getTask(op.entityId)) as Partial<Task> | undefined)?.subTaskIds ??
          [];
        const deltas = nonConflictingTimeOps.filter((delta) => {
          const taskId = extractActionPayload(delta.payload)?.['taskId'];
          return (
            taskId === op.entityId ||
            (typeof taskId === 'string' && subTaskIds.includes(taskId))
          );
        });
        const actionPayload = foldSyncTimeSpentDeltas(
          op.entityId,
          fields,
          deltas,
          subTaskIds,
        );
        if (actionPayload === fields) return op;
        deltas.forEach((delta) => foldedIds.add(delta.id));
        return { ...op, payload: { ...op.payload, actionPayload } };
      }),
    );
  const [localWins, reconciliations] = await Promise.all([
    foldSnapshots(newLocalWinOps),
    foldSnapshots(localMultiReconciliationOps),
  ]);
  // Leave unrelated deltas in their original batch: a preceding CREATE may be
  // required before their task exists, so blindly hoisting every delta loses it.
  const foldedTimeOps = nonConflictingTimeOps.filter((op) => foldedIds.has(op.id));
  const batches: MixedSourceOperationBatch[] = [
    { ops: unappliedRemoteLosers, source: 'remote' },
    {
      ops: [...compensatedRemoteOps, ...foldedTimeOps],
      source: 'remote',
      options: { pendingApply: true },
    },
    { ops: localWins, source: 'local' },
    { ops: remoteWinsOps, source: 'remote', options: { pendingApply: true } },
    { ops: reconciliations, source: 'local' },
  ];
  return { foldedTimeOps, batches: batches.filter((batch) => batch.ops.length > 0) };
};
