import { z } from 'zod';

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
  schemaVersion: z.number(),
  isPayloadEncrypted: z.boolean().optional(),
  syncImportReason: z.enum(SUPER_SYNC_IMPORT_REASONS).optional(),
});

export const SuperSyncUploadOpsRequestSchema = z.object({
  ops: z.array(SuperSyncOperationSchema).min(1).max(SUPER_SYNC_MAX_OPS_PER_UPLOAD),
  clientId: SuperSyncClientIdSchema,
  lastKnownServerSeq: z.number().optional(),
  requestId: SuperSyncRequestIdSchema.optional(),
  isCleanSlate: z.boolean().optional(),
});

export const SuperSyncDownloadOpsQuerySchema = z.object({
  sinceSeq: z.coerce.number().int().min(0),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  excludeClient: SuperSyncClientIdSchema.optional(),
});

export const SuperSyncUploadSnapshotRequestSchema = z.object({
  state: z.unknown(),
  clientId: SuperSyncClientIdSchema,
  reason: z.enum(SUPER_SYNC_SNAPSHOT_REASONS),
  vectorClock: SuperSyncVectorClockSchema,
  schemaVersion: z.number().optional(),
  isPayloadEncrypted: z.boolean().optional(),
  syncImportReason: z.enum(SUPER_SYNC_IMPORT_REASONS).optional(),
  opId: z.string().uuid().optional(),
  isCleanSlate: z.boolean().optional(),
  snapshotOpType: z.enum(SUPER_SYNC_SNAPSHOT_OP_TYPES).optional(),
  requestId: SuperSyncRequestIdSchema.optional(),
});

export const SuperSyncOperationResponseSchema = SuperSyncOperationSchema.passthrough();

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
  })
  .passthrough();

export const SuperSyncDownloadOpsResponseSchema = z
  .object({
    ops: z.array(SuperSyncServerOperationSchema),
    hasMore: z.boolean(),
    latestSeq: z.number(),
    gapDetected: z.boolean().optional(),
    latestSnapshotSeq: z.number().optional(),
    snapshotVectorClock: SuperSyncVectorClockSchema.optional(),
    serverTime: z.number().optional(),
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

export const SuperSyncRestorePointSchema = z
  .object({
    serverSeq: z.number(),
    timestamp: z.number(),
    type: z.enum(SUPER_SYNC_SNAPSHOT_OP_TYPES),
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
