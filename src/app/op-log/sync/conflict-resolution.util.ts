import { type LwwResolvedConflict } from '@sp/sync-core';
import { PROJECT_DELETE_WINS_SCHEMA_VERSION } from '@sp/shared-schema';
import {
  ActionType,
  EntityConflict,
  EntityType,
  extractActionPayload,
  Operation,
  isLwwUpdatePayload,
  isMultiEntityPayload,
  OpType,
} from '../core/operation.types';
import { toLwwUpdateActionType } from '../core/lww-update-action-types';
import { PROJECT_DELETE_WINS_MARKER } from '../../root-store/meta/task-shared.actions';
import { toEntityKey } from '../util/entity-key.util';
import { getOpEntityIds } from '../util/get-op-entity-ids.util';
import { SCOPED_PLAN_MULTI_ACTIONS } from './preserve-partial-bulk-plan.util';

/**
 * Represents the result of LWW (Last-Write-Wins) conflict resolution.
 */
export type LWWResolution = LwwResolvedConflict<Operation, EntityConflict>;

/**
 * One entity's conflicts resolved per field (#10422): the remote ops apply as
 * themselves, and `mergedOps` re-send the local fields that won, each at its
 * own write's timestamp. They are applied locally AND uploaded; the original
 * local ops are rejected (superseded).
 */
export interface MergedResolution {
  conflict: EntityConflict;
  mergedOps: Operation[];
  /** The planner's side-level winner, for the content banner only. */
  winner: 'local' | 'remote';
}

export const taskRelationshipPatch = (
  taskId: string,
  taskState: Record<string, unknown>,
): Record<string, unknown> => ({
  id: taskId,
  projectId: taskState['projectId'],
  parentId: taskState['parentId'],
  subTaskIds: taskState['subTaskIds'],
});

/** Result of `_resolveConflictsWithLWW`: LWW winners plus disjoint merges. */
export interface ResolvedConflicts {
  lwwResolutions: LWWResolution[];
  mergedResolutions: MergedResolution[];
  localMultiReconciliationOps: Operation[];
}
const isProjectDeleteWinsOperation = (operation: Operation): boolean => {
  // `!(x >= n)` (not `x < n`) so a malformed op with an undefined schemaVersion
  // is treated as pre-v4 rather than slipping through. The `!operation.payload`
  // guard prevents a null/undefined-payload DEL op (the server permits one) from
  // throwing inside `extractActionPayload` and wedging the whole conflict pass.
  if (
    !(operation.schemaVersion >= PROJECT_DELETE_WINS_SCHEMA_VERSION) ||
    operation.actionType !== ActionType.TASK_SHARED_DELETE_PROJECT ||
    operation.opType !== OpType.Delete ||
    !operation.payload
  ) {
    return false;
  }
  const actionPayload = extractActionPayload(operation.payload);
  // Gate on the AUTHENTICATED `projectId` (inside the E2EE GCM auth tag), and
  // require it to match the plaintext `entityId` used to group the conflict.
  // A tampered/replayed marked delete retargeted onto a live entity therefore
  // fails to win delete-wins, so it cannot silently drop the victim's concurrent
  // edit — it falls back to timestamp LWW. (GHSA-8pxh metadata-tampering class.)
  return (
    actionPayload[PROJECT_DELETE_WINS_MARKER] === true &&
    operation.entityId === actionPayload['projectId']
  );
};

/**
 * Concurrent tabs can capture more than one marked `deleteProject` for the same
 * project before syncing, and the local store has applied EVERY one's cascade
 * (the task reducer removes entities by explicit `allTaskIds`, not by
 * `projectId`). The single winning replacement must therefore carry the UNION of
 * all their cascaded `allTaskIds`/`noteIds`, or a client that only receives that
 * replacement keeps entities a later local delete already removed. Only the id
 * arrays are widened — `projectId` and every other field are identical across
 * same-project deletes, so the first op is a safe base.
 */
export const mergeMarkedProjectDeleteOps = (
  localOps: Operation[],
): Operation | undefined => {
  const deletes = localOps.filter(isProjectDeleteWinsOperation);
  if (deletes.length <= 1) {
    return deletes[0];
  }
  const unionIds = (key: string): string[] => {
    const merged = new Set<string>();
    for (const op of deletes) {
      const value = extractActionPayload(op.payload)[key];
      if (Array.isArray(value)) {
        value.forEach((id) => merged.add(id as string));
      }
    }
    return [...merged];
  };
  const base = deletes[0];
  const mergedActionPayload: Record<string, unknown> = {
    ...extractActionPayload(base.payload),
    allTaskIds: unionIds('allTaskIds'),
    noteIds: unionIds('noteIds'),
  };
  const mergedPayload = isMultiEntityPayload(base.payload)
    ? { ...base.payload, actionPayload: mergedActionPayload }
    : mergedActionPayload;
  return { ...base, payload: mergedPayload };
};

