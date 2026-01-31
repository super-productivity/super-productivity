import {
  Operation,
  EntityType,
  OpType,
  isMultiEntityPayload,
  EntityChange,
} from '../core/operation.types';
import { OpLog } from '../../core/log';
import { getPayloadKey, getAllPayloadKeys } from '../core/entity-registry';

/**
 * Result of validating an operation payload.
 */
export interface PayloadValidationResult {
  success: boolean;
  error?: string;
  warnings?: string[];
}

/**
 * Maps EntityType to the expected payload key.
 * Uses the central entity registry.
 */
const getEntityKeyFromType = (entityType: EntityType): string | null => {
  return getPayloadKey(entityType) ?? null;
};

/**
 * Attempts to find an entity-like object in the payload.
 * Uses payload keys from the central entity registry.
 */
const findEntityInPayload = (payload: Record<string, unknown>): unknown => {
  for (const key of getAllPayloadKeys()) {
    if (payload[key] && typeof payload[key] === 'object') {
      return payload[key];
    }
  }
  return null;
};

/**
 * Checks if an object looks like AppDataComplete.
 */
const isLikelyAppDataComplete = (obj: unknown): boolean => {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  // Check for a few key properties that AppDataComplete should have
  return 'task' in o || 'project' in o || 'globalConfig' in o;
};

/**
 * Validates CREATE operation payload.
 * Expects payload to contain the entity being created.
 */
const validateCreatePayload = (
  entityType: EntityType,
  payload: unknown,
): PayloadValidationResult => {
  const p = payload as Record<string, unknown>;
  const entityKey = getEntityKeyFromType(entityType);
  const warnings: string[] = [];

  // For create operations, we expect the entity to be in the payload
  const entity = entityKey ? p[entityKey] : findEntityInPayload(p);

  if (!entity) {
    // Warning rather than error - some creates might have different shapes
    warnings.push(`CREATE payload missing expected entity (${entityType})`);
    OpLog.warn(`[ValidateOperationPayload] ${warnings[0]}`, payload);
  } else if (typeof entity === 'object' && entity !== null) {
    // Basic ID check for the entity
    const entityObj = entity as Record<string, unknown>;
    if (!entityObj.id || typeof entityObj.id !== 'string') {
      return {
        success: false,
        error: `CREATE entity missing valid 'id' field`,
      };
    }
  }

  return { success: true, warnings: warnings.length > 0 ? warnings : undefined };
};

/**
 * Validates UPDATE operation payload.
 * Expects payload to contain entity ID and changes, or a task/entity with changes.
 */
