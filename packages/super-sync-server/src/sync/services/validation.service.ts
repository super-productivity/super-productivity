/**
 * ValidationService - Validates incoming operations
 *
 * Extracted from SyncService for better separation of concerns.
 * This service is stateless and has no database dependencies.
 */
import {
  Operation,
  OP_TYPES,
  SyncConfig,
  SYNC_ERROR_CODES,
  SyncErrorCode,
  sanitizeVectorClock,
  validatePayload,
} from '../sync.types';
import { ENTITY_TYPES } from '@sp/shared-schema';
import { Logger } from '../../logger';

/**
 * Valid entity types for operations.
 * Uses shared ENTITY_TYPES from @sp/shared-schema to ensure client/server consistency.
 * Operations with unknown entity types will be rejected.
 * Typed as Set<string> since we're validating unknown input strings.
 */
export const ALLOWED_ENTITY_TYPES: Set<string> = new Set(ENTITY_TYPES);

export interface ValidationResult {
  valid: boolean;
  error?: string;
  errorCode?: SyncErrorCode;
}

export class ValidationService {
  constructor(private readonly config: SyncConfig) {}

  /**
   * Validates an operation for correctness before processing.
   * Mutates op.vectorClock if sanitization is needed.
   */
  validateOp(op: Operation, requestClientId: string): ValidationResult {
    // Validate clientId matches request
    if (op.clientId !== requestClientId) {
      return {
        valid: false,
        error: `Operation clientId "${op.clientId}" does not match request clientId "${requestClientId}"`,
        errorCode: SYNC_ERROR_CODES.INVALID_CLIENT_ID,
      };
    }

    if (!op.id || typeof op.id !== 'string') {
      return {
        valid: false,
        error: 'Invalid operation ID',
        errorCode: SYNC_ERROR_CODES.INVALID_OP_ID,
      };
    }
    if (op.id.length > 255) {
      return {
        valid: false,
        error: 'Operation ID too long',
        errorCode: SYNC_ERROR_CODES.INVALID_OP_ID,
      };
    }
    if (!op.opType || !OP_TYPES.includes(op.opType)) {
      return {
        valid: false,
        error: 'Invalid opType',
        errorCode: SYNC_ERROR_CODES.INVALID_OP_TYPE,
      };
    }
    if (!op.entityType) {
      return {
        valid: false,
        error: 'Missing entityType',
        errorCode: SYNC_ERROR_CODES.INVALID_ENTITY_TYPE,
      };
    }
    if (!ALLOWED_ENTITY_TYPES.has(op.entityType)) {
      return {
        valid: false,
        error: `Invalid entityType: ${op.entityType}`,
        errorCode: SYNC_ERROR_CODES.INVALID_ENTITY_TYPE,
      };
    }
    if (op.entityId !== undefined && op.entityId !== null) {
      if (typeof op.entityId !== 'string' || op.entityId.length > 255) {
        return {
          valid: false,
          error: 'Invalid entityId format or length',
          errorCode: SYNC_ERROR_CODES.INVALID_ENTITY_ID,
        };
      }
      // Reject empty strings - these are corrupt operations that would cause sync issues
      if (op.entityId.trim().length === 0) {
        return {
          valid: false,
          error: 'entityId cannot be empty or whitespace-only',
          errorCode: SYNC_ERROR_CODES.INVALID_ENTITY_ID,
        };
      }
    }

    // Require entityId for regular entity operations.
    // Full-state operations (SYNC_IMPORT, BACKUP_IMPORT, REPAIR) and bulk entity types
    // (ALL, RECOVERY) legitimately don't have entityId.
    // This prevents corrupt operations (e.g., TASK with undefined entityId) from being
    // accepted and causing infinite rejection loops when synced to other clients.
    const isFullStateOp =
      op.opType === 'SYNC_IMPORT' ||
      op.opType === 'BACKUP_IMPORT' ||
      op.opType === 'REPAIR';
    const isBulkEntityType = op.entityType === 'ALL' || op.entityType === 'RECOVERY';

    if (!isFullStateOp && !isBulkEntityType && !op.entityId) {
      return {
        valid: false,
        error: `Operation ${op.opType} on ${op.entityType} requires entityId`,
        errorCode: SYNC_ERROR_CODES.MISSING_ENTITY_ID,
      };
    }
    if (op.payload === undefined) {
      return {
        valid: false,
        error: 'Missing payload',
        errorCode: SYNC_ERROR_CODES.INVALID_PAYLOAD,
      };
    }
    if (op.schemaVersion !== undefined) {
      if (op.schemaVersion < 1 || op.schemaVersion > 100) {
        return {
          valid: false,
          error: `Invalid schema version: ${op.schemaVersion}`,
          errorCode: SYNC_ERROR_CODES.INVALID_SCHEMA_VERSION,
        };
      }
    }

    const clockValidation = sanitizeVectorClock(op.vectorClock);
    if (!clockValidation.valid) {
      return {
        valid: false,
        error: clockValidation.error,
        errorCode: SYNC_ERROR_CODES.INVALID_VECTOR_CLOCK,
      };
    }
    op.vectorClock = clockValidation.clock;

    // NOTE: Vector clock pruning (limitVectorClockSize) is intentionally NOT done here.
    // It is performed in processOperation() AFTER conflict detection but BEFORE storage.
    // Pruning before comparison drops entity clock IDs when the merged clock exceeds
    // MAX_VECTOR_CLOCK_SIZE (e.g., during conflict resolution where the client includes
    // all entity clock IDs + its own ID). The pruning-aware comparison then sees non-shared
    // keys and returns CONCURRENT instead of GREATER_THAN → infinite rejection loop.
    // DoS protection: sanitizeVectorClock() above caps at 3x MAX_VECTOR_CLOCK_SIZE (30).

    // Validate payload complexity to prevent DoS attacks via deeply nested objects.
    // Full-state ops (SYNC_IMPORT, BACKUP_IMPORT, REPAIR) get higher thresholds
    // since they legitimately contain more data (including archives which can have 300K+ keys).
    // Note: isFullStateOp is already defined above in entityId validation.
    const maxDepth = isFullStateOp ? 50 : 20;
    const maxKeys = isFullStateOp ? 500000 : 20000;
    if (!this.validatePayloadComplexity(op.payload, maxDepth, maxKeys)) {
      return {
        valid: false,
        error: `Payload too complex (max depth ${maxDepth}, max keys ${maxKeys})`,
        errorCode: SYNC_ERROR_CODES.INVALID_PAYLOAD,
      };
    }

    const payloadSize = JSON.stringify(op.payload).length;
    if (payloadSize > this.config.maxPayloadSizeBytes) {
      return {
        valid: false,
        error: 'Payload too large',
        errorCode: SYNC_ERROR_CODES.PAYLOAD_TOO_LARGE,
      };
    }

    const payloadValidation = validatePayload(op.opType, op.payload);
    if (!payloadValidation.valid) {
      return {
        valid: false,
        error: payloadValidation.error,
        errorCode: SYNC_ERROR_CODES.INVALID_PAYLOAD,
      };
    }

    // Note: Future timestamp check removed - clamping is handled in SyncService.processOperation()
    // to preserve data instead of rejecting. Only "too old" check remains.
    const now = Date.now();
    if (op.timestamp < now - this.config.retentionMs) {
      return {
        valid: false,
        error: 'Operation too old',
        errorCode: SYNC_ERROR_CODES.INVALID_TIMESTAMP,
      };
    }

    return { valid: true };
  }

  /**
   * Validates payload complexity to prevent DoS attacks via deeply nested objects.
   */
  validatePayloadComplexity(
    payload: unknown,
    maxDepth: number = 20,
    maxKeys: number = 20000,
  ): boolean {
    let totalKeys = 0;

    const checkDepth = (obj: unknown, depth: number): boolean => {
      if (depth > maxDepth) return false;
      if (obj === null || typeof obj !== 'object') return true;

      if (Array.isArray(obj)) {
        totalKeys += obj.length;
        if (totalKeys > maxKeys) return false;
        return obj.every((item) => checkDepth(item, depth + 1));
      }

      const keys = Object.keys(obj);
      totalKeys += keys.length;
      if (totalKeys > maxKeys) return false;

      return keys.every((key) =>
        checkDepth((obj as Record<string, unknown>)[key], depth + 1),
      );
    };

    return checkDepth(payload, 0);
  }
}
