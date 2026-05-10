// Re-exported from @sp/sync-core. Source of truth lives in packages/sync-core/src/operation.types.ts.
export {
  OpType,
  ENTITY_TYPES,
  FULL_STATE_OP_TYPES,
  isFullStateOpType,
  isWrappedFullStatePayload,
  extractFullStateFromPayload,
  assertValidFullStatePayload,
  isMultiEntityPayload,
  extractActionPayload,
  ActionType,
} from '@sp/sync-core';
export type {
  VectorClock,
  EntityType,
  SyncImportReason,
  Operation,
  OperationLogEntry,
  EntityConflict,
  ConflictResult,
  RepairSummary,
  RepairPayload,
  WrappedFullStatePayload,
  EntityChange,
  MultiEntityPayload,
} from '@sp/sync-core';
