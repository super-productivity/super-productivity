import type { SyncLogger } from '@sp/sync-core';
import type { ProviderPlatformInfo } from '../../platform/provider-platform-info';
import type { WebFetchFactory } from '../../platform/web-fetch-factory';
import type { SyncCredentialStorePort } from '../../credential-store-port';
import type { FileSyncProvider, SyncProviderAuthHelper } from '../../provider-types';
import {
  AuthFailSPError,
  HttpNotOkAPIError,
  MissingRefreshTokenAPIError,
  RemoteFileNotFoundAPIError,
  TooManyRequestsAPIError,
  UploadRevToMatchMismatchAPIError,
} from '../../errors';
import { generateCodeVerifier, generateCodeChallenge } from '../../pkce';
import type {
  OneDrivePrivateCfg,
  OneDriveListResponse,
  OneDriveTokenResponse,
} from './onedrive.model';

export const PROVIDER_ID_ONEDRIVE = 'OneDrive' as const;

export interface OneDriveDeps {
  logger: SyncLogger;
  platformInfo: ProviderPlatformInfo;
  webFetch: WebFetchFactory;
  credentialStore: SyncCredentialStorePort<
    typeof PROVIDER_ID_ONEDRIVE,
    OneDrivePrivateCfg
  >;
  officialClientId: string | null;
  hasOfficialClientId: boolean;
  addOAuthState: (provider: string, state: string) => void;
  isElectron: boolean;
}

const ONEDRIVE_PROTOCOL = {
  graphApiBaseUrl: 'https://graph.microsoft.com/v1.0',
  scope: 'offline_access Files.ReadWrite.AppFolder',
  redirectUri: 'https://login.microsoftonline.com/common/oauth2/nativeclient',
  electronRedirectUri: 'superproductivity://oauth-callback/onedrive',
  tokenRefreshSkewMs: 60_000,
} as const;

const ONEDRIVE_DEFAULTS = {
  tenantId: 'common',
  syncFolderPath: 'Super Productivity',
} as const;

export class OneDrive implements FileSyncProvider<
  typeof PROVIDER_ID_ONEDRIVE,
  OneDrivePrivateCfg
