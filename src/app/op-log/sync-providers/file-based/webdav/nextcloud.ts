import {
  NextcloudProvider as PackageNextcloudProvider,
  PROVIDER_ID_NEXTCLOUD,
  type NextcloudDeps,
} from '@sp/sync-providers';
import { SyncProviderId } from '../../provider.const';
import { SyncCredentialStore } from '../../credential-store.service';
import { OP_LOG_SYNC_LOGGER } from '../../../core/sync-logger.adapter';
import { APP_PROVIDER_PLATFORM_INFO } from '../../platform/app-provider-platform-info';
import { APP_WEB_FETCH } from '../../platform/app-web-fetch';
import { APP_WEBDAV_NATIVE_HTTP } from './capacitor-webdav-http/app-webdav-native-http';

// Type-level bridge — same pattern as Dropbox / WebDAV. Fails to compile
// if the enum string drifts.
type AssertNextcloudId = SyncProviderId.Nextcloud extends typeof PROVIDER_ID_NEXTCLOUD
  ? true
  : never;
const _idCheck: AssertNextcloudId = true;
void _idCheck;

export type { NextcloudPrivateCfg } from '@sp/sync-providers';
export { NextcloudProvider } from '@sp/sync-providers';

/**
 * App-side factory wiring concrete adapters into the package's Nextcloud
 * provider. Returns the package class directly — no shim subclass.
 */
export const createNextcloudProvider = (extraPath?: string): PackageNextcloudProvider => {
  const deps: NextcloudDeps = {
    logger: OP_LOG_SYNC_LOGGER,
    platformInfo: APP_PROVIDER_PLATFORM_INFO,
    webFetch: APP_WEB_FETCH,
    nativeHttp: APP_WEBDAV_NATIVE_HTTP,
    credentialStore: new SyncCredentialStore(
      SyncProviderId.Nextcloud,
    ) as NextcloudDeps['credentialStore'],
  };
  return new PackageNextcloudProvider(deps, extraPath);
};
