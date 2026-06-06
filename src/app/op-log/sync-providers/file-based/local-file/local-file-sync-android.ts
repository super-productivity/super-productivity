import {
  LocalFileSyncAndroid as PackageLocalFileSyncAndroid,
  type LocalFileSyncAndroidDeps,
} from '@sp/sync-providers/local-file';
import { OP_LOG_SYNC_LOGGER } from '../../../core/sync-logger.adapter';
import { SyncCredentialStore } from '../../credential-store.service';
import { SyncProviderId } from '../../provider.const';
import { SafFileAdapter } from './droid-saf/saf-file-adapter';
import { SafService } from './droid-saf/saf.service';

const buildLocalFileSyncAndroidDeps = (): LocalFileSyncAndroidDeps => {
  const credentialStore = new SyncCredentialStore(SyncProviderId.LocalFile);
  return {
    logger: OP_LOG_SYNC_LOGGER,
    fileAdapter: new SafFileAdapter(async () => {
      const cfg = await credentialStore.load();
      return cfg?.safFolderUri;
    }),
    credentialStore: credentialStore as LocalFileSyncAndroidDeps['credentialStore'],
    saf: {
      selectFolder: () => SafService.selectFolder(),
      checkPermission: (uri) => SafService.checkPermission(uri),
    },
  };
};

export const createLocalFileSyncAndroid = (): PackageLocalFileSyncAndroid =>
  new PackageLocalFileSyncAndroid(buildLocalFileSyncAndroidDeps());
