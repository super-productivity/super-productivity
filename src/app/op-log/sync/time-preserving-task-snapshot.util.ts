import { deepEqual, planLwwConflictResolutions } from '@sp/sync-core';
import { DEFAULT_TASK, TaskCopy } from '../../features/tasks/task.model';
import {
  ActionType,
  EntityConflict,
  Operation,
  OperationLogEntry,
  OpType,
  isFullStateOpType,
  isLwwUpdatePayload,
} from '../core/operation.types';
import { getOpEntityIds } from '../util/get-op-entity-ids.util';
import {
  SYNC_TIME_SPENT_FIELDS,
  writesNoTaskTime,
  mergeChangedFields,
  isCommutingTimeDeltaCrossing,
} from './conflict-disjoint-merge.util';
import { compareVectorClocks, VectorClockComparison } from '../../core/util/vector-clock';

type OptionalKeys<T> = {
  [K in keyof T]-?: Partial<Pick<T, K>> extends Pick<T, K> ? K : never;
}[keyof T];

/** Missing optional fields are clears in a whole non-time snapshot. */
const OPTIONAL_TASK_FIELDS = Object.keys({
  notes: true,
  updated: true,
  doneOn: true,
  parentId: true,
  remindAt: true,
  repeatCfgId: true,
  _hideSubTasksMode: true,
  issueId: true,
  issueProviderId: true,
  issueType: true,
  issueWasUpdated: true,
  issueLastUpdated: true,
  issueAttachmentNr: true,
  issueTimeTracked: true,
  issuePoints: true,
  issueLastSyncedValues: true,
  priority: true,
  dueWithTime: true,
  dueDay: true,
  hasPlannedTime: true,
  deadlineDay: true,
  deadlineWithTime: true,
  deadlineRemindAt: true,
  reminderId: true,
  modified: true,
} satisfies Record<OptionalKeys<TaskCopy>, true>);

/** Resolution rows are inspected by their keys only, never merged by value. */
export const isTimelessTaskPatch = (op: Operation, entityId: string): boolean => {
  const payload = op.payload;
  const ids = getOpEntityIds(op);
  return (
    op.entityType === 'TASK' &&
    op.opType === OpType.Update &&
    ids.length === 1 &&
    ids[0] === entityId &&
    isLwwUpdatePayload(payload) &&
    payload.lwwUpdateMode === 'patch' &&
    payload.recreatesEntityAfterDelete !== true &&
    !SYNC_TIME_SPENT_FIELDS.some(
      (field) =>
        field in payload.actionPayload ||
        (Array.isArray(payload.clearedFields) && payload.clearedFields.includes(field)),
    )
  );
};

/** Original deltas and proven timeless writes, including earlier source patches. */
export const isTimePreservingTaskConflict = (conflict: EntityConflict): boolean => {
  const ops = [...conflict.localOps, ...conflict.remoteOps];
  return (
    conflict.entityType === 'TASK' &&
    ops.some(
      (op) =>
        op.actionType === ActionType.TIME_TRACKING_SYNC_TIME_SPENT ||
        isTimelessTaskPatch(op, conflict.entityId),
    ) &&
    ops.every((op) => {
      const ids = getOpEntityIds(op);
      return (
        op.entityType === 'TASK' &&
        op.opType === OpType.Update &&
        ids.length === 1 &&
        ids[0] === conflict.entityId &&
        (op.actionType === ActionType.TIME_TRACKING_SYNC_TIME_SPENT ||
          writesNoTaskTime(op, 'task', conflict.entityId) ||
          isTimelessTaskPatch(op, conflict.entityId))
      );
    })
  );
};

/** Full non-time row: membership compensation needs the same durable order as replace. */
export const isTimePreservingTaskSnapshot = (op: Operation): boolean => {
  if (!isTimelessTaskPatch(op, op.entityId!) || !isLwwUpdatePayload(op.payload)) {
    return false;
  }
  const keys = new Set([
    ...Object.keys(op.payload.actionPayload),
    ...(Array.isArray(op.payload.clearedFields) ? op.payload.clearedFields : []),
  ]);
  return [...Object.keys(DEFAULT_TASK), 'projectId', ...OPTIONAL_TASK_FIELDS]
    .filter((key) => !SYNC_TIME_SPENT_FIELDS.includes(key))
    .every((key) => keys.has(key));
};

