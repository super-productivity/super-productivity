import type { SyncLogger } from '@sp/sync-core';
import type { ProviderPlatformInfo } from '../../platform/provider-platform-info';
import type { WebFetchFactory } from '../../platform/web-fetch-factory';
import type { SyncCredentialStorePort } from '../../credential-store-port';
import type { NativeHttpExecutor } from '../../http/native-http-retry';
import type { FileSyncProvider, SyncProviderAuthHelper } from '../../provider.types';
import {
  AuthFailSPError,
  InvalidDataSPError,
  NoRevAPIError,
  RemoteFileNotFoundAPIError,
} from '../../errors';
import { generatePKCECodes } from '../../pkce';
import { DropboxApi } from './dropbox-api';

/**
 * Stable runtime identifier for the Dropbox provider. The string literal
 * (not an enum) keeps the package free of app-level enums while remaining
 * structurally compatible with `SyncProviderId.Dropbox` on the app side.
 */
export const PROVIDER_ID_DROPBOX = 'Dropbox' as const;

const DROPBOX_AUTH_URL = 'https://www.dropbox.com/oauth2/authorize' as const;
const PATH_NOT_FOUND_ERROR = 'path/not_found' as const;
const EXPIRED_TOKEN_ERROR = 'expired_access_token' as const;
const INVALID_TOKEN_ERROR = 'invalid_access_token' as const;

export interface DropboxCfg {
  appKey: string;
  basePath: string;
}

export interface DropboxPrivateCfg {
  encryptKey?: string;
  accessToken: string;
  refreshToken: string;
}

export interface DropboxDeps {
  logger: SyncLogger;
  platformInfo: ProviderPlatformInfo;
  webFetch: WebFetchFactory;
  credentialStore: SyncCredentialStorePort<typeof PROVIDER_ID_DROPBOX, DropboxPrivateCfg>;
  nativeHttpExecutor: NativeHttpExecutor;
}

interface DropboxApiError {
  response?: {
    status: number;
    data?: {
      error_summary?: string;
    };
  };
}

export class Dropbox implements FileSyncProvider<
  typeof PROVIDER_ID_DROPBOX,
  DropboxPrivateCfg
