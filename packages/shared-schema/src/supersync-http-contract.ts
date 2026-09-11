import { z } from 'zod';

export const SUPER_SYNC_CLIENT_ID_REGEX = /^[a-zA-Z0-9_-]+$/;
export const SUPER_SYNC_MAX_CLIENT_ID_LENGTH = 255;
export const SUPER_SYNC_MAX_OPS_PER_UPLOAD = 100;
export const SUPER_SYNC_MAX_ENTITY_IDS_PER_OP = 1000;

// Upload-only fields must be loose enough to reach per-operation validation,
// but still bounded so one invalid item cannot amplify logs/responses or make
// semantic validation walk an arbitrarily large identifier collection.
const SUPER_SYNC_MAX_INVALID_FIELD_TRANSPORT_LENGTH = 4096;
const SUPER_SYNC_MAX_INVALID_ENTITY_IDS_TRANSPORT = SUPER_SYNC_MAX_ENTITY_IDS_PER_OP * 2;

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

  // Server errors (500)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type SuperSyncErrorCode =
  (typeof SUPER_SYNC_ERROR_CODES)[keyof typeof SUPER_SYNC_ERROR_CODES];

/**
 * Constrains client-generated dedup keys to URL-safe chars so they can be
 * embedded in log lines without escape risk and trivially compared on the
 * server. Length is intentionally permissive (1..64) so existing clients
 * keep working; the charset restriction alone closes the log-injection
 * vector that motivated this regex.
 */
const SUPER_SYNC_REQUEST_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

const SuperSyncRequestIdSchema = z.string().regex(SUPER_SYNC_REQUEST_ID_REGEX);

export const SuperSyncVectorClockSchema = z.record(z.string(), z.number());

export const SuperSyncClientIdSchema = z
  .string()
  .min(1)
  .max(SUPER_SYNC_MAX_CLIENT_ID_LENGTH)
  .regex(
    SUPER_SYNC_CLIENT_ID_REGEX,
    'clientId must be alphanumeric with underscores/hyphens only',
  );

export const SuperSyncOperationSchema = z.object({
  id: z.string().min(1).max(255),
  clientId: SuperSyncClientIdSchema,
  actionType: z.string().min(1).max(255),
  opType: z.enum(SUPER_SYNC_OP_TYPES),
  entityType: z.string().min(1).max(255),
  entityId: z.string().max(255).optional(),
  entityIds: z
    .array(z.string().max(255))
    .max(SUPER_SYNC_MAX_ENTITY_IDS_PER_OP)
    .optional(),
  payload: z.unknown(),
  vectorClock: SuperSyncVectorClockSchema,
  timestamp: z.number(),
  schemaVersion: z.number().int().min(1).max(100),
  /** Optional (absent on old clients) — readers must sniff the payload type
   * instead of relying on it (android `SuperSyncBackgroundProvider` does). */
  isPayloadEncrypted: z.boolean().optional(),
  syncImportReason: z.enum(SUPER_SYNC_IMPORT_REASONS).optional(),
  /** Server cursor proven to be included in a causally accepted REPAIR snapshot. */
  repairBaseServerSeq: z.number().int().min(0).optional(),
});

// Upload requests are envelopes for independently validated operations. Keep
// structural types and fields that ValidationService does not handle strict,
// but defer semantic operation validation to the server so one malformed op
// cannot reject and stall every valid sibling in the batch. Download/response
// schemas stay structurally strict but keep their VOCABULARY fields loose —
// see SuperSyncOperationResponseSchema.
const SuperSyncUploadOperationSchema = SuperSyncOperationSchema.extend({
  id: z.string().max(SUPER_SYNC_MAX_INVALID_FIELD_TRANSPORT_LENGTH),
  clientId: z.string().max(SUPER_SYNC_MAX_INVALID_FIELD_TRANSPORT_LENGTH),
  opType: z.string().max(SUPER_SYNC_MAX_INVALID_FIELD_TRANSPORT_LENGTH),
  entityType: z.string().max(SUPER_SYNC_MAX_INVALID_FIELD_TRANSPORT_LENGTH),
  entityId: z.string().max(SUPER_SYNC_MAX_INVALID_FIELD_TRANSPORT_LENGTH).optional(),
  entityIds: z
    .array(z.string().max(SUPER_SYNC_MAX_INVALID_FIELD_TRANSPORT_LENGTH))
    .max(SUPER_SYNC_MAX_INVALID_ENTITY_IDS_TRANSPORT)
    .optional(),
  vectorClock: z.record(z.string(), z.unknown()),
  schemaVersion: z.number(),
});