/** Snapshot rows eligible for the existing durable-order and own-row retry proofs. */
export const isTaskResolutionSnapshot = (op: Operation): boolean =>
  op.entityType === 'TASK' &&
  op.opType === OpType.Update &&
  getOpEntityIds(op).length === 1 &&
  isLwwUpdatePayload(op.payload) &&
  (op.payload.lwwUpdateMode === 'replace' || isTimePreservingTaskSnapshot(op));

/**
 * Change only the representation of this existing local winner. Its planner,
 * timestamp, clock and batch position stay unchanged. Original deltas travel
 * independently. v18.21.1 and earlier ignore the optional-field clears.
 */
export const preserveTaskSnapshotTime = (
  op: Operation,
  conflict: EntityConflict,
): Operation => {
  const payload = op.payload;
  if (
    !isTimePreservingTaskConflict(conflict) ||
    !isLwwUpdatePayload(payload) ||
    payload.lwwUpdateMode !== 'replace' ||
    payload.recreatesEntityAfterDelete === true
  ) {
    return op;
  }
  const actionPayload = { ...payload.actionPayload };
  for (const field of SYNC_TIME_SPENT_FIELDS) delete actionPayload[field];
  const clearedFields = OPTIONAL_TASK_FIELDS.filter(
    (field) => actionPayload[field] === undefined,
  );
  return {
    ...op,
    payload: { ...payload, actionPayload, lwwUpdateMode: 'patch', clearedFields },
  };
};

/** Eligibility is entity-wide; winner decisions remain per remote operation. */
export const timePreservingTaskIds = (
  conflicts: EntityConflict[],
  nonConflictingOps: Operation[] = [],
): Set<string> => {
  const eligible = new Set<string>();
  for (const conflict of conflicts) {
    if (conflict.entityType !== 'TASK' || eligible.has(conflict.entityId)) continue;
    const siblings = conflicts.filter(
      (other) => other.entityType === 'TASK' && other.entityId === conflict.entityId,
    );
    const combined = {
      ...conflict,
      localOps: siblings.flatMap((sibling) => sibling.localOps),
      remoteOps: [
        ...siblings.flatMap((sibling) => sibling.remoteOps),
        ...nonConflictingOps.filter((op) =>
          getOpEntityIds(op).includes(conflict.entityId),
        ),
      ],
    };
    if (isTimePreservingTaskConflict(combined)) eligible.add(conflict.entityId);
  }
  return eligible;
};

/** Transform only existing winners, without regrouping or moving resolutions. */
export const preserveTaskSnapshotTimes = <
  T extends { conflict: EntityConflict; localWinOp?: Operation },
>(
  resolutions: T[],
  nonConflictingOps: Operation[],
): T[] => {
  const eligible = timePreservingTaskIds(
    resolutions.map((resolution) => resolution.conflict),
    nonConflictingOps,
  );
  return resolutions.map((resolution) =>
    resolution.localWinOp && eligible.has(resolution.conflict.entityId)
      ? {
          ...resolution,
          localWinOp: preserveTaskSnapshotTime(
            resolution.localWinOp,
            resolution.conflict,
          ),
        }
      : resolution,
  );
};

/**
 * A rejected local replacement can cross a plain content edit only when
 * applying that edit to its unchanged body would write the same real values.
 * This reads the author's own replacement for a no-op proof; it neither merges
 * an incoming resolution row nor synthesizes new fields from one.
 */
