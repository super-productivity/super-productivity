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
  DataRepairNotPossibleError,
  BackupImportFailedError,
  WebCryptoNotAvailableError,
  RemoteFileNotFoundAPIError,
  MissingCredentialsSPError,
  AuthFailSPError,
  NoSyncProviderSetError,
  SyncAlreadyInProgressError,
  CanNotMigrateMajorDownError,
  LockPresentError,
  NoRemoteModelFile,
  PotentialCorsError,
  RevMismatchForModelError,
  SyncInvalidTimeValuesError,
} from './core/errors/sync-errors';

// Provider interface
export { SyncProviderServiceInterface } from './sync-providers/provider.interface';

// Providers
export { Dropbox } from './sync-providers/file-based/dropbox/dropbox';
export { DropboxPrivateCfg } from './sync-providers/file-based/dropbox/dropbox';

// VectorClock from core
export { VectorClock } from '../core/util/vector-clock';
