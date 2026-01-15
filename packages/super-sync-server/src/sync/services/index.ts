/**
 * Barrel export for extracted sync services.
 *
 * These services were extracted from the monolithic SyncService
 * for better separation of concerns and testability.
 */
export { ValidationService, ALLOWED_ENTITY_TYPES } from './validation.service';
export type { ValidationResult } from './validation.service';
export { RateLimitService } from './rate-limit.service';
export { RequestDeduplicationService } from './request-deduplication.service';
export { DeviceService } from './device.service';
export { OperationDownloadService } from './operation-download.service';
export { StorageQuotaService } from './storage-quota.service';
export { SnapshotService } from './snapshot.service';
export type { SnapshotResult, RestorePoint } from './snapshot.service';
