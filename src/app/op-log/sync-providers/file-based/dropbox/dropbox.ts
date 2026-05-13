import { CapacitorHttp } from '@capacitor/core';
import {
  Dropbox as PackageDropbox,
  PROVIDER_ID_DROPBOX,
  type DropboxCfg,
  type DropboxDeps,
  type NativeHttpResponse,
} from '@sp/sync-providers';
import { SyncProviderId } from '../../provider.const';
import { SyncCredentialStore } from '../../credential-store.service';
import { OP_LOG_SYNC_LOGGER } from '../../../core/sync-logger.adapter';
import { APP_PROVIDER_PLATFORM_INFO } from '../../platform/app-provider-platform-info';
import { APP_WEB_FETCH } from '../../platform/app-web-fetch';

// Type-level bridge — fails to compile if the enum's runtime value drifts
// away from the package's string literal, or if either side is renamed.
// TS string enums are nominal, so only this direction is checkable; the
// reverse needs a cast. The const is elided by the bundler at runtime.
type AssertDropboxId = SyncProviderId.Dropbox extends typeof PROVIDER_ID_DROPBOX
  ? true
  : never;
const _idCheck: AssertDropboxId = true;
void _idCheck;

export type { DropboxCfg, DropboxPrivateCfg } from '@sp/sync-providers';

/**
 * App-side factory wiring concrete adapters into the package's Dropbox
 * provider. Returns the package class directly — no shim subclass.
 */
export const createDropboxProvider = (cfg: DropboxCfg): PackageDropbox => {
  const deps: DropboxDeps = {
    logger: OP_LOG_SYNC_LOGGER,
    platformInfo: APP_PROVIDER_PLATFORM_INFO,
    webFetch: APP_WEB_FETCH,
    credentialStore: new SyncCredentialStore(
      SyncProviderId.Dropbox,
    ) as DropboxDeps['credentialStore'],
    nativeHttpExecutor: (httpCfg) =>
      CapacitorHttp.request(httpCfg) as unknown as Promise<NativeHttpResponse>,
  };
  return new PackageDropbox(cfg, deps);
};
