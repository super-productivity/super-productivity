import { Capacitor } from '@capacitor/core';
import { SyncProviderId } from '../provider.const';
import {
  SyncProviderBase,
  OperationSyncCapable,
  SyncOperation,
  OpUploadResponse,
  OpDownloadResponse,
  SnapshotUploadResponse,
  RestoreCapable,
  RestorePoint,
  RestorePointType,
  RestoreSnapshotResponse,
} from '../provider.interface';
import { SyncCredentialStore } from '../credential-store.service';
import { SuperSyncPrivateCfg, SUPER_SYNC_DEFAULT_BASE_URL } from './super-sync.model';
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
import { executeNativeRequestWithRetry } from '../native-http-retry';
import { isTransientNetworkError } from '../../sync/sync-error-utils';
import {
  validateOpUploadResponse,
  validateOpDownloadResponse,
  validateSnapshotUploadResponse,
  validateRestorePointsResponse,
  validateRestoreSnapshotResponse,
  validateDeleteAllDataResponse,
} from './response-validators';

const LAST_SERVER_SEQ_KEY_PREFIX = 'super_sync_last_server_seq_';

/**
 * Timeout for individual HTTP requests to SuperSync server.
 * Set to 75s to allow server's 60s database timeout to complete,
 * plus buffer for network latency and response body reading.
 */
