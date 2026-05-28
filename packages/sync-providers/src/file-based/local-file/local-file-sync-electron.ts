import { toSyncLogError } from '@sp/sync-core';
import { LocalFileSyncBase, type LocalFileSyncBaseDeps } from './local-file-sync-base';

export interface LocalFileSyncElectronDeps extends LocalFileSyncBaseDeps {
  isElectron: boolean;
  checkDirExists: (dirPath: string) => Promise<boolean>;
  pickDirectory: () => Promise<string | void>;
}

export class LocalFileSyncElectron extends LocalFileSyncBase {
  private static readonly L = 'LocalFileSyncElectron';

  constructor(private readonly _deps: LocalFileSyncElectronDeps) {
    super(_deps);
  }

  async isReady(): Promise<boolean> {
    if (!this._deps.isElectron) {
      throw new Error('LocalFileSyncElectron is only available in electron');
    }
    const privateCfg = await this.privateCfg.load();
    return !!privateCfg?.syncFolderPath;
  }

  async getFilePath(targetPath: string): Promise<string> {
    const folderPath = await this._getFolderPath();
    const normalizedPath = targetPath.startsWith('/')
      ? targetPath.substring(1)
      : targetPath;
    return `${folderPath}/${normalizedPath}`;
  }

  async pickDirectory(): Promise<string | void> {
    this.logger.normal(`${LocalFileSyncElectron.L}.pickDirectory()`);

    try {
      const dir = await this._deps.pickDirectory();
      if (dir) {
        await this.privateCfg.upsertPartial({ syncFolderPath: dir });
      }
      return dir;
    } catch (e) {
      this.logger.error(
        `${LocalFileSyncElectron.L}.pickDirectory() error`,
        toSyncLogError(e),
      );
      throw e;
    }
  }

  private async _checkDirAndOpenPickerIfNotExists(): Promise<void> {
    this.logger.normal(
      `${LocalFileSyncElectron.L}.${this._checkDirAndOpenPickerIfNotExists.name}`,
    );

    try {
      const privateCfg = await this.privateCfg.load();
      const folderPath = privateCfg?.syncFolderPath;

      if (!folderPath) {
        this.logger.critical(
          `${LocalFileSyncElectron.L} - no sync folder configured, opening picker`,
        );
        await this.pickDirectory();
        return;
      }

      const isDirExists = await this._checkDirExists(folderPath);
      if (!isDirExists) {
        this.logger.critical(
          `${LocalFileSyncElectron.L} - no valid directory, opening picker`,
        );
        await this.pickDirectory();
      }
    } catch (err) {
      this.logger.error(
        `${LocalFileSyncElectron.L}.${this._checkDirAndOpenPickerIfNotExists.name}() error`,
        toSyncLogError(err),
      );
      await this.pickDirectory();
    }
  }

  private async _getFolderPath(): Promise<string> {
    const privateCfg = await this.privateCfg.load();
    const folderPath = privateCfg?.syncFolderPath;
    if (!folderPath) {
      await this._checkDirAndOpenPickerIfNotExists();
      const updatedCfg = await this.privateCfg.load();
      const updatedPath = updatedCfg?.syncFolderPath;
      if (!updatedPath) {
        throw new Error('No sync folder path configured after directory picker');
      }
      return updatedPath;
    }
    return folderPath;
  }

  private async _checkDirExists(dirPath: string): Promise<boolean> {
    try {
      return await this._deps.checkDirExists(dirPath);
    } catch (e) {
      this.logger.error(
        `${LocalFileSyncElectron.L}.${this._checkDirExists.name}() error`,
        toSyncLogError(e),
      );
      return false;
    }
  }
}
