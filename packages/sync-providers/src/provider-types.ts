import type { VectorClock } from '@sp/sync-core';
import type { SyncCredentialStorePort } from './credential-store-port';

export type ProviderId = string;

export interface SyncProviderAuthHelper {
  authUrl?: string;
  codeVerifier?: string;

  verifyCodeChallenge?(codeChallenge: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  }>;
}

export interface SyncProviderBase<
  PID extends ProviderId = ProviderId,
  TPrivateCfg = unknown,
> {
  id: PID;
  isUploadForcePossible?: boolean;
  maxConcurrentRequests: number;
  privateCfg: SyncCredentialStorePort<PID, TPrivateCfg>;

  isReady(): Promise<boolean>;
  getAuthHelper?(): Promise<SyncProviderAuthHelper>;
  setPrivateCfg(privateCfg: TPrivateCfg): Promise<void>;
  /**
   * Implement ONLY when the provider's credential is a machine-refreshable
   * token (OAuth access/refresh token) that is SAFE to destroy on a 401 to
   * force a re-auth flow (Dropbox, SuperSync). Do NOT implement for
   * user-typed secrets (WebDAV/Nextcloud passwords) — clearing them is
   * irreversible data loss. Absence is a deliberate, supported no-op:
   * `ProviderManager.clearAuthCredentials` skips providers without this
   * hook. See issue #7616.
   */
  clearAuthCredentials?(): Promise<void>;
}

export interface FileRevResponse {
  rev: string;
}

export interface FileDownloadResponse extends FileRevResponse {
  dataStr: string;
}

export interface FileSyncProvider<
  PID extends ProviderId = ProviderId,
  TPrivateCfg = unknown,
> extends SyncProviderBase<PID, TPrivateCfg> {
  isLimitedToSingleFileSync?: boolean;

  getFileRev(targetPath: string, localRev: string | null): Promise<FileRevResponse>;
  downloadFile(targetPath: string): Promise<FileDownloadResponse>;
  uploadFile(
    targetPath: string,
    dataStr: string,
    revToMatch: string | null,
    isForceOverwrite?: boolean,
  ): Promise<FileRevResponse>;
  removeFile(targetPath: string): Promise<void>;
  listFiles?(targetPath: string): Promise<string[]>;
}

export const isFileSyncProvider = <
  PID extends ProviderId = ProviderId,
  TPrivateCfg = unknown,
>(
  provider: SyncProviderBase<PID, TPrivateCfg>,
): provider is FileSyncProvider<PID, TPrivateCfg> => {
  return (
    'getFileRev' in provider &&
    typeof (provider as Record<string, unknown>).getFileRev === 'function'
  );
};

export type OperationSyncProviderMode = 'superSyncOps' | 'fileSnapshotOps';

export interface SyncOperation {
  id: string;
  clientId: string;
  actionType: string;
  opType: string;
  entityType: string;
  entityId?: string;
  entityIds?: string[];
  payload: unknown;
  vectorClock: VectorClock;
  timestamp: number;
  schemaVersion: number;
  isPayloadEncrypted?: boolean;
  syncImportReason?: string;
}

export interface ServerSyncOperation {
  serverSeq: number;
  op: SyncOperation;
  receivedAt: number;
}

export interface OpUploadResult {
  opId: string;
  accepted: boolean;
  serverSeq?: number;
  error?: string;
  errorCode?: string;
  existingClock?: VectorClock;
}

export interface OpUploadResponse {
  results: OpUploadResult[];
  newOps?: ServerSyncOperation[];
  latestSeq: number;
  hasMorePiggyback?: boolean;
}

export interface OpDownloadResponseBase {
  ops: ServerSyncOperation[];
  hasMore: boolean;
  latestSeq: number;
  latestSnapshotSeq?: number;
  gapDetected?: boolean;
  snapshotVectorClock?: VectorClock;
  serverTime?: number;
}

export interface SuperSyncOpDownloadResponse extends OpDownloadResponseBase {
  snapshotState?: never;
}

export interface FileSnapshotOpDownloadResponse extends OpDownloadResponseBase {
  snapshotState?: unknown;
}

export type OpDownloadResponse =
  | SuperSyncOpDownloadResponse
  | FileSnapshotOpDownloadResponse;

export type OpDownloadResponseForMode<M extends OperationSyncProviderMode> =
  M extends 'fileSnapshotOps'
    ? FileSnapshotOpDownloadResponse
    : SuperSyncOpDownloadResponse;

export interface SnapshotUploadResponse {
  accepted: boolean;
  serverSeq?: number;
  error?: string;
}

export interface OperationSyncCapable<
  M extends OperationSyncProviderMode = OperationSyncProviderMode,
  TRestorePointType extends string = string,
> {
  supportsOperationSync: boolean;
  providerMode: M;

  uploadOps(
    ops: SyncOperation[],
    clientId: string,
    lastKnownServerSeq?: number,
  ): Promise<OpUploadResponse>;
  downloadOps(
    sinceSeq: number,
    excludeClient?: string,
    limit?: number,
  ): Promise<OpDownloadResponseForMode<M>>;
  getLastServerSeq(): Promise<number>;
  setLastServerSeq(seq: number): Promise<void>;
  uploadSnapshot(
    state: unknown,
    clientId: string,
    reason: 'initial' | 'recovery' | 'migration',
    vectorClock: VectorClock,
    schemaVersion: number,
    isPayloadEncrypted: boolean | undefined,
    opId: string,
    isCleanSlate?: boolean,
    snapshotOpType?: TRestorePointType,
    syncImportReason?: string,
  ): Promise<SnapshotUploadResponse>;
  deleteAllData(): Promise<{ success: boolean }>;
  getEncryptKey?(): Promise<string | undefined>;
}

export interface RestorePoint<TRestorePointType extends string = string> {
  serverSeq: number;
  timestamp: number;
  type: TRestorePointType;
  clientId: string;
  description?: string;
}

export interface RestorePointsResponse<TRestorePointType extends string = string> {
  restorePoints: RestorePoint<TRestorePointType>[];
}

export interface RestoreSnapshotResponse {
  state: unknown;
  serverSeq: number;
  generatedAt: number;
}

export interface RestoreCapable<TRestorePointType extends string = string> {
  getRestorePoints(limit?: number): Promise<RestorePoint<TRestorePointType>[]>;
  getStateAtSeq(serverSeq: number): Promise<RestoreSnapshotResponse>;
}
