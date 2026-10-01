import { extractActionPayload } from '@sp/sync-core';
import {
  compareVectorClocks,
  mergeVectorClocks,
  VectorClockComparison,
} from '../../core/util/vector-clock';
import {
  ActionType,
  isLwwUpdatePayload,
  Operation,
  OpType,
} from '../core/operation.types';
import { Task, TimeSpentOnDay } from '../../features/tasks/task.model';
import { calcTotalTimeSpent } from '../../features/tasks/util/calc-total-time-spent';
import { initialTaskState, taskReducer } from '../../features/tasks/store/task.reducer';
import { taskAdapter } from '../../features/tasks/store/task.adapter';
import { updateTimeSpentForTask } from '../../features/tasks/store/task.reducer.util';
import { mergeChangedFields, NOISE_FIELDS } from './conflict-disjoint-merge.util';
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
 * Task fields `updateTask` assigns as they are. Every other field has derived
 * or cross-entity writes (`isDone` sets `doneOn`, `timeEstimate` the parent's
 * total, `projectId`/`tagIds`/`dueDay` the lists), which a field overlay
 * cannot reproduce, and a time delta's arguments are not task fields (#10147).
 */
const PLAIN_TASK_FIELDS: ReadonlySet<string> = new Set(['title', 'notes']);

/**
 * The fields a nonconflicting single-task update writes on `taskId`, when all
 * of them are plain (noise fields aside), else undefined: opaque, multi-entity,
 * another task, an LWW row (whose flat payload reads as no fields), or a field
 * with derived writes. A clear keeps its key with the value `undefined`.
 */
const plainTaskFields = (
  op: Operation,
  taskId: string,
): Record<string, unknown> | undefined => {
  if (
    op.entityType !== 'TASK' ||
    op.opType !== OpType.Update ||
    isLwwUpdatePayload(op.payload)
  ) {
    return undefined;
  }
  const ids = getOpEntityIds(op);
  if (ids.length !== 1 || ids[0] !== taskId) {
    return undefined;
  }
  const changes = mergeChangedFields([op], 'task', taskId);
  const fields = Object.keys(changes).filter((field) => !NOISE_FIELDS.has(field));
  return fields.length > 0 && fields.every((field) => PLAIN_TASK_FIELDS.has(field))
    ? Object.fromEntries(fields.map((field) => [field, changes[field]]))
    : undefined;
};

/** True when `op` declares `taskId` or names it anywhere in its payload. */
const touchesTask = (op: Operation, taskId: string): boolean =>
  getOpEntityIds(op).includes(taskId) ||
  JSON.stringify(op.payload).includes(JSON.stringify(taskId));

/** The `type:id` keys of the entities an op declares. */
const entityKeys = (op: Operation): Set<string> =>
  new Set(getOpEntityIds(op).map((id) => `${op.entityType}:${id}`));

/**
 * #10423: the incoming prefix to persist ahead of the resolution's local rows,
 * in server order. Splitting a download into conflicts and nonconflicting ops
 * loses that order, but on one entity it is causal: a remote winner belongs
 * right after the last nonconflicting op it dominates, which reached the
 * server first, and before any op that dominates it. Such winners join the
 * prefix (`moved`); the others keep their place. The prefix covers at least
 * the first `minLength` nonconflicting ops.
 */
export const orderIncomingPrefix = (
  nonConflictingOps: Operation[],
  remoteWinsOps: Operation[],
  minLength = 0,
): { ordered: Operation[]; precedingOps: Operation[]; moved: Set<Operation> } => {
  const keysOf = new Map(
    [...nonConflictingOps, ...remoteWinsOps].map((op) => [op, entityKeys(op)]),
  );
  // True when `later` causally dominates `earlier` on an entity they share.
  const dominates = (later: Operation, earlier: Operation): boolean =>
    [...keysOf.get(later)!].some((key) => keysOf.get(earlier)!.has(key)) &&
    compareVectorClocks(earlier.vectorClock, later.vectorClock) ===
      VectorClockComparison.LESS_THAN;
  const placed = remoteWinsOps.map((winner) => ({
    winner,
    pos: nonConflictingOps.reduce(
      (last, op, index) => (dominates(winner, op) ? index + 1 : last),
      0,
    ),
  }));
  const length = Math.max(minLength, ...placed.map(({ pos }) => pos));
  const precedingOps = nonConflictingOps.slice(0, length);
  const inPrefix = placed.filter(
    ({ winner, pos }) => pos > 0 || precedingOps.some((op) => dominates(op, winner)),
  );
  const ordered: Operation[] = [];
  for (let index = 0; index <= length; index++) {
    inPrefix.forEach(({ winner, pos }) => pos === index && ordered.push(winner));
    if (index < length) ordered.push(nonConflictingOps[index]);
  }
  return { ordered, precedingOps, moved: new Set(inPrefix.map(({ winner }) => winner)) };
};

/**
 * Without a local resolution row, the remote winners and the incoming prefix
 * they dominate, in server order (`orderIncomingPrefix`); the other winners
 * keep their place first.
 */
export const remoteWinsInServerOrder = (
  nonConflictingOps: Operation[],
  remoteWinsOps: Operation[],
): Operation[] => {
  const { ordered, moved } = orderIncomingPrefix(nonConflictingOps, remoteWinsOps);
  return [...remoteWinsOps.filter((op) => !moved.has(op)), ...ordered];
};

