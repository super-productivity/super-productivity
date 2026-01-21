import {
  SyncProviderAuthHelper,
  SyncProviderServiceInterface,
} from '../../provider.interface';
import { SyncProviderId } from '../../provider.const';
import {
  AuthFailSPError,
  InvalidDataSPError,
  RemoteFileNotFoundAPIError,
  NoRevAPIError,
} from '../../../core/errors/sync-errors';
import { PFLog } from '../../../../core/log';
import { DropboxApi } from './dropbox-api';
import { generatePKCECodes } from './generate-pkce-codes';
import { SyncCredentialStore } from '../../credential-store.service';
import { SyncProviderPrivateCfgBase } from '../../../core/types/sync.types';
import { IS_NATIVE_PLATFORM } from '../../../../util/is-native-platform';

const DROPBOX_AUTH_URL = 'https://www.dropbox.com/oauth2/authorize' as const;
const PATH_NOT_FOUND_ERROR = 'path/not_found' as const;
const EXPIRED_TOKEN_ERROR = 'expired_access_token' as const;
const INVALID_TOKEN_ERROR = 'invalid_access_token' as const;

export interface DropboxCfg {
  appKey: string;
  basePath: string;
}

export interface DropboxPrivateCfg extends SyncProviderPrivateCfgBase {
  accessToken: string;
  refreshToken: string;
}

interface DropboxApiError {
  response?: {
    status: number;
    data?: {
      error_summary?: string;
    };
  };
}

export class Dropbox implements SyncProviderServiceInterface<SyncProviderId.Dropbox> {
  private static readonly L = 'Dropbox';

  readonly id = SyncProviderId.Dropbox;
  readonly isUploadForcePossible = true;
  readonly maxConcurrentRequests = 4;

  private readonly _api: DropboxApi;
  private readonly _appKey: string;
  private readonly _basePath: string;

  public privateCfg: SyncCredentialStore<SyncProviderId.Dropbox>;

  constructor(cfg: DropboxCfg) {
    if (!cfg.appKey) {
      throw new Error('Missing appKey for Dropbox');
    }
    this._appKey = cfg.appKey;
    this._basePath = cfg.basePath || '/';
    this._api = new DropboxApi(this._appKey, this);
    this.privateCfg = new SyncCredentialStore(SyncProviderId.Dropbox);
  }

  async isReady(): Promise<boolean> {
    const privateCfg = await this.privateCfg.load();
    return !!this._appKey && !!privateCfg?.accessToken && !!privateCfg?.refreshToken;
  }

  async setPrivateCfg(privateCfg: DropboxPrivateCfg): Promise<void> {
    await this.privateCfg.setComplete(privateCfg);
  }

