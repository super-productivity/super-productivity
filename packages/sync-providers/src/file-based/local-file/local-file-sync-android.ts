import { toSyncLogError } from '@sp/sync-core';
import { LocalFileSyncBase, type LocalFileSyncBaseDeps } from './local-file-sync-base';

interface LocalFileSafPort {
  selectFolder(): Promise<string>;
  checkPermission(uri?: string): Promise<boolean>;
}

export interface LocalFileSyncAndroidDeps extends LocalFileSyncBaseDeps {
  saf: LocalFileSafPort;
}

export class LocalFileSyncAndroid extends LocalFileSyncBase {
  constructor(private readonly _deps: LocalFileSyncAndroidDeps) {
    super(_deps);
  }

  async isReady(): Promise<boolean> {
    const privateCfg = await this.privateCfg.load();
    if (privateCfg?.safFolderUri?.length) {
      const hasPermission = await this._deps.saf.checkPermission(privateCfg.safFolderUri);
      if (!hasPermission) {
        await this.privateCfg.updatePartial({ safFolderUri: undefined });
        return false;
      }
      return true;
    }
    return false;
  }

  async setupSaf(): Promise<string> {
    try {
      const uri = await this._deps.saf.selectFolder();
      await this.privateCfg.upsertPartial({
        safFolderUri: uri,
      });
      return uri;
    } catch (error) {
      this.logger.err('Failed to setup SAF', toSyncLogError(error));
      throw error;
    }
  }

  async getFilePath(targetPath: string): Promise<string> {
    return targetPath;
  }
}
