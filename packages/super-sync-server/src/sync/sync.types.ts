import { Logger } from '../logger';
import {
  VectorClock,
  VectorClockComparison,
  compareVectorClocks,
  limitVectorClockSize,
  MAX_VECTOR_CLOCK_SIZE,
} from '@sp/shared-schema';

// Re-export for consumers of this module
export {
  VectorClock,
  VectorClockComparison,
  compareVectorClocks,
  limitVectorClockSize,
  MAX_VECTOR_CLOCK_SIZE,
};

// Structured error codes for client handling
export const SYNC_ERROR_CODES = {
  // Validation errors (400)
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_OP_ID: 'INVALID_OP_ID',
  INVALID_OP_TYPE: 'INVALID_OP_TYPE',
  INVALID_ENTITY_TYPE: 'INVALID_ENTITY_TYPE',
  INVALID_ENTITY_ID: 'INVALID_ENTITY_ID',
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  INVALID_VECTOR_CLOCK: 'INVALID_VECTOR_CLOCK',
  INVALID_TIMESTAMP: 'INVALID_TIMESTAMP',
  MISSING_ENTITY_ID: 'MISSING_ENTITY_ID',
  INVALID_SCHEMA_VERSION: 'INVALID_SCHEMA_VERSION',
  INVALID_CLIENT_ID: 'INVALID_CLIENT_ID',

  // Conflict errors (409)
  CONFLICT_CONCURRENT: 'CONFLICT_CONCURRENT',
  CONFLICT_SUPERSEDED: 'CONFLICT_SUPERSEDED',
  /** @deprecated Use CONFLICT_SUPERSEDED. Keep for backward compat with older clients. */
  CONFLICT_STALE: 'CONFLICT_STALE',
  DUPLICATE_OPERATION: 'DUPLICATE_OPERATION',

  // Rate limiting (429)
  RATE_LIMITED: 'RATE_LIMITED',

  // Storage quota (413)
  STORAGE_QUOTA_EXCEEDED: 'STORAGE_QUOTA_EXCEEDED',

  // Encryption-related errors (400)
  ENCRYPTED_OPS_NOT_SUPPORTED: 'ENCRYPTED_OPS_NOT_SUPPORTED' as const,

  // Server errors (500)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type SyncErrorCode = (typeof SYNC_ERROR_CODES)[keyof typeof SYNC_ERROR_CODES];

// Operation types - single source of truth
export const OP_TYPES = [
  'CRT',
  'UPD',
  'DEL',
  'MOV',
  'BATCH',
  'SYNC_IMPORT',
  'BACKUP_IMPORT',
  'REPAIR',
] as const;

export type OpType = (typeof OP_TYPES)[number];

// VectorClock, VectorClockComparison, and compareVectorClocks are imported from @sp/shared-schema
// and re-exported above. This ensures client and server use identical implementations.

/**
 * Validates and sanitizes a vector clock.
 * Returns a sanitized clock with validated entries, or an error.
 *
 * Validation rules:
 * - Maximum MAX_VECTOR_CLOCK_SIZE * 5 (50) entries (prevents DoS via huge clocks)
 * - Keys must be non-empty strings, max 255 characters
 * - Values must be non-negative integers, max 10 million
 * - Invalid entries are removed (not rejected)
 */
export const sanitizeVectorClock = (
  clock: unknown,
): { valid: true; clock: VectorClock } | { valid: false; error: string } => {
  if (typeof clock !== 'object' || clock === null || Array.isArray(clock)) {
    return { valid: false, error: 'Vector clock must be an object' };
  }

  const entries = Object.entries(clock as Record<string, unknown>);

  // Reject absurdly large clocks (DoS protection).
  // Legitimate clocks can temporarily exceed MAX_VECTOR_CLOCK_SIZE during conflict
  // resolution: entity clock IDs + client ID + merged clocks from multiple concurrent
  // clients. 5x MAX gives ample room for multi-client merge scenarios while catching
  // adversarial inputs. Server-side pruning (limitVectorClockSize) will trim to MAX
  // before storage.
  const MAX_SANITIZE_VECTOR_CLOCK_SIZE = MAX_VECTOR_CLOCK_SIZE * 5;
  if (entries.length > MAX_SANITIZE_VECTOR_CLOCK_SIZE) {
    return {
      valid: false,
      error: `Vector clock has too many entries (${entries.length}, max ${MAX_SANITIZE_VECTOR_CLOCK_SIZE})`,
    };
  }

  const sanitized: VectorClock = {};
  let strippedCount = 0;

  for (const [key, value] of entries) {
    // Validate key
    if (typeof key !== 'string' || key.length === 0 || key.length > 255) {
      strippedCount++;
      continue; // Skip invalid keys
    }

    // Validate value
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > 10000000
    ) {
      strippedCount++;
      continue; // Skip invalid values
    }

    sanitized[key] = value;
  }

  if (strippedCount > 0) {
    Logger.warn(
      `sanitizeVectorClock: Stripped ${strippedCount} invalid entries from vector clock`,
    );
  }

  return { valid: true, clock: sanitized };
};

