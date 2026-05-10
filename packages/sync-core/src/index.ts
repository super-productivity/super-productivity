// Operation log primitives — the generic, app-agnostic core of the sync engine.
export {
  OpType,
  FULL_STATE_OP_TYPES,
  isFullStateOpType,
  isMultiEntityPayload,
  extractActionPayload,
} from './operation.types';
export type {
  VectorClock,
  Operation,
  OperationLogEntry,
  EntityConflict,
  ConflictResult,
  EntityChange,
  MultiEntityPayload,
} from './operation.types';

// LWW (Last-Writer-Wins) update action-type helpers — factory parameterized by
// the host application's entity-type list, so the lib stays domain-agnostic.
export { createLwwUpdateActionTypeHelpers } from './lww-update-action-types';
export type { LwwUpdateActionTypeHelpers } from './lww-update-action-types';

// Apply-operation result and option types.
export type { ApplyOperationsResult, ApplyOperationsOptions } from './apply.types';

// Entity key encoding helpers.
export { toEntityKey, parseEntityKey } from './entity-key.util';

// Sync state corruption error.
export { SyncStateCorruptedError } from './sync-state-corrupted.error';