export const isTaskSnapshotUnchangedByContent = (
  snapshot: Operation,
  other: Operation,
): boolean => {
  if (!isTaskResolutionSnapshot(snapshot) || !isLwwUpdatePayload(snapshot.payload))
    return false;
  if (other.entityType === 'TIME_TRACKING' && other.opType === OpType.Update) {
    return (
      other.actionType === ActionType.TIME_TRACKING_SYNC_SESSIONS ||
      isLwwUpdatePayload(other.payload)
    );
  }
  if (
    other.entityType !== 'TASK' ||
    other.opType !== OpType.Update ||
    other.actionType !== ActionType.TASK_SHARED_UPDATE ||
    getOpEntityIds(other).length !== 1 ||
    isLwwUpdatePayload(other.payload)
  )
    return false;
  const replacement = snapshot.payload.actionPayload;
  const otherId = getOpEntityIds(other)[0];
  const changes = mergeChangedFields([other], 'task', otherId);
  const fields = Object.keys(changes);
  return (
    fields.length > 0 &&
    fields.every(
      (field) =>
        field === 'modified' ||
        (['title', 'notes', 'priority'].includes(field) &&
          (otherId !== getOpEntityIds(snapshot)[0] ||
            deepEqual(replacement[field], changes[field]))),
    )
  );
};

/** The existing own-snapshot retry proof, over every retained operation. */
export const taskSnapshotGroupCommutes = (
  entries: OperationLogEntry[],
  tail: OperationLogEntry[],
  taskId: string,
): boolean => {
  const pendingIds = new Set(entries.map(({ op }) => op.id));
  return entries.every((entry) =>
    tail.every(
      ({ seq, op }) =>
        pendingIds.has(op.id) ||
        (seq <= entry.seq &&
          compareVectorClocks(entry.op.vectorClock, op.vectorClock) ===
            VectorClockComparison.GREATER_THAN) ||
        (isTaskResolutionSnapshot(entry.op)
          ? isTaskSnapshotUnchangedByContent(entry.op, op)
          : !isFullStateOpType(op.opType) &&
            (!getOpEntityIds(op).includes(taskId) ||
              isCommutingTimeDeltaCrossing({
                localOps: [entry.op],
                remoteOps: [op],
                payloadKey: 'task',
                entityId: taskId,
              }))),
    ),
  );
};

/**
 * A newer applied full non-time row already superseded this rejected own row.
 * Retiring it leaves durable replay unchanged and lets original deltas retry
 * alone. Only keys and the planner's winner are read from the incoming row.
 * The caller must still prove complete, commuting history before any write.
 */
export const supersededTaskSnapshotIds = (
  entries: OperationLogEntry[],
  rejected: { opId: string; op: Operation }[],
  clientId: string | null,
  appliedRow: (opId: string) => OperationLogEntry | undefined,
): Set<string> => {
  const ids = new Set<string>();
  for (const entry of entries) {
    const { op } = entry;
    const item = rejected.find(({ opId }) => opId === op.id);
    if (
      !item ||
      entry.source !== 'local' ||
      op.clientId !== clientId ||
      entry.syncedAt !== undefined ||
      entry.rejectedAt !== undefined ||
      !isTimePreservingTaskSnapshot(op) ||
      compareVectorClocks(op.vectorClock, item.op.vectorClock) !==
        VectorClockComparison.EQUAL
    )
      continue;
    const row = appliedRow(op.id);
    if (
      !row ||
      row.seq <= entry.seq ||
      !isTimePreservingTaskSnapshot(row.op) ||
      !isLwwUpdatePayload(op.payload) ||
      !isLwwUpdatePayload(row.op.payload)
    )
      continue;
    const [plan] = planLwwConflictResolutions(
      [
        {
          entityType: 'TASK',
          entityId: op.entityId!,
          suggestedResolution: 'manual',
          localOps: [op],
          remoteOps: [row.op],
        },
      ],
      { isArchiveAction: () => false },
    );
    const keys = new Set([
      ...Object.keys(row.op.payload.actionPayload),
      ...(Array.isArray(row.op.payload.clearedFields)
        ? row.op.payload.clearedFields
        : []),
    ]);
    if (
      plan.winner === 'remote' &&
      [
        ...Object.keys(op.payload.actionPayload),
        ...(Array.isArray(op.payload.clearedFields) ? op.payload.clearedFields : []),
      ].every((key) => keys.has(key))
    )
      ids.add(op.id);
  }
  return ids;
};