const getTaskProjectMoveEntityIds = (operation: Operation): string[] | undefined => {
  // Reuse a prior synthetic LWW op's footprint ONLY from the AUTHENTICATED
  // payload (projectMoveFootprint), never the plaintext op.entityIds envelope.
  // A compromised server can tamper a remote op's envelope; reading it here
  // would launder those ids into a freshly-authenticated merged op that every
  // client then trusts — the same GHSA-8pxh-mgc7-gp3g vector, one merge removed.
  // Legacy LWW ops carry no authenticated footprint → no reusable set (the
  // merged op then falls back to receiving-state repair, mirroring the reducers).
  if (operation.actionType === toLwwUpdateActionType('TASK') && operation.entityId) {
    const footprint = isLwwUpdatePayload(operation.payload)
      ? operation.payload.projectMoveFootprint
      : undefined;
    if (!Array.isArray(footprint)) return undefined;
    return Array.from(
      new Set([
        operation.entityId,
        ...footprint.filter((id): id is string => typeof id === 'string'),
      ]),
    );
  }

  if (
    operation.actionType !== ActionType.TASK_SHARED_UPDATE ||
    !operation.entityId ||
    !operation.payload ||
    typeof operation.payload !== 'object'
  ) {
    return undefined;
  }

  const payload = operation.payload as Record<string, unknown>;
  const actionPayload =
    payload['actionPayload'] && typeof payload['actionPayload'] === 'object'
      ? (payload['actionPayload'] as Record<string, unknown>)
      : payload;
  const subTaskIds = actionPayload['projectMoveSubTaskIds'];
  if (!Array.isArray(subTaskIds)) return undefined;

  // SECURITY: the footprint ROOT must come from the AUTHENTICATED payload
  // (actionPayload.task.id), NOT the plaintext op.entityId envelope. Unlike LWW
  // ops — whose entityId is bound to payload.id by assertDecryptedOpMetadataIntegrity
  // — a raw TASK_SHARED_UPDATE op's entityId is unauthenticated, so reading it here
  // would let a compromised server launder a victim id into the authenticated
  // projectMoveFootprint of the synthesized merged op. GHSA-8pxh-mgc7-gp3g.
  const task = actionPayload['task'];
  const rootId =
    task && typeof task === 'object'
      ? (task as Record<string, unknown>)['id']
      : undefined;
  if (typeof rootId !== 'string') return undefined;

  return Array.from(
    new Set([rootId, ...subTaskIds.filter((id): id is string => typeof id === 'string')]),
  );
};

export const getLatestTaskProjectMoveEntityIds = (
  operations: Operation[],
): string[] | undefined => {
  let latest: { operation: Operation; entityIds: string[] } | undefined;
  for (const operation of operations) {
    const entityIds = getTaskProjectMoveEntityIds(operation);
    if (!entityIds) continue;
    if (
      !latest ||
      operation.timestamp > latest.operation.timestamp ||
      (operation.timestamp === latest.operation.timestamp &&
        operation.id > latest.operation.id)
    ) {
      latest = { operation, entityIds };
    }
  }

  return latest?.entityIds;
};

export const latestProjectMoveEntityIds = (
  entityId: string,
  operations: Operation[],
): string[] | undefined => {
  const projectMoveEntityIds = getLatestTaskProjectMoveEntityIds(operations);
  if (!projectMoveEntityIds) return undefined;

  return Array.from(new Set([entityId, ...projectMoveEntityIds]));
};

export const markLwwDeleteRecreation = (op: Operation): Operation =>
  isLwwUpdatePayload(op.payload)
    ? {
        ...op,
        payload: {
          ...op.payload,
          recreatesEntityAfterDelete: true,
        },
      }
    : op;

// The only legacy bulk operation whose captured per-task deltas are known to be
// independently replayable. Do not generalize this from payload shape alone:
// other multi-entity UPDATE actions encode relationship/list invariants that
// must stay atomic.
export const DECOMPOSABLE_MULTI_ACTION_FIELDS = new Map<ActionType, ReadonlySet<string>>([
  [ActionType.TASK_ROUND_TIME_SPENT, new Set(['timeSpent', 'timeSpentOnDay'])],
]);