export const SuperSyncUploadOpsRequestSchema = z.object({
  ops: z.array(SuperSyncUploadOperationSchema).min(1).max(SUPER_SYNC_MAX_OPS_PER_UPLOAD),
  clientId: SuperSyncClientIdSchema,
  lastKnownServerSeq: z.number().optional(),
  requestId: SuperSyncRequestIdSchema.optional(),
});

export const SuperSyncDownloadOpsQuerySchema = z.object({
  sinceSeq: z.coerce.number().int().min(0),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  excludeClient: SuperSyncClientIdSchema.optional(),
});

export const SuperSyncUploadSnapshotRequestSchema = z
  .object({
    state: z.unknown(),
    clientId: SuperSyncClientIdSchema,
    reason: z.enum(SUPER_SYNC_SNAPSHOT_REASONS),
    vectorClock: SuperSyncVectorClockSchema,
    schemaVersion: z.number().int().min(1).max(100).optional(),
    isPayloadEncrypted: z.boolean().optional(),
    syncImportReason: z.enum(SUPER_SYNC_IMPORT_REASONS).optional(),
    opId: z.string().uuid().optional(),
    isCleanSlate: z.boolean().optional(),
    snapshotOpType: z.enum(SUPER_SYNC_SNAPSHOT_OP_TYPES).optional(),
    repairBaseServerSeq: z.number().int().min(0).optional(),
    requestId: SuperSyncRequestIdSchema.optional(),
  })
  .superRefine((request, context) => {
    if (request.isCleanSlate && !request.opId) {
      context.addIssue({
        code: 'custom',
        path: ['opId'],
        message: 'opId is required for clean-slate snapshot idempotency',
      });
    }
  });

/**
 * Vocabulary fields (`opType`, `syncImportReason`, restore-point `type`) are
 * loose strings on the RESPONSE side, mirroring `errorCode`: a client must
 * never reject a whole download page because a newer server relayed a value
 * this client does not know yet. One unknown op would otherwise wedge every
 * not-yet-updated device with a generic parse error, before the schema-version
 * "update your app" path could run (#8764). Unknown values are handled per op
 * after parsing (the receiver blocks at that op and keeps its cursor); the
 * strict enums stay on the REQUEST side, where the server validates per op.
 */
const SUPER_SYNC_MAX_VOCABULARY_TRANSPORT_LENGTH = 255;

export const SuperSyncOperationResponseSchema = SuperSyncOperationSchema.extend({
  opType: z.string().min(1).max(SUPER_SYNC_MAX_VOCABULARY_TRANSPORT_LENGTH),
  syncImportReason: z.string().max(SUPER_SYNC_MAX_VOCABULARY_TRANSPORT_LENGTH).optional(),
}).passthrough();

export const SuperSyncServerOperationSchema = z
  .object({
    serverSeq: z.number(),
    op: SuperSyncOperationResponseSchema,
    receivedAt: z.number(),
  })
  .passthrough();

export const SuperSyncUploadResultSchema = z
  .object({
    opId: z.string(),
    accepted: z.boolean(),
    serverSeq: z.number().optional(),
    error: z.string().optional(),
    errorCode: z.string().optional(),
    existingClock: SuperSyncVectorClockSchema.optional(),
  })
  .passthrough();

export const SuperSyncUploadOpsResponseSchema = z
  .object({
    results: z.array(SuperSyncUploadResultSchema),
    newOps: z.array(SuperSyncServerOperationSchema).optional(),
    latestSeq: z.number(),
    hasMorePiggyback: z.boolean().optional(),
    deduplicated: z.boolean().optional(),
  })
  .passthrough();

export const SuperSyncDownloadOpsResponseSchema = z
  .object({
    ops: z.array(SuperSyncServerOperationSchema),
    hasMore: z.boolean(),
    latestSeq: z.number(),
    gapDetected: z.boolean().optional(),
    snapshotVectorClock: SuperSyncVectorClockSchema.optional(),
    serverTime: z.number().optional(),
    // Capability flags are plain booleans: a `literal(true)` would turn a
    // server that ever reports `false` into a page-wide parse failure.
    capabilities: z
      .object({
        causalRepairSnapshots: z.boolean().optional(),
      })
      .optional(),
  })
  .passthrough();

export const SuperSyncSnapshotResponseSchema = z
  .object({
    state: z.unknown(),
    serverSeq: z.number(),
    generatedAt: z.number(),
  })
  .passthrough();

export const SuperSyncSnapshotUploadResponseSchema = z
  .object({
    accepted: z.boolean(),
    serverSeq: z.number().optional(),
    error: z.string().optional(),
    errorCode: z.string().optional(),
  })
  .passthrough();

