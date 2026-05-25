import {
  isFileSyncProvider as isGenericFileSyncProvider,
  type FileDownloadResponse as GenericFileDownloadResponse,
  type FileRevResponse as GenericFileRevResponse,
  type FileSnapshotOpDownloadResponse as GenericFileSnapshotOpDownloadResponse,
  type FileSyncProvider as GenericFileSyncProvider,
  type OpDownloadResponse as GenericOpDownloadResponse,
  type OpDownloadResponseBase as GenericOpDownloadResponseBase,
  type OpDownloadResponseForMode as GenericOpDownloadResponseForMode,
  type OperationSyncCapable as GenericOperationSyncCapable,
  type OperationSyncProviderMode as GenericOperationSyncProviderMode,
  type OpUploadResponse as GenericOpUploadResponse,
  type OpUploadResult as GenericOpUploadResult,
  type RestoreCapable as GenericRestoreCapable,
  type RestorePoint as GenericRestorePoint,
  type RestorePointsResponse as GenericRestorePointsResponse,
  type RestoreSnapshotResponse as GenericRestoreSnapshotResponse,
  type ServerSyncOperation as GenericServerSyncOperation,
  type SnapshotUploadResponse as GenericSnapshotUploadResponse,
  type SuperSyncOpDownloadResponse as GenericSuperSyncOpDownloadResponse,
  type SyncOperation as GenericSyncOperation,
  type SyncProviderAuthHelper as GenericSyncProviderAuthHelper,
  type SyncProviderBase as GenericSyncProviderBase,
} from '@sp/sync-providers/provider-types';
import type { SyncProviderId } from './provider.const';
import type { PrivateCfgByProviderId } from '../core/types/sync.types';

export type SyncProviderAuthHelper = GenericSyncProviderAuthHelper;

export type SyncProviderBase<PID extends SyncProviderId> = GenericSyncProviderBase<
  PID,
  PrivateCfgByProviderId<PID>
>;

export type FileSyncProvider<PID extends SyncProviderId> = GenericFileSyncProvider<
  PID,
  PrivateCfgByProviderId<PID>
>;

export const isFileSyncProvider = (
  provider: SyncProviderBase<SyncProviderId>,
): provider is FileSyncProvider<SyncProviderId> => {
  return isGenericFileSyncProvider(provider);
};

export type FileRevResponse = GenericFileRevResponse;
export type FileDownloadResponse = GenericFileDownloadResponse;
export type OperationSyncProviderMode = GenericOperationSyncProviderMode;
export type SyncOperation = GenericSyncOperation;
export type ServerSyncOperation = GenericServerSyncOperation;
export type OpUploadResult = GenericOpUploadResult;
export type OpUploadResponse = GenericOpUploadResponse;
export type OpDownloadResponseBase = GenericOpDownloadResponseBase;
export type SuperSyncOpDownloadResponse = GenericSuperSyncOpDownloadResponse;
export type FileSnapshotOpDownloadResponse = GenericFileSnapshotOpDownloadResponse;
export type OpDownloadResponse = GenericOpDownloadResponse;
export type OpDownloadResponseForMode<M extends OperationSyncProviderMode> =
  GenericOpDownloadResponseForMode<M>;

export type RestorePointType = 'SYNC_IMPORT' | 'BACKUP_IMPORT' | 'REPAIR';

export type OperationSyncCapable<
  M extends OperationSyncProviderMode = OperationSyncProviderMode,
> = GenericOperationSyncCapable<M, RestorePointType>;

export type SnapshotUploadResponse = GenericSnapshotUploadResponse;
export type RestorePoint = GenericRestorePoint<RestorePointType>;
export type RestorePointsResponse = GenericRestorePointsResponse<RestorePointType>;
export type RestoreSnapshotResponse = GenericRestoreSnapshotResponse;
export type RestoreCapable = GenericRestoreCapable<RestorePointType>;