/**
 * A local winner can share an entity with incoming nonconflicting time edits
 * (including edits to its children). Project those edits in their received
 * order and persist the incoming prefix BEFORE the snapshot. Hoisting only a
 * delta can put it ahead of an absolute edit and silently erase tracked time.
 * Keep both decisions together. Live apply still uses the written remote rows
 * and only the local snapshots needed for compensation.
 *
 * An incoming nonconflicting task update of plain fields, e.g. a notes edit
 * that commutes with a pending time delta (#10385), is handled differently: a
 * replace snapshot read before it is applied would erase it on every other
 * device, so its fields are overlaid onto the snapshot's content. Unlike a
 * delta it is absolute, so it needs neither the clock merge nor the hoist: it
 * stays after the snapshot and re-applies the same value there on replay.
 *
 * Field-patch re-sends (#10422) go last, after every incoming op, in the same
 * transaction: a crash between the remote winners and the re-sends would
 * otherwise hydrate the winners without the local fields that beat them.
 */
export const buildTimeAwareResolutionBatches = async ({
  unappliedRemoteLosers,
  compensatedRemoteOps,
  newLocalWinOps,
  remoteWinsOps,
  localMultiReconciliationOps,
  nonConflictingOps,
  resendOps = [],
  getTask,
}: {
  unappliedRemoteLosers: Operation[];
  compensatedRemoteOps: Operation[];
  newLocalWinOps: Operation[];
  remoteWinsOps: Operation[];
  localMultiReconciliationOps: Operation[];
  nonConflictingOps: Operation[];
  resendOps?: Operation[];
  getTask: (taskId: string) => Promise<unknown>;
}): Promise<{ batches: MixedSourceOperationBatch[]; precedingOps: Operation[] }> => {
  const foldedIds = new Set<string>();
  // A remote winner applied after the snapshot can overwrite a folded field,
  // so the overlay would no longer be this device's post-batch value. A
  // winning delta is folded before the snapshot and writes no plain field.
  const remoteWinnerTaskIds = new Set(
    remoteWinsOps
      .filter((op) => op.entityType === 'TASK' && !isSyncTimeSpentOp(op))
      .flatMap(getOpEntityIds),
  );
  const foldFieldOps = (op: Operation, fieldOps: Operation[]): Operation => {
    if (
      op.entityType !== 'TASK' ||
      !op.entityId ||
      !isLwwUpdatePayload(op.payload) ||
      op.payload.lwwUpdateMode !== 'replace' ||
      remoteWinnerTaskIds.has(op.entityId)
    ) {
      return op;
    }
    // The overlay changes only the snapshot's content, never its clock, and
    // the edits stay after it in the log. Merging their clocks would also
    // claim every earlier op of their author, including undeclared writes to
    // this task (a subtask's estimate, a tag delete), so the server would
    // accept a snapshot master's clock gets rejected and rebuilt from
    // post-batch state (review of #10398). With master's clock, the server
    // accepts it only where master's does, and there it now carries the
    // edits. An op that touches the task (declares or names it) but is not a
    // plain edit leaves the snapshot as on master, since the overlay would no
    // longer be the post-batch value; the time projection's folds are carried.
    const taskId = op.entityId;
    const overlay: Record<string, unknown> = {};
    let hasOverlay = false;
    for (const incoming of fieldOps) {
      if (!touchesTask(incoming, taskId) || foldedIds.has(incoming.id)) continue;
      const changes = plainTaskFields(incoming, taskId);
      if (!changes) return op;
      Object.assign(overlay, changes);
      hasOverlay = true;
    }
    if (!hasOverlay) return op;
    const actionPayload = { ...op.payload.actionPayload, ...overlay };
    return { ...op, payload: { ...op.payload, actionPayload } };
  };
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
  const [timeFoldedLocalWins, reconciliations] = await Promise.all([
    foldSnapshots(newLocalWinOps, [...nonConflictingOps, ...winningTimeOps]),
    foldSnapshots(localMultiReconciliationOps, nonConflictingOps),
  ]);
  const localWins = timeFoldedLocalWins.map((op) => foldFieldOps(op, nonConflictingOps));
  // Keep the incoming prefix intact: hoisting a delta alone can move it ahead
  // of an absolute time edit (losing the delta) or the task's CREATE.
  const isFolded = (op: Operation): boolean => foldedIds.has(op.id);
  const lastFoldedIndex = nonConflictingOps.reduce(
    (last, op, index) => (isFolded(op) ? index : last),
    -1,
  );
  // A winner beside a local win of its entity stays after it: it must
  // override the snapshot, here and on replay.
  const localWinKeys = new Set(
    newLocalWinOps.flatMap((op) =>
      getOpEntityIds(op).map((id) => `${op.entityType}:${id}`),
    ),
  );
  const { ordered, precedingOps, moved } = orderIncomingPrefix(
    nonConflictingOps,
    remoteWinsOps.filter(
      (op) =>
        !isFolded(op) &&
        !getOpEntityIds(op).some((id) => localWinKeys.has(`${op.entityType}:${id}`)),
    ),
    lastFoldedIndex + 1,
  );
  const batches: MixedSourceOperationBatch[] = [
    { ops: unappliedRemoteLosers, source: 'remote' },
    {
      ops: [...compensatedRemoteOps, ...ordered, ...winningTimeOps.filter(isFolded)],
      source: 'remote',
      options: { pendingApply: true },
    },
    { ops: localWins, source: 'local' },
    {
      ops: remoteWinsOps.filter((op) => !isFolded(op) && !moved.has(op)),
      source: 'remote',
      options: { pendingApply: true },
    },
    { ops: reconciliations, source: 'local' },
  ];
  // Re-sends must follow the whole incoming batch, so it all joins the prefix.
  const rest = resendOps.length > 0 ? nonConflictingOps.slice(precedingOps.length) : [];
  batches.push(
    { ops: rest, source: 'remote', options: { pendingApply: true } },
    { ops: resendOps, source: 'local' },
  );
  return {
    precedingOps: [...precedingOps, ...rest],
    batches: batches.filter((batch) => batch.ops.length > 0),
  };
};
