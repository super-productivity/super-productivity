/* eslint-disable @typescript-eslint/naming-convention */

import { stringify } from 'query-string';
import { CapacitorHttp, Capacitor, HttpResponse } from '@capacitor/core';
import { DropboxFileMetadata } from '../../../../imex/sync/dropbox/dropbox.model';
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
} from '../../../core/errors/sync-errors';
import { SyncLog } from '../../../../core/log';
import { SyncProviderServiceInterface } from '../../provider.interface';
import { SyncProviderId } from '../../provider.const';
import { tryCatchInlineAsync } from '../../../../util/try-catch-inline';
import { IS_ANDROID_WEB_VIEW } from '../../../../util/is-android-web-view';
import { executeNativeRequestWithRetry } from '../../native-http-retry';

interface DropboxApiOptions {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  data?: string | Record<string, unknown>;
  params?: Record<string, string>;
  accessToken?: string;
  isSkipTokenRefresh?: boolean;
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

/**
 * API class for Dropbox integration
 */
export class DropboxApi {
  private static readonly L = 'DropboxApi';

  constructor(
    private _appKey: string,
    private _parent: SyncProviderServiceInterface<SyncProviderId.Dropbox>,
  ) {}

  /**
   * Check if running on a native platform (iOS/Android).
   * On native platforms, we use CapacitorHttp instead of fetch() to avoid
   * issues with iOS WebKit and Android WebView handling of HTTP requests.
   */
  protected get isNativePlatform(): boolean {
    return Capacitor.isNativePlatform() || IS_ANDROID_WEB_VIEW;
  }

  // ==============================
  // File Operations
  // ==============================

  /**
   * List folder contents
   */
  async listFiles(path: string): Promise<string[]> {
    SyncLog.normal(`${DropboxApi.L}.listFiles() for path: ${path}`);
    try {
      const response = await this._request({
        method: 'POST',
        url: 'https://api.dropboxapi.com/2/files/list_folder',
        headers: { 'Content-Type': 'application/json' },
        data: { path },
      });
      const result = (await response.json()) as DropboxListFolderResult;
      if (!result || !result.entries) {
        return [];
      }
      return result.entries
        .filter((entry) => entry['.tag'] === 'file') // Only return files
        .map((entry) => entry.path_lower); // Return full path in lower case
    } catch (e) {
      SyncLog.critical(`${DropboxApi.L}.listFiles() error for path: ${path}`, e);
      this._checkCommonErrors(e, path);
      throw e;
    }
  }

