import { CapacitorHttp } from '@capacitor/core';
import { SyncProviderId } from '../provider.const';
import {
  SyncProviderServiceInterface,
  FileRevResponse,
  FileDownloadResponse,
  OperationSyncCapable,
  SyncOperation,
  OpUploadResponse,
  OpDownloadResponse,
  SnapshotUploadResponse,
  RestoreCapable,
  RestorePoint,
  RestorePointsResponse,
  RestoreSnapshotResponse,
} from '../provider.interface';
import { SyncCredentialStore } from '../credential-store.service';
import { SuperSyncPrivateCfg } from './super-sync.model';
import {
  MissingCredentialsSPError,
  AuthFailSPError,
} from '../../core/errors/sync-errors';
import { SyncLog } from '../../../core/log';
import {
  compressWithGzip,
  compressWithGzipToString,
} from '../../encryption/compression-handler';
import { IS_ANDROID_WEB_VIEW } from '../../../util/is-android-web-view';

const LAST_SERVER_SEQ_KEY_PREFIX = 'super_sync_last_server_seq_';

/**
 * SuperSync provider - operation-based sync provider.
 *
 * This provider uses operation-based sync exclusively (no file-based sync).
 * All data is synchronized through the operations API.
 *
 * @see docs/sync/SYNC-PLAN.md for full roadmap
 */
