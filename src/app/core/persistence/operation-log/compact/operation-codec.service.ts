import {
  Operation,
  OperationLogEntry,
  OpType,
  EntityType,
  ActionType,
} from '../../../../op-log/core/operation.types';
import { CompactOperation, CompactOperationLogEntry } from './compact-operation.types';
import { encodeActionType, decodeActionType } from './action-type-codes';

/**
 * Encodes an Operation to CompactOperation format.
 * Uses short keys and action type codes to minimize size.
 */
export const encodeOperation = (op: Operation): CompactOperation => {
  const compact: CompactOperation = {
    id: op.id, // Keep 'id' for IndexedDB index compatibility
    a: encodeActionType(op.actionType),
    o: op.opType,
    e: op.entityType,
    p: op.payload,
    c: op.clientId,
    v: op.vectorClock,
    t: op.timestamp,
    s: op.schemaVersion,
  };

  if (op.entityId !== undefined) {
    compact.d = op.entityId;
  }
  if (op.entityIds !== undefined) {
    compact.ds = op.entityIds;
  }

  return compact;
};

/**
 * Decodes a CompactOperation back to Operation format.
 */
export const decodeOperation = (compact: CompactOperation): Operation => {
  const op: Operation = {
    id: compact.id,
    // Type assertion: We trust the data was encoded with a valid ActionType.
    // Unknown action types from future versions are handled by decodeActionType's fallback.
    actionType: decodeActionType(compact.a) as ActionType,
    opType: compact.o as OpType,
    entityType: compact.e as EntityType,
    payload: compact.p,
    clientId: compact.c,
    vectorClock: compact.v,
    timestamp: compact.t,
    schemaVersion: compact.s,
  };

  if (compact.d !== undefined) {
    op.entityId = compact.d;
  }
  if (compact.ds !== undefined) {
    op.entityIds = compact.ds;
  }

  return op;
};

/**
 * Encodes an OperationLogEntry to CompactOperationLogEntry format.
 */
export const encodeOperationLogEntry = (
  entry: OperationLogEntry,
): CompactOperationLogEntry => {
  const compact: CompactOperationLogEntry = {
    seq: entry.seq,
    op: encodeOperation(entry.op),
    appliedAt: entry.appliedAt,
    source: entry.source,
  };

  if (entry.syncedAt !== undefined) {
    compact.syncedAt = entry.syncedAt;
  }
  if (entry.rejectedAt !== undefined) {
    compact.rejectedAt = entry.rejectedAt;
  }
  if (entry.applicationStatus !== undefined) {
    compact.applicationStatus = entry.applicationStatus;
  }
  if (entry.retryCount !== undefined) {
    compact.retryCount = entry.retryCount;
  }

  return compact;
};

/**
 * Decodes a CompactOperationLogEntry back to OperationLogEntry format.
 */
export const decodeOperationLogEntry = (
  compact: CompactOperationLogEntry,
): OperationLogEntry => {
  const entry: OperationLogEntry = {
    seq: compact.seq,
    op: decodeOperation(compact.op),
    appliedAt: compact.appliedAt,
    source: compact.source,
  };

  if (compact.syncedAt !== undefined) {
    entry.syncedAt = compact.syncedAt;
  }
  if (compact.rejectedAt !== undefined) {
    entry.rejectedAt = compact.rejectedAt;
  }
  if (compact.applicationStatus !== undefined) {
    entry.applicationStatus = compact.applicationStatus;
  }
  if (compact.retryCount !== undefined) {
    entry.retryCount = compact.retryCount;
  }

  return entry;
};

/**
 * Type guard to check if an operation is in compact format.
 * Distinguishes from full Operation by checking for compact-specific keys.
 */
export const isCompactOperation = (op: unknown): op is CompactOperation => {
  return (
    typeof op === 'object' &&
    op !== null &&
    'a' in op && // 'a' is compact actionType (full format uses 'actionType')
    'o' in op && // 'o' is compact opType
    'e' in op && // 'e' is compact entityType
    !('actionType' in op) // Ensure it's not a full Operation
  );
};

/**
 * Type guard to check if a log entry is in compact format.
 */
export const isCompactOperationLogEntry = (
  entry: unknown,
): entry is CompactOperationLogEntry => {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    'op' in entry &&
    isCompactOperation((entry as CompactOperationLogEntry).op)
  );
};
