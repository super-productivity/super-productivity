import {
  SyncProviderAuthHelper,
  SyncProviderServiceInterface,
} from '../../provider.interface';
import { SyncProviderId } from '../../provider.const';
import {
  AuthFailSPError,
  HttpNotOkAPIError,
  MissingCredentialsSPError,
  MissingRefreshTokenAPIError,
  RemoteFileNotFoundAPIError,
  TooManyRequestsAPIError,
  UploadRevToMatchMismatchAPIError,
} from '../../../core/errors/sync-errors';
import { SyncLog } from '../../../../core/log';
import { SyncCredentialStore } from '../../credential-store.service';
import {
  OneDriveListResponse,
  OneDrivePrivateCfg,
  OneDriveTokenResponse,
} from './onedrive.model';
import { generateCodeChallenge, generateCodeVerifier } from '../../../../util/pkce.util';
import {
  HAS_OFFICIAL_ONEDRIVE_CLIENT_ID,
  OFFICIAL_ONEDRIVE_CLIENT_ID,
} from '../../../../imex/sync/onedrive-auth-mode.const';

const ONEDRIVE_PROTOCOL = {
  graphApiBaseUrl: 'https://graph.microsoft.com/v1.0',
  scope: 'offline_access Files.ReadWrite.AppFolder',
  // Manual code entry flow: user pastes code shown in URL after login.
  redirectUri: 'https://login.microsoftonline.com/common/oauth2/nativeclient',
  electronRedirectUri: 'superproductivity://oauth-callback/onedrive',
  tokenRefreshSkewMs: 60_000,
} as const;

const ONEDRIVE_DEFAULTS = {
  tenantId: 'common',
  syncFolderPath: 'super-productivity',
} as const;

interface ApiRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  headers?: HeadersInit;
  body?: string;
}

interface ParsedGraphError {
  code?: string;
  message?: string;
}

interface OAuthTokenRequest {
  grantType: 'authorization_code' | 'refresh_token';
  authCode?: string;
  codeVerifier?: string;
  refreshToken?: string;
  redirectUri?: string;
}

// OAuth state storage for CSRF protection: state -> { provider, expiresAt }
const OAUTH_STATES_MAP = new Map<string, { provider: 'onedrive'; expiresAt: number }>();

// Clean up expired states periodically
const TOKEN_STATE_VALIDITY_MS = 10 * 60 * 1000; // 10 minutes
setInterval(
  () => {
    const now = Date.now();
    for (const [state, data] of OAUTH_STATES_MAP.entries()) {
      if (now > data.expiresAt) {
        OAUTH_STATES_MAP.delete(state);
      }
    }
  },
  5 * 60 * 1000,
); // Every 5 minutes

/**
 * Validate OneDrive OAuth state parameter against stored states.
 * Returns true if state is valid and belongs to OneDrive, false otherwise.
 */
export const validateOneDriveOAuthState = (state: string | null): boolean => {
  if (!state) return false;
  const stored = OAUTH_STATES_MAP.get(state);
  if (!stored) return false;
  if (Date.now() > stored.expiresAt) {
    OAUTH_STATES_MAP.delete(state);
    return false;
  }
  OAUTH_STATES_MAP.delete(state);
  return true;
};

export class OneDrive implements SyncProviderServiceInterface<SyncProviderId.OneDrive> {
  readonly id = SyncProviderId.OneDrive;
  readonly isUploadForcePossible = true;
  readonly maxConcurrentRequests = 4;

  public privateCfg = new SyncCredentialStore(SyncProviderId.OneDrive);
  private _ensuredFolderPath: string | null = null;
  private _folderEnsureInFlightPath: string | null = null;
  private _folderEnsureInFlightPromise: Promise<void> | null = null;
  private _tokenRefreshInFlightPromise: Promise<string> | null = null;

  async isReady(): Promise<boolean> {
    const cfg = await this.privateCfg.load();
    const resolvedClientId = this._resolveClientId(cfg || {});
    return !!(resolvedClientId && cfg?.accessToken && cfg?.refreshToken);
  }

  async setPrivateCfg(privateCfg: OneDrivePrivateCfg): Promise<void> {
    await this.privateCfg.setComplete(privateCfg);
  }