const validateUpdatePayload = (
  entityType: EntityType,
  payload: unknown,
): PayloadValidationResult => {
  const p = payload as Record<string, unknown>;
  const warnings: string[] = [];

  // TIME_TRACKING uses action-payload capture with specific shapes
  // that don't match standard entity update patterns (see operation-capture.service.ts)
  if (entityType === 'TIME_TRACKING') {
    // syncTimeTracking shape: { contextType, contextId, date, data }
    if ('contextType' in p && 'contextId' in p && 'date' in p && 'data' in p) {
      return { success: true };
    }
    // updateWorkContextData shape: { ctx: { id, type }, date, updates }
    if ('ctx' in p && 'date' in p && 'updates' in p) {
      return { success: true };
    }
    // Fall through to standard validation if unknown TIME_TRACKING shape
  }

  // TASK time tracking updates use a special shape: { taskId, date, duration }
  // This comes from syncTimeSpent action (see time-tracking.actions.ts)
  if (entityType === 'TASK' && 'taskId' in p && 'date' in p && 'duration' in p) {
    return { success: true };
  }

  // METRIC focus session logging uses a special shape: { day, duration }
  // This comes from logFocusSession action (see metric.actions.ts)
  if (entityType === 'METRIC' && 'day' in p && 'duration' in p) {
    return { success: true };
  }

  // Update payloads can have various shapes:
  // 1. { task: { id, changes } } or { project: { id, changes } }
  // 2. { id, changes }
  // 3. { task: Task, ...otherProps } - for convertToMainTask etc.
  // 4. { tasks: Task[] } - for batch updates like moveToArchive

  const entityKey = getEntityKeyFromType(entityType);

  // Check for nested update shape: { task: { id, changes } }
  if (entityKey && p[entityKey]) {
    const nested = p[entityKey] as Record<string, unknown>;
    if (nested.id && nested.changes) {
      return { success: true };
    }
    // Could be a full entity for updates that pass the whole entity
    if (nested.id) {
      return { success: true };
    }
  }

  // Check for direct shape: { id, changes }
  if (p.id && typeof p.id === 'string') {
    return { success: true };
  }

  // Check for batch update shape: { tasks: Task[] }
  if (entityKey) {
    const pluralKey = entityKey + 's';
    if (Array.isArray(p[pluralKey])) {
      return { success: true };
    }
  }

  // Check for bulk ID-based update shape: { taskIds: string[] }
  // Used by actions like planTasksForToday, removeTasksFromTodayTag
  if (entityKey) {
    const idsKey = entityKey + 'Ids';
    if (Array.isArray(p[idsKey])) {
      return { success: true };
    }
  }

  // Check if there's any entity-like object in payload
  const entity = findEntityInPayload(p);
  if (entity && typeof entity === 'object' && (entity as Record<string, unknown>).id) {
    return { success: true };
  }

  // Allow through with warning - updates have many shapes
  warnings.push(`UPDATE payload has unusual structure for ${entityType}`);
  OpLog.warn(`[ValidateOperationPayload] ${warnings[0]}`, payload);

  return { success: true, warnings };
};

/**
 * Validates DELETE operation payload.
 * Expects entityId/entityIds in operation or in payload.
 */
const validateDeletePayload = (
  entityType: EntityType,
  payload: unknown,
  entityId?: string,
  entityIds?: string[],
): PayloadValidationResult => {
  // entityId or entityIds should be on the operation itself
  if (entityId && typeof entityId === 'string') {
    return { success: true };
  }

  if (entityIds && Array.isArray(entityIds) && entityIds.length > 0) {
    const allStrings = entityIds.every((id) => typeof id === 'string');
    if (!allStrings) {
      return { success: false, error: 'DELETE entityIds must all be strings' };
    }
    return { success: true };
  }

  // Check payload for task/taskIds
  const p = payload as Record<string, unknown>;
  if (p.taskIds && Array.isArray(p.taskIds)) {
    return { success: true };
  }
  if (p.task && typeof p.task === 'object' && (p.task as Record<string, unknown>).id) {
    return { success: true };
  }

  // Allow through with warning
  OpLog.warn(
    `[ValidateOperationPayload] DELETE missing entityId/entityIds for ${entityType}`,
    payload,
  );
  return { success: true, warnings: ['DELETE missing entityId/entityIds'] };
};

/**
 * Validates MOVE operation payload.
 * Expects entityIds array for reordering.
 */
const validateMovePayload = (
  payload: unknown,
  entityIds?: string[],
): PayloadValidationResult => {
  // entityIds should be on the operation
  if (entityIds && Array.isArray(entityIds)) {
    return { success: true };
  }

  // Or in the payload
  const p = payload as Record<string, unknown>;
  if (p.ids && Array.isArray(p.ids)) {
    return { success: true };
  }
  if (p.taskIds && Array.isArray(p.taskIds)) {
    return { success: true };
  }

  OpLog.warn('[ValidateOperationPayload] MOVE missing ids array', payload);
  return { success: true, warnings: ['MOVE missing ids array'] };
};

/**
 * Validates BATCH operation payload.
 * Allows various batch structures through with minimal validation.
 */
