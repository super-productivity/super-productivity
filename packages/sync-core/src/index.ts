// Operation log primitives — the generic, app-agnostic core of the sync engine.
export { OpType, isMultiEntityPayload, extractActionPayload } from './operation.types';
export type {
  VectorClock,
  Operation,
  OperationLogEntry,
  EntityConflict,
  ConflictResult,
  EntityChange,
  MultiEntityPayload,
} from './operation.types';

// Vector-clock algorithms — single source of truth for client/server parity.
export {
  compareVectorClocks,
  mergeVectorClocks,
  limitVectorClockSize,
  MAX_VECTOR_CLOCK_SIZE,
} from './vector-clock';
export type { VectorClockComparison } from './vector-clock';

// Full-state import clean-slate vector-clock decisions.
export { classifyOpAgainstSyncImport } from './sync-import-filter';
export type {
  SyncImportFilterClockSource,
  SyncImportFilterDecision,
  SyncImportFilterDecisionReason,
  SyncImportFilterInvalidateReason,
  SyncImportFilterKeepReason,
} from './sync-import-filter';

// Host-configured sync file prefix helpers.
export {
  createSyncFilePrefixHelpers,
  SyncFilePrefixError,
  SyncFilePrefixVersionError,
} from './sync-file-prefix';
export type {
  SyncFilePrefixConfig,
  SyncFilePrefixHelpers,
  SyncFilePrefixInvalidPrefixDetails,
  SyncFilePrefixParams,
  SyncFilePrefixParamsOutput,
} from './sync-file-prefix';

// Gzip compression helpers.
export {
  compressWithGzip,
  compressWithGzipToString,
  decompressGzipFromString,
  sanitizeBase64,
  CompressionApiUnavailableError,
  GzipCompressError,
  GzipDecompressError,
} from './compression';
export type { GzipCompressionLogMessages, GzipCompressionOptions } from './compression';

// Encryption primitives — Argon2id KDF + AES-GCM, Web Crypto with @noble fallback.
// See packages/sync-core/src/encryption.ts for the wire-format contract and
// the structural-vs-side-channel legacy-diagnostics discussion.
export {
  encrypt,
  decrypt,
  encryptBatch,
  decryptBatch,
  encryptWithDerivedKey,
  decryptWithDerivedKey,
  decryptWithMigration,
  deriveKeyFromPassword,
  clearSessionKeyCache,
  getSessionKeyCacheStats,
  getArgon2Params,
  isCryptoSubtleAvailable,
  setArgon2ParamsForTesting,
  setLegacyKdfWarningHandler,
} from './encryption';
export type { DerivedKey, DecryptResult } from './encryption';

// Generic error helpers.
export { extractErrorMessage } from './error.util';
export { WebCryptoNotAvailableError } from './web-crypto-error';

// Full-state operation classification helper. Hosts supply their own op strings.
export {
  FULL_STATE_OP_TYPES,
  createFullStateOpTypeHelpers,
  isFullStateOpType,
} from './full-state-op-types';
export type { FullStateOpTypeHelpers } from './full-state-op-types';

// LWW (Last-Writer-Wins) update action-type helpers — factory parameterized by
// the host application's entity-type list, so the lib stays domain-agnostic.
export { createLwwUpdateActionTypeHelpers } from './lww-update-action-types';
export type { LwwUpdateActionTypeHelpers } from './lww-update-action-types';

// Apply-operation result and option types.
export type { ApplyOperationsResult, ApplyOperationsOptions } from './apply.types';

// Generic operation replay coordinator.
export { replayOperationBatch, yieldToEventLoop } from './replay-coordinator';
export type {
  OperationReplayArchiveFailureContext,
  OperationReplayCoordinatorOptions,
} from './replay-coordinator';

// Remote operation application coordinator.
export { applyRemoteOperations } from './remote-apply';
export type {
  ApplyRemoteOperationsOptions,
  RemoteApplyOperationsResult,
  RemoteOperationAppendResult,
  RemoteOperationApplyStorePort,
} from './remote-apply';

// Upload planning helpers.
export {
  planRegularOpsAfterFullStateUpload,
  planUploadLastServerSeqUpdate,
} from './upload-planning';
export type {
  PlanRegularOpsAfterFullStateUploadOptions,
  PlanUploadLastServerSeqUpdateOptions,
  RegularOpsAfterFullStateUploadPlan,
  UploadLastServerSeqUpdatePlan,
  UploadLastServerSeqUpdateReason,
} from './upload-planning';

// Download planning helpers.
export {
  planDownloadFullStateUpload,
  planDownloadGapReset,
  planDownloadedDataEncryptionState,
  planSnapshotHydration,
} from './download-planning';
export type {
  DownloadFullStateUploadPlan,
  DownloadFullStateUploadReason,
  DownloadGapResetPlan,
  PlanDownloadFullStateUploadOptions,
  PlanDownloadGapResetOptions,
  PlanDownloadedDataEncryptionStateOptions,
  PlanSnapshotHydrationOptions,
  SnapshotHydrationPlan,
  SnapshotHydrationPlanReason,
} from './download-planning';

// Port contracts for app-side orchestration adapters.
export type {
  ActionDispatchPort,
  ArchiveSideEffectPort,
  ConflictUiDialogRequest,
  ConflictUiNotification,
  ConflictUiNotificationSeverity,
  ConflictUiPort,
  DeferredLocalActionsPort,
  OperationApplyPort,
  OperationStorePort,
  RemoteApplyWindowPort,
  SyncActionLike,
  SyncConfigPort,
  SyncConfigSnapshot,
  SyncPortMeta,
} from './ports';

// Conflict-resolution helpers.
export {
  adjustForClockCorruption,
  buildEntityFrontier,
  convertLocalDeleteRemoteUpdatesToLww,
  deepEqual,
  extractEntityFromPayload,
  extractUpdateChanges,
  isIdenticalConflict,
  partitionLwwResolutions,
  planLwwConflictResolutions,
  suggestConflictResolution,
} from './conflict-resolution';
export type {
  ClockCorruptionAdjustmentOptions,
  ConflictResolutionSuggestion,
  DeepEqualOptions,
  EntityConflictLike,
  EntityFrontierContext,
  LocalDeleteRemoteUpdateConversionOptions,
  LwwConflictResolutionPlan,
  LwwConflictResolutionPlanningOptions,
  LwwConflictResolutionReason,
  LwwConflictResolutionWinner,
  LwwLocalWinOperationKind,
  LwwResolutionPartitionOptions,
  LwwResolutionPartitions,
  LwwResolvedConflict,
} from './conflict-resolution';

// Entity-registry contracts.
export {
  getEntityConfig,
  getPayloadKey,
  isAdapterEntity,
  isSingletonEntity,
  isMapEntity,
  isArrayEntity,
  isVirtualEntity,
  getAllPayloadKeys,
} from './entity-registry.types';
export type {
  EntityStoragePattern,
  BaseEntity,
  EntityDictionary,
  EntityConfig,
  EntityRegistry,
} from './entity-registry.types';

// Privacy-aware logger port.
export { NOOP_SYNC_LOGGER, toSyncLogError } from './sync-logger';
export type { SyncLogError, SyncLogMeta, SyncLogger } from './sync-logger';

// Entity key encoding helpers.
export { toEntityKey, parseEntityKey } from './entity-key.util';

// Sync state corruption error.
export { SyncStateCorruptedError } from './sync-state-corrupted.error';
