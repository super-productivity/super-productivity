import {
  ActionType,
  extractActionPayload,
  FULL_STATE_OP_TYPES,
  Operation,
  OpType,
} from '../core/operation.types';
import { isLwwUpdateActionType } from '../core/lww-update-action-types';
import { isSingletonEntityId } from '../core/entity-registry';
import { PersistentAction } from '../core/persistent-action.interface';
import { SyncLog } from '../../core/log';
import { getDbDateStr } from '../../util/get-db-date-str';

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
    typeof actionPayload['today'] !== 'string'
  ) {
    // Legacy operations did not store the logical day, timezone, or start-of-next-day
    // offset. The timestamp is the best available fallback, but it is interpreted in
    // the replaying device's local timezone and can still be off near midnight or for
    // dueWithTime values around a different original day-start offset.
    return {
      ...actionPayload,
      today: getDbDateStr(op.timestamp),
    };
  }
  return actionPayload;
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

  const replaySafeChanges = {
    ...taskChanges,
    doneOn:
      typeof taskChanges['doneOn'] === 'number' ? taskChanges['doneOn'] : op.timestamp,
    // Older done ops did not store the logical day, timezone, or start-of-next-day
    // offset. This timestamp fallback is replay-stable, but still uses the replaying
    // device's local calendar and can be off near custom day-start boundaries.
    dueDay:
      typeof taskChanges['dueDay'] === 'string'
        ? taskChanges['dueDay']
        : getDbDateStr(op.timestamp),
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

  // Handle full-state operations (SYNC_IMPORT, BACKUP_IMPORT, Repair) specially
  // These need their payload wrapped in appDataComplete for the loadAllData action
  const isFullStateOp = FULL_STATE_OP_TYPES.has(op.opType as OpType);
  let actionPayload: Record<string, unknown> = isFullStateOp
    ? extractFullStatePayload(op.payload)
    : (extractActionPayload(op.payload) as Record<string, unknown>);

  actionPayload = addLegacyPlanForTodayDate(actionType, actionPayload, op);
  actionPayload = addReplaySafeDoneFields(actionType, actionPayload, op);

  // Force `payload.id = op.entityId` for non-singleton LWW Update ops. The
  // op's `entityId` is the canonical identifier — producers also enforce
  // this when creating ops, but a malformed/older remote op (or any path
  // that ever drifts) could carry a payload.id that disagrees with
  // op.entityId, in which case the consumer reducer at
  // task-shared-meta-reducers/lww-update.meta-reducer.ts trusts payload.id
  // and would update the WRONG entity. Forcing here makes "entityId is
  // canonical" a hard invariant at the apply boundary regardless of
  // producer or wire shape. Singletons use `SINGLETON_ENTITY_ID` and have
  // no `id` field. Issue #7330.
  if (
    !isFullStateOp &&
    isLwwUpdateActionType(actionType) &&
    op.entityId &&
    !isSingletonEntityId(op.entityId) &&
    actionPayload &&
    typeof actionPayload === 'object' &&
    actionPayload['id'] !== op.entityId
  ) {
    // The hard rewrite is correct in direction (canonical entityId wins),
    // but it silently fixes a producer/wire bug. Surface it so we can
    // detect if the assumption ever breaks in production. Log only the
    // ids — never the payload content (op log is exportable). #7330.
    SyncLog.warn(`[convertOpToAction] payload.id mismatch — forcing to op.entityId`, {
      actionType,
      entityType: op.entityType,
      entityId: op.entityId,
      payloadId: actionPayload['id'],
    });
    actionPayload = { ...actionPayload, id: op.entityId };
  }

  // IMPORTANT: Spread actionPayload FIRST, then set type, to prevent entity properties
  // named 'type' (like SimpleCounter.type = 'ClickCounter') from overwriting the action type.
  return {
    ...actionPayload,
    type: actionType,
    meta: {
      isPersistent: true,
      entityType: op.entityType,
      entityId: op.entityId,
      entityIds: op.entityIds,
      opType: op.opType,
      isRemote: true, // Important to prevent re-logging during replay/sync
    },
  };
};