// compareVectorClocks is imported from @sp/shared-schema (see imports at top of file)

export interface Operation {
  id: string;
  clientId: string;
  actionType: string;
  opType: OpType;
  entityType: string;
  entityId?: string;
  entityIds?: string[]; // For batch operations
  payload: unknown;
  vectorClock: VectorClock;
  timestamp: number;
  schemaVersion: number;
  isPayloadEncrypted?: boolean; // True if payload is E2E encrypted
}

export interface ServerOperation {
  serverSeq: number;
  op: Operation;
  receivedAt: number;
}

// Upload types
export interface UploadOpsRequest {
  ops: Operation[];
  clientId: string;
  lastKnownServerSeq?: number;
  requestId?: string; // For request deduplication on retries
  isCleanSlate?: boolean; // If true, server deletes all user data before accepting ops
}

export interface UploadResult {
  opId: string;
  accepted: boolean;
  serverSeq?: number;
  error?: string;
  errorCode?: SyncErrorCode;
  /**
   * The existing entity's vector clock when rejecting due to conflict.
   * Allows clients to create LWW updates that dominate the server's state.
   */
  existingClock?: VectorClock;
}

export interface UploadOpsResponse {
  results: UploadResult[];
  newOps?: ServerOperation[];
  latestSeq: number;
  /**
   * True when piggybacked ops were limited (more ops exist on server).
   * Client should trigger a download to get the remaining operations.
   */
  hasMorePiggyback?: boolean;
}

// Download types
export interface DownloadOpsQuery {
  sinceSeq: number;
  limit?: number;
  excludeClient?: string;
}

export interface DownloadOpsResponse {
  ops: ServerOperation[];
  hasMore: boolean;
  latestSeq: number;
  /**
   * Set to true if operations were deleted and the client should re-sync
   * from a snapshot. This happens when:
   * - The requested sinceSeq is older than retained operations
   * - There's a gap in sequence numbers (operations were purged)
   */
  gapDetected?: boolean;
  /**
   * Server sequence of the latest full-state operation (SYNC_IMPORT, BACKUP_IMPORT, REPAIR).
   * Fresh clients (sinceSeq=0) can use this to understand where the effective state starts.
   * Operations before this seq are superseded by the full-state operation.
   */
  latestSnapshotSeq?: number;
  /**
   * Aggregated vector clock from all ops before and including the snapshot.
   * Only set when snapshot optimization is used (sinceSeq < latestSnapshotSeq).
   * Clients need this to create merged updates that dominate all known clocks.
   */
  snapshotVectorClock?: VectorClock;
  /**
   * Server timestamp for client clock drift detection.
   */
  serverTime?: number;
}

// Snapshot types
export interface SnapshotResponse {
  state: unknown;
  serverSeq: number;
  generatedAt: number;
}

export interface UploadSnapshotRequest {
  state: unknown;
  clientId: string;
  reason: 'initial' | 'recovery' | 'migration';
  vectorClock: VectorClock;
  schemaVersion?: number;
}

// Status types
export interface SyncStatusResponse {
  latestSeq: number;
  devicesOnline: number;
  snapshotAge?: number;
  storageUsedBytes: number;
  storageQuotaBytes: number;
}

