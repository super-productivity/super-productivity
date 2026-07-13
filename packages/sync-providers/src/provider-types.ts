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
    /**
     * Optional host snapshot captured atomically with `ops`. File-backed
     * providers embed it beside their recent-op window; API providers ignore it.
     */
    localStateSnapshot?: unknown,
  ): Promise<OpUploadResponse>;
  /**
   * @param limit Best-effort page-size hint. Cursor-based providers (SuperSync)
   * honor it and paginate; cursorless file-based providers cannot paginate (they
   * re-download the whole file each call) and ignore it, returning their whole
   * write-bounded ops buffer in a single page (`hasMore` is always `false`).
   */
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
  /**
   * Whether the host has flagged encryption as enabled, independent of whether a
   * usable key is present. Lets consumers distinguish a genuinely-fresh client
   * (encryption never configured) from one whose key is missing despite an
   * encrypted config — the dropped-credential signature.
   */
  isEncryptionEnabled?(): Promise<boolean>;
  /**
   * Whether encryption is enabled for this provider but no usable key is
   * available — the dropped-credential signature (GHSA-9544-hjjr-fg8h).
   * File-based providers encrypt inside the adapter and do not expose
   * `getEncryptKey`, so the upload path cannot infer their missing key from the
   * `isEncryptionMandatory` guard; it queries this instead and fails closed
   * (refuses to upload) rather than silently sending plaintext. Providers that
   * surface their key via `getEncryptKey` (SuperSync) leave this unset.
   */
  isEncryptionKeyMissing?(): Promise<boolean>;
  /**
   * Whether this provider mandates end-to-end encryption and must NEVER transmit
   * plaintext operations. When true, the upload path refuses to push ops while no
   * usable encryption key is configured yet (e.g. first-time setup, before the
   * user has chosen a password): the encrypted snapshot uploaded by the
   * encryption-enable flow becomes the first data to reach the server. Without
   * this guard the initial-setup sync leaks all local ops in cleartext, breaking
   * the E2EE promise even if they are later deleted (GHSA-9v8x-68pf-p5x7).
   *
   * Providers where unencrypted sync is a legitimate user choice (file-based)
   * leave this unset.
   */
  readonly isEncryptionMandatory?: boolean;
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