> {
  readonly id = PROVIDER_ID_ONEDRIVE;
  readonly isUploadForcePossible = true;
  readonly maxConcurrentRequests = 4;

  readonly privateCfg: SyncCredentialStorePort<
    typeof PROVIDER_ID_ONEDRIVE,
    OneDrivePrivateCfg
  >;

  private _ensuredFolderPath: string | null = null;
  private _folderEnsureInFlightPath: string | null = null;
  private _folderEnsureInFlightPromise: Promise<void> | null = null;
  private _tokenRefreshInFlightPromise: Promise<string> | null = null;
  private _is401Retry = false;
  private readonly _devPath?: string;
  private readonly _deps: OneDriveDeps;

  constructor(cfg: { devPath?: string }, deps: OneDriveDeps) {
    this._devPath = cfg.devPath;
    this._deps = deps;
    this.privateCfg = deps.credentialStore;
  }

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
    this._tokenRefreshInFlightPromise = null;
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

    const state = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    this._deps.addOAuthState('onedrive', state);

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
      return { rev: item.eTag || '' };
    } catch (e) {
      this._mapAndThrow(e, targetPath);
    }
    throw new RemoteFileNotFoundAPIError(targetPath);
  }

  async downloadFile(targetPath: string): Promise<{ rev: string; dataStr: string }> {
    const cfg = await this._cfgOrError();
    try {
      const driveItemPath = this._getDriveItemPath(targetPath, cfg);
      const response = await this._request({
        method: 'GET',
        path: `${driveItemPath}/content`,
      });
      const dataStr = await response.text();
      const revFromContentHeaders = this._getResponseETag(response);
      if (revFromContentHeaders) {
        return {
          rev: revFromContentHeaders,
          dataStr,
        };
      }

      const metadata = await this._requestJson<{ eTag?: string }>(driveItemPath);
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

  // ---- private helpers ----

  private _getDriveItemPath(targetPath: string, cfg: OneDrivePrivateCfg): string {
    const relativeTargetPath = this._normalizeRelativePath(targetPath);
    const cfgPath = this._getSyncFolderPath(cfg);
    const fullPath = this._joinPathSegments(cfgPath, relativeTargetPath);
    const encodedPath = this._encodePath(fullPath);
    return `/me/drive/special/approot:/${encodedPath}:`;
  }

  private _getSyncFolderPath(cfg: OneDrivePrivateCfg): string {
    return this._joinPathSegments(this._devPath || '', cfg?.syncFolderPath || '');
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

  private _getResponseETag(response: Response): string {
    return response.headers.get('etag') || response.headers.get('ETag') || '';
  }

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

      const createPath = parentPath
        ? `/me/drive/special/approot:/${this._encodePath(parentPath)}:/children`
        : '/me/drive/special/approot/children';

      try {
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
            // eslint-disable-next-line @typescript-eslint/naming-convention
            '@microsoft.graph.conflictBehavior': 'replace',
          }),
        });
      } catch (e) {
        const err = e as HttpNotOkAPIError;
        if (err?.response?.status === 409) {
          const parsed = this._parseGraphError(err.body);
          if (parsed.code === 'nameAlreadyExists') {
            continue;
          }
        }
        throw e;
      }
    }
  }

  private async _cfgOrError(): Promise<OneDrivePrivateCfg> {
    const cfg = (await this.privateCfg.load()) || ({} as Partial<OneDrivePrivateCfg>);
    const resolvedClientId = this._resolveClientId(cfg);
    if (!resolvedClientId) {
      throw new Error('OneDrive clientId is required');
    }
    return {
      ...cfg,
      useCustomApp:
        cfg.useCustomApp !== undefined
          ? cfg.useCustomApp
          : !this._deps.hasOfficialClientId,
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
      return this._deps.officialClientId || cfg.clientId || null;
    }

    return cfg.clientId || this._deps.officialClientId || null;
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

    if (this._tokenRefreshInFlightPromise) {
      return this._tokenRefreshInFlightPromise;
    }

    this._tokenRefreshInFlightPromise = (async () => {
      try {
        const tokenData = await this._requestOAuthToken(cfg, {
          grantType: 'refresh_token',
          refreshToken: cfg.refreshToken,
        });
        const expiresInMs = tokenData.expires_in * 1000;

        const currentCfg = await this.privateCfg.load();
        if (!currentCfg?.refreshToken) {
          this._deps.logger.warn(
            '[OneDrive] Credentials cleared during token refresh, discarding refresh result',
          );
          throw new MissingRefreshTokenAPIError();
        }

        const updatedCfg: OneDrivePrivateCfg = {
          ...currentCfg,
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token || currentCfg.refreshToken,
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
    const tenant = cfg.tenantId || ONEDRIVE_DEFAULTS.tenantId;
    const response = await this._deps.webFetch()(this._buildOAuthTokenUrl(tenant), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, // eslint-disable-line @typescript-eslint/naming-convention
      body: this._buildOAuthTokenRequestBody(cfg, req),
    });

    if (!response.ok) {
      const body = await response.text();
      if (response.status === 400) {
        try {
          const parsedBody = JSON.parse(body) as {
            error?: string;
            error_description?: string;
          };
          if (parsedBody.error === 'invalid_grant') {
            this._deps.logger.warn(
              '[OneDrive] Refresh token revoked (invalid_grant), clearing credentials',
            );
            await this.clearAuthCredentials();
            throw new MissingRefreshTokenAPIError();
          }
        } catch (_parseErr) {
          /* fall through to generic HttpNotOkAPIError */
        }
      }
      throw new HttpNotOkAPIError(response, body);
    }

    return (await response.json()) as OneDriveTokenResponse;
  }

  private _getRedirectUri(): string {
    if (!this._deps.isElectron) {
      return ONEDRIVE_PROTOCOL.redirectUri;
    }
    return ONEDRIVE_PROTOCOL.electronRedirectUri;
  }

  private async _request(options: ApiRequestOptions): Promise<Response> {
    const cfg = await this._cfgOrError();
    const accessToken = await this._refreshAccessTokenIfNeeded(cfg);
    const isUploadRequest = options.method === 'PUT' && options.path.endsWith('/content');

    this._deps.logger.log({
      method: options.method,
      isUpload: isUploadRequest,
    } as unknown as string);

    const requestHeaders = new Headers(options.headers);
    requestHeaders.set('Authorization', `Bearer ${accessToken}`);

    const response = await this._deps.webFetch()(
      `${ONEDRIVE_PROTOCOL.graphApiBaseUrl}${options.path}`,
      {
        method: options.method,
        headers: requestHeaders,
        body: options.body,
      },
    );

    const responseBody = response.ok ? '' : await response.text();

    if (!response.ok) {
      const parsed = this._parseGraphError(responseBody);
      this._deps.logger.log({
        status: response.status,
        code: parsed.code || undefined,
      } as unknown as string);
    }

    if (response.status === 401) {
      if (!this._is401Retry) {
        this._is401Retry = true;
        try {
          const currentCfg = await this._cfgOrError();
          await this._refreshAccessTokenIfNeeded({
            ...currentCfg,
            tokenExpiresAt: 0,
          });
          return this._request(options);
        } catch {
          /* fall through to auth clear */
        } finally {
          this._is401Retry = false;
        }
      }
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

  private _mapAndThrow(error: unknown, targetPath: string): never {
    if (error instanceof RemoteFileNotFoundAPIError) {
      throw error;
    }
    if (error instanceof AuthFailSPError) {
      throw error;
    }
    if (error instanceof HttpNotOkAPIError) {
      const status = error.response.status;
      if (status === 404) {
        this._ensuredFolderPath = null;
        throw new RemoteFileNotFoundAPIError(targetPath);
      }
      if (status === 429) {
        throw new TooManyRequestsAPIError({
          status,
          path: targetPath,
        });
      }
      if (status === 409 || status === 412) {
        throw new UploadRevToMatchMismatchAPIError(targetPath);
      }
      if (status === 401 || status === 403) {
        throw new AuthFailSPError(`OneDrive auth failed (status=${status})`, targetPath);
      }
    }

    throw error;
  }
}

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
