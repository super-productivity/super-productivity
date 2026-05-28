// Schema version constants
export {
  CURRENT_SCHEMA_VERSION,
  MIN_SUPPORTED_SCHEMA_VERSION,
  MAX_VERSION_SKIP,
} from './schema-version';

// Types
export type {
  OperationLike,
  SchemaMigration,
  MigrationResult,
  MigratableStateCache,
} from './migration.types';

// Migration functions
export {
  migrateState,
  migrateOperation,
  migrateOperations,
  stateNeedsMigration,
  operationNeedsMigration,
  validateMigrationRegistry,
  getCurrentSchemaVersion,
} from './migrate';

// Migration registry (for inspection/debugging)
export { MIGRATIONS } from './migrations/index';

// Vector clock types and comparison (shared between client and server)
export type { VectorClock, VectorClockComparison } from './vector-clock';
export {
  compareVectorClocks,
  mergeVectorClocks,
  limitVectorClockSize,
  MAX_VECTOR_CLOCK_SIZE,
} from './vector-clock';

// Entity types (shared between client and server)
export type { EntityType } from './entity-types';
export { ENTITY_TYPES } from './entity-types';

// SuperSync HTTP contract (shared between client and server)
export {
  SUPER_SYNC_CLIENT_ID_REGEX,
  SUPER_SYNC_MAX_CLIENT_ID_LENGTH,
  SUPER_SYNC_MAX_OPS_PER_UPLOAD,
  SUPER_SYNC_MAX_ENTITY_IDS_PER_OP,
  SUPER_SYNC_OP_TYPES,
  SUPER_SYNC_IMPORT_REASONS,
  SUPER_SYNC_SNAPSHOT_REASONS,
  SUPER_SYNC_SNAPSHOT_OP_TYPES,
  SuperSyncVectorClockSchema,
  SuperSyncClientIdSchema,
  SuperSyncOperationSchema,
  SuperSyncUploadOpsRequestSchema,
  SuperSyncDownloadOpsQuerySchema,
  SuperSyncUploadSnapshotRequestSchema,
  SuperSyncOperationResponseSchema,
  SuperSyncServerOperationSchema,
  SuperSyncUploadResultSchema,
  SuperSyncUploadOpsResponseSchema,
  SuperSyncDownloadOpsResponseSchema,
  SuperSyncSnapshotResponseSchema,
  SuperSyncSnapshotUploadResponseSchema,
  SuperSyncStatusResponseSchema,
  SuperSyncRestorePointSchema,
  SuperSyncRestorePointsResponseSchema,
  SuperSyncRestoreSnapshotResponseSchema,
  SuperSyncDeleteAllDataResponseSchema,
} from './supersync-http-contract';
export type {
  SuperSyncOpType,
  SuperSyncImportReason,
  SuperSyncSnapshotReason,
  SuperSyncSnapshotOpType,
  SuperSyncOperation,
  SuperSyncUploadOpsRequest,
  SuperSyncDownloadOpsQuery,
  SuperSyncUploadSnapshotRequest,
  SuperSyncServerOperation,
  SuperSyncUploadResult,
  SuperSyncUploadOpsResponse,
  SuperSyncDownloadOpsResponse,
  SuperSyncSnapshotResponse,
  SuperSyncSnapshotUploadResponse,
  SuperSyncStatusResponse,
  SuperSyncRestorePoint,
  SuperSyncRestorePointsResponse,
  SuperSyncRestoreSnapshotResponse,
  SuperSyncDeleteAllDataResponse,
} from './supersync-http-contract';
