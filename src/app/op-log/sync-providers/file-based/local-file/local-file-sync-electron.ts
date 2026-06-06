import {
  LocalFileSyncElectron as PackageLocalFileSyncElectron,
  type LocalFileSyncElectronDeps,
} from '@sp/sync-providers/local-file';
import { IS_ELECTRON } from '../../../../app.constants';
import type { ElectronAPI } from '../../../../../../electron/electronAPI';
import { OP_LOG_SYNC_LOGGER } from '../../../core/sync-logger.adapter';
import { SyncCredentialStore } from '../../credential-store.service';
import { SyncProviderId } from '../../provider.const';
import { ElectronFileAdapter } from './electron-file-adapter';

const getElectronApi = (): ElectronAPI => {
  const maybeWindow = window as Window & { ea?: ElectronAPI };
  if (!maybeWindow.ea) {
    throw new Error('Electron API is not available');
  }
  return maybeWindow.ea;
};

const buildLocalFileSyncElectronDeps = (): LocalFileSyncElectronDeps => ({
  logger: OP_LOG_SYNC_LOGGER,
  fileAdapter: new ElectronFileAdapter(),
  credentialStore: new SyncCredentialStore(
    SyncProviderId.LocalFile,
  ) as LocalFileSyncElectronDeps['credentialStore'],
  isElectron: IS_ELECTRON,
  checkDirExists: async (dirPath) => {
    const r = await getElectronApi().checkDirExists({ dirPath });
    if (r instanceof Error) {
      throw r;
    }
    return r;
  },
  pickDirectory: () => getElectronApi().pickDirectory(),
});

export const createLocalFileSyncElectron = (): PackageLocalFileSyncElectron =>
  new PackageLocalFileSyncElectron(buildLocalFileSyncElectronDeps());
