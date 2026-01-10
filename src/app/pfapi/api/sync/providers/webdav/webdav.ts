import { SyncProviderServiceInterface } from '../../sync-provider.interface';
import { SyncProviderId } from '../../../pfapi.const';
import { WebdavApi } from './webdav-api';
import { SyncProviderPrivateCfgStore } from '../../sync-provider-private-cfg-store';
import {
  InvalidDataSPError,
  MissingCredentialsSPError,
  NoRevAPIError,
} from '../../../errors/errors';
import { WebdavPrivateCfg } from './webdav.model';
import { SyncLog } from '../../../../../core/log';

export class Webdav implements SyncProviderServiceInterface<SyncProviderId.WebDAV> {
  private static readonly L = 'Webdav';

  readonly id = SyncProviderId.WebDAV;
  readonly isUploadForcePossible = false;
  readonly maxConcurrentRequests = 10;

  private readonly _api: WebdavApi = new WebdavApi(() => this._cfgOrError());

  public privateCfg!: SyncProviderPrivateCfgStore<SyncProviderId.WebDAV>;

  constructor(private _extraPath?: string) {}

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

  async setPrivateCfg(privateCfg: WebdavPrivateCfg): Promise<void> {
    await this.privateCfg.setComplete(privateCfg);
  }

  async getFileRev(
    targetPath: string,
    localRev: string | null,
  ): Promise<{ rev: string }> {
    const { filePath } = await this._getConfigAndPath(targetPath);
    const meta = await this._api.getFileMeta(filePath, localRev, true);
    return { rev: meta.lastmod };
  }

  async uploadFile(
    targetPath: string,
    dataStr: string,
    localRev: string,
    isForceOverwrite: boolean = false,
  ): Promise<{ rev: string }> {
    SyncLog.debug(Webdav.L, 'uploadFile', { targetPath, localRev, isForceOverwrite });
    const { filePath } = await this._getConfigAndPath(targetPath);

    const result = await this._api.upload({
      path: filePath,
      data: dataStr,
      isForceOverwrite: isForceOverwrite,
      expectedRev: isForceOverwrite ? null : localRev,
    });

    if (!result.rev) {
      throw new NoRevAPIError();
    }

    return { rev: result.rev };
  }

  async downloadFile(
    targetPath: string,
  ): Promise<{ rev: string; legacyRev?: string; dataStr: string }> {
    SyncLog.debug(Webdav.L, 'downloadFile', { targetPath });
    const { filePath } = await this._getConfigAndPath(targetPath);

    const result = await this._api.download({
      path: filePath,
    });

    if (!result.dataStr && result.dataStr !== '') {
      throw new InvalidDataSPError(targetPath);
    }
    if (typeof result.rev !== 'string') {
      throw new NoRevAPIError();
    }

    return { rev: result.rev, legacyRev: result.legacyRev, dataStr: result.dataStr };
  }

  async removeFile(targetPath: string): Promise<void> {
    SyncLog.debug(Webdav.L, 'removeFile', { targetPath });
    const { filePath } = await this._getConfigAndPath(targetPath);
    await this._api.remove(filePath);
  }

  async testConnection(
    cfg: WebdavPrivateCfg,
  ): Promise<{ success: boolean; error?: string; fullUrl: string }> {
    SyncLog.debug(Webdav.L, 'testConnection', { baseUrl: cfg.baseUrl });
    return this._api.testConnection(cfg);
  }

  private _getFilePath(targetPath: string, cfg: WebdavPrivateCfg): string {
    const parts = [cfg.syncFolderPath];
    if (this._extraPath) {
      parts.push(this._extraPath);
    }
    parts.push(targetPath);
    return parts.join('/').replace(/\/+/g, '/');
  }

  private async _cfgOrError(): Promise<WebdavPrivateCfg> {
    const cfg = await this.privateCfg.load();
    if (!cfg) {
      throw new MissingCredentialsSPError();
    }
    return cfg;
  }

  private async _getConfigAndPath(
    targetPath: string,
  ): Promise<{ cfg: WebdavPrivateCfg; filePath: string }> {
    const cfg = await this._cfgOrError();
    const filePath = this._getFilePath(targetPath, cfg);
    return { cfg, filePath };
  }
}
