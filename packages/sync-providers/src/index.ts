export type {
  CredentialChangeHandler,
  SyncCredentialStorePort,
} from './credential-store-port';
export {
  AdditionalLogErrorBase,
  AuthFailSPError,
  EmptyRemoteBodySPError,
  extractErrorMessage,
  FileHashCreationAPIError,
  HttpNotOkAPIError,
  InvalidDataSPError,
  MissingCredentialsSPError,
  MissingRefreshTokenAPIError,
  NetworkUnavailableSPError,
  NoRevAPIError,
  PotentialCorsError,
  RemoteFileChangedUnexpectedly,
  RemoteFileNotFoundAPIError,
  TooManyRequestsAPIError,
  UploadRevToMatchMismatchAPIError,
} from './errors';
export { FILE_BASED_SYNC_CONSTANTS } from './file-based-sync-data';
export type { FileBasedSyncData, SyncFileCompactOp } from './file-based-sync-data';
export type { FileAdapter } from './file-adapter';
export { generateCodeChallenge, generateCodeVerifier, generatePKCECodes } from './pkce';
export type {
  GenerateCodeChallengeOptions,
  GenerateCodeVerifierOptions,
  GeneratePkceCodesOptions,
  PkceCrypto,
  PkceSha256,
} from './pkce';
export {
  executeNativeRequestWithRetry,
  isTransientNetworkError,
} from './http/native-http-retry';
export type {
  ExecuteNativeRequestOptions,
  NativeHttpExecutor,
  NativeHttpRequestConfig,
  NativeHttpResponse,
} from './http/native-http-retry';
export { isRetryableUploadError } from './http/retryable-upload-error';
export { errorMeta, urlPathOnly } from './log/error-meta';
export type { ProviderPlatformInfo } from './platform/provider-platform-info';
export type { WebFetchFactory } from './platform/web-fetch-factory';
export {
  Dropbox,
  PROVIDER_ID_DROPBOX,
  type DropboxCfg,
  type DropboxDeps,
  type DropboxPrivateCfg,
} from './file-based/dropbox/dropbox';
export type { DropboxFileMetadata } from './file-based/dropbox/dropbox.model';
export {
  PROVIDER_ID_NEXTCLOUD,
  PROVIDER_ID_WEBDAV,
  WebdavBaseProvider,
  type WebdavBaseDeps,
  type WebdavProviderId,
} from './file-based/webdav/webdav-base-provider';
export { Webdav, type WebdavDeps } from './file-based/webdav/webdav';
export { NextcloudProvider, type NextcloudDeps } from './file-based/webdav/nextcloud';
export type { WebdavPrivateCfg } from './file-based/webdav/webdav.model';
export type { NextcloudPrivateCfg } from './file-based/webdav/nextcloud.model';
export {
  testWebdavConnection,
  type TestWebdavConnectionDeps,
} from './file-based/webdav/test-connection';
export {
  LocalFileSyncBase,
  type LocalFileSyncBaseDeps,
} from './file-based/local-file/local-file-sync-base';
export {
  LocalFileSyncElectron,
  type LocalFileSyncElectronDeps,
} from './file-based/local-file/local-file-sync-electron';
export {
  LocalFileSyncAndroid,
  type LocalFileSyncAndroidDeps,
} from './file-based/local-file/local-file-sync-android';
export {
  PROVIDER_ID_LOCAL_FILE,
  type LocalFileSyncPrivateCfg,
} from './file-based/local-file/local-file.model';
export {
  PROVIDER_ID_SUPER_SYNC,
  SUPER_SYNC_DEFAULT_BASE_URL,
  type SuperSyncPrivateCfg,
} from './super-sync/super-sync.model';
export { SuperSyncProvider, type SuperSyncDeps } from './super-sync/super-sync';
export type { SuperSyncResponseValidators } from './super-sync/response-validators';
export type { SuperSyncStorage } from './super-sync/storage';
// `WebDavHttpAdapter` and `WebdavApi` are deliberately NOT exported.
// Their single host-app consumer goes through `testWebdavConnection`
// above. Keeping them internal preserves freedom to refactor the
// adapter / api boundary later.
export {
  isFileSyncProvider,
  type FileDownloadResponse,
  type FileRevResponse,
  type FileSnapshotOpDownloadResponse,
  type FileSyncProvider,
  type OpDownloadResponse,
  type OpDownloadResponseBase,
  type OpDownloadResponseForMode,
  type OperationSyncCapable,
  type OperationSyncProviderMode,
  type OpUploadResponse,
  type OpUploadResult,
  type ProviderId,
  type RestoreCapable,
  type RestorePoint,
  type RestorePointsResponse,
  type RestoreSnapshotResponse,
  type ServerSyncOperation,
  type SnapshotUploadResponse,
  type SuperSyncOpDownloadResponse,
  type SyncOperation,
  type SyncProviderAuthHelper,
  type SyncProviderBase,
} from './provider.types';
