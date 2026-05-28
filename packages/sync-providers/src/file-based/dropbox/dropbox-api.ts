/* eslint-disable @typescript-eslint/naming-convention */

import { DropboxFileMetadata } from './dropbox.model';
import { errorMeta, urlPathOnly } from '../../log/error-meta';
import {
  AuthFailSPError,
  HttpNotOkAPIError,
  InvalidDataSPError,
  MissingCredentialsSPError,
  MissingRefreshTokenAPIError,
  NoRevAPIError,
  RemoteFileNotFoundAPIError,
  TooManyRequestsAPIError,
  UploadRevToMatchMismatchAPIError,
} from '../../errors';
import { executeNativeRequestWithRetry } from '../../http/native-http-retry';
import type { NativeHttpResponse } from '../../http/native-http-retry';
import type { DropboxDeps, DropboxPrivateCfg } from './dropbox';
import { PROVIDER_ID_DROPBOX } from './dropbox';
import type { SyncCredentialStorePort } from '../../credential-store-port';

interface DropboxApiOptions {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  data?: string | Record<string, unknown>;
  params?: Record<string, string>;
  accessToken?: string;
  isSkipTokenRefresh?: boolean;
  /**
   * Relative path before the `basePath` prefix is applied. Threaded
   * through to error objects so we never include the user-configured
   * basePath in privacy-sensitive logs / errors (B3.2).
   */
  targetPath?: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

/**
 * Dropbox file/folder entry from list_folder API
 */
interface DropboxListEntry {
  '.tag': 'file' | 'folder' | 'deleted';
  name: string;
  path_lower: string;
  path_display: string;
  id: string;
}

interface DropboxListFolderResult {
  entries: DropboxListEntry[];
  cursor: string;
  has_more: boolean;
}

interface DropboxErrorResponse {
  error_summary?: string;
  error?: {
    retry_after?: number;
    [key: string]: unknown;
  };
}

/**
 * Dropbox file write mode - determines conflict handling behavior.
 * @see https://www.dropbox.com/developers/documentation/http/documentation#files-upload
 */
type DropboxWriteMode =
  | { '.tag': 'add' }
  | { '.tag': 'overwrite' }
  | { '.tag': 'update'; update: string };

/** Timeout for data transfer requests (uploads/downloads) — 120s */
const NATIVE_REQUEST_READ_TIMEOUT = 120000;

/** Timeout for auth endpoints (token refresh, token exchange) — 30s */
const NATIVE_AUTH_READ_TIMEOUT = 30000;

const DROPBOX_OAUTH_TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token' as const;

/**
 * API class for Dropbox integration
 */
export class DropboxApi {
  private static readonly L = 'DropboxApi';

  private readonly _credentialStore: SyncCredentialStorePort<
    typeof PROVIDER_ID_DROPBOX,
    DropboxPrivateCfg
  >;

  constructor(
    private _appKey: string,
    private _deps: DropboxDeps,
  ) {
    this._credentialStore = _deps.credentialStore;
  }

  // ==============================
  // File Operations
  // ==============================

  /**
   * List folder contents
   */
  async listFiles(path: string, targetPath: string = path): Promise<string[]> {
    this._deps.logger.normal(`${DropboxApi.L}.listFiles()`, { targetPath });
    try {
      const response = await this._request({
        method: 'POST',
        url: 'https://api.dropboxapi.com/2/files/list_folder',
        headers: { 'Content-Type': 'application/json' },
        data: { path },
        targetPath,
      });
      const result = (await response.json()) as DropboxListFolderResult;
      if (!result || !result.entries) {
        return [];
      }
      return result.entries
        .filter((entry) => entry['.tag'] === 'file') // Only return files
        .map((entry) => entry.path_lower); // Return full path in lower case
    } catch (e) {
      this._deps.logger.critical(
        `${DropboxApi.L}.listFiles() error`,
        errorMeta(e, { targetPath }),
      );
      this._checkCommonErrors(e, targetPath);
      throw e;
    }
  }