  /**
   * Gets the revision information for a file from Dropbox
   * @param targetPath Path to the target file
   * @param localRev Local revision to compare against
   * @returns Promise with the remote revision
   * @throws RemoteFileNotFoundAPIError if the file doesn't exist
   * @throws AuthFailSPError if authentication fails
   */
  async getFileRev(targetPath: string, localRev: string): Promise<{ rev: string }> {
    try {
      const r = await this._api.getMetaData(this._getPath(targetPath), localRev);
      return {
        rev: r.rev,
      };
    } catch (e) {
      if (this._isTokenError(e)) {
        PFLog.critical('EXPIRED or INVALID TOKEN, trying to refresh');
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
   * @param localRev Local revision to validate against
   * @returns Promise with the file data and revision
   * @throws NoRevAPIError if no revision is returned
   * @throws RemoteFileNotFoundAPIError if the file doesn't exist
   * @throws InvalidDataSPError if the data is invalid
   */
  async downloadFile(targetPath: string): Promise<{ rev: string; dataStr: string }> {
    try {
      const r = await this._api.download({
        path: this._getPath(targetPath),
      });

      if (!r.meta.rev) {
        throw new NoRevAPIError();
      }

      if (!r.data) {
        throw new RemoteFileNotFoundAPIError(targetPath);
      }

      if (typeof r.data !== 'string') {
        PFLog.critical(`${Dropbox.L}.${this.downloadFile.name}() data`, r.data);
        throw new InvalidDataSPError(r.data);
      }

      return {
        rev: r.meta.rev,
        dataStr: r.data,
      };
    } catch (e) {
      if (this._isTokenError(e)) {
        PFLog.critical('EXPIRED or INVALID TOKEN, trying to refresh');
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
        PFLog.normal(
          `${Dropbox.L}.${this.uploadFile.name}() got current rev for conditional upload: ${effectiveRev}`,
        );
      } catch (e) {
        if (!(e instanceof RemoteFileNotFoundAPIError)) {
          throw e;
        }
        // File doesn't exist - proceed without rev (will create new)
        PFLog.normal(
          `${Dropbox.L}.${this.uploadFile.name}() file does not exist, will create new`,
        );
      }
    }

    try {
      const r = await this._api.upload({
        path: this._getPath(targetPath),
        data: dataStr,
        revToMatch: effectiveRev,
        isForceOverwrite,
      });

      if (!r.rev) {
        throw new NoRevAPIError();
      }

      return {
        rev: r.rev,
      };
    } catch (e) {
      if (this._isTokenError(e)) {
        PFLog.critical('EXPIRED or INVALID TOKEN, trying to refresh');
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
      await this._api.remove(this._getPath(targetPath));
    } catch (e) {
      if (this._isTokenError(e)) {
        PFLog.critical('EXPIRED or INVALID TOKEN, trying to refresh');
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
    PFLog.normal(`${Dropbox.L}.${this.listFiles.name}()`, { dirPath });
    try {
      // DropboxApi.listFiles now returns full paths, so no need to prepend _getPath
      return await this._api.listFiles(this._getPath(dirPath));
    } catch (e) {
      if (this._isTokenError(e)) {
        PFLog.critical('EXPIRED or INVALID TOKEN, trying to refresh');
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
    const { codeVerifier, codeChallenge } = await generatePKCECodes(128);

    // Determine redirect URI based on platform (only for mobile)
    const redirectUri = this._getRedirectUri();

    let authCodeUrl =
      `${DROPBOX_AUTH_URL}` +
      `?response_type=code&client_id=${this._appKey}` +
      '&code_challenge_method=S256' +
      '&token_access_type=offline' +
      `&code_challenge=${codeChallenge}`;

    // Only add redirect_uri for mobile platforms
    if (redirectUri) {
      authCodeUrl += `&redirect_uri=${encodeURIComponent(redirectUri)}`;
    }

    return {
      authUrl: authCodeUrl,
      codeVerifier,
      verifyCodeChallenge: async <T>(authCode: string) => {
        return (await this._api.getTokensFromAuthCode(
          authCode,
          codeVerifier,
          redirectUri,
        )) as T;
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
   * Gets the appropriate OAuth redirect URI based on the current platform.
   *
   * Mobile platforms (iOS/Android/Android WebView):
   *   Returns custom URI scheme to enable automatic redirect back to app.
   *   Dropbox will redirect to: com.super-productivity.app://oauth-callback?code=xxx
   *
   * Web/Electron platforms:
   *   Returns null to use Dropbox's manual code entry flow.
   *   User must copy the code from Dropbox's page and paste it manually.
   *
   * @returns The redirect URI for mobile platforms, null for web/Electron
   */
  private _getRedirectUri(): string | null {
    if (IS_NATIVE_PLATFORM) {
      return 'com.super-productivity.app://oauth-callback';
    } else {
      // Web/Electron: Use manual code entry (no redirect_uri)
      return null;
    }
  }

  /**
   * Checks if an error is a path not found error
   * @param e The error to check
   * @returns True if it's a path not found error
   */
  private _isPathNotFoundError(e: unknown): boolean {
    const apiError = e as DropboxApiError;
    return !!apiError?.response?.data?.error_summary?.includes(PATH_NOT_FOUND_ERROR);
  }

  /**
   * Checks if an error is an unauthorized error
   * @param e The error to check
   * @returns True if it's an unauthorized error
   */
  private _isUnauthorizedError(e: unknown): boolean {
    const apiError = e as DropboxApiError;
    return apiError?.response?.status === 401;
  }

  /**
   * Checks if an error is related to expired or invalid tokens
   * @param e The error to check
   * @returns True if it's a token-related error
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