// Restore point types
export type RestorePointType =
  | 'SYNC_IMPORT'
  | 'BACKUP_IMPORT'
  | 'REPAIR'
  | 'DAILY_BOUNDARY';

export interface RestorePoint {
  serverSeq: number;
  timestamp: number; // clientTimestamp from the operation
  type: RestorePointType;
  clientId: string;
  description?: string; // e.g., "Backup from Desktop" or "Daily checkpoint"
}

export interface RestorePointsResponse {
  restorePoints: RestorePoint[];
}

export interface RestoreSnapshotResponse {
  state: unknown;
  serverSeq: number;
  generatedAt: number;
}

// Payload validation result
export interface PayloadValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates operation payload structure based on operation type.
 * This is a server-side security check to ensure payloads have the expected structure.
 *
 * Note: The entity ID is stored in operation.entityId, NOT in the payload.
 * Payloads contain the entity data, e.g., { task: { id: '...', title: '...' } }
 *
 * Rules:
 * - CRT: Must be a non-null object (contains the entity being created)
 * - UPD: Must be an object (partial update)
 * - DEL: Can be empty object, null, or object with deletion metadata
 * - MOV: Must be an object (contains move/reorder data)
 * - BATCH: Must be an object, optionally with 'entities' object
 * - SYNC_IMPORT/BACKUP_IMPORT/REPAIR: Accept any (too complex to validate)
 */
export const validatePayload = (
  opType: OpType,
  payload: unknown,
): PayloadValidationResult => {
  // Skip validation for full-state operations (too complex to validate server-side)
  if (opType === 'SYNC_IMPORT' || opType === 'BACKUP_IMPORT' || opType === 'REPAIR') {
    return { valid: true };
  }

  // DEL can have empty payload, null, or metadata object
  if (opType === 'DEL') {
    if (payload === null || payload === undefined) {
      return { valid: true };
    }
    if (typeof payload === 'object' && !Array.isArray(payload)) {
      return { valid: true };
    }
    // Encrypted DEL payload might be a string
    if (typeof payload === 'string') {
      return { valid: true };
    }
    return {
      valid: false,
      error: 'DEL payload must be null, an object, or an encrypted string',
    };
  }

  // Encrypted payloads are strings - allow them
  if (typeof payload === 'string') {
    return { valid: true };
  }

  // All other operations require an object payload
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { valid: false, error: `${opType} payload must be a non-null object` };
  }

  const payloadObj = payload as Record<string, unknown>;

  // BATCH with 'entities' must have entities as an object
  if (opType === 'BATCH' && 'entities' in payloadObj) {
    if (
      typeof payloadObj.entities !== 'object' ||
      payloadObj.entities === null ||
      Array.isArray(payloadObj.entities)
    ) {
      return { valid: false, error: 'BATCH entities must be an object keyed by ID' };
    }
  }

  return { valid: true };
};

// Configuration
export interface SyncConfig {
  maxOpsPerUpload: number;
  maxPayloadSizeBytes: number;
  downloadLimit: number;
  uploadRateLimit: { max: number; windowMs: number };
  downloadRateLimit: { max: number; windowMs: number };
  retentionMs: number; // Unified retention period for ops, devices, and validation
  maxClockDriftMs: number;
}

// Time constants (in milliseconds)
export const MS_PER_MINUTE = 60 * 1000;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

// Retention period
export const RETENTION_DAYS = 45;
export const RETENTION_MS = RETENTION_DAYS * MS_PER_DAY;

// Device thresholds
export const ONLINE_DEVICE_THRESHOLD_MS = 5 * MS_PER_MINUTE; // 5 minutes

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  maxOpsPerUpload: 100,
  maxPayloadSizeBytes: 20 * 1024 * 1024, // 20MB - needed for large imports
  downloadLimit: 1000,
  uploadRateLimit: { max: 100, windowMs: MS_PER_MINUTE },
  downloadRateLimit: { max: 200, windowMs: MS_PER_MINUTE },
  retentionMs: RETENTION_MS, // 45 days - used for ops, devices, and validation
  maxClockDriftMs: MS_PER_MINUTE, // 60 seconds
};