  /**
   * Retrieve metadata for a file or folder
   */
  async getMetaData(
    path: string,
    localRev: string | null,
    targetPath: string = path,
  ): Promise<DropboxFileMetadata> {
    try {
      const response = await this._request({
        method: 'POST',
        url: 'https://api.dropboxapi.com/2/files/get_metadata',
        headers: {
          'Content-Type': 'application/json',
          // NOTE: Dropbox ignores If-None-Match for metadata requests
          // We keep localRev parameter for API consistency but don't use it
          // ...(localRev ? { 'If-None-Match': localRev } : {}),
        },
        data: { path },
        targetPath,
      });
      return (await response.json()) as DropboxFileMetadata;
    } catch (e) {
      this._deps.logger.critical(
        `${DropboxApi.L}.getMetaData() error`,
        errorMeta(e, { targetPath }),
      );
      this._checkCommonErrors(e, targetPath);
      throw e;
    }
  }

  /**
   * Download a file from Dropbox
   *
   * NOTE: We don't use If-None-Match for downloads to ensure we always get content
   * when requested. Future optimization could implement caching and handle 304 responses,
   * but current sync architecture expects actual data from downloadFile() calls.
   */
  async download<T>({
    path,
    targetPath = path,
  }: {
    path: string;
    targetPath?: string;
  }): Promise<{ meta: DropboxFileMetadata; data: T }> {
    try {
      const response = await this._request({
        method: 'POST',
        url: 'https://content.dropboxapi.com/2/files/download',
        headers: {
          'Dropbox-API-Arg': JSON.stringify({ path }),
          'Content-Type': 'application/octet-stream',
          // Don't send If-None-Match - always download full content
        },
        targetPath,
      });

      const apiResult = response.headers.get('dropbox-api-result');
      if (!apiResult) {
        throw new InvalidDataSPError('Missing dropbox-api-result header');
      }

      const meta = JSON.parse(apiResult);
      const data = await response.text();

      if (!meta.rev) {
        throw new NoRevAPIError();
      }

      return { meta, data: data as unknown as T };
    } catch (e) {
      this._deps.logger.critical(
        `${DropboxApi.L}.download() error`,
        errorMeta(e, { targetPath }),
      );
      this._checkCommonErrors(e, targetPath);
      throw e;
    }
  }

  /**
   * Upload a file to Dropbox
   */
  async upload({
    path,
    revToMatch,
    data,
    isForceOverwrite = false,
    targetPath = path,
  }: {
    path: string;
    revToMatch?: string | null;
    data: string | Record<string, unknown>;
    isForceOverwrite?: boolean;
    targetPath?: string;
  }): Promise<DropboxFileMetadata> {
    const args: { mode: DropboxWriteMode; path: string; mute: boolean } = {
      mode: { '.tag': 'overwrite' },
      path,
      mute: true,
    };

    if (!isForceOverwrite) {
      args.mode = revToMatch
        ? { '.tag': 'update', update: revToMatch }
        : // Use 'add' mode for new files - will fail if file already exists
          { '.tag': 'add' };
    }

    try {
      const response = await this._request({
        method: 'POST',
        url: 'https://content.dropboxapi.com/2/files/upload',
        data,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Dropbox-API-Arg': JSON.stringify(args),
        },
        targetPath,
      });

      // with 429 response (Too many request) json is already parsed (sometimes?)
      // Defensive fallback preserves the old `tryCatchInlineAsync` swallow
      // semantics without the indirection.
      const result = (await response
        .json()
        .catch(() => ({}) as DropboxFileMetadata)) as DropboxFileMetadata;

      if (!result.rev) {
        throw new NoRevAPIError();
      }

      return result;
    } catch (e) {
      this._deps.logger.critical(
        `${DropboxApi.L}.upload() error`,
        errorMeta(e, { targetPath }),
      );
      this._checkCommonErrors(e, targetPath);
      throw e;
    }
  }

  /**
   * Delete a file from Dropbox
   */
  async remove(path: string, targetPath: string = path): Promise<unknown> {
    try {
      const response = await this._request({
        method: 'POST',
        url: 'https://api.dropboxapi.com/2/files/delete_v2',
        headers: { 'Content-Type': 'application/json' },
        data: { path },
        targetPath,
      });
      return response.json();
    } catch (e) {
      this._deps.logger.critical(
        `${DropboxApi.L}.remove() error`,
        errorMeta(e, { targetPath }),
      );
      this._checkCommonErrors(e, targetPath);
      throw e;
    }
  }