  async clearAuthCredentials(): Promise<void> {
    const cfg = await this.privateCfg.load();
    if (!cfg) {
      return;
    }
    await this.privateCfg.setComplete({
      ...cfg,
      accessToken: '',
      refreshToken: '',
      tokenExpiresAt: 0,
    });
  }

  async getAuthHelper(): Promise<SyncProviderAuthHelper> {
    const cfg = await this._cfgOrError();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const tenant = cfg.tenantId || ONEDRIVE_DEFAULTS.tenantId;
    const redirectUri = this._getRedirectUri();

    // Generate state for OAuth CSRF protection
    const state = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const stateExpiresAt = Date.now() + TOKEN_STATE_VALIDITY_MS;
    OAUTH_STATES_MAP.set(state, {
      provider: 'onedrive',
      expiresAt: stateExpiresAt,
    });

    const authUrl =
      `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize` +
      `?client_id=${encodeURIComponent(cfg.clientId)}` +
      '&response_type=code' +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(ONEDRIVE_PROTOCOL.scope)}` +
      `&code_challenge=${encodeURIComponent(codeChallenge)}` +
      '&code_challenge_method=S256' +
      `&state=${encodeURIComponent(state)}`;

    return {
      authUrl,
      codeVerifier,
      verifyCodeChallenge: async <T>(authCode: string) => {
        return (await this._exchangeAuthCode(authCode, codeVerifier, cfg)) as T;
      },
    };
  }

  async getFileRev(targetPath: string, _localRev: string): Promise<{ rev: string }> {
    const cfg = await this._cfgOrError();
    try {
      const item = await this._requestJson<{ eTag?: string }>(
        this._getDriveItemPath(targetPath, cfg),
      );
      if (!item.eTag) {
        throw new RemoteFileNotFoundAPIError(targetPath);
      }
      return { rev: item.eTag };
    } catch (e) {
      this._mapAndThrow(e, targetPath);
    }
    throw new RemoteFileNotFoundAPIError(targetPath);
  }

  async downloadFile(targetPath: string): Promise<{ rev: string; dataStr: string }> {
    const cfg = await this._cfgOrError();
    try {
      const metadata = await this._requestJson<{ eTag?: string }>(
        this._getDriveItemPath(targetPath, cfg),
      );
      const response = await this._request({
        method: 'GET',
        path: `${this._getDriveItemPath(targetPath, cfg)}/content`,
      });
      const dataStr = await response.text();
      return {
        rev: metadata.eTag || '',
        dataStr,
      };
    } catch (e) {
      this._mapAndThrow(e, targetPath);
    }
    throw new RemoteFileNotFoundAPIError(targetPath);
  }

  async uploadFile(
    targetPath: string,
    dataStr: string,
    revToMatch: string | null,
    isForceOverwrite = false,
  ): Promise<{ rev: string }> {
    const cfg = await this._cfgOrError();
    try {
      await this._ensureSyncFolderExistsCached(cfg);
      const headers = new Headers();
      headers.set('Content-Type', 'text/plain');
      if (!isForceOverwrite && revToMatch) {
        headers.set('If-Match', revToMatch);
      }

      const response = await this._request({
        method: 'PUT',
        path: `${this._getDriveItemPath(targetPath, cfg)}/content`,
        headers,
        body: dataStr,
      });
      const result = (await response.json()) as { eTag?: string };
      return { rev: result.eTag || '' };
    } catch (e) {
      this._mapAndThrow(e, targetPath);
    }
    throw new UploadRevToMatchMismatchAPIError(targetPath);
  }

  async removeFile(targetPath: string): Promise<void> {
    const cfg = await this._cfgOrError();
    try {
      await this._request({
        method: 'DELETE',
        path: this._getDriveItemPath(targetPath, cfg),
      });
    } catch (e) {
      this._mapAndThrow(e, targetPath);
    }
  }

  async listFiles(dirPath: string): Promise<string[]> {
    const cfg = await this._cfgOrError();
    try {
      const result = await this._requestJson<OneDriveListResponse>(
        `${this._getDriveItemPath(dirPath, cfg)}/children`,
      );
      return (result.value || [])
        .filter((item) => !!item.file)
        .map((item) => item.name)
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  private _getDriveItemPath(targetPath: string, cfg: OneDrivePrivateCfg): string {
    const relativeTargetPath = this._normalizeRelativePath(targetPath);
    const cfgPath = this._getSyncFolderPath(cfg);
    const fullPath = this._joinPathSegments(cfgPath, relativeTargetPath);
    const encodedPath = this._encodePath(fullPath);
    return `/me/drive/special/approot:/${encodedPath}:`;
  }

  private _getSyncFolderPath(cfg: OneDrivePrivateCfg): string {
    return this._normalizeRelativePath(cfg?.syncFolderPath || '');
  }

  private _normalizeRelativePath(path: string): string {
    return path
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean)
      .join('/');
  }

  private _joinPathSegments(...parts: string[]): string {
    return parts
      .map((part) => this._normalizeRelativePath(part))
      .filter(Boolean)
      .join('/');
  }

  private _encodePath(path: string): string {
    return this._normalizeRelativePath(path)
      .split('/')
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join('/');
  }

  // Cache successful folder checks to avoid repeated path probes on every upload.
  private async _ensureSyncFolderExistsCached(cfg: OneDrivePrivateCfg): Promise<void> {
    const folderPath = this._getSyncFolderPath(cfg);
    if (!folderPath) {
      return;
    }

    if (this._ensuredFolderPath === folderPath) {
      return;
    }

    if (
      this._folderEnsureInFlightPromise &&
      this._folderEnsureInFlightPath === folderPath
    ) {
      await this._folderEnsureInFlightPromise;
      return;
    }

    this._folderEnsureInFlightPath = folderPath;
    this._folderEnsureInFlightPromise = this._ensureSyncFolderExists(cfg)
      .then(() => {
        this._ensuredFolderPath = folderPath;
      })
      .finally(() => {
        this._folderEnsureInFlightPath = null;
        this._folderEnsureInFlightPromise = null;
      });

    await this._folderEnsureInFlightPromise;
  }

  private async _ensureSyncFolderExists(cfg: OneDrivePrivateCfg): Promise<void> {
    const folderPath = this._getSyncFolderPath(cfg);
    if (!folderPath) {
      return;
    }

    const segments = folderPath.split('/').filter(Boolean);
    let currentPath = '';

    for (const segment of segments) {
      const parentPath = currentPath;
      currentPath = parentPath ? `${parentPath}/${segment}` : segment;

      try {
        await this._request({
          method: 'GET',
          path: `/me/drive/special/approot:/${this._encodePath(currentPath)}:`,
        });
      } catch (e) {
        const err = e as HttpNotOkAPIError;
        if (err?.response?.status !== 404) {
          throw e;
        }

        const createPath = parentPath
          ? `/me/drive/special/approot:/${this._encodePath(parentPath)}:/children`
          : '/me/drive/special/approot/children';

        await this._request({
          method: 'POST',
          path: createPath,
          headers: (() => {
            const requestHeaders = new Headers();
            requestHeaders.set('Content-Type', 'application/json');
            return requestHeaders;
          })(),
          body: JSON.stringify({
            name: segment,
            folder: {},
            ...{ ['@microsoft.graph.conflictBehavior']: 'replace' },
          }),
        });
      }
    }
  }

  private async _cfgOrError(requireAuth = false): Promise<OneDrivePrivateCfg> {
    const cfg = (await this.privateCfg.load()) || ({} as Partial<OneDrivePrivateCfg>);
    const resolvedClientId = this._resolveClientId(cfg);
    if (!resolvedClientId) {
      throw new MissingCredentialsSPError('OneDrive clientId is required');
    }
    if (requireAuth && !cfg.refreshToken) {
      throw new MissingRefreshTokenAPIError();
    }
    return {
      ...cfg,
      useCustomApp:
        cfg.useCustomApp !== undefined
          ? cfg.useCustomApp
          : !HAS_OFFICIAL_ONEDRIVE_CLIENT_ID,
      clientId: resolvedClientId,
      tenantId: cfg.tenantId || ONEDRIVE_DEFAULTS.tenantId,
      syncFolderPath: cfg.syncFolderPath || ONEDRIVE_DEFAULTS.syncFolderPath,
    };
  }

  private _resolveClientId(cfg: Partial<OneDrivePrivateCfg>): string | null {
    if (cfg.useCustomApp === true) {
      return cfg.clientId || null;
    }

    if (cfg.useCustomApp === false) {
      return OFFICIAL_ONEDRIVE_CLIENT_ID || cfg.clientId || null;
    }

    // Legacy configs: preserve explicit client ID first; otherwise fallback to official app.
    return cfg.clientId || OFFICIAL_ONEDRIVE_CLIENT_ID || null;
  }

  private async _exchangeAuthCode(
    authCode: string,
    codeVerifier: string,
    cfg: OneDrivePrivateCfg,
  ): Promise<OneDrivePrivateCfg> {
    const tokenData = await this._requestOAuthToken(cfg, {
      grantType: 'authorization_code',
      authCode,
      codeVerifier,
      redirectUri: this._getRedirectUri(),
    });
    const expiresInMs = tokenData.expires_in * 1000;

    return {
      ...cfg,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || cfg.refreshToken,
      tokenExpiresAt: Date.now() + expiresInMs,
    };
  }

  private async _refreshAccessTokenIfNeeded(cfg: OneDrivePrivateCfg): Promise<string> {
    const expiresAt = cfg.tokenExpiresAt || 0;
    if (
      cfg.accessToken &&
      Date.now() < expiresAt - ONEDRIVE_PROTOCOL.tokenRefreshSkewMs
    ) {
      return cfg.accessToken;
    }
    if (!cfg.refreshToken) {
      throw new MissingRefreshTokenAPIError();
    }

    // If a token refresh is already in flight, wait for it instead of creating a duplicate
    if (this._tokenRefreshInFlightPromise) {
      return this._tokenRefreshInFlightPromise;
    }

    // Perform the refresh and cache the promise
    this._tokenRefreshInFlightPromise = (async () => {
      try {
        const tokenData = await this._requestOAuthToken(cfg, {
          grantType: 'refresh_token',
          refreshToken: cfg.refreshToken,
        });
        const expiresInMs = tokenData.expires_in * 1000;
        const updatedCfg: OneDrivePrivateCfg = {
          ...cfg,
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token || cfg.refreshToken,
          tokenExpiresAt: Date.now() + expiresInMs,
        };

        await this.privateCfg.setComplete(updatedCfg);
        return updatedCfg.accessToken || '';
      } finally {
        this._tokenRefreshInFlightPromise = null;
      }
    })();

    return this._tokenRefreshInFlightPromise;
  }

  private _buildOAuthTokenUrl(tenantId: string): string {
    return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
  }

  private _buildOAuthTokenRequestBody(
    cfg: OneDrivePrivateCfg,
    req: OAuthTokenRequest,
  ): URLSearchParams {
    const bodyBase = {
      client_id: cfg.clientId,
      scope: ONEDRIVE_PROTOCOL.scope,
    };

    if (req.grantType === 'authorization_code') {
      return new URLSearchParams({
        ...bodyBase,
        grant_type: 'authorization_code',
        code: req.authCode || '',
        redirect_uri: req.redirectUri || ONEDRIVE_PROTOCOL.redirectUri,
        code_verifier: req.codeVerifier || '',
      });
    }

    return new URLSearchParams({
      ...bodyBase,
      grant_type: 'refresh_token',
      refresh_token: req.refreshToken || '',
    });
  }

  private async _requestOAuthToken(
    cfg: OneDrivePrivateCfg,
    req: OAuthTokenRequest,
  ): Promise<OneDriveTokenResponse> {
    // OAuth token exchange/refresh is centralized here to keep grant-specific logic
    // in one place and ensure consistent error handling for both flows.
    const tenant = cfg.tenantId || ONEDRIVE_DEFAULTS.tenantId;
    const response = await fetch(this._buildOAuthTokenUrl(tenant), {
      method: 'POST',
      headers: (() => {
        const requestHeaders = new Headers();
        requestHeaders.set('Content-Type', 'application/x-www-form-urlencoded');
        return requestHeaders;
      })(),
      body: this._buildOAuthTokenRequestBody(cfg, req),
    });

    if (!response.ok) {
      throw new HttpNotOkAPIError(response, await response.text());
    }

    return (await response.json()) as OneDriveTokenResponse;
  }

  private _getRedirectUri(): string {
    return IS_ELECTRON
      ? ONEDRIVE_PROTOCOL.electronRedirectUri
      : ONEDRIVE_PROTOCOL.redirectUri;
  }

  private async _request(options: ApiRequestOptions): Promise<Response> {
    const cfg = await this._cfgOrError();
    const accessToken = await this._refreshAccessTokenIfNeeded(cfg);
    const isUploadRequest = options.method === 'PUT' && options.path.endsWith('/content');

    SyncLog.normal(
      `[OneDrive] ${options.method} ${options.path}${isUploadRequest ? ' (upload)' : ''}`,
    );

    if (isUploadRequest) {
      SyncLog.normal('[OneDrive] Upload request started');
    }

    const requestHeaders = new Headers(options.headers);
    requestHeaders.set('Authorization', `Bearer ${accessToken}`);

    const response = await fetch(`${ONEDRIVE_PROTOCOL.graphApiBaseUrl}${options.path}`, {
      method: options.method,
      headers: requestHeaders,
      body: options.body,
    });

    // Read error bodies once here so downstream mapping can include provider-specific
    // details (Graph error codes/messages) without duplicate fetch body reads.
    const responseBody = response.ok ? '' : await response.text();

    if (isUploadRequest && !response.ok) {
      SyncLog.warn(`[OneDrive] Upload request failed (status=${response.status})`);
    }

    if (!response.ok) {
      const parsed = this._parseGraphError(responseBody);
      SyncLog.warn(
        `[OneDrive] Request failed status=${response.status} path=${options.path}`,
        parsed.code || '[no-code]',
        parsed.message || '[no-message]',
      );
    }

    if (response.status === 401) {
      await this.clearAuthCredentials();
      throw new AuthFailSPError('OneDrive 401', options.path, responseBody);
    }

    if (response.status === 403) {
      const parsed = this._parseGraphError(responseBody);
      if (parsed.code === 'InvalidAuthenticationToken') {
        await this.clearAuthCredentials();
      }
    }

    if (!response.ok) {
      throw new HttpNotOkAPIError(response, responseBody);
    }

    if (isUploadRequest) {
      SyncLog.normal(`[OneDrive] Upload request succeeded (status=${response.status})`);
    }

    return response;
  }

  private async _requestJson<T>(path: string): Promise<T> {
    const response = await this._request({ method: 'GET', path });
    return (await response.json()) as T;
  }

  private _parseGraphError(body?: string): ParsedGraphError {
    if (!body) {
      return {};
    }

    try {
      const parsed = JSON.parse(body) as {
        error?: { code?: string; message?: string };
      };
      return {
        code: parsed.error?.code,
        message: parsed.error?.message,
      };
    } catch {
      return {};
    }
  }

  private _formatHttpErrorDetails(error: HttpNotOkAPIError): string {
    const parsed = this._parseGraphError(error.body);
    const details = [
      `status=${error.response.status}`,
      parsed.code ? `code=${parsed.code}` : '',
      parsed.message ? `message=${parsed.message}` : '',
    ].filter(Boolean);
    return details.join(', ');
  }

  private _mapAndThrow(error: unknown, targetPath: string): never {
    if (error instanceof RemoteFileNotFoundAPIError) {
      throw error;
    }
    if (error instanceof AuthFailSPError) {
      throw error;
    }
    if (error instanceof MissingCredentialsSPError) {
      throw error;
    }
    if (error instanceof MissingRefreshTokenAPIError) {
      throw error;
    }
    if (error instanceof HttpNotOkAPIError) {
      const status = error.response.status;
      const details = this._formatHttpErrorDetails(error);
      SyncLog.warn(`[OneDrive] Mapping HTTP ${status} for ${targetPath}: ${details}`);
      if (status === 404) {
        this._ensuredFolderPath = null;
        throw new RemoteFileNotFoundAPIError(targetPath);
      }
      if (status === 429) {
        throw new TooManyRequestsAPIError(
          `OneDrive request throttled (${details})`,
          targetPath,
        );
      }
      if (status === 409 || status === 412) {
        throw new UploadRevToMatchMismatchAPIError(targetPath);
      }
      if (status === 401 || status === 403) {
        throw new AuthFailSPError(`OneDrive auth failed (${details})`, targetPath);
      }
    }

    throw error;
  }
}
