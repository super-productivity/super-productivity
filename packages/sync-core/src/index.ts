// Action types enum (NgRx action type strings, immutable)
export { ActionType } from './action-types.enum';

// Operation types and full-state / multi-entity helpers
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
} from './operation.types';
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
} from './operation.types';

// LWW (Last-Writer-Wins) action type helpers
export {
  LWW_UPDATE_ACTION_TYPES,
  isLwwUpdateActionType,
  getLwwEntityType,
  toLwwUpdateActionType,
} from './lww-update-action-types';

// Apply-operation result and option types
export type { ApplyOperationsResult, ApplyOperationsOptions } from './apply.types';

// Entity key encoding helpers
export { toEntityKey, parseEntityKey } from './entity-key.util';

// Sync provider id, status, conflict reasons, file/private-cfg prefixes
export {
  SyncProviderId,
  OAUTH_SYNC_PROVIDERS,
  toSyncProviderId,
  SyncStatus,
  ConflictReason,
  REMOTE_FILE_CONTENT_PREFIX,
  PRIVATE_CFG_PREFIX,
} from './provider.const';

// Sync state corruption error
export { SyncStateCorruptedError } from './sync-state-corrupted.error';