export const isRoundTimePayloadValidForStaticFields = (op: Operation): boolean => {
  if (op.actionType !== ActionType.TASK_ROUND_TIME_SPENT) {
    return false;
  }
  const actionPayload = extractActionPayload(op.payload);
  // The gate runs on remote (attacker-influenceable) input and the download
  // path never re-validates payload shape — stay total instead of throwing a
  // raw TypeError out of the preflight on a null/missing actionPayload.
  if (typeof actionPayload !== 'object' || actionPayload === null) {
    return false;
  }
  const taskIds = actionPayload['taskIds'];
  if (
    !Array.isArray(taskIds) ||
    taskIds.some((id) => typeof id !== 'string') ||
    typeof actionPayload['day'] !== 'string' ||
    typeof actionPayload['isRoundUp'] !== 'boolean'
  ) {
    return false;
  }

  const roundTo = actionPayload['roundTo'];
  const isKnownRoundOption =
    roundTo === undefined ||
    roundTo === null ||
    roundTo === '5M' ||
    roundTo === 'QUARTER' ||
    roundTo === 'HALF' ||
    roundTo === 'HOUR' ||
    // Older payloads represented the interval numerically.
    typeof roundTo === 'number';
  if (!isKnownRoundOption) {
    return false;
  }

  const declaredIds = new Set(taskIds as string[]);
  const operationIds = getOpEntityIds(op);
  return (
    declaredIds.size === operationIds.length &&
    operationIds.every((id) => declaredIds.has(id))
  );
};

/**
 * Mirror of the rounding reducer's write filter (`roundTimeSpentForDay` in
 * task.reducer.ts): the op declares every task id of the day, but the reducer
 * skips parents-with-subtasks and — when the payload carries a project limit
 * (a string id or the explicit `null` no-project bucket) — tasks of other
 * projects. Used to spot conflict targets the replay cannot write on this
 * client. Keep in sync with the reducer's filter.
 */
export const doesRoundTimeOpWriteTask = (
  op: Operation,
  task: Record<string, unknown>,
): boolean => {
  const actionPayload = extractActionPayload(op.payload);
  const projectId = actionPayload['projectId'];
  const isLimitToProject = !!projectId || projectId === null;
  const subTaskIds = task['subTaskIds'];
  const isDirectlyRoundable =
    (Array.isArray(subTaskIds) ? subTaskIds.length === 0 : true) || !!task['parentId'];
  return isDirectlyRoundable && (!isLimitToProject || task['projectId'] === projectId);
};

export const INDEPENDENT_MULTI_DELETE_ACTIONS = new Set<ActionType>([
  ActionType.TASK_SHARED_DELETE_MULTIPLE,
  ActionType.TAG_DELETE_MULTIPLE,
  ActionType.REPEAT_CFG_DELETE_MULTIPLE,
  ActionType.COUNTER_DELETE_MULTIPLE,
]);

/**
 * Today-list multi-entity UPDATE actions that conflict resolution handles
 * without splitting the atomic row (#9426, #9405 — the day-rollover
 * `planTasksForToday` op carries EVERY due task id, so one concurrent remote
 * edit of any of them used to stop sync entirely):
 *
 * - SCOPED_PLAN rows (see `preserve-partial-bulk-plan.util.ts`) are rejected
 *   as a unit and replaced by ONE copy narrowed to the surviving task ids,
 *   mirroring `_preservePartiallyRejectedLocalBulkDeletes`.
 * - ORDERING_ONLY rows touch no task entity fields — Today MEMBERSHIP is
 *   derived from `task.dueDay`/`dueWithTime` (ADR #2). Their reducers can
 *   reorder `TODAY_TAG.taskIds` and persisted `TaskState.ids`, so rejecting
 *   such a row loses ordering only: cosmetic, self-healing, no replacement
 *   needed. Pinned by the entity-field-free and ordering specs in
 *   `task-shared-scheduling.reducer.spec.ts` and `task.reducer.spec.ts`.
 *
 * Remote rows of these types replay as ordinary atomic actions (the reducers
 * skip unknown task ids); local winners are restored by mixed-winner
 * compensation snapshots applied after the remote row. A remote
 * `planTasksForToday` also removes every target from `planner.days`, so each
 * local-winning target whose snapshot still matches its surviving placement
 * receives an established `Transfer Task` follow-up that restores that exact
 * placement on live apply and replay
 * (`_createMixedRemoteTodayPlannerCompensationOps`).
 */
const ORDERING_ONLY_MULTI_ACTIONS = new Set<ActionType>([
  ActionType.TASK_SHARED_MOVE_IN_TODAY,
  ActionType.TASK_SHARED_REMOVE_FROM_TODAY,
]);
/** NOTE: classifies by action type alone — callers gate on multi-entity-ness. */
export const LWW_PLANNING_OPTIONS = {
  isArchiveAction: (op: Operation): boolean =>
    op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
  isDeleteWinsAction: isProjectDeleteWinsOperation,
  toEntityKey: (entityType: string, entityId: string): string =>
    toEntityKey(entityType as EntityType, entityId),
};

export const isResolvableTodayListAction = (actionType: ActionType): boolean =>
  SCOPED_PLAN_MULTI_ACTIONS.has(actionType) ||
  ORDERING_ONLY_MULTI_ACTIONS.has(actionType);
