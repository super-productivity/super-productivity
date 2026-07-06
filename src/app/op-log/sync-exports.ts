// Barrel export for sync module - providers and related types

// Types from sync.types.ts
export {
  ValidationResult,
  EncryptAndCompressCfg,
  ModelBase,
  ModelCfg,
  ModelCfgs,
  AllModelData,
  AllSyncModels,
  SyncProviderPrivateCfgBase,
  LocalFileSyncPrivateCfg,
  SyncProviderPrivateCfg,
  PrivateCfgByProviderId,
  RevMap,
  ConflictData,
  CompleteBackup,
  CurrentProviderPrivateCfg,
} from './core/types/sync.types';

// Enums and constants from provider.const.ts
export {
  SyncProviderId,
  SyncStatus,
  ConflictReason,
  REMOTE_FILE_CONTENT_PREFIX,
  PRIVATE_CFG_PREFIX,
  toSyncProviderId,
} from './sync-providers/provider.const';

// Error classes
export {
  ImpossibleError,
  DecryptError,
  DecryptNoPasswordError,
  EncryptNoPasswordError,
  DataRepairNotPossibleError,
  BackupImportFailedError,
  WebCryptoNotAvailableError,
  RemoteFileNotFoundAPIError,
  MissingCredentialsSPError,
  NetworkUnavailableSPError,
  AuthFailSPError,
  NoSyncProviderSetError,
  SyncAlreadyInProgressError,
  LockAcquisitionTimeoutError,
  CanNotMigrateMajorDownError,
  PotentialCorsError,
} from './core/errors/sync-errors';

// Provider interfaces
export {
  SyncProviderBase,
  FileSyncProvider,
  isFileSyncProvider,
} from './sync-providers/provider.interface';

// Provider types
export type { DropboxPrivateCfg } from '@sp/sync-providers/dropbox';
export type { OneDrivePrivateCfg } from '@sp/sync-providers/onedrive';

// VectorClock from core
export { VectorClock } from '../core/util/vector-clock';