  /**
   * Retrieve metadata for a file or folder
   */
  async getMetaData(path: string, localRev: string): Promise<DropboxFileMetadata> {
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
      });
      return response.json();
    } catch (e) {
      SyncLog.critical(`${DropboxApi.L}.getMetaData() error for path: ${path}`, e);
      this._checkCommonErrors(e, path);
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
  }: {
    path: string;
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
      SyncLog.critical(`${DropboxApi.L}.download() error for path: ${path}`, e);
      this._checkCommonErrors(e, path);
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
  }: {
    path: string;
    revToMatch?: string | null;
    data: string | Record<string, unknown>;
    isForceOverwrite?: boolean;
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
      });

      // with 429 response (Too many request) json is already parsed (sometimes?)
      const result = await tryCatchInlineAsync(() => response.json(), response);

      if (!result.rev) {
        throw new NoRevAPIError();
      }

      return result;
    } catch (e) {
      SyncLog.critical(`${DropboxApi.L}.upload() error for path: ${path}`, e);
      this._checkCommonErrors(e, path);
      throw e;
    }
  }

  /**
   * Delete a file from Dropbox
   */
  async remove(path: string): Promise<unknown> {
    try {
      const response = await this._request({
        method: 'POST',
        url: 'https://api.dropboxapi.com/2/files/delete_v2',
        headers: { 'Content-Type': 'application/json' },
        data: { path },
      });
      return response.json();
    } catch (e) {
      SyncLog.critical(`${DropboxApi.L}.remove() error for path: ${path}`, e);
      this._checkCommonErrors(e, path);
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
      SyncLog.critical(`${DropboxApi.L}.checkUser() error`, e);
      this._checkCommonErrors(e, 'check/user');
      throw e;
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async updateAccessTokenFromRefreshTokenIfAvailable(): Promise<void> {
    SyncLog.normal(`${DropboxApi.L}.updateAccessTokenFromRefreshTokenIfAvailable()`);

    const privateCfg = await this._parent.privateCfg.load();
    const refreshToken = privateCfg?.refreshToken;

    if (!refreshToken) {
      SyncLog.critical('Dropbox: No refresh token available');
      await this._clearTokensIfPresent(privateCfg);
      throw new MissingRefreshTokenAPIError();
    }

    const bodyParams = stringify({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      client_id: this._appKey,
    });

    try {
      let data: TokenResponse;

      if (this.isNativePlatform) {
        // Use CapacitorHttp on native platforms, with retry for transient errors
        const response = await executeNativeRequestWithRetry(
          {
            url: 'https://api.dropbox.com/oauth2/token',
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            },
            data: bodyParams,
            responseType: 'json',
            readTimeout: NATIVE_AUTH_READ_TIMEOUT,
          },
          DropboxApi.L,
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
        // Use fetch on web/Electron
        const response = await fetch('https://api.dropbox.com/oauth2/token', {
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

      SyncLog.normal('Dropbox: Refresh access token Response', data);

      await this._parent.privateCfg.updatePartial({
        accessToken: data.access_token,
        refreshToken: data.refresh_token || privateCfg?.refreshToken,
      });
    } catch (e) {
      SyncLog.critical('Failed to refresh Dropbox access token', e);
      throw e;
    }
  }

  private async _clearTokensIfPresent(
    privateCfg: { accessToken?: string; refreshToken?: string } | null,
  ): Promise<void> {
    if (!privateCfg) {
      return;
    }
    await this._parent.privateCfg.setComplete({
      ...privateCfg,
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

      if (this.isNativePlatform) {
        // No retry wrapper here: this is a one-time user-initiated auth code exchange.
        // If it fails, the user retries the OAuth flow manually.
        const response = await CapacitorHttp.request({
          url: 'https://api.dropboxapi.com/oauth2/token',
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          },
          data: stringify(bodyParams),
          responseType: 'json',
          connectTimeout: 30000,
          readTimeout: NATIVE_AUTH_READ_TIMEOUT,
        });

        if (response.status < 200 || response.status >= 300) {
          throw new HttpNotOkAPIError(
            new Response(JSON.stringify(response.data), { status: response.status }),
          );
        }

        data = response.data as TokenResponse;
      } else {
        // Use fetch on web/Electron
        const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          },
          body: stringify(bodyParams),
        });

        if (!response.ok) {
          throw new HttpNotOkAPIError(response);
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
      SyncLog.critical(`${DropboxApi.L}.getTokensFromAuthCode() error`, e);
      throw e;
    }
  }

  // ==============================
  // Core Request Logic
  // ==============================

  /**
   * Make an authenticated request to the Dropbox API using CapacitorHttp.
   * Used on native platforms (iOS/Android) to avoid issues with fetch().
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
    } = options;

    let token = accessToken;
    if (!token) {
      const privateCfg = await this._parent.privateCfg.load();
      if (!privateCfg?.accessToken) {
        throw new MissingCredentialsSPError('Dropbox no token');
      }
      token = privateCfg.accessToken;
    }

    // Add query params if needed
    const requestUrl =
      params && Object.keys(params).length ? `${url}?${stringify(params)}` : url;

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
      SyncLog.log(`${DropboxApi.L}._requestNative() ${method} ${requestUrl}`);

      const capacitorResponse = await this._executeNativeRequestWithRetry({
        url: requestUrl,
        method,
        headers: requestHeaders,
        data: requestData,
      });

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
        const path = headers['Dropbox-API-Arg']
          ? JSON.parse(headers['Dropbox-API-Arg']).path
          : 'unknown';

        await this._handleErrorResponse(response, requestHeaders, path, () =>
          this._requestNative({
            ...options,
            isSkipTokenRefresh: true,
          }),
        );
      }

      return response;
    } catch (e) {
      SyncLog.critical(`${DropboxApi.L}._requestNative() error for ${url}`, e);
      this._checkCommonErrors(e, url);
      throw e;
    }
  }

  /**
   * Convert CapacitorHttp response to a fetch-like Response object.
   * This ensures compatibility with existing code that expects fetch Response.
   */
  private _convertCapacitorResponse(capacitorResponse: HttpResponse): Response {
    let responseData = capacitorResponse.data;

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

    return new Response(responseData, {
      status: capacitorResponse.status,
      headers,
    });
  }

  /**
   * Make an authenticated request to the Dropbox API
   */
  async _request(options: DropboxApiOptions): Promise<Response> {
    // On native platforms, use CapacitorHttp for consistent behavior
    if (this.isNativePlatform) {
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
    } = options;

    let token = accessToken;
    if (!token) {
      const privateCfg = await this._parent.privateCfg.load();
      if (!privateCfg?.accessToken) {
        throw new MissingCredentialsSPError('Dropbox no token');
      }
      token = privateCfg.accessToken;
    }

    // Add query params if needed
    const requestUrl =
      params && Object.keys(params).length ? `${url}?${stringify(params)}` : url;

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
      const response = await fetch(requestUrl, requestOptions);

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
        const path = headers['Dropbox-API-Arg']
          ? JSON.parse(headers['Dropbox-API-Arg']).path
          : 'unknown';

        await this._handleErrorResponse(response, requestHeaders, path, () =>
          this._request({
            ...options,
            isSkipTokenRefresh: true,
          }),
        );
      }

      return response;
    } catch (e) {
      SyncLog.critical(`${DropboxApi.L}._request() error for ${url}`, e);
      this._checkCommonErrors(e, url);
      throw e;
    }
  }

  /**
   * Handle error responses from the API
   */
  private async _handleErrorResponse(
    response: Response,
    headers: Record<string, string>,
    path: string,
    originalRequestExecutor: () => Promise<unknown>,
  ): Promise<never> {
    let responseData: DropboxErrorResponse = {};
    try {
      responseData = await response.json();
    } catch (e) {
      // Ignore JSON parse errors for non-JSON responses
    }

    // Handle rate limiting
    if (responseData.error_summary?.includes('too_many_write_operations')) {
      const retryAfter = responseData.error?.retry_after;
      if (retryAfter) {
        return this._handleRateLimit(retryAfter, path, originalRequestExecutor);
      }
      throw new TooManyRequestsAPIError({ response, headers, responseData });
    }

    // Handle specific error cases
    if (responseData.error_summary?.includes('path/not_found/')) {
      throw new RemoteFileNotFoundAPIError(path, responseData);
    }

    // Handle conflict errors (rev mismatch or file exists with 'add' mode)
    if (responseData.error_summary?.includes('path/conflict/')) {
      throw new UploadRevToMatchMismatchAPIError(
        `Dropbox upload conflict for ${path}: ${responseData.error_summary}`,
      );
    }

    if (response.status === 401) {
      if (
        responseData.error_summary?.includes('expired_access_token') ||
        responseData.error_summary?.includes('invalid_access_token')
      ) {
        throw new AuthFailSPError('Dropbox token expired or invalid', '', responseData);
      }
      throw new AuthFailSPError(`Dropbox ${response.status}`, '', responseData);
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
    path: string,
    originalRequestExecutor: () => Promise<unknown>,
  ): Promise<never> {
    const EXTRA_WAIT = 1;
    return new Promise((resolve, reject) => {
      setTimeout(
        () => {
          SyncLog.normal(`Too many requests ${path}, retrying in ${retryAfter}s...`);
          originalRequestExecutor()
            .then(resolve as (value: unknown) => void)
            .catch(reject);
        },
        (retryAfter + EXTRA_WAIT) * 1000,
      );
    });
  }

  /**
   * Execute a CapacitorHttp request with retry logic for transient network errors.
   * Delegates to the shared retry utility.
   */
  private async _executeNativeRequestWithRetry(config: {
    url: string;
    method: HttpMethod;
    headers: Record<string, string>;
    data: string | undefined;
  }): Promise<HttpResponse> {
    return executeNativeRequestWithRetry(
      {
        url: config.url,
        method: config.method,
        headers: config.headers,
        data: config.data,
        readTimeout: NATIVE_REQUEST_READ_TIMEOUT,
      },
      DropboxApi.L,
    );
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