  // ==============================
  // Authentication Methods
  // ==============================

  /**
   * Check user authentication status
   */
  async checkUser(accessToken: string): Promise<unknown> {
    try {
      const response = await this._request({
        method: 'POST',
        url: 'https://api.dropboxapi.com/2/check/user',
        headers: { 'Content-Type': 'application/json' },
        accessToken,
      });
      return response.json();
    } catch (e) {
      this._deps.logger.critical(`${DropboxApi.L}.checkUser() error`, errorMeta(e));
      this._checkCommonErrors(e, 'check/user');
      throw e;
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async updateAccessTokenFromRefreshTokenIfAvailable(): Promise<void> {
    this._deps.logger.normal(
      `${DropboxApi.L}.updateAccessTokenFromRefreshTokenIfAvailable()`,
    );

    const privateCfg = await this._credentialStore.load();
    const refreshToken = privateCfg?.refreshToken;

    if (!refreshToken) {
      this._deps.logger.critical('Dropbox: No refresh token available');
      await this._clearTokensIfPresent(privateCfg);
      throw new MissingRefreshTokenAPIError();
    }

    const bodyParams = new URLSearchParams({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      client_id: this._appKey,
    }).toString();

    try {
      let data: TokenResponse;

      if (
        this._deps.platformInfo.isNativePlatform &&
        !this._deps.platformInfo.isIosNative
      ) {
        // Use CapacitorHttp on native platforms (except iOS), with retry for transient errors
        const response = await executeNativeRequestWithRetry(
          {
            url: DROPBOX_OAUTH_TOKEN_URL,
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            },
            data: bodyParams,
            responseType: 'json',
            readTimeout: NATIVE_AUTH_READ_TIMEOUT,
          },
          {
            executor: this._deps.nativeHttpExecutor,
            logger: this._deps.logger,
            label: DropboxApi.L,
          },
        );

        if (response.status < 200 || response.status >= 300) {
          if (
            response.status === 400 ||
            response.status === 401 ||
            response.status === 403
          ) {
            await this._clearTokensIfPresent(privateCfg);
            throw new MissingRefreshTokenAPIError();
          }
          throw new HttpNotOkAPIError(
            new Response(JSON.stringify(response.data), { status: response.status }),
          );
        }

        data = response.data as TokenResponse;
      } else {
        // Use fetch on web/Electron/iOS
        const response = await this._deps.webFetch()(DROPBOX_OAUTH_TOKEN_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          },
          body: bodyParams,
        });

        if (!response.ok) {
          if (
            response.status === 400 ||
            response.status === 401 ||
            response.status === 403
          ) {
            await this._clearTokensIfPresent(privateCfg);
            throw new MissingRefreshTokenAPIError();
          }
          throw new HttpNotOkAPIError(response);
        }

        data = (await response.json()) as TokenResponse;
      }

      this._deps.logger.normal('Dropbox: Refresh access token Response', {
        hasAccessToken: !!data.access_token,
        hasRefreshToken: !!data.refresh_token,
        expiresIn: data.expires_in,
      });

      await this._credentialStore.updatePartial({
        accessToken: data.access_token,
        refreshToken: data.refresh_token || privateCfg?.refreshToken,
      });
    } catch (e) {
      this._deps.logger.critical('Failed to refresh Dropbox access token', errorMeta(e));
      throw e;
    }
  }

  private async _clearTokensIfPresent(
    privateCfg: { accessToken?: string; refreshToken?: string } | null,
  ): Promise<void> {
    if (!privateCfg) {
      return;
    }
    await this._credentialStore.setComplete({
      ...(privateCfg as DropboxPrivateCfg),
      accessToken: '',
      refreshToken: '',
    });
  }

  /**
   * Get access and refresh tokens from authorization code
   */
  async getTokensFromAuthCode(
    authCode: string,
    codeVerifier: string,
    redirectUri: string | null,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  } | null> {
    try {
      const bodyParams: Record<string, string> = {
        code: authCode,
        grant_type: 'authorization_code',
        client_id: this._appKey,
        code_verifier: codeVerifier,
      };

      // Only include redirect_uri for mobile platforms
      if (redirectUri) {
        bodyParams.redirect_uri = redirectUri;
      }

      let data: TokenResponse;

      if (
        this._deps.platformInfo.isNativePlatform &&
        !this._deps.platformInfo.isIosNative
      ) {
        // One-time user-initiated auth code exchange: no retry. If it fails,
        // the user retries the OAuth flow manually. Going through the package
        // retry helper with maxRetries: 0 keeps a single executor invocation
        // path (consistency with refresh) without changing semantics.
        const response = await executeNativeRequestWithRetry(
          {
            url: DROPBOX_OAUTH_TOKEN_URL,
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            },
            data: new URLSearchParams(bodyParams).toString(),
            responseType: 'json',
            connectTimeout: 30000,
            readTimeout: NATIVE_AUTH_READ_TIMEOUT,
          },
          {
            executor: this._deps.nativeHttpExecutor,
            logger: this._deps.logger,
            label: DropboxApi.L,
            maxRetries: 0,
          },
        );

        if (response.status < 200 || response.status >= 300) {
          const bodyStr = JSON.stringify(response.data);
          throw new HttpNotOkAPIError(
            new Response(bodyStr, { status: response.status }),
            bodyStr,
          );
        }

        data = response.data as TokenResponse;
      } else {
        // Use fetch on web/Electron/iOS
        const response = await this._deps.webFetch()(DROPBOX_OAUTH_TOKEN_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          },
          body: new URLSearchParams(bodyParams),
        });

        if (!response.ok) {
          const bodyStr = await response.text();
          throw new HttpNotOkAPIError(
            new Response(bodyStr, { status: response.status }),
            bodyStr,
          );
        }

        data = (await response.json()) as TokenResponse;
      }

      // Validate response data
      if (typeof data.access_token !== 'string') {
        throw new Error('Dropbox: Invalid access token response');
      }
      if (typeof data.refresh_token !== 'string') {
        throw new Error('Dropbox: Invalid refresh token response');
      }
      if (typeof +data.expires_in !== 'number') {
        throw new Error('Dropbox: Invalid expiresIn response');
      }

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        // eslint-disable-next-line no-mixed-operators
        expiresAt: +data.expires_in * 1000 + Date.now(),
      };
    } catch (e) {
      // Raw `e` may contain the auth code or verifier from a rejection — only
      // a sanitized identity is safe to log.
      this._deps.logger.critical(
        `${DropboxApi.L}.getTokensFromAuthCode() error`,
        errorMeta(e),
      );
      throw e;
    }
  }

  // ==============================
  // Core Request Logic
  // ==============================

  /**
   * Make an authenticated request to the Dropbox API using CapacitorHttp.
   * Used on Android only (iOS uses fetch via CapacitorWebFetch instead).
   */
  private async _requestNative(options: DropboxApiOptions): Promise<Response> {
    const {
      url,
      method = 'GET',
      data,
      headers = {},
      params,
      accessToken,
      isSkipTokenRefresh = false,
      targetPath,
    } = options;

    let token = accessToken;
    if (!token) {
      const privateCfg = await this._credentialStore.load();
      if (!privateCfg?.accessToken) {
        throw new MissingCredentialsSPError('Dropbox no token');
      }
      token = privateCfg.accessToken;
    }

    // Add query params if needed
    const requestUrl =
      params && Object.keys(params).length
        ? `${url}?${new URLSearchParams(params)}`
        : url;

    // Prepare request headers
    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      ...headers,
    };

    // Set default content-type for JSON requests if not explicitly disabled or set
    if (
      requestHeaders['Content-Type'] === undefined &&
      data &&
      typeof data !== 'string' &&
      !requestHeaders['Dropbox-API-Arg']
    ) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    // Prepare request body
    let requestData: string | undefined;
    if (data !== undefined) {
      requestData = typeof data === 'string' ? data : JSON.stringify(data);
    }

    try {
      this._deps.logger.log(`${DropboxApi.L}._requestNative()`, {
        method,
        url: urlPathOnly(requestUrl),
      });

      const capacitorResponse = await executeNativeRequestWithRetry(
        {
          url: requestUrl,
          method,
          headers: requestHeaders,
          data: requestData,
          readTimeout: NATIVE_REQUEST_READ_TIMEOUT,
        },
        {
          executor: this._deps.nativeHttpExecutor,
          logger: this._deps.logger,
          label: DropboxApi.L,
        },
      );

      // Handle token refresh
      if (capacitorResponse.status === 401 && !isSkipTokenRefresh) {
        await this.updateAccessTokenFromRefreshTokenIfAvailable();
        return this._requestNative({
          ...options,
          isSkipTokenRefresh: true,
        });
      }

      // Convert CapacitorHttp response to fetch-like Response
      const response = this._convertCapacitorResponse(capacitorResponse);

      // Handle errors
      if (!response.ok) {
        await this._handleErrorResponse(response, targetPath ?? 'unknown', () =>
          this._requestNative({
            ...options,
            isSkipTokenRefresh: true,
          }),
        );
      }

      return response;
    } catch (e) {
      this._deps.logger.critical(
        `${DropboxApi.L}._requestNative() error`,
        errorMeta(e, { url: urlPathOnly(url) }),
      );
      this._checkCommonErrors(e, targetPath ?? url);
      throw e;
    }
  }

  /**
   * Convert CapacitorHttp response to a fetch-like Response object.
   * This ensures compatibility with existing code that expects fetch Response.
   */
  private _convertCapacitorResponse(capacitorResponse: NativeHttpResponse): Response {
    let responseData: unknown = capacitorResponse.data;

    // Ensure data is a string
    if (responseData === null || responseData === undefined) {
      responseData = '';
    } else if (typeof responseData !== 'string') {
      if (typeof responseData === 'object') {
        responseData = JSON.stringify(responseData);
      } else {
        responseData = String(responseData);
      }
    }

    // Create a Headers object from CapacitorHttp headers
    const headers = new Headers();
    if (capacitorResponse.headers) {
      Object.entries(capacitorResponse.headers).forEach(([key, value]) => {
        headers.set(key.toLowerCase(), value);
      });
    }

    return new Response(responseData as string, {
      status: capacitorResponse.status,
      headers,
    });
  }

  /**
   * Make an authenticated request to the Dropbox API
   */
  async _request(options: DropboxApiOptions): Promise<Response> {
    // On native platforms (except iOS), use CapacitorHttp.
    // iOS uses fetch (via CapacitorWebFetch) to bypass Capacitor's URLSession.shared,
    // which causes persistent -1005 "The network connection was lost" errors.
    // See: docs/long-term-plans/ios-dropbox-sync-reliability.md
    if (
      this._deps.platformInfo.isNativePlatform &&
      !this._deps.platformInfo.isIosNative
    ) {
      return this._requestNative(options);
    }
    const {
      url,
      method = 'GET',
      data,
      headers = {},
      params,
      accessToken,
      isSkipTokenRefresh = false,
      targetPath,
    } = options;

    let token = accessToken;
    if (!token) {
      const privateCfg = await this._credentialStore.load();
      if (!privateCfg?.accessToken) {
        throw new MissingCredentialsSPError('Dropbox no token');
      }
      token = privateCfg.accessToken;
    }

    // Add query params if needed
    const requestUrl =
      params && Object.keys(params).length
        ? `${url}?${new URLSearchParams(params)}`
        : url;

    // Prepare request options
    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      ...headers,
    };

    // Set default content-type for JSON requests if not explicitly disabled or set
    if (
      requestHeaders['Content-Type'] === undefined &&
      data &&
      typeof data !== 'string' &&
      !requestHeaders['Dropbox-API-Arg']
    ) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const requestOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    // Add request body if data is present
    if (data !== undefined) {
      requestOptions.body = typeof data === 'string' ? data : JSON.stringify(data);
    }

    try {
      const response = await this._deps.webFetch()(requestUrl, requestOptions);

      // Handle token refresh
      if (response.status === 401 && !isSkipTokenRefresh) {
        await this.updateAccessTokenFromRefreshTokenIfAvailable();
        return this._request({
          ...options,
          isSkipTokenRefresh: true,
        });
      }

      // Handle errors
      if (!response.ok) {
        await this._handleErrorResponse(response, targetPath ?? 'unknown', () =>
          this._request({
            ...options,
            isSkipTokenRefresh: true,
          }),
        );
      }

      return response;
    } catch (e) {
      this._deps.logger.critical(
        `${DropboxApi.L}._request() error`,
        errorMeta(e, { url: urlPathOnly(url) }),
      );
      this._checkCommonErrors(e, targetPath ?? url);
      throw e;
    }
  }

  /**
   * Handle error responses from the API.
   *
   * `targetPath` is the relative path before basePath was applied — we
   * never let basePath bleed into errors visible at catch sites (B3.2).
   */
  private async _handleErrorResponse(
    response: Response,
    targetPath: string,
    originalRequestExecutor: () => Promise<unknown>,
  ): Promise<never> {
    let responseData: DropboxErrorResponse = {};
    try {
      responseData = (await response.json()) as DropboxErrorResponse;
    } catch (e) {
      // Ignore JSON parse errors for non-JSON responses
    }

    // Handle rate limiting. Pass primitives only — never the raw
    // `headers` (contains the bearer token) or `responseData` (B3.1).
    if (responseData.error_summary?.includes('too_many_write_operations')) {
      const retryAfter = responseData.error?.retry_after;
      if (retryAfter) {
        return this._handleRateLimit(retryAfter, targetPath, originalRequestExecutor);
      }
      throw new TooManyRequestsAPIError({
        status: response.status,
        path: targetPath,
      });
    }

    // Handle specific error cases
    if (responseData.error_summary?.includes('path/not_found/')) {
      throw new RemoteFileNotFoundAPIError(targetPath, responseData);
    }

    // Handle conflict errors (rev mismatch or file exists with 'add' mode)
    if (responseData.error_summary?.includes('path/conflict/')) {
      throw new UploadRevToMatchMismatchAPIError(
        `Dropbox upload conflict for ${targetPath}: ${responseData.error_summary}`,
      );
    }

    if (response.status === 401) {
      // Drop raw responseData per B3.3 — `error_summary` is opaque but
      // can occasionally include account hints. Catch sites use
      // toSyncLogError(e) for a sanitized summary.
      if (
        responseData.error_summary?.includes('expired_access_token') ||
        responseData.error_summary?.includes('invalid_access_token')
      ) {
        throw new AuthFailSPError('Dropbox token expired or invalid', targetPath);
      }
      throw new AuthFailSPError(`Dropbox ${response.status}`, targetPath);
    }

    if (!response.ok) {
      throw new HttpNotOkAPIError(response);
    }

    // Throw formatted error for consistency
    throw {
      status: response.status,
      response: {
        status: response.status,
        data: responseData,
      },
      error_summary: responseData.error_summary,
    };
  }

  /**
   * Handle rate limiting by waiting and retrying
   */
  private _handleRateLimit(
    retryAfter: number,
    targetPath: string,
    originalRequestExecutor: () => Promise<unknown>,
  ): Promise<never> {
    const EXTRA_WAIT = 1;
    return new Promise((resolve, reject) => {
      setTimeout(
        () => {
          this._deps.logger.normal(`Too many requests, retrying`, {
            targetPath,
            retryAfter,
          });
          originalRequestExecutor()
            .then(resolve as (value: unknown) => void)
            .catch(reject);
        },
        (retryAfter + EXTRA_WAIT) * 1000,
      );
    });
  }

  /**
   * Check for common API errors and convert to appropriate custom errors
   */
  private _checkCommonErrors(e: unknown, targetPath: string): void {
    if (
      e instanceof RemoteFileNotFoundAPIError ||
      e instanceof AuthFailSPError ||
      e instanceof NoRevAPIError ||
      e instanceof TooManyRequestsAPIError
    ) {
      return;
    }

    const err = e as { status?: number; error_summary?: string } | null;

    if (err?.status === 401) {
      throw new AuthFailSPError(`Dropbox ${err.status}`, targetPath);
    }

    if (err?.error_summary?.includes('path/not_found/')) {
      throw new RemoteFileNotFoundAPIError(targetPath);
    }
  }
}
