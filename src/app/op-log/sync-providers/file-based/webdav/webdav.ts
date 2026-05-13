import {
  PROVIDER_ID_WEBDAV,
  Webdav as PackageWebdav,
  type WebdavDeps,
} from '@sp/sync-providers';
import { SyncProviderId } from '../../provider.const';
import { SyncCredentialStore } from '../../credential-store.service';
import { OP_LOG_SYNC_LOGGER } from '../../../core/sync-logger.adapter';
import { APP_PROVIDER_PLATFORM_INFO } from '../../platform/app-provider-platform-info';
import { APP_WEB_FETCH } from '../../platform/app-web-fetch';
import { APP_WEBDAV_NATIVE_HTTP } from './capacitor-webdav-http/app-webdav-native-http';

// Type-level bridge — fails to compile if the enum's runtime value drifts
// away from the package's string literal, or if either side is renamed.
type AssertWebdavId = SyncProviderId.WebDAV extends typeof PROVIDER_ID_WEBDAV
  ? true
  : never;
const _idCheck: AssertWebdavId = true;
void _idCheck;

export type { WebdavPrivateCfg } from '@sp/sync-providers';

/**
 * App-side factory wiring concrete adapters into the package's WebDAV
 * provider. Returns the package class directly — no shim subclass.
 */
export const createWebdavProvider = (extraPath?: string): PackageWebdav => {
  const deps: WebdavDeps = {
    logger: OP_LOG_SYNC_LOGGER,
    platformInfo: APP_PROVIDER_PLATFORM_INFO,
    webFetch: APP_WEB_FETCH,
    nativeHttp: APP_WEBDAV_NATIVE_HTTP,
    credentialStore: new SyncCredentialStore(
      SyncProviderId.WebDAV,
    ) as WebdavDeps['credentialStore'],
  };
  return new PackageWebdav(deps, extraPath);
};