export class SuperSyncProvider
  implements
    SyncProviderServiceInterface<SyncProviderId.SuperSync>,
    OperationSyncCapable,
    RestoreCapable
{
  readonly id = SyncProviderId.SuperSync;
  readonly isUploadForcePossible = false;
  readonly maxConcurrentRequests = 10;
  readonly supportsOperationSync = true;

  public privateCfg: SyncCredentialStore<SyncProviderId.SuperSync>;

  // Caches to reduce repeated async loads during sync operations
  private _cachedCfg?: SuperSyncPrivateCfg;
  private _cachedServerSeqKey?: string;

  constructor(_basePath?: string) {
    // basePath is ignored - SuperSync uses operation-based sync only
    this.privateCfg = new SyncCredentialStore(SyncProviderId.SuperSync);
  }

  private get logLabel(): string {
    return 'SuperSyncProvider';
  }

  // Make IS_ANDROID_WEB_VIEW testable by using a getter that can be overridden
  protected get isAndroidWebView(): boolean {
    return IS_ANDROID_WEB_VIEW;
  }

  async isReady(): Promise<boolean> {
    const cfg = await this.privateCfg.load();
    return !!(cfg && cfg.baseUrl && cfg.accessToken);
  }

  async setPrivateCfg(cfg: SuperSyncPrivateCfg): Promise<void> {
    // Invalidate caches when config changes
    this._cachedCfg = undefined;
    this._cachedServerSeqKey = undefined;
    await this.privateCfg.setComplete(cfg);
  }

  // === File Operations (Not supported - use operation sync instead) ===

  async getFileRev(
    _targetPath: string,
    _localRev: string | null,
  ): Promise<FileRevResponse> {
    throw new Error(
      'SuperSync uses operation-based sync only. File operations not supported.',
    );
  }

  async downloadFile(_targetPath: string): Promise<FileDownloadResponse> {
    throw new Error(
      'SuperSync uses operation-based sync only. File operations not supported.',
    );
  }

  async uploadFile(
    _targetPath: string,
    _dataStr: string,
    _localRev: string | null,
    _isForceOverwrite?: boolean,
  ): Promise<FileRevResponse> {
    throw new Error(
      'SuperSync uses operation-based sync only. File operations not supported.',
    );
  }

  async removeFile(_targetPath: string): Promise<void> {
    throw new Error(
      'SuperSync uses operation-based sync only. File operations not supported.',
    );
  }

  async listFiles(_dirPath: string): Promise<string[]> {
    throw new Error(
      'SuperSync uses operation-based sync only. File operations not supported.',
    );
  }

  // === Operation Sync Implementation ===

  async uploadOps(
    ops: SyncOperation[],
    clientId: string,
    lastKnownServerSeq?: number,
  ): Promise<OpUploadResponse> {
    SyncLog.debug(this.logLabel, 'uploadOps', { opsCount: ops.length, clientId });
    const cfg = await this._cfgOrError();

    // Compress the payload to reduce upload size
    const jsonPayload = JSON.stringify({
      ops,
      clientId,
      lastKnownServerSeq,
    });

    // On Android, use CapacitorHttp with base64-encoded gzip
    // (Android WebView's fetch() corrupts binary Uint8Array bodies)
    if (this.isAndroidWebView) {
      return this._fetchApiCompressedAndroid<OpUploadResponse>(
        cfg,
        '/api/sync/ops',
        jsonPayload,
      );
    }

    const compressedPayload = await compressWithGzip(jsonPayload);

    SyncLog.debug(this.logLabel, 'uploadOps compressed', {
      originalSize: jsonPayload.length,
      compressedSize: compressedPayload.length,
      ratio: ((compressedPayload.length / jsonPayload.length) * 100).toFixed(1) + '%',
    });

    const response = await this._fetchApiCompressed<OpUploadResponse>(
      cfg,
      '/api/sync/ops',
      compressedPayload,
    );

    return response;
  }

  async downloadOps(
    sinceSeq: number,
    excludeClient?: string,
    limit?: number,
  ): Promise<OpDownloadResponse> {
    SyncLog.debug(this.logLabel, 'downloadOps', { sinceSeq, excludeClient, limit });
    const cfg = await this._cfgOrError();

    const params = new URLSearchParams({ sinceSeq: String(sinceSeq) });
    if (excludeClient) {
      params.set('excludeClient', excludeClient);
    }
    if (limit !== undefined) {
      params.set('limit', String(limit));
    }

    const response = await this._fetchApi<OpDownloadResponse>(
      cfg,
      `/api/sync/ops?${params.toString()}`,
      { method: 'GET' },
    );

    return response;
  }

  async getLastServerSeq(): Promise<number> {
    const key = await this._getServerSeqKey();
    const stored = localStorage.getItem(key);
    return stored ? parseInt(stored, 10) : 0;
  }

  async setLastServerSeq(seq: number): Promise<void> {
    const key = await this._getServerSeqKey();
    localStorage.setItem(key, String(seq));
  }

  async uploadSnapshot(
    state: unknown,
    clientId: string,
    reason: 'initial' | 'recovery' | 'migration',
    vectorClock: Record<string, number>,
    schemaVersion: number,
    isPayloadEncrypted?: boolean,
  ): Promise<SnapshotUploadResponse> {
    SyncLog.debug(this.logLabel, 'uploadSnapshot', {
      clientId,
      reason,
      schemaVersion,
      isPayloadEncrypted,
    });
    const cfg = await this._cfgOrError();

    // Compress the payload to reduce upload size
    const jsonPayload = JSON.stringify({
      state,
      clientId,
      reason,
      vectorClock,
      schemaVersion,
      isPayloadEncrypted,
    });

    // On Android, use CapacitorHttp with base64-encoded gzip
    // (Android WebView's fetch() corrupts binary Uint8Array bodies)
    if (this.isAndroidWebView) {
      return this._fetchApiCompressedAndroid<SnapshotUploadResponse>(
        cfg,
        '/api/sync/snapshot',
        jsonPayload,
      );
    }

    const compressedPayload = await compressWithGzip(jsonPayload);

    // Diagnostic logging for gzip decompression issues
    // Gzip magic bytes should be 0x1f, 0x8b
    const hasValidGzipMagic =
      compressedPayload.length >= 2 &&
      compressedPayload[0] === 0x1f &&
      compressedPayload[1] === 0x8b;

    SyncLog.debug(this.logLabel, 'uploadSnapshot compressed', {
      originalSize: jsonPayload.length,
      compressedSize: compressedPayload.length,
      ratio: ((compressedPayload.length / jsonPayload.length) * 100).toFixed(1) + '%',
      hasValidGzipMagic,
      firstBytes: Array.from(compressedPayload.slice(0, 10)).map((b) => b.toString(16)),
    });

    if (!hasValidGzipMagic) {
      SyncLog.error(this.logLabel, 'uploadSnapshot: Invalid gzip magic bytes!', {
        expected: [0x1f, 0x8b],
        actual: [compressedPayload[0], compressedPayload[1]],
      });
    }

    const response = await this._fetchApiCompressed<SnapshotUploadResponse>(
      cfg,
      '/api/sync/snapshot',
      compressedPayload,
    );

    return response;
  }

  // === Restore Point Methods ===

  async getRestorePoints(limit: number = 30): Promise<RestorePoint[]> {
    SyncLog.debug(this.logLabel, 'getRestorePoints', { limit });
    const cfg = await this._cfgOrError();

    const response = await this._fetchApi<RestorePointsResponse>(
      cfg,
      `/api/sync/restore-points?limit=${limit}`,
      { method: 'GET' },
    );

    return response.restorePoints;
  }

  async getStateAtSeq(serverSeq: number): Promise<RestoreSnapshotResponse> {
    SyncLog.debug(this.logLabel, 'getStateAtSeq', { serverSeq });
    const cfg = await this._cfgOrError();

    const response = await this._fetchApi<RestoreSnapshotResponse>(
      cfg,
      `/api/sync/restore/${serverSeq}`,
      { method: 'GET' },
    );

    return response;
  }

  // === Data Management ===

  async deleteAllData(): Promise<{ success: boolean }> {
    SyncLog.debug(this.logLabel, 'deleteAllData');
    const cfg = await this._cfgOrError();

    const response = await this._fetchApi<{ success: boolean }>(cfg, '/api/sync/data', {
      method: 'DELETE',
    });

    // Reset local lastServerSeq since all server data is deleted
    const key = await this._getServerSeqKey();
    localStorage.removeItem(key);

    return response;
  }

  async getEncryptKey(): Promise<string | undefined> {
    const cfg = await this.privateCfg.load();
    return cfg?.encryptKey;
  }

  // === Private Helper Methods ===

  private async _cfgOrError(): Promise<SuperSyncPrivateCfg> {
    if (this._cachedCfg) {
      return this._cachedCfg;
    }
    const cfg = await this.privateCfg.load();
    if (!cfg) {
      throw new MissingCredentialsSPError();
    }
    this._cachedCfg = cfg;
    return cfg;
  }

  /**
   * Generates a storage key unique to this server URL to avoid conflicts
   * when switching between different accounts or servers.
   */
  private async _getServerSeqKey(): Promise<string> {
    if (this._cachedServerSeqKey) {
      return this._cachedServerSeqKey;
    }
    const cfg = await this.privateCfg.load();
    const baseUrl = cfg?.baseUrl ?? 'default';
    // Include accessToken in the hash so different users on the same server
    // get separate lastServerSeq tracking. This ensures server migration detection
    // works correctly when switching between accounts on the same server.
    const accessToken = cfg?.accessToken ?? '';
    const identifier = `${baseUrl}|${accessToken}`;
    const hash = identifier
      .split('')
      .reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0)
      .toString(16);
    this._cachedServerSeqKey = `${LAST_SERVER_SEQ_KEY_PREFIX}${hash}`;
    return this._cachedServerSeqKey;
  }

  /**
   * Check HTTP response status and throw AuthFailSPError for auth failures.
   * Clears cached config so next operation will reload from store.
   */
  private _checkHttpStatus(status: number, body?: string): void {
    if (status === 401 || status === 403) {
      // Clear cached config so next operation will reload from store
      // (allowing user to re-configure after auth failure)
      this._cachedCfg = undefined;
      this._cachedServerSeqKey = undefined;
      throw new AuthFailSPError(`Authentication failed (HTTP ${status})`, body);
    }
  }

  /**
   * Sanitizes an access token by removing non-ASCII characters.
   * This handles cases where users accidentally copy invisible characters
   * (e.g., zero-width spaces, smart quotes) along with the token.
   */
  private _sanitizeToken(token: string): string {
    return token.replace(/[^\x20-\x7E]/g, '');
  }

  private async _fetchApi<T>(
    cfg: SuperSyncPrivateCfg,
    path: string,
    options: RequestInit,
  ): Promise<T> {
    const baseUrl = cfg.baseUrl.replace(/\/$/, '');
    const url = `${baseUrl}${path}`;
    const sanitizedToken = this._sanitizeToken(cfg.accessToken);

    const headers = new Headers(options.headers as HeadersInit);
    headers.set('Content-Type', 'application/json');
    headers.set('Authorization', `Bearer ${sanitizedToken}`);

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      // Check for auth failure FIRST before throwing generic error
      this._checkHttpStatus(response.status, errorText);
      throw new Error(
        `SuperSync API error: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * Sends a gzip-compressed request body.
   * Used for large payloads like snapshot uploads.
   */
  private async _fetchApiCompressed<T>(
    cfg: SuperSyncPrivateCfg,
    path: string,
    compressedBody: Uint8Array,
  ): Promise<T> {
    const baseUrl = cfg.baseUrl.replace(/\/$/, '');
    const url = `${baseUrl}${path}`;
    const sanitizedToken = this._sanitizeToken(cfg.accessToken);

    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    headers.set('Content-Encoding', 'gzip');
    headers.set('Authorization', `Bearer ${sanitizedToken}`);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: new Blob([compressedBody as BlobPart]),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      // Check for auth failure FIRST before throwing generic error
      this._checkHttpStatus(response.status, errorText);
      throw new Error(
        `SuperSync API error: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * Sends a gzip-compressed request body from Android.
   * Android WebView's fetch() corrupts binary Uint8Array bodies, so we use
   * CapacitorHttp with base64-encoded gzip data instead.
   */
  private async _fetchApiCompressedAndroid<T>(
    cfg: SuperSyncPrivateCfg,
    path: string,
    jsonPayload: string,
  ): Promise<T> {
    const base64Gzip = await compressWithGzipToString(jsonPayload);
    const baseUrl = cfg.baseUrl.replace(/\/$/, '');
    const url = `${baseUrl}${path}`;
    const sanitizedToken = this._sanitizeToken(cfg.accessToken);

    SyncLog.debug(this.logLabel, '_fetchApiCompressedAndroid', {
      path,
      originalSize: jsonPayload.length,
      compressedBase64Size: base64Gzip.length,
    });

    const headers: Record<string, string> = {
      Authorization: `Bearer ${sanitizedToken}`,
    };
    // HTTP headers with hyphens don't match naming convention - use bracket notation
    headers['Content-Type'] = 'application/json';
    headers['Content-Encoding'] = 'gzip';
    headers['Content-Transfer-Encoding'] = 'base64';

    const response = await CapacitorHttp.request({
      url,
      method: 'POST',
      headers,
      data: base64Gzip,
    });

    if (response.status < 200 || response.status >= 300) {
      const errorData =
        typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
      // Check for auth failure FIRST before throwing generic error
      this._checkHttpStatus(response.status, errorData);
      throw new Error(`SuperSync API error: ${response.status} - ${errorData}`);
    }

    return response.data as T;
  }
}
