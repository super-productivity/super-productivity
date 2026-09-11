import {
  compressWithGzip,
  compressWithGzipToString,
  toSyncLogError,
} from '@sp/sync-core';
import type { SyncLogger } from '@sp/sync-core';
import type { SyncCredentialStorePort } from '../credential-store-port';
import {
  AuthFailSPError,
  MissingCredentialsSPError,
  NetworkUnavailableSPError,
} from '../errors';
import {
  executeNativeRequestWithRetry,
  type NativeHttpExecutor,
} from '../http/native-http-retry';
import { isRetryableUploadError } from '../http/retryable-upload-error';
import type { ProviderPlatformInfo } from '../platform/provider-platform-info';
import type { WebFetchFactory } from '../platform/web-fetch-factory';
import type {
  OpUploadResponse,
  OperationSyncCapable,
  RestoreCapable,
  RestorePoint,
  RestoreSnapshotResponse,
  SnapshotUploadResponse,
  SuperSyncOpDownloadResponse,
  SyncOperation,
  SyncProviderBase,
} from '../provider-types';
import { createOpsUploadRequestId, createSnapshotUploadRequestId } from './request-id';
import type { SuperSyncResponseValidators } from './response-validators';
import type { SuperSyncStorage } from './storage';
import {
  PROVIDER_ID_SUPER_SYNC,
  type SuperSyncDeviceListResponse,
  type SuperSyncPrivateCfg,
  type SuperSyncWebSocketAccess,
} from './super-sync.model';

const LAST_SERVER_SEQ_KEY_PREFIX = 'super_sync_last_server_seq_';

/** 75s allows the server's 60s database timeout plus network/parse buffer. */
const SUPERSYNC_REQUEST_TIMEOUT_MS = 75000;

/** Browser/Electron transient fetch failures get the same retry budget as native. */
const SUPERSYNC_WEB_MAX_RETRIES = 2;

/** Max chars of server `error` field threaded into thrown `Error.message`. */
const SERVER_ERROR_REASON_MAX_CHARS = 80;

/**
 * Internal tag for non-2xx HTTP errors thrown by this provider, so
 * `_handleNativeRequestError` can distinguish "errors we just
 * constructed (already scrubbed)" from foreign native-stack errors
 * that may embed hostname/URL in `.message`. Not exported — the only
 * consumer is the catch block in `_doNativeFetch`.
 */
class SuperSyncHttpStatusError extends Error {
  override readonly name = 'SuperSyncHttpStatusError';

  constructor(
    message: string,
    readonly status: number,
    /** Structured server `errorCode` (see SUPER_SYNC_ERROR_CODES), when the
     * non-2xx body carried one. */
    readonly code?: string,
  ) {
    super(message);
  }
}

type ParsedServerErrorDetails = {
  reason?: string;
  errorCode?: string;
};

const defaultDelay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface SuperSyncDeps {
  logger: SyncLogger;
  platformInfo: ProviderPlatformInfo;
  webFetch: WebFetchFactory;
  nativeHttpExecutor: NativeHttpExecutor;
  credentialStore: SyncCredentialStorePort<
    typeof PROVIDER_ID_SUPER_SYNC,
    SuperSyncPrivateCfg
  >;
  storage: SuperSyncStorage;
  responseValidators: SuperSyncResponseValidators;
  /**
   * Host-supplied fallback used whenever `SuperSyncPrivateCfg.baseUrl`
   * is empty/undefined. The package deliberately has no implicit
   * default — keeping the SP-specific URL out of the package keeps it
   * framework-agnostic. Hosts pointing at the SP-hosted server can pass
   * `SUPER_SYNC_DEFAULT_BASE_URL`; others pass their own URL.
   */
  defaultBaseUrl: string;
  /**
   * Optional override for tests to avoid real web-request retry waits.
   */
  webRequestRetryDelay?: (ms: number) => Promise<void>;
}

