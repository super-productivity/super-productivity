// Plain SuperSync contract values, kept free of zod so app code that only needs
// these does not pull zod into the initial bundle (the schemas importing zod live
// in './supersync-http-contract', loaded lazily with the SuperSync provider).

export const SUPER_SYNC_CLIENT_ID_REGEX = /^[a-zA-Z0-9_-]+$/;
export const SUPER_SYNC_MAX_CLIENT_ID_LENGTH = 255;
export const SUPER_SYNC_MAX_OPS_PER_UPLOAD = 100;
export const SUPER_SYNC_MAX_ENTITY_IDS_PER_OP = 1000;

export const SUPER_SYNC_OP_TYPES = [
  'CRT',
  'UPD',
  'DEL',
  'MOV',
  'BATCH',
  'SYNC_IMPORT',
  'BACKUP_IMPORT',
  'REPAIR',
] as const;

export const SUPER_SYNC_IMPORT_REASONS = [
  'PASSWORD_CHANGED',
  'FILE_IMPORT',
  'BACKUP_RESTORE',
  'FORCE_UPLOAD',
  'SERVER_MIGRATION',
  'REPAIR',
] as const;

export const SUPER_SYNC_SNAPSHOT_REASONS = ['initial', 'recovery', 'migration'] as const;

export const SUPER_SYNC_SNAPSHOT_OP_TYPES = [
  'SYNC_IMPORT',
  'BACKUP_IMPORT',
  'REPAIR',
] as const;

/**
 * Structured error codes the SuperSync server attaches to responses
 * (`errorCode` on non-2xx bodies and per-op upload results).
 *
 * This is the producer/comparison vocabulary shared by server and client —
 * NOT a wire validation set. Response schemas keep `errorCode` as a loose
 * `z.string()` so an older client never rejects an otherwise-valid response
 * just because a newer server introduced a code it does not know yet.
 */
export const SUPER_SYNC_ERROR_CODES = {
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
  REPAIR_STALE: 'REPAIR_STALE',
  DUPLICATE_OPERATION: 'DUPLICATE_OPERATION',
  SYNC_IMPORT_EXISTS: 'SYNC_IMPORT_EXISTS',

  // Rate limiting (429)
  RATE_LIMITED: 'RATE_LIMITED',

  // Storage quota (413)
  STORAGE_QUOTA_EXCEEDED: 'STORAGE_QUOTA_EXCEEDED',

  // Encryption-related errors (400)
  ENCRYPTED_OPS_NOT_SUPPORTED: 'ENCRYPTED_OPS_NOT_SUPPORTED',
  // Encrypted-only ingress gate: upload rejected because a payload is not
  // flagged encrypted or lacks the ciphertext transport shape.
  E2EE_REQUIRED: 'E2EE_REQUIRED',

  // Minimum app version (whole request, any non-2xx status). Not sent by any
  // server yet: clients learn it first so a future floor can show them a
  // calm "update the app" notice instead of a raw HTTP error. Clients must
  // keep every pending op pending and never treat it as an auth failure.
  // See docs/sync-and-op-log/client-version-floor.md.
  CLIENT_UPDATE_REQUIRED: 'CLIENT_UPDATE_REQUIRED',

  // Server errors (500)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type SuperSyncErrorCode =
  (typeof SUPER_SYNC_ERROR_CODES)[keyof typeof SUPER_SYNC_ERROR_CODES];
