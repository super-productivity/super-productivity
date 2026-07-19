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

  /**
   * Opens the SAF folder picker and returns the picked URI WITHOUT persisting
   * it (#9075). The caller (sync settings form) holds the URI in its model as
   * `safFolderUri` and persists it via the normal settings-Save path
   * (`setProviderConfig`), so Cancel abandons the pick and a sync firing
   * between pick and Save still targets the old folder. Throws on cancel.
   */
  async setupSaf(): Promise<string> {
    try {
      return await this._deps.saf.selectFolder();
    } catch (error) {
      this.logger.err('Failed to setup SAF', toSyncLogError(error));
      throw error;
    }
  }

  async getFilePath(targetPath: string): Promise<string> {
    return targetPath;
  }
}