/**
 * SuperSync provider — operation-based sync.
 *
 * All data is synchronized through the operations API; no file-based
 * sync. Native platforms (Android WebView, iOS Capacitor) route HTTP
 * via `nativeHttpExecutor` to dodge binary-body / WebKit response
 * bugs.
 *
 * @invariant `getEncryptKey` callers MUST NOT log the return value.
 * @invariant `getWebSocketParams` is the only method that exposes the
 *   access token to callers — callers MUST NOT log the return value.
 * @invariant `_cachedServerSeqKey` is reset to `null` whenever
 *   `setPrivateCfg` is called, ensuring per-user/per-server seq
 *   isolation.
 * @invariant `deleteAllData` logs only the `validated` response shape,
 *   which must remain primitives-only.
 */
export class SuperSyncProvider
  implements
    SyncProviderBase<typeof PROVIDER_ID_SUPER_SYNC, SuperSyncPrivateCfg>,
    OperationSyncCapable<'superSyncOps'>,
    RestoreCapable,
    SuperSyncWebSocketAccess
{
  readonly id = PROVIDER_ID_SUPER_SYNC;
  readonly isUploadForcePossible = false;
  readonly maxConcurrentRequests = 10;
  readonly supportsOperationSync = true;
  readonly providerMode = 'superSyncOps' as const;
  // SuperSync is E2EE-mandatory: the upload path must never push plaintext ops.
  // See `isEncryptionMandatory` on OperationSyncCapable (GHSA-9v8x-68pf-p5x7).
  readonly isEncryptionMandatory = true;

  public privateCfg: SyncCredentialStorePort<
    typeof PROVIDER_ID_SUPER_SYNC,
    SuperSyncPrivateCfg
  >;

  private _cachedServerSeqKey: string | null = null;
  private _causalRepairSnapshotsSupported = false;

  constructor(private readonly _deps: SuperSyncDeps) {
    this.privateCfg = _deps.credentialStore;
  }

  private get _logLabel(): string {
    return 'SuperSyncProvider';
  }

  protected get isNativePlatform(): boolean {
    return (
      this._deps.platformInfo.isNativePlatform || this._deps.platformInfo.isAndroidWebView
    );
  }

  async isReady(): Promise<boolean> {
    const cfg = await this.privateCfg.load();
    if (!cfg || !cfg.accessToken) {
      return false;
    }
    // A self-inconsistent encrypted config — encryption flagged on but no key — is
    // NOT ready. Auto-syncing in this state downloads ops we cannot decrypt and could
    // push unencrypted ops into an encrypted dataset. This is the dropped-credential
    // signature documented in SyncCredentialStore.load(); staying not-ready keeps the
    // client out of destructive auto-recovery until the password is re-entered.
    if (this._isEncryptionHalfConfigured(cfg)) {
      return false;
    }
    return true;
  }

  /**
   * Whether the host has flagged encryption as enabled for this provider,
   * regardless of whether a usable key is present. Used by the op-log download
   * service to keep the "encrypted ops, no key" log loud (it is the
   * dropped-credential signature) even for a client whose local op store was
   * wiped — distinct from a genuinely-fresh client that never had encryption.
   */
  async isEncryptionEnabled(): Promise<boolean> {
    const cfg = await this.privateCfg.load();
    return !!cfg?.isEncryptionEnabled;
  }

  /**
   * A "half-configured" encrypted config: encryption is flagged on but no key is
   * present. The client can neither decrypt remote ops nor safely encrypt its own
   * uploads in this state. Shared by `isReady()` (gate auto-sync) and
   * `getEncryptKey()` (no usable key).
   */
  private _isEncryptionHalfConfigured(cfg: SuperSyncPrivateCfg): boolean {
    return !!cfg.isEncryptionEnabled && !cfg.encryptKey;
  }

  async setPrivateCfg(cfg: SuperSyncPrivateCfg): Promise<void> {
    this._cachedServerSeqKey = null;
    this._causalRepairSnapshotsSupported = false;
    await this.privateCfg.setComplete(cfg);
  }

  /**
   * Drops every cache derived from the stored credentials so the next read
   * hits the persistent store. Needed when another browser tab may have
   * rotated the token on the shared store (sign out other devices): this
   * tab's cached cfg would keep serving the revoked token — striking out
   * the auth-failure tolerance and wiping the fresh token — and its cached
   * seq key would read the wrong cursor slot for the new token.
   */
  invalidateCredentialCache(): void {
    this._cachedServerSeqKey = null;
    this.privateCfg.invalidateInMemoryCache?.();
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
    this._deps.logger.debug(`${this._logLabel}: uploadOps`, {
      opsCount: ops.length,
      clientId,
    });
    const cfg = await this._cfgOrError();

    const jsonPayload = JSON.stringify({
      ops,
      clientId,
      lastKnownServerSeq,
      requestId: createOpsUploadRequestId(ops, clientId),
    });

    if (this.isNativePlatform) {
      const nativeResponse = await this._fetchApiCompressedNative<unknown>(
        cfg,
        '/api/sync/ops',
        jsonPayload,
      );
      return this._deps.responseValidators.validateOpUpload(nativeResponse);
    }

    const compressedPayload = await compressWithGzip(jsonPayload, {
      logger: this._deps.logger,
    });

    this._deps.logger.debug(`${this._logLabel}: uploadOps compressed`, {
      originalSize: jsonPayload.length,
      compressedSize: compressedPayload.length,
      ratio: ((compressedPayload.length / jsonPayload.length) * 100).toFixed(1) + '%',
    });

    const response = await this._fetchApiCompressed<unknown>(
      cfg,
      '/api/sync/ops',
      compressedPayload,
    );

    return this._deps.responseValidators.validateOpUpload(response);
  }

  async downloadOps(
    sinceSeq: number,
    excludeClient?: string,
    limit?: number,
  ): Promise<SuperSyncOpDownloadResponse> {
    this._deps.logger.debug(`${this._logLabel}: downloadOps`, {
      sinceSeq,
      excludeClient,
      limit,
    });
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

    const validated = this._deps.responseValidators.validateOpDownload(response);
    this._causalRepairSnapshotsSupported =
      validated.capabilities?.causalRepairSnapshots === true;
    return validated;
  }

  supportsCausalRepairSnapshots(): boolean {
    return this._causalRepairSnapshotsSupported;
  }

  async getLastServerSeq(): Promise<number> {
    const key = await this._getServerSeqKey();
    const stored = this._deps.storage.getLastServerSeq(key);
    return stored ?? 0;
  }

  async setLastServerSeq(seq: number): Promise<void> {
    const key = await this._getServerSeqKey();
    this._deps.storage.setLastServerSeq(key, seq);
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
    snapshotOpType?: string,
    syncImportReason?: string,
    repairBaseServerSeq?: number,
  ): Promise<SnapshotUploadResponse> {
    this._deps.logger.normal(`${this._logLabel}: uploadSnapshot: Starting...`, {
      clientId,
      reason,
      schemaVersion,
      isPayloadEncrypted,
      opId,
      isCleanSlate,
      snapshotOpType,
      repairBaseServerSeq,
    });
    const cfg = await this._cfgOrError();

    const requestId = createSnapshotUploadRequestId(clientId, opId);
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
      ...(syncImportReason ? { syncImportReason } : {}),
      ...(repairBaseServerSeq !== undefined ? { repairBaseServerSeq } : {}),
      requestId,
    });

    if (this.isNativePlatform) {
      const nativeResponse = await this._fetchApiCompressedNative<unknown>(
        cfg,
        '/api/sync/snapshot',
        jsonPayload,
      );
      const validated =
        this._deps.responseValidators.validateSnapshotUpload(nativeResponse);
      this._deps.logger.normal(`${this._logLabel}: uploadSnapshot: Complete`, {
        accepted: validated.accepted,
        serverSeq: validated.serverSeq,
        error: validated.error,
      });
      return validated;
    }

    const compressedPayload = await compressWithGzip(jsonPayload, {
      logger: this._deps.logger,
    });

    // Diagnostic: gzip magic bytes must be 0x1f, 0x8b. The first 10
    // bytes are the invariant gzip header (no user content). This
    // diagnostic boundary is pinned — do NOT widen to log payload
    // content.
    const hasValidGzipMagic =
      compressedPayload.length >= 2 &&
      compressedPayload[0] === 0x1f &&
      compressedPayload[1] === 0x8b;

    this._deps.logger.debug(`${this._logLabel}: uploadSnapshot compressed`, {
      originalSize: jsonPayload.length,
      compressedSize: compressedPayload.length,
      ratio: ((compressedPayload.length / jsonPayload.length) * 100).toFixed(1) + '%',
      hasValidGzipMagic,
    });

    if (!hasValidGzipMagic) {
      this._deps.logger.error(
        `${this._logLabel}: uploadSnapshot: Invalid gzip magic bytes`,
        undefined,
        {
          expectedByte0: 0x1f,
          expectedByte1: 0x8b,
          actualByte0: compressedPayload[0],
          actualByte1: compressedPayload[1],
        },
      );
    }

    const response = await this._fetchApiCompressed<unknown>(
      cfg,
      '/api/sync/snapshot',
      compressedPayload,
    );

    const validated = this._deps.responseValidators.validateSnapshotUpload(response);
    this._deps.logger.normal(`${this._logLabel}: uploadSnapshot: Complete`, {
      accepted: validated.accepted,
      serverSeq: validated.serverSeq,
      error: validated.error,
    });

    return validated;
  }

  // === Restore Point Methods ===

  async getRestorePoints(limit: number = 30): Promise<RestorePoint[]> {
    this._deps.logger.debug(`${this._logLabel}: getRestorePoints`, { limit });
    const cfg = await this._cfgOrError();

    const response = await this._fetchApi<unknown>(
      cfg,
      `/api/sync/restore-points?limit=${limit}`,
      { method: 'GET' },
    );

    return this._deps.responseValidators.validateRestorePoints(response).restorePoints;
  }

  async getStateAtSeq(serverSeq: number): Promise<RestoreSnapshotResponse> {
    this._deps.logger.debug(`${this._logLabel}: getStateAtSeq`, { serverSeq });
    const cfg = await this._cfgOrError();

    const response = await this._fetchApi<unknown>(
      cfg,
      `/api/sync/restore/${serverSeq}`,
      { method: 'GET' },
    );

    return this._deps.responseValidators.validateRestoreSnapshot(response);
  }

  // === Devices ===

  /** Lists the devices syncing this account, newest activity first. */
  async getDevices(): Promise<SuperSyncDeviceListResponse> {
    this._deps.logger.debug(`${this._logLabel}: getDevices`);
    const cfg = await this._cfgOrError();

    const response = await this._fetchApi<unknown>(cfg, '/api/sync/devices', {
      method: 'GET',
    });

    return this._deps.responseValidators.validateDevices(response);
  }

  /**
   * Signs every other device out of the account. Server-side this is
   * `POST /api/replace-token`: the account's `tokenVersion` is bumped —
   * invalidating all existing tokens, including legacy ones without a
   * version claim — and a fresh token is returned for this client, which
   * replaces the stored one so the calling device stays signed in.
   *
   * The `lastServerSeq` cursor is keyed on the access token (see
   * `_getServerSeqKey`), so it is carried over to the new token's key —
   * same server, same account, same op stream; without this the swap would
   * force a full re-download from seq 0.
   *
   * The server also closes this device's own WebSocket (the revocation
   * closes every socket of the account — a socket's clientId is
   * self-declared and unauthenticated, so sparing "the caller's" socket by
   * id would let a stolen-token client exempt itself by claiming this id).
   * The next sync cycle reconnects with the fresh token.
   */
  async signOutAllOtherDevices(): Promise<void> {
    this._deps.logger.normal(`${this._logLabel}: signOutAllOtherDevices`);
    const cfg = await this._cfgOrError();
    // Read the cursor (and its key, for cleanup) before the POST: once the
    // server bumps `tokenVersion` the old token is dead, so nothing after
    // that point should depend on more local steps than strictly needed.
    const lastServerSeq = await this.getLastServerSeq();
    const oldSeqKey = await this._getServerSeqKey();

    // An explicit JSON body is required: Fastify rejects a body-less POST
    // carrying `Content-Type: application/json` (FST_ERR_CTP_EMPTY_JSON_BODY).
    // noRetry: the endpoint is NOT idempotent. If the bump lands but the
    // response is lost, a retry re-POSTs with the already-revoked token and
    // deterministically 401s — worse than surfacing the original failure.
    const response = await this._fetchApi<unknown>(cfg, '/api/replace-token', {
      method: 'POST',
      body: '{}',
      noRetry: true,
    });
    const { token } = this._deps.responseValidators.validateReplaceToken(response);

    // Cursor first, token second: a hard crash between the two writes then
    // leaves at worst an orphaned storage entry — never a persisted token
    // without a cursor under its key (which would silently re-download the
    // full op stream from seq 0 on the next sync).
    const newSeqKey = this._computeServerSeqKey(cfg.baseUrl, token);
    this._deps.storage.setLastServerSeq(newSeqKey, lastServerSeq);
    await this.setPrivateCfg({ ...cfg, accessToken: token });
    // Guard: if the keys coincide (unchanged token, hash collision) the
    // removal would delete the cursor just written above.
    if (oldSeqKey !== newSeqKey) {
      this._deps.storage.removeLastServerSeq(oldSeqKey);
    }
  }

  // === WebSocket Parameters ===

  /**
   * Returns the base URL and sanitized access token for WebSocket connection.
   * Returns `null` if provider is not configured.
   *
   * @invariant This is the ONLY method that exposes the access token
   *   to callers. Callers MUST NOT log the return value.
   */
  async getWebSocketParams(): Promise<{
    baseUrl: string;
    accessToken: string;
  } | null> {
    const cfg = await this.privateCfg.load();
    if (!cfg?.accessToken) {
      return null;
    }
    return {
      baseUrl: this._resolveBaseUrl(cfg),
      accessToken: this._sanitizeToken(cfg.accessToken),
    };
  }

  // === Data Management ===

  async deleteAllData(): Promise<{ success: boolean }> {
    this._deps.logger.normal(
      `${this._logLabel}: deleteAllData: Starting DELETE request...`,
    );
    const cfg = await this._cfgOrError();

    this._deps.logger.normal(
      `${this._logLabel}: deleteAllData: Calling DELETE /api/sync/data`,
    );
    const response = await this._fetchApi<unknown>(cfg, '/api/sync/data', {
      method: 'DELETE',
    });

    // The validator must return a primitives-only shape (see class
    // JSDoc). If the protocol ever adds a non-primitive field, this
    // log line must be rewritten to log explicit fields.
    const validated = this._deps.responseValidators.validateDeleteAllData(response);
    this._deps.logger.normal(`${this._logLabel}: deleteAllData: Server response`, {
      success: validated.success,
    });

    const key = await this._getServerSeqKey();
    this._deps.storage.removeLastServerSeq(key);
    this._deps.logger.normal(
      `${this._logLabel}: deleteAllData: Cleared local lastServerSeq`,
    );

    return validated;
  }

  /**
   * Returns the host-configured encryption key, or `undefined` if
   * encryption is disabled.
   *
   * @invariant Callers MUST NOT log the return value. Pass to the
   *   encryption pipeline only.
   */
  async getEncryptKey(): Promise<string | undefined> {
    const cfg = await this.privateCfg.load();
    // No usable key when encryption is off, or half-configured (flagged on, key missing).
    if (!cfg?.isEncryptionEnabled || this._isEncryptionHalfConfigured(cfg)) {
      return undefined;
    }
    return cfg.encryptKey;
  }

  // === Private Helper Methods ===

  private async _cfgOrError(): Promise<SuperSyncPrivateCfg> {
    const cfg = await this.privateCfg.load();
    if (!cfg) {
      throw new MissingCredentialsSPError();
    }
    return cfg;
  }

  private _resolveBaseUrl(cfg: SuperSyncPrivateCfg): string {
    return (cfg.baseUrl || this._deps.defaultBaseUrl).replace(/\/$/, '');
  }

  /**
   * Generates a storage key unique to this server URL + access token
   * so different users on the same server get separate `lastServerSeq`
   * tracking. The cached value is invalidated in `setPrivateCfg`
   * (see class invariant).
   */
  private async _getServerSeqKey(): Promise<string> {
    if (this._cachedServerSeqKey) {
      return this._cachedServerSeqKey;
    }
    const cfg = await this.privateCfg.load();
    this._cachedServerSeqKey = this._computeServerSeqKey(
      cfg?.baseUrl,
      cfg?.accessToken ?? '',
    );
    return this._cachedServerSeqKey;
  }

  /**
   * Pure key derivation, split from `_getServerSeqKey` so a token swap can
   * compute the NEW token's key before persisting the token (crash-safety
   * ordering in `signOutAllOtherDevices`).
   */
  private _computeServerSeqKey(baseUrl: string | undefined, accessToken: string): string {
    const identifier = `${baseUrl || this._deps.defaultBaseUrl}|${accessToken}`;
    const hash = identifier
      .split('')
      .reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0)
      .toString(16);
    return `${LAST_SERVER_SEQ_KEY_PREFIX}${hash}`;
  }

  /**
   * Throws `AuthFailSPError` for 401/403. Body is NOT retained on the
   * error (would land in `AdditionalLogErrorBase.additionalLog` and
   * leak user content from a malformed response).
   */
  private _checkHttpStatus(status: number, body?: string): void {
    if (status === 401 || status === 403) {
      const { reason } = this._extractServerErrorDetails(body, status);
      throw new AuthFailSPError(reason || `Authentication failed (HTTP ${status})`);
    }
  }

  /**
   * Extracts a short server-controlled reason string from a JSON
   * error response body. The SuperSync server's contract for the
   * `error` field is a fixed-vocabulary slug (e.g. `invalid_token`,
   * `expired`); we cap at `SERVER_ERROR_REASON_MAX_CHARS` to defend
   * against future contract drift that might embed user content.
   */
  private _extractServerErrorDetails(
    body?: string,
    status?: number,
  ): ParsedServerErrorDetails {
    if (!body) return {};
    try {
      const parsed = JSON.parse(body) as unknown;
      if (typeof parsed === 'object' && parsed !== null) {
        const errorReason =
          'error' in parsed && typeof (parsed as { error: unknown }).error === 'string'
            ? (parsed as { error: string }).error.slice(0, SERVER_ERROR_REASON_MAX_CHARS)
            : undefined;
        const errorCode =
          'errorCode' in parsed &&
          typeof (parsed as { errorCode: unknown }).errorCode === 'string'
            ? (parsed as { errorCode: string }).errorCode.slice(
                0,
                SERVER_ERROR_REASON_MAX_CHARS,
              )
            : undefined;
        const retryDelayReason =
          status === 429 ? this._extractRetryDelayReason(parsed) : undefined;
        const reason =
          [errorReason, retryDelayReason].filter(Boolean).join(' — ') || undefined;
        return { reason, errorCode };
      }
    } catch {
      // Not JSON — ignore
    }
    return {};
  }

  private _extractRetryDelayReason(parsed: object): string | undefined {
    if (
      !('message' in parsed) ||
      typeof (parsed as { message: unknown }).message !== 'string'
    ) {
      return undefined;
    }
    const match = (parsed as { message: string }).message.match(
      /\bretry in\s+(\d+)\s*(second|minute)s?\b/i,
    );
    if (!match) {
      return undefined;
    }
    const count = Number.parseInt(match[1], 10);
    if (!Number.isFinite(count)) {
      return undefined;
    }
    const unit = match[2].toLowerCase();
    return `retry in ${count} ${unit}${count === 1 ? '' : 's'}`.slice(
      0,
      SERVER_ERROR_REASON_MAX_CHARS,
    );
  }

  /**
   * Strips non-ASCII characters from the access token. UX fix for
   * users who paste zero-width spaces / smart quotes along with the
   * token. The original token is NOT sanitized in storage.
   */
  private _sanitizeToken(token: string): string {
    return token.replace(/[^\x20-\x7E]/g, '');
  }

  /** Extracts a string message from a thrown unknown error. */
  private _getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'object' && error !== null && 'message' in error) {
      return String((error as { message: unknown }).message);
    }
    return String(error);
  }

  private _getSafeErrorLogMeta(error: unknown): {
    errorName: string;
    errorCode?: string | number;
  } {
    const syncError = toSyncLogError(error);
    const code =
      error instanceof SuperSyncHttpStatusError && error.code !== undefined
        ? error.code
        : syncError.code;
    return {
      errorName: syncError.name,
      ...(code !== undefined ? { errorCode: code } : {}),
    };
  }

  /**
   * Logs the native error structurally and re-throws either a
   * user-facing "Unable to connect" Error for transient/network
   * failures, or the original error otherwise. The user-facing
   * message does NOT interpolate the raw error message — that string
   * can carry the resolved hostname on low-level CapacitorHttp
   * failures.
   */
  private _handleNativeRequestError(
    error: unknown,
    path: string,
    startTime: number,
  ): never {
    const duration = Date.now() - startTime;
    const errorMessage = this._getErrorMessage(error);
    const networkError = isRetryableUploadError(
      error instanceof Error ? error : errorMessage,
    );

    this._deps.logger.error(
      `${this._logLabel}: SuperSync request failed (native)`,
      undefined,
      {
        path,
        durationMs: duration,
        ...this._getSafeErrorLogMeta(error),
        isNetworkError: networkError,
      },
    );

    if (networkError) {
      throw new NetworkUnavailableSPError();
    }
    // Our own thrown errors (`AuthFailSPError`, `MissingCredentialsSPError`,
    // `SuperSyncHttpStatusError` from the non-2xx branch) carry only
    // scrubbed content and propagate unchanged. Foreign errors from the
    // native HTTP executor (e.g. iOS TLS-cert errors like "Hostname
    // mismatch for example.com") can embed the resolved hostname in
    // `.message`. Replace those with a name-only surface; the logger
    // above also records only error name/code metadata.
    if (
      error instanceof AuthFailSPError ||
      error instanceof MissingCredentialsSPError ||
      error instanceof SuperSyncHttpStatusError
    ) {
      throw error;
    }
    if (error instanceof Error) {
      throw new Error(`SuperSync native request failed: ${error.name}`);
    }
    throw new Error(`SuperSync native request failed: ${toSyncLogError(error).name}`);
  }

  private _isRetryableWebRequestError(error: unknown): boolean {
    if (
      error instanceof AuthFailSPError ||
      error instanceof MissingCredentialsSPError ||
      error instanceof SuperSyncHttpStatusError
    ) {
      return false;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return false;
    }
    return isRetryableUploadError(
      error instanceof Error ? error : this._getErrorMessage(error),
    );
  }

  private _delayWebRequestRetry(ms: number): Promise<void> {
    return (this._deps.webRequestRetryDelay ?? defaultDelay)(ms);
  }

  private async _fetchApi<T>(
    cfg: SuperSyncPrivateCfg,
    path: string,
    options: RequestInit & { noRetry?: boolean; body?: string },
  ): Promise<T> {
    const baseUrl = this._resolveBaseUrl(cfg);
    const url = `${baseUrl}${path}`;
    const sanitizedToken = this._sanitizeToken(cfg.accessToken);

    if (this.isNativePlatform) {
      return this._doNativeFetch<T>(
        cfg,
        path,
        options.method || 'GET',
        options.body === undefined ? undefined : { data: options.body },
        { noRetry: options.noRetry },
      );
    }

    const headers = new Headers(options.headers as HeadersInit);
    headers.set('Content-Type', 'application/json');
    headers.set('Authorization', `Bearer ${sanitizedToken}`);

    return this._doWebFetch<T>(url, path, headers, {
      method: options.method || 'GET',
      body: options.body,
      noRetry: options.noRetry,
    });
  }

  /**
   * Sends a gzip-compressed request body. Used for large payloads
   * like snapshot uploads.
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
   * Native (Android/iOS) gzip-compressed body. CapacitorHttp because
   * Android WebView's `fetch()` corrupts binary `Uint8Array` bodies
   * and iOS WebKit may have similar issues in Capacitor context.
   * We base64-encode the gzip data and send via the native HTTP
   * executor.
   */
  private async _fetchApiCompressedNative<T>(
    cfg: SuperSyncPrivateCfg,
    path: string,
    jsonPayload: string,
  ): Promise<T> {
    const base64Gzip = await compressWithGzipToString(jsonPayload, {
      logger: this._deps.logger,
    });

    this._deps.logger.debug(`${this._logLabel}: _fetchApiCompressedNative`, {
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
    options: { method: string; body?: BodyInit; noRetry?: boolean },
  ): Promise<T> {
    const maxRetries = options.noRetry ? 0 : SUPERSYNC_WEB_MAX_RETRIES;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const startTime = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        SUPERSYNC_REQUEST_TIMEOUT_MS,
      );

      try {
        const fetchFn = this._deps.webFetch();
        const response = await fetchFn(url, {
          ...options,
          headers,
          signal: controller.signal,
        });

        if (!response.ok) {
          // Keep the abort timer running across response.text() — a server/proxy
          // that sends an error status and stalls the body must still be aborted.
          const errorText = await response.text().catch(() => '');
          clearTimeout(timeoutId);
          // Check for auth failure FIRST before throwing generic error
          this._checkHttpStatus(response.status, errorText);
          const { reason, errorCode } = this._extractServerErrorDetails(
            errorText,
            response.status,
          );
          const suffix = reason ? ` — ${reason}` : '';
          throw new SuperSyncHttpStatusError(
            `HTTP ${response.status} ${response.statusText}${suffix}`,
            response.status,
            errorCode,
          );
        }

        // CRITICAL: Read response body BEFORE clearing timeout
        // The timeout must cover the entire response cycle including JSON parsing
        const data = (await response.json()) as T;
        clearTimeout(timeoutId);

        const duration = Date.now() - startTime;
        if (duration > 30000) {
          this._deps.logger.warn(`${this._logLabel}: Slow SuperSync request detected`, {
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
          this._deps.logger.error(
            `${this._logLabel}: SuperSync request timeout`,
            undefined,
            {
              path,
              durationMs: duration,
              timeoutMs: SUPERSYNC_REQUEST_TIMEOUT_MS,
            },
          );
          // Path is NOT interpolated — relative path includes
          // `excludeClient` (clientId) on download queries.
          throw new Error(
            `SuperSync request timeout after ${SUPERSYNC_REQUEST_TIMEOUT_MS / 1000}s`,
          );
        }

        const isNetworkError = this._isRetryableWebRequestError(error);
        if (isNetworkError && attempt < maxRetries) {
          const delayMs = 1000 * (attempt + 1);
          this._deps.logger.warn(
            `${this._logLabel}: transient SuperSync request failure, retrying in ${delayMs}ms`,
            {
              path,
              attempt: attempt + 1,
              maxRetries,
              delayMs,
              durationMs: duration,
              ...this._getSafeErrorLogMeta(error),
            },
          );
          await this._delayWebRequestRetry(delayMs);
          continue;
        }

        this._deps.logger.error(
          `${this._logLabel}: SuperSync request failed`,
          undefined,
          {
            path,
            durationMs: duration,
            ...this._getSafeErrorLogMeta(error),
            ...(isNetworkError ? { isNetworkError: true } : {}),
          },
        );

        if (isNetworkError) {
          throw new NetworkUnavailableSPError();
        }
        throw error;
      }
    }

    // Unreachable: the loop returns or throws.
    throw new Error('SuperSync request failed');
  }

  /**
   * Shared native fetch using CapacitorHttp (via `nativeHttpExecutor`)
   * with retry logic, error handling, and slow-request logging.
   */
  private async _doNativeFetch<T>(
    cfg: SuperSyncPrivateCfg,
    path: string,
    method: string,
    requestData?: { data: string; extraHeaders?: Record<string, string> },
    retryOpts?: { noRetry?: boolean },
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
        {
          executor: this._deps.nativeHttpExecutor,
          logger: this._deps.logger,
          label: this._logLabel,
          ...(retryOpts?.noRetry ? { maxRetries: 0 } : {}),
        },
      );

      if (response.status < 200 || response.status >= 300) {
        const errorData =
          typeof response.data === 'string'
            ? response.data
            : JSON.stringify(response.data);
        // Check for auth failure FIRST before throwing generic error
        this._checkHttpStatus(response.status, errorData);
        const { reason, errorCode } = this._extractServerErrorDetails(
          errorData,
          response.status,
        );
        const suffix = reason ? ` — ${reason}` : '';
        // No `statusText` on CapacitorHttp responses; status-only form.
        throw new SuperSyncHttpStatusError(
          `HTTP ${response.status}${suffix}`,
          response.status,
          errorCode,
        );
      }

      const duration = Date.now() - startTime;
      if (duration > 30000) {
        this._deps.logger.warn(
          `${this._logLabel}: Slow SuperSync request detected (native)`,
          {
            path,
            durationMs: duration,
            durationSec: (duration / 1000).toFixed(1),
          },
        );
      }

      return response.data as T;
    } catch (error) {
      this._handleNativeRequestError(error, path, startTime);
    }
  }
}