const validateBatchPayload = (payload: unknown): PayloadValidationResult => {
  const p = payload as Record<string, unknown>;

  // Batch operations can have many shapes
  // Just ensure payload is not empty
  if (Object.keys(p).length === 0) {
    return { success: false, error: 'BATCH payload cannot be empty' };
  }

  return { success: true };
};

/**
 * Validates SYNC_IMPORT/BACKUP_IMPORT payload.
 * Expects appDataComplete structure.
 */
const validateFullStatePayload = (payload: unknown): PayloadValidationResult => {
  const p = payload as Record<string, unknown>;

  // Full state imports should have appDataComplete
  if (!p.appDataComplete && !isLikelyAppDataComplete(p)) {
    return {
      success: false,
      error: 'Full state import missing appDataComplete',
    };
  }

  const data = (p.appDataComplete || p) as Record<string, unknown>;

  // Check for at least some expected keys
  const expectedKeys = ['task', 'project', 'tag', 'globalConfig'];
  const hasExpectedKeys = expectedKeys.some((key) => key in data);

  if (!hasExpectedKeys) {
    return {
      success: false,
      error: 'Full state import missing expected data keys (task, project, tag, etc.)',
    };
  }

  return { success: true };
};

/**
 * Validates entity changes in a multi-entity payload.
 */
const validateEntityChanges = (
  entityChanges: EntityChange[],
): PayloadValidationResult => {
  const warnings: string[] = [];

  for (let i = 0; i < entityChanges.length; i++) {
    const change = entityChanges[i];

    // Validate entity type
    if (!change.entityType || typeof change.entityType !== 'string') {
      return {
        success: false,
        error: `EntityChange[${i}] missing or invalid entityType`,
      };
    }

    // Validate entity ID (allow '*' for singletons)
    if (!change.entityId || typeof change.entityId !== 'string') {
      return {
        success: false,
        error: `EntityChange[${i}] missing or invalid entityId`,
      };
    }

    // Validate op type
    if (!change.opType || typeof change.opType !== 'string') {
      return {
        success: false,
        error: `EntityChange[${i}] missing or invalid opType`,
      };
    }

    // Validate changes based on opType
    if (change.opType === OpType.Create) {
      if (
        !change.changes ||
        typeof change.changes !== 'object' ||
        change.changes === null
      ) {
        return {
          success: false,
          error: `EntityChange[${i}] CREATE requires changes to be an object with entity data`,
        };
      }
      // Create should have an id in changes
      const changesObj = change.changes as Record<string, unknown>;
      if (!changesObj.id && change.entityId !== '*') {
        warnings.push(`EntityChange[${i}] CREATE changes missing 'id' field`);
      }
    } else if (change.opType === OpType.Delete) {
      // Delete should have minimal changes (tombstone)
      // Allow null/undefined or object
      if (change.changes !== null && change.changes !== undefined) {
        if (typeof change.changes !== 'object') {
          return {
            success: false,
            error: `EntityChange[${i}] DELETE changes must be null or object`,
          };
        }
      }
    }
    // Update changes can be partial objects, no strict validation needed
  }

  return { success: true, warnings: warnings.length > 0 ? warnings : undefined };
};

/**
 * Validates a multi-entity payload structure.
 */
const validateMultiEntityPayloadStructure = (
  payload: unknown,
): PayloadValidationResult => {
  if (!isMultiEntityPayload(payload)) {
    // Not a multi-entity payload, this is fine (legacy format)
    return { success: true };
  }

  const warnings: string[] = [];

  // Validate actionPayload
  if (
    !payload.actionPayload ||
    typeof payload.actionPayload !== 'object' ||
    payload.actionPayload === null
  ) {
    return {
      success: false,
      error: 'MultiEntityPayload.actionPayload must be a non-null object',
    };
  }

  // Validate entityChanges array
  if (!Array.isArray(payload.entityChanges)) {
    return {
      success: false,
      error: 'MultiEntityPayload.entityChanges must be an array',
    };
  }

  // Empty entityChanges is allowed (action may not have caused state changes)
  // Most actions have empty entityChanges because actionPayload is sufficient for replay
  if (payload.entityChanges.length > 0) {
    // Validate each entity change
    const changesResult = validateEntityChanges(payload.entityChanges);
    if (!changesResult.success) {
      return changesResult;
    }
    if (changesResult.warnings) {
      warnings.push(...changesResult.warnings);
    }
  }

  return { success: true, warnings: warnings.length > 0 ? warnings : undefined };
};

