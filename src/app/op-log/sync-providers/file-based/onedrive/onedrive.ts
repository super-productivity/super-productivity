import {
  OneDrive as PackageOneDrive,
  PROVIDER_ID_ONEDRIVE,
  type OneDriveDeps,
} from '@sp/sync-providers/onedrive';
import { SyncProviderId } from '../../provider.const';
import { SyncCredentialStore } from '../../credential-store.service';
import { OP_LOG_SYNC_LOGGER } from '../../../core/sync-logger.adapter';
import { APP_PROVIDER_PLATFORM_INFO } from '../../platform/app-provider-platform-info';
import { APP_WEB_FETCH } from '../../platform/app-web-fetch';
import {
  OFFICIAL_ONEDRIVE_CLIENT_ID,
  HAS_OFFICIAL_ONEDRIVE_CLIENT_ID,
} from '../../../../imex/sync/onedrive-auth-mode.const';
import { addOAuthState } from '../../../../imex/sync/oauth-state.util';
import { IS_ELECTRON } from '../../../../app.constants';

type AssertOneDriveId = SyncProviderId.OneDrive extends typeof PROVIDER_ID_ONEDRIVE
  ? true
  : never;
const _idCheck: AssertOneDriveId = true;
void _idCheck;

export type { OneDrivePrivateCfg } from '@sp/sync-providers/onedrive';

export const createOneDriveProvider = (
  cfg: { devPath?: string } = {},
): PackageOneDrive => {
  const deps: OneDriveDeps = {
    logger: OP_LOG_SYNC_LOGGER,
    platformInfo: APP_PROVIDER_PLATFORM_INFO,
    webFetch: APP_WEB_FETCH,
    credentialStore: new SyncCredentialStore(
      SyncProviderId.OneDrive,
    ) as OneDriveDeps['credentialStore'],
    officialClientId: OFFICIAL_ONEDRIVE_CLIENT_ID,
    hasOfficialClientId: HAS_OFFICIAL_ONEDRIVE_CLIENT_ID,
    addOAuthState,
    isElectron: IS_ELECTRON,
  };
  return new PackageOneDrive(cfg, deps);
};
