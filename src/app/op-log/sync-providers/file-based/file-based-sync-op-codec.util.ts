import {
  ActionType,
  EntityType,
  Operation,
  OpType,
  SyncImportReason,
} from '../../core/operation.types';
import { CompactOperation } from '../../persistence/compact/compact-operation.types';
import {
  decodeOperation,
  encodeOperation,
} from '../../persistence/compact/operation-codec.service';
import { SyncOperation } from '../provider.interface';

/**
 * Converts a SyncOperation to CompactOperation format.
 */
export const syncOpToCompact = (op: SyncOperation): CompactOperation => {
  // Create a full Operation from SyncOperation, then encode.
  // Type assertions are needed because SyncOperation uses string types for
  // actionType/opType/entityType (for JSON serialization compatibility),
  // while Operation uses the specific enum/union types.
  const fullOp: Operation = {
    id: op.id,
    actionType: op.actionType as ActionType,
    opType: op.opType as OpType,
    entityType: op.entityType as EntityType,
    entityId: op.entityId,
    entityIds: op.entityIds,
    payload: op.payload,
    clientId: op.clientId,
    vectorClock: op.vectorClock,
    timestamp: op.timestamp,
    schemaVersion: op.schemaVersion,
    ...(op.syncImportReason
      ? { syncImportReason: op.syncImportReason as SyncImportReason }
      : {}),
    ...(op.repairBaseServerSeq !== undefined
      ? { repairBaseServerSeq: op.repairBaseServerSeq }
      : {}),
  };
  return encodeOperation(fullOp);
};

/**
 * Converts a CompactOperation to SyncOperation format.
 */
export const compactToSyncOp = (compact: CompactOperation): SyncOperation => {
  const fullOp = decodeOperation(compact);
  return {
    id: fullOp.id,
    clientId: fullOp.clientId,
    actionType: fullOp.actionType,
    opType: fullOp.opType,
    entityType: fullOp.entityType,
    entityId: fullOp.entityId,
    entityIds: fullOp.entityIds,
    payload: fullOp.payload,
    vectorClock: fullOp.vectorClock,
    timestamp: fullOp.timestamp,
    schemaVersion: fullOp.schemaVersion,
    ...(fullOp.syncImportReason ? { syncImportReason: fullOp.syncImportReason } : {}),
    ...(fullOp.repairBaseServerSeq !== undefined
      ? { repairBaseServerSeq: fullOp.repairBaseServerSeq }
      : {}),
  };
};
