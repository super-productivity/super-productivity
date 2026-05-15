import type { SyncLogger } from '@sp/sync-core';
import type { ProviderPlatformInfo } from '../../platform/provider-platform-info';
import type { WebFetchFactory } from '../../platform/web-fetch-factory';
import type { NativeHttpExecutor } from '../../http/native-http-retry';
import type { SyncCredentialStorePort } from '../../credential-store-port';
import type { FileSyncProvider } from '../../provider-types';
import {
  InvalidDataSPError,
  MissingCredentialsSPError,
  RemoteFileChangedUnexpectedly,
  UploadRevToMatchMismatchAPIError,
} from '../../errors';
import { WebDavHttpAdapter } from './webdav-http-adapter';
import { WebdavApi } from './webdav-api';
import type { WebdavPrivateCfg } from './webdav.model';

/**
 * Stable runtime identifier for the standard WebDAV provider. The string
 * literal keeps the package free of app-level enums while remaining
 * structurally compatible with `SyncProviderId.WebDAV` on the app side.
 */
export const PROVIDER_ID_WEBDAV = 'WebDAV' as const;

/**
 * Stable runtime identifier for the Nextcloud-flavored WebDAV provider.
 * Carries its own ID so credentials and config UI can stay separated from
 * generic WebDAV while reusing the same transport.
 */
export const PROVIDER_ID_NEXTCLOUD = 'Nextcloud' as const;

export type WebdavProviderId = typeof PROVIDER_ID_WEBDAV | typeof PROVIDER_ID_NEXTCLOUD;

export interface WebdavBaseDeps<T extends WebdavProviderId, TPrivateCfg> {
  logger: SyncLogger;
  platformInfo: ProviderPlatformInfo;
  webFetch: WebFetchFactory;
  /**
   * Native HTTP path. On Capacitor platforms the app injects an adapter
   * wired to the `WebDavHttp` plugin (bypassing `CapacitorHttp`); on
   * web/Electron the same `NativeHttpExecutor` port is used but the
   * adapter chooses fetch instead based on `platformInfo.isNativePlatform`.
   */
  nativeHttp: NativeHttpExecutor;
  credentialStore: SyncCredentialStorePort<T, TPrivateCfg>;
}

/**
 * Abstract WebDAV base provider. Concrete subclasses (`Webdav`,
 * `NextcloudProvider`) supply the provider id and the cfg loader; the
 * base handles file ops, conditional uploads, hash-based revisions, and
 * post-upload integrity verification via `WebdavApi`.
 */
/**
 * Bare-credential surface every WebDAV-flavored cfg must expose. The
 * `isReady` path in the base provider only reads these fields. Concrete
 * cfgs (`WebdavPrivateCfg`, `NextcloudPrivateCfg`) extend with their own
 * required fields.
 */
type WebdavCredentialsLike = {
  userName?: string;
  password?: string;
  baseUrl?: string;
  syncFolderPath?: string;
};

export abstract class WebdavBaseProvider<
  T extends WebdavProviderId,
  TPrivateCfg extends WebdavCredentialsLike = WebdavPrivateCfg,