const SUPERSYNC_REQUEST_TIMEOUT_MS = 75000;

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
    SyncProviderBase<SyncProviderId.SuperSync>,
    OperationSyncCapable,
    RestoreCapable
{
  readonly id = SyncProviderId.SuperSync;
  readonly isUploadForcePossible = false;
  readonly maxConcurrentRequests = 10;
  readonly supportsOperationSync = true;

  public privateCfg: SyncCredentialStore<SyncProviderId.SuperSync>;
  private _cachedServerSeqKey: string | null = null;

  constructor(_basePath?: string) {
    // basePath is ignored - SuperSync uses operation-based sync only
    this.privateCfg = new SyncCredentialStore(SyncProviderId.SuperSync);
  }

  private get logLabel(): string {
    return 'SuperSyncProvider';
  }

  // Make platform check testable by using a getter that can be overridden
  protected get isNativePlatform(): boolean {
    // Combines modern Capacitor native (iOS/Android) with legacy Android WebView
    return Capacitor.isNativePlatform() || IS_ANDROID_WEB_VIEW;
  }

  async isReady(): Promise<boolean> {
    const cfg = await this.privateCfg.load();
    return !!(cfg && cfg.accessToken);
  }

  async setPrivateCfg(cfg: SuperSyncPrivateCfg): Promise<void> {
    this._cachedServerSeqKey = null;
    await this.privateCfg.setComplete(cfg);
  }

  async clearAuthCredentials(): Promise<void> {
    const cfg = await this.privateCfg.load();
    if (cfg?.accessToken) {
      await this.privateCfg.setComplete({
        ...cfg,
        accessToken: '',
        refreshToken: undefined,
        expiresAt: undefined,
      });
    }
  }

  // === Operation Sync Implementation ===

  async uploadOps(
    ops: SyncOperation[],
    clientId: string,
    lastKnownServerSeq?: number,
  ): Promise<OpUploadResponse> {
    SyncLog.debug(this.logLabel, 'uploadOps', {
      opsCount: ops.length,
      clientId,
    });
    const cfg = await this._cfgOrError();

    // Compress the payload to reduce upload size
    const jsonPayload = JSON.stringify({
      ops,
      clientId,
      lastKnownServerSeq,
    });

    // On native platforms (Android/iOS), use CapacitorHttp with base64-encoded gzip
    // (Android WebView's fetch() corrupts binary Uint8Array bodies, and iOS WebKit
    // may have similar issues with binary request bodies in Capacitor context)
    if (this.isNativePlatform) {
      const nativeResponse = await this._fetchApiCompressedNative<unknown>(
        cfg,
        '/api/sync/ops',
        jsonPayload,
      );
      return validateOpUploadResponse(nativeResponse);
    }

    const compressedPayload = await compressWithGzip(jsonPayload);

    SyncLog.debug(this.logLabel, 'uploadOps compressed', {
      originalSize: jsonPayload.length,
      compressedSize: compressedPayload.length,
      ratio: ((compressedPayload.length / jsonPayload.length) * 100).toFixed(1) + '%',
    });

    const response = await this._fetchApiCompressed<unknown>(
      cfg,
      '/api/sync/ops',
      compressedPayload,
    );

    return validateOpUploadResponse(response);
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

    const response = await this._fetchApi<unknown>(
      cfg,
      `/api/sync/ops?${params.toString()}`,
      { method: 'GET' },
    );

    return validateOpDownloadResponse(response);
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
    isPayloadEncrypted: boolean | undefined,
    opId: string,
    isCleanSlate?: boolean,
    snapshotOpType?: RestorePointType,
  ): Promise<SnapshotUploadResponse> {
    SyncLog.normal(this.logLabel, 'uploadSnapshot: Starting...', {
      clientId,
      reason,
      schemaVersion,
      isPayloadEncrypted,
      opId,
      isCleanSlate,
      snapshotOpType,
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
      opId, // CRITICAL: Server must use this ID to prevent ID mismatch bugs
      isCleanSlate,
      snapshotOpType,
    });

    // On native platforms (Android/iOS), use CapacitorHttp with base64-encoded gzip
    // (Android WebView's fetch() corrupts binary Uint8Array bodies, and iOS WebKit
    // may have similar issues with binary request bodies in Capacitor context)
    if (this.isNativePlatform) {
      const nativeResponse = await this._fetchApiCompressedNative<unknown>(
        cfg,
        '/api/sync/snapshot',
        jsonPayload,
      );
      const validated = validateSnapshotUploadResponse(nativeResponse);
      SyncLog.normal(this.logLabel, 'uploadSnapshot: Complete', {
        accepted: validated.accepted,
        serverSeq: validated.serverSeq,
        error: validated.error,
      });
      return validated;
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

    const response = await this._fetchApiCompressed<unknown>(
      cfg,
      '/api/sync/snapshot',
      compressedPayload,
    );

    const validated = validateSnapshotUploadResponse(response);
    SyncLog.normal(this.logLabel, 'uploadSnapshot: Complete', {
      accepted: validated.accepted,
      serverSeq: validated.serverSeq,
      error: validated.error,
    });

    return validated;
  }

  // === Restore Point Methods ===

  async getRestorePoints(limit: number = 30): Promise<RestorePoint[]> {
    SyncLog.debug(this.logLabel, 'getRestorePoints', { limit });
    const cfg = await this._cfgOrError();

    const response = await this._fetchApi<unknown>(
      cfg,
      `/api/sync/restore-points?limit=${limit}`,
      { method: 'GET' },
    );

    return validateRestorePointsResponse(response).restorePoints;
  }

  async getStateAtSeq(serverSeq: number): Promise<RestoreSnapshotResponse> {
    SyncLog.debug(this.logLabel, 'getStateAtSeq', { serverSeq });
    const cfg = await this._cfgOrError();

    const response = await this._fetchApi<unknown>(
      cfg,
      `/api/sync/restore/${serverSeq}`,
      { method: 'GET' },
    );

    return validateRestoreSnapshotResponse(response);
  }

  // === Data Management ===

  async deleteAllData(): Promise<{ success: boolean }> {
    SyncLog.normal(this.logLabel, 'deleteAllData: Starting DELETE request...');
    const cfg = await this._cfgOrError();

    SyncLog.normal(this.logLabel, 'deleteAllData: Calling DELETE /api/sync/data');
    const response = await this._fetchApi<unknown>(cfg, '/api/sync/data', {
      method: 'DELETE',
    });

    const validated = validateDeleteAllDataResponse(response);
    SyncLog.normal(this.logLabel, 'deleteAllData: Server response:', validated);

    // Reset local lastServerSeq since all server data is deleted
    const key = await this._getServerSeqKey();
    localStorage.removeItem(key);
    SyncLog.normal(this.logLabel, 'deleteAllData: Cleared local lastServerSeq');

    return validated;
  }

  async getEncryptKey(): Promise<string | undefined> {
    const cfg = await this.privateCfg.load();
    // Only return encryption key if encryption is explicitly enabled
    // This ensures encryption is not accidentally used when disabled
    if (cfg?.isEncryptionEnabled && cfg.encryptKey) {
      return cfg.encryptKey;
    }
    return undefined;
  }

  // === Private Helper Methods ===

  private async _cfgOrError(): Promise<SuperSyncPrivateCfg> {
    // Note: SyncCredentialStore.load() has its own in-memory caching
    const cfg = await this.privateCfg.load();
    if (!cfg) {
      throw new MissingCredentialsSPError();
    }
    return cfg;
  }

  private _resolveBaseUrl(cfg: SuperSyncPrivateCfg): string {
    return (cfg.baseUrl || SUPER_SYNC_DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  /**
   * Generates a storage key unique to this server URL to avoid conflicts
   * when switching between different accounts or servers.
   */
  private async _getServerSeqKey(): Promise<string> {
    if (this._cachedServerSeqKey) {
      return this._cachedServerSeqKey;
    }
    // Note: SyncCredentialStore.load() has its own in-memory caching
    const cfg = await this.privateCfg.load();
    const baseUrl = cfg?.baseUrl || SUPER_SYNC_DEFAULT_BASE_URL;
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
   * Extracts the server's rejection reason from the response body if available.
   */
  private _checkHttpStatus(status: number, body?: string): void {
    if (status === 401 || status === 403) {
      const reason = this._extractServerErrorReason(body);
      throw new AuthFailSPError(reason || `Authentication failed (HTTP ${status})`, body);
    }
  }

  /**
   * Extracts the "error" field from a JSON response body, if present.
   */
  private _extractServerErrorReason(body?: string): string | undefined {
    if (!body) return undefined;
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed?.error === 'string') {
        return parsed.error;
      }
    } catch {
      // Not JSON — ignore
    }
    return undefined;
  }

  /**
   * Sanitizes an access token by removing non-ASCII characters.
   * This handles cases where users accidentally copy invisible characters
   * (e.g., zero-width spaces, smart quotes) along with the token.
   */
  private _sanitizeToken(token: string): string {
    return token.replace(/[^\x20-\x7E]/g, '');
  }

  /**
   * Extracts a user-friendly error message from various error types.
   */
  private _getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'object' && error !== null && 'message' in error) {
      return String((error as { message: unknown }).message);
    }
    return String(error);
  }

  /**
   * Handles errors from native CapacitorHttp requests.
   * Logs the error and transforms network errors into user-friendly messages.
   */
  private _handleNativeRequestError(
    error: unknown,
    path: string,
    startTime: number,
  ): never {
    const duration = Date.now() - startTime;
    const errorMessage = this._getErrorMessage(error);
    const networkError = isTransientNetworkError(
      error instanceof Error ? error : errorMessage,
    );

    SyncLog.error(this.logLabel, `SuperSync request failed (native)`, {
      path,
      durationMs: duration,
      error: errorMessage,
      isNetworkError: networkError,
    });

    if (networkError) {
      throw new Error(
        `Unable to connect to SuperSync server. Check your internet connection. (${errorMessage})`,
      );
    }
    throw error;
  }

  private async _fetchApi<T>(
    cfg: SuperSyncPrivateCfg,
    path: string,
    options: RequestInit,
  ): Promise<T> {
    const baseUrl = this._resolveBaseUrl(cfg);
    const url = `${baseUrl}${path}`;
    const sanitizedToken = this._sanitizeToken(cfg.accessToken);

    // On native platforms (Android/iOS), use CapacitorHttp for consistent behavior
    if (this.isNativePlatform) {
      return this._doNativeFetch<T>(cfg, path, options.method || 'GET');
    }

    const headers = new Headers(options.headers as HeadersInit);
    headers.set('Content-Type', 'application/json');
    headers.set('Authorization', `Bearer ${sanitizedToken}`);

    return this._doWebFetch<T>(url, path, headers, { method: options.method || 'GET' });
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
    const baseUrl = this._resolveBaseUrl(cfg);
    const url = `${baseUrl}${path}`;
    const sanitizedToken = this._sanitizeToken(cfg.accessToken);

    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    headers.set('Content-Encoding', 'gzip');
    headers.set('Authorization', `Bearer ${sanitizedToken}`);

    return this._doWebFetch<T>(url, path, headers, {
      method: 'POST',
      body: new Blob([compressedBody as BlobPart]),
    });
  }

  /**
   * Sends a gzip-compressed request body from native platforms (Android/iOS)
   * with retry logic for transient network errors.
   * Android WebView's fetch() corrupts binary Uint8Array bodies, and iOS WebKit
   * may have similar issues in Capacitor context. We use CapacitorHttp with
   * base64-encoded gzip data instead.
   */
  private async _fetchApiCompressedNative<T>(
    cfg: SuperSyncPrivateCfg,
    path: string,
    jsonPayload: string,
  ): Promise<T> {
    const base64Gzip = await compressWithGzipToString(jsonPayload);

    SyncLog.debug(this.logLabel, '_fetchApiCompressedNative', {
      path,
      originalSize: jsonPayload.length,
      compressedBase64Size: base64Gzip.length,
    });

    const extraHeaders: Record<string, string> = {};
    extraHeaders['Content-Encoding'] = 'gzip';
    extraHeaders['Content-Transfer-Encoding'] = 'base64';

    return this._doNativeFetch<T>(cfg, path, 'POST', {
      data: base64Gzip,
      extraHeaders,
    });
  }

  // === Shared HTTP helpers ===

  /**
   * Shared web fetch with AbortController timeout, error handling,
   * and slow-request logging.
   */
  private async _doWebFetch<T>(
    url: string,
    path: string,
    headers: Headers,
    options: { method: string; body?: BodyInit },
  ): Promise<T> {
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SUPERSYNC_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        clearTimeout(timeoutId);
        const errorText = await response.text().catch(() => 'Unknown error');
        // Check for auth failure FIRST before throwing generic error
        this._checkHttpStatus(response.status, errorText);
        throw new Error(
          `SuperSync API error: ${response.status} ${response.statusText} - ${errorText}`,
        );
      }

      // CRITICAL: Read response body BEFORE clearing timeout
      // The timeout must cover the entire response cycle including JSON parsing
      const data = (await response.json()) as T;
      clearTimeout(timeoutId);

      // Log slow requests
      const duration = Date.now() - startTime;
      if (duration > 30000) {
        SyncLog.warn(this.logLabel, `Slow SuperSync request detected`, {
          path,
          durationMs: duration,
          durationSec: (duration / 1000).toFixed(1),
        });
      }

      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;

      if (error instanceof Error && error.name === 'AbortError') {
        SyncLog.error(this.logLabel, `SuperSync request timeout`, {
          path,
          durationMs: duration,
          timeoutMs: SUPERSYNC_REQUEST_TIMEOUT_MS,
        });
        throw new Error(
          `SuperSync request timeout after ${SUPERSYNC_REQUEST_TIMEOUT_MS / 1000}s: ${path}`,
        );
      }

      SyncLog.error(this.logLabel, `SuperSync request failed`, {
        path,
        durationMs: duration,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Shared native fetch using CapacitorHttp with retry logic,
   * error handling, and slow-request logging.
   */
  private async _doNativeFetch<T>(
    cfg: SuperSyncPrivateCfg,
    path: string,
    method: string,
    requestData?: { data: string; extraHeaders?: Record<string, string> },
  ): Promise<T> {
    const startTime = Date.now();
    const baseUrl = this._resolveBaseUrl(cfg);
    const url = `${baseUrl}${path}`;
    const sanitizedToken = this._sanitizeToken(cfg.accessToken);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${sanitizedToken}`,
      ...requestData?.extraHeaders,
    };
    headers['Content-Type'] = 'application/json';

    try {
      const response = await executeNativeRequestWithRetry(
        {
          url,
          method,
          headers,
          data: requestData?.data,
          connectTimeout: 10000,
          readTimeout: SUPERSYNC_REQUEST_TIMEOUT_MS,
        },
        this.logLabel,
      );

      if (response.status < 200 || response.status >= 300) {
        const errorData =
          typeof response.data === 'string'
            ? response.data
            : JSON.stringify(response.data);
        // Check for auth failure FIRST before throwing generic error
        this._checkHttpStatus(response.status, errorData);
        throw new Error(`SuperSync API error: ${response.status} - ${errorData}`);
      }

      // Log slow requests
      const duration = Date.now() - startTime;
      if (duration > 30000) {
        SyncLog.warn(this.logLabel, `Slow SuperSync request detected (native)`, {
          path,
          durationMs: duration,
          durationSec: (duration / 1000).toFixed(1),
        });
      }

      return response.data as T;
    } catch (error) {
      this._handleNativeRequestError(error, path, startTime);
    }
  }
}
