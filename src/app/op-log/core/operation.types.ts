// Generic, framework-agnostic primitives come from @sp/sync-core.
// Super Productivity-specific types (entity-type union, app action-type enum,
// sync-import reasons, repair payloads, full-state wrapper) live alongside this
// file in the app.

import type {
  VectorClock,
  Operation as LibOperation,
  OperationLogEntry as LibOperationLogEntry,
  EntityChange as LibEntityChange,
  EntityConflict as LibEntityConflict,
  ConflictResult as LibConflictResult,
  MultiEntityPayload as LibMultiEntityPayload,
} from '@sp/sync-core';
import type { EntityType as SharedEntityType } from '@sp/shared-schema';
import { ENTITY_TYPES } from '@sp/shared-schema';
import {
  createFullStateOpTypeHelpers,
  isMultiEntityPayload as libIsMultiEntityPayload,
  OpType,
} from '@sp/sync-core';
import { ActionType } from './action-types.enum';

export { OpType, extractActionPayload } from '@sp/sync-core';
export type { VectorClock };
export { ENTITY_TYPES, ActionType };

const fullStateOpTypeHelpers = createFullStateOpTypeHelpers<OpType>([
  OpType.SyncImport,
  OpType.BackupImport,
  OpType.Repair,
]);

export const FULL_STATE_OP_TYPES = fullStateOpTypeHelpers.FULL_STATE_OP_TYPES;
export const isFullStateOpType = fullStateOpTypeHelpers.isFullStateOpType;

/**
 * Entity type — Super Productivity's domain set, sourced from `@sp/shared-schema`
 * so client and server agree on the union.
 */
export type EntityType = SharedEntityType;

/**
 * Reason for a full-state operation (SYNC_IMPORT, BACKUP_IMPORT, REPAIR).
 * Used in the conflict dialog to explain WHY the import happened.
 */
export type SyncImportReason =
  | 'PASSWORD_CHANGED'
  | 'FILE_IMPORT'
  | 'BACKUP_RESTORE'
  | 'FORCE_UPLOAD'
  | 'SERVER_MIGRATION'
  | 'REPAIR';

/**
 * Super Productivity's narrowed Operation type: tightens `actionType` and
 * `entityType` to the app's enums and adds the optional `syncImportReason`
 * field carried on full-state ops.
 */
export interface Operation extends Omit<LibOperation, 'actionType' | 'entityType'> {
  actionType: ActionType;
  entityType: EntityType;
  /**
   * Optional reason for full-state operations (SYNC_IMPORT, BACKUP_IMPORT, REPAIR).
   * Used in the conflict dialog to explain why the import was created.
   * Old operations without this field gracefully show a generic message.
   */
  syncImportReason?: SyncImportReason;
}

export interface OperationLogEntry extends Omit<LibOperationLogEntry, 'op'> {
  op: Operation;
}

export interface EntityChange extends Omit<LibEntityChange, 'entityType'> {
  entityType: EntityType;
}

export interface EntityConflict extends Omit<
  LibEntityConflict,
  'entityType' | 'localOps' | 'remoteOps'
> {
  entityType: EntityType;
  localOps: Operation[];
  remoteOps: Operation[];
}

export interface ConflictResult extends Omit<
  LibConflictResult,
  'nonConflicting' | 'conflicts'
> {
  nonConflicting: Operation[];
  conflicts: EntityConflict[];
}

export interface MultiEntityPayload extends Omit<LibMultiEntityPayload, 'entityChanges'> {
  entityChanges: EntityChange[];
}

/**
 * SP-narrowed type guard that mirrors `@sp/sync-core`'s `isMultiEntityPayload`
 * but narrows to the app's `MultiEntityPayload` (with the SP entity-type union).
 * The runtime check is identical; only the inferred type changes.
 */
export const isMultiEntityPayload = (payload: unknown): payload is MultiEntityPayload =>
  libIsMultiEntityPayload(payload);

/**
 * Minimal summary of repairs performed, used in REPAIR operation payload.
 * Keeps repair log lightweight while providing debugging info.
 */
export interface RepairSummary {
  entityStateFixed: number; // Fixed ids/entities array sync
  orphanedEntitiesRestored: number; // Tasks restored from archive, orphaned notes fixed
  invalidReferencesRemoved: number; // Non-existent project/tag IDs removed
  relationshipsFixed: number; // Project/tag ID consistency, subtask parent relationships
  structureRepaired: number; // Menu tree, inbox project creation
  typeErrorsFixed: number; // Typia errors auto-fixed (type coercion)
}

/**
 * Payload structure for REPAIR operations.
 * Contains the fully repaired state and a summary of what was fixed.
 */
export interface RepairPayload {
  appDataComplete: unknown; // AppDataComplete - using unknown to avoid circular deps
  repairSummary: RepairSummary;
}

/**
 * Legacy wrapper format for full-state payloads.
 * Some older code wrapped the state in { appDataComplete: ... }.
 * New code should use unwrapped format directly.
 */
export interface WrappedFullStatePayload {
  appDataComplete: Record<string, unknown>;
}

/**
 * Type guard to check if a payload is in the wrapped format.
 */
export const isWrappedFullStatePayload = (
  payload: unknown,
): payload is WrappedFullStatePayload =>
  typeof payload === 'object' &&
  payload !== null &&
  'appDataComplete' in payload &&
  typeof (payload as WrappedFullStatePayload).appDataComplete === 'object' &&
  (payload as WrappedFullStatePayload).appDataComplete !== null;

/**
 * Extracts the raw application state from a full-state operation payload.
 * Handles both wrapped ({ appDataComplete: ... }) and unwrapped formats.
 */
export const extractFullStateFromPayload = (
  payload: unknown,
): Record<string, unknown> => {
  if (isWrappedFullStatePayload(payload)) {
    return payload.appDataComplete;
  }
  return payload as Record<string, unknown>;
};

/**
 * Validates that a full-state payload has the expected structure.
 * Throws an error if the payload is malformed.
 */
export const assertValidFullStatePayload: (
  payload: unknown,
  context: string,
) => asserts payload is Record<string, unknown> = (payload, context) => {
  const state = extractFullStateFromPayload(payload);

  if (typeof state !== 'object' || state === null) {
    throw new Error(
      `[${context}] Invalid full-state payload: expected object, got ${typeof state}`,
    );
  }

  const expectedKeys = ['task', 'project', 'tag', 'globalConfig'];
  const hasExpectedKeys = expectedKeys.some((key) => key in state);

  if (!hasExpectedKeys) {
    const actualKeys = Object.keys(state).slice(0, 5).join(', ');
    throw new Error(
      `[${context}] Invalid full-state payload: missing expected keys. ` +
        `Expected some of [${expectedKeys.join(', ')}], got [${actualKeys}...]`,
    );
  }
};
