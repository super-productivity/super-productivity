import type {
  OpUploadResponse,
  RestorePointsResponse,
  RestoreSnapshotResponse,
  SnapshotUploadResponse,
  SuperSyncOpDownloadResponse,
} from '../provider.types';

/**
 * Host-injected response validators. The package can't import
 * `@sp/shared-schema` (ESLint-banned in `packages/sync-providers/**`),
 * so SuperSync's schema validation stays app-side and is wired
 * through this port.
 *
 * Each validator takes the raw `unknown` response and returns the
 * typed shape, or throws `InvalidDataSPError` on failure. The package
 * does not catch — error identity is preserved by the app's import
 * shim of `InvalidDataSPError`.
 */
export interface SuperSyncResponseValidators {
  validateOpUpload(data: unknown): OpUploadResponse;
  validateOpDownload(data: unknown): SuperSyncOpDownloadResponse;
  validateSnapshotUpload(data: unknown): SnapshotUploadResponse;
  validateRestorePoints(data: unknown): RestorePointsResponse;
  validateRestoreSnapshot(data: unknown): RestoreSnapshotResponse;
  validateDeleteAllData(data: unknown): { success: boolean };
}