> {
  private static readonly L = 'Dropbox';

  readonly id = PROVIDER_ID_DROPBOX;
  readonly isUploadForcePossible = true;
  readonly maxConcurrentRequests = 4;

  private readonly _api: DropboxApi;
  private readonly _appKey: string;
  private readonly _basePath: string;

  // Cached PKCE material — the verifier paired with the URL the user is
  // looking at. Reused across `getAuthHelper()` calls so a user who closes
  // and reopens the auth dialog (e.g. after `shell.openExternal()` fails
  // silently in Flatpak — issue #7139) can still exchange a code obtained
  // from the originally-shown URL. Cached as a Promise (not the resolved
  // value) so concurrent callers share one PKCE generation rather than
  // racing. Cleared on successful exchange and on explicit credential clear.
  // The Dropbox provider is a process-singleton via the providers factory,
  // so the cache spans the user session.
  private _pkcePromise: Promise<{
    codeVerifier: string;
    authUrl: string;
  }> | null = null;

  readonly privateCfg: SyncCredentialStorePort<
    typeof PROVIDER_ID_DROPBOX,
    DropboxPrivateCfg
  >;

  constructor(
    cfg: DropboxCfg,
    private readonly _deps: DropboxDeps,
  ) {
    if (!cfg.appKey) {
      throw new Error('Missing appKey for Dropbox');
    }
    this._appKey = cfg.appKey;
    this._basePath = cfg.basePath || '/';
    this.privateCfg = _deps.credentialStore;
    this._api = new DropboxApi(this._appKey, _deps);
  }

  async isReady(): Promise<boolean> {
    const privateCfg = await this.privateCfg.load();
    return !!this._appKey && !!privateCfg?.accessToken && !!privateCfg?.refreshToken;
  }

  async setPrivateCfg(privateCfg: DropboxPrivateCfg): Promise<void> {
    await this.privateCfg.setComplete(privateCfg);
  }

  async clearAuthCredentials(): Promise<void> {
    this._pkcePromise = null;
    const cfg = await this.privateCfg.load();
    if (cfg?.accessToken || cfg?.refreshToken) {
      await this.privateCfg.setComplete({ ...cfg, accessToken: '', refreshToken: '' });
    }
  }

  /**
   * Gets the revision information for a file from Dropbox
   * @param targetPath Path to the target file
   * @param localRev Local revision to compare against
   * @returns Promise with the remote revision
   * @throws RemoteFileNotFoundAPIError if the file doesn't exist
   * @throws AuthFailSPError if authentication fails
   */
  async getFileRev(
    targetPath: string,
    localRev: string | null,
  ): Promise<{ rev: string }> {
    try {
      const r = await this._api.getMetaData(
        this._getPath(targetPath),
        localRev,
        targetPath,
      );
      return {
        rev: r.rev,
      };
    } catch (e) {
      if (this._isTokenError(e)) {
        this._deps.logger.critical('EXPIRED or INVALID TOKEN, trying to refresh');
        await this._api.updateAccessTokenFromRefreshTokenIfAvailable();
        return this.getFileRev(targetPath, localRev);
      }

      if (this._isPathNotFoundError(e)) {
        throw new RemoteFileNotFoundAPIError(targetPath);
      }

      if (this._isUnauthorizedError(e)) {
        throw new AuthFailSPError('Dropbox 401 getFileRev', targetPath);
      }

      throw e;
    }
  }

  /**
   * Downloads a file from Dropbox
   * @param targetPath Path to the target file
   * @returns Promise with the file data and revision
   * @throws NoRevAPIError if no revision is returned
   * @throws RemoteFileNotFoundAPIError if the file doesn't exist
   * @throws InvalidDataSPError if the data is invalid
   */
  async downloadFile(targetPath: string): Promise<{ rev: string; dataStr: string }> {
    try {
      const r = await this._api.download({
        path: this._getPath(targetPath),
        targetPath,
      });

      if (!r.meta.rev) {
        throw new NoRevAPIError();
      }

      if (!r.data) {
        throw new RemoteFileNotFoundAPIError(targetPath);
      }

      if (typeof r.data !== 'string') {
        // A1: never log the raw user blob — only its shape.
        this._deps.logger.critical(`${Dropbox.L}.downloadFile got non-string data`, {
          dataType: typeof r.data,
        });
        throw new InvalidDataSPError('Dropbox download returned non-string data');
      }

      return {
        rev: r.meta.rev,
        dataStr: r.data,
      };
    } catch (e) {
      if (this._isTokenError(e)) {
        this._deps.logger.critical('EXPIRED or INVALID TOKEN, trying to refresh');
        await this._api.updateAccessTokenFromRefreshTokenIfAvailable();
        return this.downloadFile(targetPath);
      }
      throw e;
    }
  }

  /**
   * Uploads a file to Dropbox
   * @param targetPath Path to the target file
   * @param dataStr Data to upload
   * @param revToMatch Revision to match for conflict prevention
   * @param isForceOverwrite Whether to force overwrite the file
   * @returns Promise with the new revision
   * @throws NoRevAPIError if no revision is returned
   */
  async uploadFile(
    targetPath: string,
    dataStr: string,
    revToMatch: string | null,
    isForceOverwrite: boolean = false,
  ): Promise<{ rev: string }> {
    let effectiveRev = revToMatch;

    // If no rev provided and not force overwrite, get current rev first
    if (!effectiveRev && !isForceOverwrite) {
      try {
        const current = await this.getFileRev(targetPath, '');
        effectiveRev = current.rev;
        this._deps.logger.normal(
          `${Dropbox.L}.uploadFile got current rev for conditional upload`,
          { targetPath, hasRev: !!effectiveRev },
        );
      } catch (e) {
        if (!(e instanceof RemoteFileNotFoundAPIError)) {
          throw e;
        }
        // File doesn't exist - proceed without rev (will create new)
        this._deps.logger.normal(`${Dropbox.L}.uploadFile file does not exist`, {
          targetPath,
        });
      }
    }

    try {
      const r = await this._api.upload({
        path: this._getPath(targetPath),
        data: dataStr,
        revToMatch: effectiveRev,
        isForceOverwrite,
        targetPath,
      });

      if (!r.rev) {
        throw new NoRevAPIError();
      }

      return {
        rev: r.rev,
      };
    } catch (e) {
      if (this._isTokenError(e)) {
        this._deps.logger.critical('EXPIRED or INVALID TOKEN, trying to refresh');
        await this._api.updateAccessTokenFromRefreshTokenIfAvailable();
        return this.uploadFile(targetPath, dataStr, revToMatch, isForceOverwrite);
      }
      throw e;
    }
  }

  /**
   * Removes a file from Dropbox
   * @param targetPath Path to the target file
   * @throws RemoteFileNotFoundAPIError if the file doesn't exist
   * @throws AuthFailSPError if authentication fails
   */
  async removeFile(targetPath: string): Promise<void> {
    try {
      await this._api.remove(this._getPath(targetPath), targetPath);
    } catch (e) {
      if (this._isTokenError(e)) {
        this._deps.logger.critical('EXPIRED or INVALID TOKEN, trying to refresh');
        await this._api.updateAccessTokenFromRefreshTokenIfAvailable();
        return this.removeFile(targetPath);
      }

      if (this._isPathNotFoundError(e)) {
        throw new RemoteFileNotFoundAPIError(targetPath);
      }

      if (this._isUnauthorizedError(e)) {
        throw new AuthFailSPError('Dropbox 401 removeFile', targetPath);
      }

      throw e;
    }
  }

  async listFiles(dirPath: string): Promise<string[]> {
    this._deps.logger.normal(`${Dropbox.L}.listFiles()`, { dirPath });
    try {
      // DropboxApi.listFiles now returns full paths, so no need to prepend _getPath
      return await this._api.listFiles(this._getPath(dirPath), dirPath);
    } catch (e) {
      if (this._isTokenError(e)) {
        this._deps.logger.critical('EXPIRED or INVALID TOKEN, trying to refresh');
        await this._api.updateAccessTokenFromRefreshTokenIfAvailable();
        return this.listFiles(dirPath);
      }

      if (this._isPathNotFoundError(e)) {
        // If the directory doesn't exist, return empty array
        return [];
      }

      if (this._isUnauthorizedError(e)) {
        throw new AuthFailSPError('Dropbox 401 listFiles', dirPath);
      }

      throw e;
    }
  }

  /**
   * Gets authentication helper for OAuth flow
   * @returns Promise with auth helper object
   */
  async getAuthHelper(): Promise<SyncProviderAuthHelper> {
    const redirectUri = this._getRedirectUri();

    // Cache the in-flight Promise so concurrent callers (e.g. a double-clicked
    // auth button) share one PKCE generation instead of racing.
    if (!this._pkcePromise) {
      const inFlight = (async () => {
        const { codeVerifier, codeChallenge } = await generatePKCECodes(128);
        let authCodeUrl =
          `${DROPBOX_AUTH_URL}` +
          `?response_type=code&client_id=${this._appKey}` +
          '&code_challenge_method=S256' +
          '&token_access_type=offline' +
          `&code_challenge=${codeChallenge}`;
        if (redirectUri) {
          authCodeUrl += `&redirect_uri=${encodeURIComponent(redirectUri)}`;
        }
        return { codeVerifier, authUrl: authCodeUrl };
      })();
      // Don't poison the cache with a rejection — let a future call retry.
      inFlight.catch(() => {
        if (this._pkcePromise === inFlight) {
          this._pkcePromise = null;
        }
      });
      this._pkcePromise = inFlight;
    }

    // Captured by closure so the success-path nulling below doesn't strand an
    // in-flight verifyCodeChallenge call.
    const cached = await this._pkcePromise;
    return {
      authUrl: cached.authUrl,
      codeVerifier: cached.codeVerifier,
      verifyCodeChallenge: async (authCode: string) => {
        const result = await this._api.getTokensFromAuthCode(
          authCode,
          cached.codeVerifier,
          redirectUri,
        );
        this._pkcePromise = null;
        if (!result) {
          throw new Error('Dropbox: getTokensFromAuthCode returned null');
        }
        return result;
      },
    };
  }

  /**
   * Gets the full path including base path
   * @param path The relative path
   * @returns The full path
   */
  private _getPath(path: string): string {
    return this._basePath + path;
  }

  /**
   * Gets the OAuth redirect URI.
   *
   * Returns null on all platforms to use Dropbox's manual code entry flow.
   * User copies the code from Dropbox's page and pastes it manually.
   * This is the most reliable cross-platform approach — the automatic deep-link
   * redirect flow was reverted because the Dropbox developer console redirect URI
   * registration is uncertain and Android may kill the app during auth, losing
   * the in-memory code verifier.
   */
  private _getRedirectUri(): string | null {
    return null;
  }

  /**
   * Checks if an error is a path not found error
   */
  private _isPathNotFoundError(e: unknown): boolean {
    const apiError = e as DropboxApiError;
    return !!apiError?.response?.data?.error_summary?.includes(PATH_NOT_FOUND_ERROR);
  }

  /**
   * Checks if an error is an unauthorized error
   */
  private _isUnauthorizedError(e: unknown): boolean {
    const apiError = e as DropboxApiError;
    return apiError?.response?.status === 401;
  }

  /**
   * Checks if an error is related to expired or invalid tokens
   */
  private _isTokenError(e: unknown): boolean {
    const apiError = e as DropboxApiError;
    return !!(
      apiError?.response?.status === 401 &&
      (apiError.response.data?.error_summary?.includes(EXPIRED_TOKEN_ERROR) ||
        apiError.response.data?.error_summary?.includes(INVALID_TOKEN_ERROR))
    );
  }
}
