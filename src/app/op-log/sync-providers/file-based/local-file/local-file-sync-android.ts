import { Directory } from '@capacitor/filesystem';
import { LocalFileSyncBase } from './local-file-sync-base';
import { LocalFileSyncPrivateCfg } from '../../../core/types/sync.types';
import { SafService } from './droid-saf/saf.service';
import { SafFileAdapter } from './droid-saf/saf-file-adapter';
import { SyncLog } from '../../../../core/log';

export class LocalFileSyncAndroid extends LocalFileSyncBase {
  constructor(public directory = Directory.Documents) {
    super(
      new SafFileAdapter(async () => {
        const cfg = await this.privateCfg.load();
        return cfg?.safFolderUri;
      }),
    );
  }

  async isReady(): Promise<boolean> {
    const privateCfg = await this.privateCfg.load();
    // Check if SAF is enabled and has valid permissions
    if (privateCfg?.safFolderUri?.length) {
      const hasPermission = await SafService.checkPermission(privateCfg.safFolderUri);
      if (!hasPermission) {
        // SAF was enabled but permission was revoked
        await this.privateCfg.updatePartial({ safFolderUri: undefined });
        return false;
      }
      return true;
    }
    return false;
  }

  async setupSaf(): Promise<string | undefined> {
    try {
      const uri = await SafService.selectFolder();
      await this.privateCfg.upsertPartial({
        safFolderUri: uri,
      });
      return uri;
    } catch (error) {
      SyncLog.err('Failed to setup SAF:', error);
      return undefined;
    }
  }

  async setPrivateCfg(privateCfg: LocalFileSyncPrivateCfg): Promise<void> {
    await this.privateCfg.setComplete(privateCfg);
  }

  async getFilePath(targetPath: string): Promise<string> {
    return targetPath;
  }
}