/**
 * Extracts the action payload from an operation payload.
 * Handles both multi-entity (new format) and legacy payloads.
 */
const extractActionPayloadForValidation = (payload: unknown): Record<string, unknown> => {
  if (isMultiEntityPayload(payload)) {
    return payload.actionPayload;
  }
  return payload as Record<string, unknown>;
};

/**
 * Validates an operation payload before persisting to IndexedDB.
 *
 * This is Checkpoint A in the validation architecture.
 * - For CREATE/UPDATE operations: validates payload has required entity/id structure
 * - For DELETE operations: validates IDs are present
 * - For SYNC_IMPORT/BACKUP_IMPORT: validates appDataComplete structure exists
 * - For REPAIR: skips validation (internally generated)
 * - For MultiEntityPayload: validates actionPayload and entityChanges structure
 *
 * NOTE: This validation is intentionally lenient to start.
 * It checks structural requirements rather than deep entity validation.
 * Full Typia validation happens at state checkpoints (B, C, D).
 */
export const validateOperationPayload = (op: Operation): PayloadValidationResult => {
  const allWarnings: string[] = [];

  // 1. Basic structural validation
  if (op.payload === null || op.payload === undefined) {
    return { success: false, error: 'Payload cannot be null or undefined' };
  }

  if (typeof op.payload !== 'object') {
    return { success: false, error: 'Payload must be an object' };
  }

  // Arrays bypass typeof === 'object' check, but payloads should be plain objects
  if (Array.isArray(op.payload)) {
    return { success: false, error: 'Payload must be a plain object, not an array' };
  }

  // 2. Validate multi-entity payload structure if present
  const multiEntityResult = validateMultiEntityPayloadStructure(op.payload);
  if (!multiEntityResult.success) {
    return multiEntityResult;
  }
  if (multiEntityResult.warnings) {
    allWarnings.push(...multiEntityResult.warnings);
  }

  // 3. Extract actionPayload for type-specific validation
  // For multi-entity payloads, we validate the actionPayload
  // For legacy payloads, we validate the payload directly
  const actionPayload = extractActionPayloadForValidation(op.payload);

  // 4. Validate based on operation type
  let result: PayloadValidationResult;
  switch (op.opType) {
    case OpType.Create:
      result = validateCreatePayload(op.entityType, actionPayload);
      break;

    case OpType.Update:
      result = validateUpdatePayload(op.entityType, actionPayload);
      break;

    case OpType.Delete:
      result = validateDeletePayload(
        op.entityType,
        actionPayload,
        op.entityId,
        op.entityIds,
      );
      break;

    case OpType.Move:
      result = validateMovePayload(actionPayload, op.entityIds);
      break;

    case OpType.Batch:
      result = validateBatchPayload(actionPayload);
      break;

    case OpType.SyncImport:
    case OpType.BackupImport:
      result = validateFullStatePayload(actionPayload);
      break;

    case OpType.Repair:
      // Repair operations are internally generated - skip validation
      result = { success: true };
      break;

    default:
      OpLog.warn(
        `[ValidateOperationPayload] Unknown opType: ${op.opType}, allowing through`,
      );
      result = { success: true };
  }

  // Merge warnings
  if (!result.success) {
    return result;
  }
  if (result.warnings) {
    allWarnings.push(...result.warnings);
  }

  return {
    success: true,
    warnings: allWarnings.length > 0 ? allWarnings : undefined,
  };
};
