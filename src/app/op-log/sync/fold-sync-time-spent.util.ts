import { extractActionPayload } from '@sp/sync-core';
import { mergeVectorClocks } from '../../core/util/vector-clock';
import { ActionType, isLwwUpdatePayload, Operation } from '../core/operation.types';
import { Task, TimeSpentOnDay } from '../../features/tasks/task.model';
import { calcTotalTimeSpent } from '../../features/tasks/util/calc-total-time-spent';
import { initialTaskState, taskReducer } from '../../features/tasks/store/task.reducer';
import { taskAdapter } from '../../features/tasks/store/task.adapter';
import { updateTimeSpentForTask } from '../../features/tasks/store/task.reducer.util';
import { mergeChangedFields } from './conflict-disjoint-merge.util';
import { convertOpToAction } from '../apply/operation-converter.util';
import { getOpEntityIds } from '../util/get-op-entity-ids.util';
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
 * A local winner can share an entity with incoming nonconflicting time edits
 * (including edits to its children). Project those edits in their received
 * order and persist the incoming prefix BEFORE the snapshot. Hoisting only a
 * delta can put it ahead of an absolute edit and silently erase tracked time.
 * Keep both decisions together. Live apply still uses the written remote rows
 * and only the local snapshots needed for compensation.
 */
export const buildTimeAwareResolutionBatches = async ({
  unappliedRemoteLosers,
  compensatedRemoteOps,
  newLocalWinOps,
  remoteWinsOps,
  localMultiReconciliationOps,
  nonConflictingOps,
  getTask,
}: {
  unappliedRemoteLosers: Operation[];
  compensatedRemoteOps: Operation[];
  newLocalWinOps: Operation[];
  remoteWinsOps: Operation[];
  localMultiReconciliationOps: Operation[];
  nonConflictingOps: Operation[];
  getTask: (taskId: string) => Promise<unknown>;
}): Promise<{ batches: MixedSourceOperationBatch[]; precedingOps: Operation[] }> => {
  const foldedIds = new Set<string>();
  const foldSnapshots = (ops: Operation[], timeOps: Operation[]): Promise<Operation[]> =>
    Promise.all(
      ops.map(async (op) => {
        if (op.entityType !== 'TASK' || !op.entityId || !isLwwUpdatePayload(op.payload)) {
          return op;
        }
        const fields = op.payload.actionPayload;
        if (!('timeSpentOnDay' in fields) || timeOps.length === 0) return op;
        const subTaskIds =
          (fields as Partial<Task>).subTaskIds ??
          ((await getTask(op.entityId)) as Partial<Task> | undefined)?.subTaskIds ??
          [];
        const task = { ...((await getTask(op.entityId)) as Task), ...fields } as Task;
        const children = await Promise.all(subTaskIds.map((id) => getTask(id)));
        let projected = taskAdapter.setAll(
          [task, ...children.filter((child): child is Task => !!child)],
          initialTaskState,
        );
        const folded: Operation[] = [];
        for (const incoming of timeOps) {
          if (incoming.entityType !== 'TASK') continue;
          const ids = getOpEntityIds(incoming).filter((id) => projected.entities[id]);
          if (ids.length === 0) continue;
          const before = projected;
          // Replay semantic time actions with their real reducer, including
          // removal clamping, deferred rounding and child-to-parent totals.
          if (
            isSyncTimeSpentOp(incoming) ||
            incoming.actionType === ActionType.TASK_REMOVE_TIME_SPENT ||
            incoming.actionType === ActionType.TASK_ROUND_TIME_SPENT
          ) {
            projected = taskReducer(projected, convertOpToAction(incoming));
          } else {
            for (const id of ids) {
              const changes = mergeChangedFields([incoming], 'task', id);
              const timeSpentOnDay = changes['timeSpentOnDay'] as
                | TimeSpentOnDay
                | undefined;
              if (timeSpentOnDay) {
                projected = updateTimeSpentForTask(id, timeSpentOnDay, projected);
              }
            }
          }
          if (projected !== before) folded.push(incoming);
        }
        if (folded.length === 0) return op;
        const projectedTask = projected.entities[op.entityId]!;
        const actionPayload = {
          ...fields,
          timeSpentOnDay: projectedTask.timeSpentOnDay,
          ...('timeSpent' in fields ? { timeSpent: projectedTask.timeSpent } : {}),
        };
        folded.forEach((incoming) => foldedIds.add(incoming.id));
        // The snapshot carries these edits, so its clock must dominate them.
        const vectorClock = folded.reduce(
          (clock, incoming) => mergeVectorClocks(clock, incoming.vectorClock),
          op.vectorClock,
        );
        return { ...op, vectorClock, payload: { ...op.payload, actionPayload } };
      }),
    );
  // A delta that won its own row can share the entity with a local-win row
  // (e.g. local rename beat a remote rename); the snapshot must carry it too.
  // Reconciliations already fold their winning deltas.
  const winningTimeOps = remoteWinsOps.filter(isSyncTimeSpentOp);
  const [localWins, reconciliations] = await Promise.all([
    foldSnapshots(newLocalWinOps, [...nonConflictingOps, ...winningTimeOps]),
    foldSnapshots(localMultiReconciliationOps, nonConflictingOps),
  ]);
  // Keep the incoming prefix intact: hoisting a delta alone can move it ahead
  // of an absolute time edit (losing the delta) or the task's CREATE.
  const isFolded = (op: Operation): boolean => foldedIds.has(op.id);
  const lastFoldedIndex = nonConflictingOps.reduce(
    (last, op, index) => (isFolded(op) ? index : last),
    -1,
  );
  const precedingOps = nonConflictingOps.slice(0, lastFoldedIndex + 1);
  const batches: MixedSourceOperationBatch[] = [
    { ops: unappliedRemoteLosers, source: 'remote' },
    {
      ops: [...compensatedRemoteOps, ...precedingOps, ...winningTimeOps.filter(isFolded)],
      source: 'remote',
      options: { pendingApply: true },
    },
    { ops: localWins, source: 'local' },
    {
      ops: remoteWinsOps.filter((op) => !isFolded(op)),
      source: 'remote',
      options: { pendingApply: true },
    },
    { ops: reconciliations, source: 'local' },
  ];
  return { precedingOps, batches: batches.filter((batch) => batch.ops.length > 0) };
};