export const SuperSyncStatusResponseSchema = z
  .object({
    latestSeq: z.number(),
    devicesOnline: z.number(),
    snapshotAge: z.number().optional(),
    storageUsedBytes: z.number(),
    storageQuotaBytes: z.number(),
  })
  .passthrough();

export const SuperSyncDeviceSchema = z
  .object({
    clientId: SuperSyncClientIdSchema,
    /** Unix ms of the device's last sync activity (upload or download). */
    lastSeenAt: z.number(),
  })
  .passthrough();

export const SuperSyncDevicesResponseSchema = z
  .object({
    devices: z.array(SuperSyncDeviceSchema),
  })
  .passthrough();

/**
 * Response of `POST /api/replace-token`: a fresh JWT for the calling client.
 * Issuing it bumps the account's `tokenVersion`, signing out every other device.
 */
// Only `token` is validated: it is the only field the client consumes, and
// requiring more would turn a benign server-side response change into a
// hard sign-out failure.
export const SuperSyncReplaceTokenResponseSchema = z
  .object({
    token: z.string().min(1),
  })
  .passthrough();

export const SuperSyncRestorePointSchema = z
  .object({
    serverSeq: z.number(),
    timestamp: z.number(),
    // Loose on purpose (see SuperSyncOperationResponseSchema); the client
    // keeps unknown types — the dialog renders them generically and restore
    // works by serverSeq.
    type: z.string().max(SUPER_SYNC_MAX_VOCABULARY_TRANSPORT_LENGTH),
    clientId: z.string(),
    description: z.string().optional(),
  })
  .passthrough();

export const SuperSyncRestorePointsResponseSchema = z
  .object({
    restorePoints: z.array(SuperSyncRestorePointSchema),
  })
  .passthrough();

export const SuperSyncRestoreSnapshotResponseSchema = SuperSyncSnapshotResponseSchema;

export const SuperSyncDeleteAllDataResponseSchema = z
  .object({
    success: z.boolean(),
  })
  .passthrough();

export type SuperSyncOpType = (typeof SUPER_SYNC_OP_TYPES)[number];
export type SuperSyncImportReason = (typeof SUPER_SYNC_IMPORT_REASONS)[number];
export type SuperSyncSnapshotReason = (typeof SUPER_SYNC_SNAPSHOT_REASONS)[number];
export type SuperSyncSnapshotOpType = (typeof SUPER_SYNC_SNAPSHOT_OP_TYPES)[number];

export type SuperSyncOperation = z.infer<typeof SuperSyncOperationSchema>;
export type SuperSyncUploadOpsRequest = z.infer<typeof SuperSyncUploadOpsRequestSchema>;
export type SuperSyncDownloadOpsQuery = z.infer<typeof SuperSyncDownloadOpsQuerySchema>;
export type SuperSyncUploadSnapshotRequest = z.infer<
  typeof SuperSyncUploadSnapshotRequestSchema
>;
export type SuperSyncServerOperation = z.infer<typeof SuperSyncServerOperationSchema>;
export type SuperSyncUploadResult = z.infer<typeof SuperSyncUploadResultSchema>;
export type SuperSyncUploadOpsResponse = z.infer<typeof SuperSyncUploadOpsResponseSchema>;
export type SuperSyncDownloadOpsResponse = z.infer<
  typeof SuperSyncDownloadOpsResponseSchema
>;
export type SuperSyncSnapshotResponse = z.infer<typeof SuperSyncSnapshotResponseSchema>;
export type SuperSyncSnapshotUploadResponse = z.infer<
  typeof SuperSyncSnapshotUploadResponseSchema
>;
export type SuperSyncStatusResponse = z.infer<typeof SuperSyncStatusResponseSchema>;
export type SuperSyncDevice = z.infer<typeof SuperSyncDeviceSchema>;
export type SuperSyncDevicesResponse = z.infer<typeof SuperSyncDevicesResponseSchema>;
export type SuperSyncReplaceTokenResponse = z.infer<
  typeof SuperSyncReplaceTokenResponseSchema
>;
export type SuperSyncRestorePoint = z.infer<typeof SuperSyncRestorePointSchema>;
export type SuperSyncRestorePointsResponse = z.infer<
  typeof SuperSyncRestorePointsResponseSchema
>;
export type SuperSyncRestoreSnapshotResponse = z.infer<
  typeof SuperSyncRestoreSnapshotResponseSchema
>;
export type SuperSyncDeleteAllDataResponse = z.infer<
  typeof SuperSyncDeleteAllDataResponseSchema
>;
