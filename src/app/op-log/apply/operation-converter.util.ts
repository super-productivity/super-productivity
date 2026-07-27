import {
  ActionType,
  extractActionPayload,
  FULL_STATE_OP_TYPES,
  isLwwUpdatePayload,
  Operation,
  OpType,
} from '../core/operation.types';
import { getLwwEntityType } from '../core/lww-update-action-types';
import { getEntityConfig, isLwwPayloadIdCanonical } from '../core/entity-registry';
import { PersistentAction } from '../core/persistent-action.interface';
import { SyncLog } from '../../core/log';
import { isValidDBDateStr } from '../../util/get-db-date-str';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getValueType = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
};

const isValidDbDate = (value: unknown): value is string =>
  typeof value === 'string' && isValidDBDateStr(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Legacy operations did not capture the originating logical day or timezone.
 * UTC cannot recover that lost context, but it gives every replaying client the
 * same deterministic best-effort fallback.
 */
const getDeterministicLegacyTimestamp = (timestamp: number): number =>
  Number.isFinite(timestamp) ? timestamp : 0;

const getDeterministicLegacyDay = (timestamp: number): string =>
  new Date(getDeterministicLegacyTimestamp(timestamp)).toISOString().slice(0, 10);

/**
 * Maps old/renamed action types to their current names.
 * When an action is renamed, add an entry here to ensure old operations
 * in the log can still be replayed correctly.
 *
 * Format: { 'old action type': 'current action type' }
 *
 * IMPORTANT: Never remove entries from this map - old operations may still
 * reference the old action type.
 */
export const ACTION_TYPE_ALIASES: Record<string, string> = {
  // Example: '[Task] Update Task': '[Task] Update',
};

/**
 * Extracts the action payload for full-state operations (SYNC_IMPORT, BACKUP_IMPORT, Repair).
 * These operations contain the complete application state and need to be wrapped in
 * `appDataComplete` to match what the loadAllData action expects.
 *
 * Handles both:
 * - New format: payload is { appDataComplete: {...} }
 * - Legacy format: payload IS the appDataComplete directly
 */
const extractFullStatePayload = (payload: unknown): Record<string, unknown> => {
  // Check if payload already has appDataComplete wrapper
  if (typeof payload === 'object' && payload !== null && 'appDataComplete' in payload) {
    // Already wrapped - return as-is
    return payload as Record<string, unknown>;
  }
  // Legacy format: payload is the appDataComplete directly, wrap it
  return { appDataComplete: payload };
};

const addLegacyPlanForTodayDate = (
  actionType: string,
  actionPayload: Record<string, unknown>,
  op: Operation,
): Record<string, unknown> => {
  if (
    actionType === ActionType.TASK_SHARED_PLAN_FOR_TODAY &&
    !isValidDbDate(actionPayload['today'])
  ) {
    return {
      ...actionPayload,
      today: getDeterministicLegacyDay(op.timestamp),
    };
  }
  return actionPayload;
};

const addLegacyConvertToMainTaskDates = (
  actionType: string,
  actionPayload: Record<string, unknown>,
  op: Operation,
): Record<string, unknown> => {
  if (actionType !== ActionType.TASK_SHARED_CONVERT_TO_MAIN) {
    return actionPayload;
  }

  return {
    ...actionPayload,
    today: isValidDbDate(actionPayload['today'])
      ? actionPayload['today']
      : getDeterministicLegacyDay(op.timestamp),
    modified: isFiniteNumber(actionPayload['modified'])
      ? actionPayload['modified']
      : getDeterministicLegacyTimestamp(op.timestamp),
    ...(actionPayload['isDone'] === true
      ? {
          doneOn: isFiniteNumber(actionPayload['doneOn'])
            ? actionPayload['doneOn']
            : getDeterministicLegacyTimestamp(op.timestamp),
        }
      : {}),
  };
};

const addLegacyUnscheduleDate = (
  actionType: string,
  actionPayload: Record<string, unknown>,
  op: Operation,
): Record<string, unknown> => {
  if (
    actionType !== ActionType.TASK_SHARED_UNSCHEDULE ||
    actionPayload['isLeaveInToday'] !== true ||
    isValidDbDate(actionPayload['today'])
  ) {
    return actionPayload;
  }

  return {
    ...actionPayload,
    today: getDeterministicLegacyDay(op.timestamp),
  };
};

const addReplaySafeDoneFields = (
  actionType: string,
  actionPayload: Record<string, unknown>,
  op: Operation,
): Record<string, unknown> => {
  if (actionType !== ActionType.TASK_SHARED_UPDATE) {
    return actionPayload;
  }

  const task = actionPayload['task'];
  if (typeof task !== 'object' || task === null) {
    return actionPayload;
  }

  const taskUpdate = task as Record<string, unknown>;
  const changes = taskUpdate['changes'];
  if (typeof changes !== 'object' || changes === null) {
    return actionPayload;
  }

  const taskChanges = changes as Record<string, unknown>;
  if (taskChanges['isDone'] !== true) {
    return actionPayload;
  }

  const hasDoneOn = isFiniteNumber(taskChanges['doneOn']);

  const replaySafeChanges = {
    ...taskChanges,
    // Back-fill `doneOn` for older done ops that didn't store it. We never inject a
    // `dueDay`: completion records only the completion timestamp and must not
    // synthesize a schedule, so local apply and replay both yield no `dueDay` for
    // an unscheduled completion (replay determinism). Any `dueDay` the op already
    // carries (an explicit schedule) is preserved via the spread above.
    doneOn: hasDoneOn
      ? taskChanges['doneOn']
      : getDeterministicLegacyTimestamp(op.timestamp),
  };

  return {
    ...actionPayload,
    task: {
      ...taskUpdate,
      changes: replaySafeChanges,
    },
  };
};

/**
 * `[Task Shared] convertToMainTask` carries `parentTagIds?: string[]`.
 * A SuperSync fresh-client replay crashed at `task-shared-crud.reducer.ts`
 * with `TypeError: r is not iterable` because a captured op's
 * `parentTagIds` was truthy but not an array — bypassing the reducer's
 * `parentTagIds ?? parentTask.tagIds` fallback and crashing the spread.
 *
 * The producing code path is unknown (current dispatch sites all pass an
 * array or omit the field); strip the field on the read boundary so a
 * single bad op cannot poison the bulk-replay loop, and warn with the op
 * id/clientId so we can chase the producer next time it appears.
 */
const stripMalformedConvertToMainTaskParentTagIds = (
  actionType: string,
  actionPayload: Record<string, unknown>,
  op: Operation,
): Record<string, unknown> => {
  if (actionType !== ActionType.TASK_SHARED_CONVERT_TO_MAIN) return actionPayload;
  const ptt = actionPayload['parentTagIds'];
  if (ptt === undefined || Array.isArray(ptt)) return actionPayload;
  SyncLog.warn(
    `[convertOpToAction] convertToMainTask: parentTagIds is not an array — stripping so the reducer falls back to parent.tagIds`,
    {
      opId: op.id,
      clientId: op.clientId,
      vectorClock: op.vectorClock,
      parentTagIdsType: ptt === null ? 'null' : typeof ptt,
    },
  );
  const rest = { ...actionPayload };
  delete rest['parentTagIds'];
  return rest;
};

/**
 * Task-time deltas are additive and therefore must be rejected rather than
 * coerced when their identity or arithmetic fields are malformed. Otherwise an
 * operation indexed for one task could mutate another, or a negative/invalid
 * duration could silently corrupt replayed totals.
 */
const assertValidTaskTimeSyncPayload = (
  actionType: string,
  actionPayload: Record<string, unknown>,
  op: Operation,
): void => {
  if (actionType !== ActionType.TIME_TRACKING_SYNC_TIME_SPENT) {
    return;
  }

  const taskId = actionPayload['taskId'];
  const date = actionPayload['date'];
  const duration = actionPayload['duration'];
  if (
    typeof taskId !== 'string' ||
    taskId.length === 0 ||
    taskId !== op.entityId ||
    typeof date !== 'string' ||
    !isValidDBDateStr(date) ||
    typeof duration !== 'number' ||
    !Number.isFinite(duration) ||
    duration < 0
  ) {
    throw new Error(
      `[convertOpToAction] Invalid task-time sync payload for operation ${op.id}`,
    );
  }
};

/**
 * Converts an Operation from the operation log back into a PersistentAction.
 * Used during sync replay and recovery to re-dispatch operations.
 *
 * For multi-entity operations, this extracts the actionPayload and uses that
 * to reconstruct the original action. The meta-reducers will then apply all
 * the entity changes atomically.
 *
 * For full-state operations (SYNC_IMPORT, BACKUP_IMPORT, Repair), this wraps
 * the payload in `appDataComplete` to match the loadAllData action format.
 */
export const convertOpToAction = (op: Operation): PersistentAction => {
  // Resolve any aliased action types to their current names
  const actionType = ACTION_TYPE_ALIASES[op.actionType] ?? op.actionType;
  const lwwEntityType = getLwwEntityType(actionType);

  // Handle full-state operations (SYNC_IMPORT, BACKUP_IMPORT, Repair) specially
  // These need their payload wrapped in appDataComplete for the loadAllData action
  const isFullStateOp = FULL_STATE_OP_TYPES.has(op.opType as OpType);
  const isSingletonLww =
    !isFullStateOp &&
    lwwEntityType !== undefined &&
    getEntityConfig(lwwEntityType)?.storagePattern === 'singleton';
  const replayActionType = isFullStateOp ? ActionType.LOAD_ALL_DATA : actionType;
  let actionPayload: Record<string, unknown> = isFullStateOp
    ? extractFullStatePayload(op.payload)
    : (extractActionPayload(op.payload) as Record<string, unknown>);

  // JSON primitives and arrays are object-spreadable at runtime: a non-record
  // singleton payload such as "x" or ["x"] would spread into { 0: "x" }, which
  // the LWW reducer mistakes for non-empty singleton state and uses to replace
  // the entire feature slice. Normalize it to the reducer's empty-data no-op.
  if (isSingletonLww && !isRecord(actionPayload)) {
    SyncLog.warn('[convertOpToAction] malformed singleton LWW payload — ignoring', {
      opId: op.id,
      actionType,
      entityType: lwwEntityType,
      payloadType: getValueType(actionPayload),
    });
    actionPayload = {};
  }

  actionPayload = addLegacyPlanForTodayDate(actionType, actionPayload, op);
  actionPayload = addLegacyConvertToMainTaskDates(actionType, actionPayload, op);
  actionPayload = addLegacyUnscheduleDate(actionType, actionPayload, op);
  actionPayload = addReplaySafeDoneFields(actionType, actionPayload, op);
  actionPayload = stripMalformedConvertToMainTaskParentTagIds(
    actionType,
    actionPayload,
    op,
  );
  assertValidTaskTimeSyncPayload(actionType, actionPayload, op);

  // Affected #7330 clients injected conflict keys as `id` into singleton LWW
  // payloads. Singleton models have no top-level id, so remove it based on the
  // action-derived reducer target rather than comparing against unauthenticated
  // envelope metadata. This also cleans stale ids already carried in state.
  if (isSingletonLww && Object.hasOwn(actionPayload, 'id')) {
    actionPayload = { ...actionPayload };
    delete actionPayload['id'];
  }

  // Force `payload.id = op.entityId` for adapter-backed LWW Update ops. The
  // op's `entityId` is the canonical identifier for adapters — producers also
  // enforce this when creating ops, but a malformed/older remote op (or any
  // path that ever drifts) could carry a payload.id that disagrees with
  // op.entityId, in which case the consumer reducer at
  // task-shared-meta-reducers/lww-update.meta-reducer.ts trusts payload.id and
  // would update the WRONG entity. Singleton LWW actions target their feature
  // state as a whole; their conflict-routing entityId may be composite and must
  // not be injected into that state. Issues #7330, #9256.
  if (
    !isFullStateOp &&
    isLwwPayloadIdCanonical(lwwEntityType) &&
    op.entityId &&
    isRecord(actionPayload) &&
    actionPayload['id'] !== op.entityId
  ) {
    const payloadId = actionPayload['id'];
    // The hard rewrite is correct in direction (canonical entityId wins),
    // but it silently fixes a producer/wire bug. Surface it so we can
    // detect if the assumption ever breaks in production. Log only the
    // ids — never the payload content (op log is exportable). #7330.
    SyncLog.warn(`[convertOpToAction] payload.id mismatch — forcing to op.entityId`, {
      actionType,
      entityType: op.entityType,
      entityId: op.entityId,
      payloadId:
        typeof payloadId === 'string' ? payloadId : `<${getValueType(payloadId)}>`,
    });
    actionPayload = { ...actionPayload, id: op.entityId };
  }

  // IMPORTANT: Spread actionPayload FIRST, then set type, to prevent entity properties
  // named 'type' (like SimpleCounter.type = 'ClickCounter') from overwriting the action type.
  const lwwPayload = isLwwUpdatePayload(op.payload) ? op.payload : undefined;
  return {
    ...actionPayload,
    type: replayActionType,
    meta: {
      isPersistent: true,
      entityType: op.entityType,
      entityId: op.entityId,
      // Plaintext, UNAUTHENTICATED envelope footprint. Never trust it for an
      // LWW-TASK relocation / task-set decision — use the authenticated
      // meta.projectMoveFootprint instead. GHSA-8pxh-mgc7-gp3g. (Still surfaced
      // here for the non-relocation consumers that legitimately read it.)
      entityIds: op.entityIds,
      opType: op.opType,
      isRemote: true, // Important to prevent re-logging during replay/sync
      ...(lwwPayload ? { lwwUpdateMode: lwwPayload.lwwUpdateMode } : {}),
      ...(lwwPayload?.recreatesEntityAfterDelete === true
        ? { recreatesEntityAfterDelete: true }
        : {}),
      // Surface the AUTHENTICATED move footprint from the encrypted payload so
      // reducers can relocate task families without trusting the plaintext
      // op.entityIds envelope (which a compromised server can tamper with).
      // GHSA-8pxh-mgc7-gp3g. Absent on legacy/non-move ops → receiving-state repair.
      ...(lwwPayload?.projectMoveFootprint !== undefined
        ? { projectMoveFootprint: lwwPayload.projectMoveFootprint }
        : {}),
    },
  };
};
