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
  pickDirectory: async () => {
    // Main returns an Error (not a thrown rejection) when the pick succeeded
    // but persisting/canonicalizing the folder failed (#8228). Re-throw so it
    // flows into LocalFileSyncElectron.pickDirectory()'s catch path (log +
    // rethrow) instead of masquerading as a picked path string.
    const result = await getElectronApi().pickDirectory();
    if (result instanceof Error) {
      throw result;
    }
    return result;
  },
  getMainSyncFolderPath: () => getElectronApi().getSyncFolderPath(),
});

export const createLocalFileSyncElectron = (): PackageLocalFileSyncElectron =>
  new PackageLocalFileSyncElectron(buildLocalFileSyncElectronDeps());
