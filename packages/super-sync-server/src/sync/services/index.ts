/**
 * Barrel export for extracted sync services.
 *
 * These services were extracted from the monolithic SyncService
 * for better separation of concerns and testability.
 *
 * OperationUploadService owns upload validation, conflict checks, sequence
 * reservation, and operation persistence inside the SyncService transaction.
 * SnapshotGenerationService owns snapshot replay/generation transactions while
 * SnapshotService keeps cache access and per-user generation locks.
 * StorageQuotaService owns storage accounting plus quota-driven eviction.
 * DeviceService owns device ownership, online status, and stale-device cleanup.
 */
export { ValidationService, ALLOWED_ENTITY_TYPES } from './validation.service';
export type { ValidationResult } from './validation.service';
export { RateLimitService } from './rate-limit.service';
export { RequestDeduplicationService } from './request-deduplication.service';
export type {
  RequestDedupNamespace,
  SnapshotDedupResponse,
} from './request-deduplication.service';
export { DeviceService } from './device.service';
export { OperationDownloadService } from './operation-download.service';
export { OperationUploadService } from './operation-upload.service';
export { StorageQuotaService } from './storage-quota.service';
export { SnapshotGenerationService } from './snapshot-generation.service';
export { SnapshotService } from './snapshot.service';
export type {
  CacheSnapshotResult,
  PreparedSnapshotCache,
  SnapshotResult,
  RestorePoint,
} from './snapshot.service';