> implements FileSyncProvider<T, TPrivateCfg> {
  abstract readonly id: T;
  readonly isUploadForcePossible = false;
  readonly maxConcurrentRequests = 10;

  readonly privateCfg: SyncCredentialStorePort<T, TPrivateCfg>;
  protected readonly _api: WebdavApi;
  protected readonly _logger: SyncLogger;
  protected readonly _extraPath?: string;

  constructor(deps: WebdavBaseDeps<T, TPrivateCfg>, extraPath?: string) {
    this.privateCfg = deps.credentialStore;
    this._logger = deps.logger;
    this._extraPath = extraPath;

    const httpAdapter = new WebDavHttpAdapter({
      platformInfo: deps.platformInfo,
      webFetch: deps.webFetch,
      nativeHttp: deps.nativeHttp,
      logger: deps.logger,
    });
    this._api = new WebdavApi({
      logger: deps.logger,
      getCfg: () => this._cfgOrError(),
      httpAdapter,
    });
  }

  protected get logLabel(): string {
    return 'WebdavBaseProvider';
  }

  async isReady(): Promise<boolean> {
    const privateCfg = await this.privateCfg.load();
    return !!(
      privateCfg &&
      privateCfg.userName &&
      privateCfg.baseUrl &&
      privateCfg.syncFolderPath &&
      privateCfg.password
    );
  }

  async setPrivateCfg(privateCfg: TPrivateCfg): Promise<void> {
    await this.privateCfg.setComplete(privateCfg);
  }

  // `clearAuthCredentials` is intentionally NOT implemented for WebDAV /
  // Nextcloud: the credential is a user-typed, often-irrecoverable password,
  // not a refreshable token — clearing it on a recoverable 401 is
  // irreversible data loss. See the contract on `SyncProviderBase`
  // (provider-types.ts) and issue #7616. Regression-guarded by
  // webdav-base-provider.spec.ts. Do NOT add an override here.

  async getFileRev(
    targetPath: string,
    _localRev: string | null,
  ): Promise<{ rev: string }> {
    const r = await this.downloadFile(targetPath);
    return { rev: r.rev };
  }

  async uploadFile(
    targetPath: string,
    dataStr: string,
    localRev: string,
    isForceOverwrite: boolean = false,
  ): Promise<{ rev: string }> {
    this._logger.normal(`${this.logLabel}.uploadFile()`, {
      targetPath,
      isForceOverwrite,
      hasRev: !!localRev,
    });
    const { filePath } = await this._getConfigAndPath(targetPath);

    try {
      const result = await this._api.upload({
        path: filePath,
        data: dataStr,
        isForceOverwrite,
        expectedRev: isForceOverwrite ? null : localRev,
      });
      return { rev: result.rev };
    } catch (e) {
      // Translate RemoteFileChangedUnexpectedly to UploadRevToMatchMismatchAPIError
      // so FileBasedSyncAdapterService._uploadWithMismatchFallback() can handle it
      if (e instanceof RemoteFileChangedUnexpectedly) {
        throw new UploadRevToMatchMismatchAPIError(e.message);
      }
      throw e;
    }
  }

  async downloadFile(targetPath: string): Promise<{ rev: string; dataStr: string }> {
    this._logger.normal(`${this.logLabel}.downloadFile()`, { targetPath });
    const { filePath } = await this._getConfigAndPath(targetPath);

    const result = await this._api.download({ path: filePath });

    if (result.dataStr == null) {
      throw new InvalidDataSPError(targetPath);
    }

    return { rev: result.rev, dataStr: result.dataStr };
  }

  async removeFile(targetPath: string): Promise<void> {
    this._logger.normal(`${this.logLabel}.removeFile()`, { targetPath });
    const { filePath } = await this._getConfigAndPath(targetPath);
    await this._api.remove(filePath);
  }

  async listFiles(dirPath: string): Promise<string[]> {
    this._logger.normal(`${this.logLabel}.listFiles()`, { dirPath });
    const { filePath } = await this._getConfigAndPath(dirPath);
    return this._api.listFiles(filePath);
  }

  protected _getFilePath(targetPath: string, cfg: WebdavPrivateCfg): string {
    const parts = cfg.syncFolderPath ? [cfg.syncFolderPath] : [];
    if (this._extraPath) {
      parts.push(this._extraPath);
    }
    parts.push(targetPath);
    return parts.join('/').replace(/\/+/g, '/');
  }

  /**
   * Returns a fully-validated `WebdavPrivateCfg` — the structurally normalized
   * shape downstream `WebdavApi` consumes. Subclasses that store a different
   * private-cfg shape (Nextcloud) override this to transform their stored
   * cfg into a `WebdavPrivateCfg` (e.g. derive `baseUrl` from `serverUrl`).
   */
  protected async _cfgOrError(): Promise<WebdavPrivateCfg> {
    const cfg = (await this.privateCfg.load()) as WebdavPrivateCfg | null;
    if (!cfg) {
      throw new MissingCredentialsSPError('WebDAV configuration is missing.');
    }
    if (!cfg.baseUrl) {
      throw new MissingCredentialsSPError(
        'WebDAV base URL is not configured. Please check your sync settings.',
      );
    }
    if (!cfg.userName) {
      throw new MissingCredentialsSPError(
        'WebDAV username is not configured. Please check your sync settings.',
      );
    }
    if (!cfg.password) {
      throw new MissingCredentialsSPError(
        'WebDAV password is not configured. Please check your sync settings.',
      );
    }
    return cfg;
  }

  protected async _getConfigAndPath(
    targetPath: string,
  ): Promise<{ cfg: WebdavPrivateCfg; filePath: string }> {
    const cfg = await this._cfgOrError();
    const filePath = this._getFilePath(targetPath, cfg);
    return { cfg, filePath };
  }
}
