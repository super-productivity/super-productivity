import {
  extractActionPayload,
  FULL_STATE_OP_TYPES,
  Operation,
  OpType,
} from '../core/operation.types';
import { PersistentAction } from '../core/persistent-action.interface';

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
  const actionPayload = isFullStateOp
    ? extractFullStatePayload(op.payload)
    : extractActionPayload(op.payload);

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
