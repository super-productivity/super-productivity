import { SyncProviderId } from '../../provider.const';
import {
  PROVIDER_ID_WEBDAV,
  WebdavBaseProvider,
  type WebdavBaseDeps,
  type WebdavPrivateCfg,
} from '@sp/sync-providers/webdav';
import { MissingCredentialsSPError } from '../../../core/errors/sync-errors';
import { ProtonDrivePrivateCfg } from './proton-drive.model';
import { SyncCredentialStore } from '../../credential-store.service';
import { IS_ELECTRON } from '../../../../app.constants';
import type { ElectronAPI } from '../../../../../../electron/electronAPI';
import { OP_LOG_SYNC_LOGGER } from '../../../core/sync-logger.adapter';
import { APP_PROVIDER_PLATFORM_INFO } from '../../platform/app-provider-platform-info';
import { APP_WEB_FETCH } from '../../platform/app-web-fetch';
import { APP_WEBDAV_NATIVE_HTTP } from './capacitor-webdav-http/app-webdav-native-http';

const getElectronApi = (): ElectronAPI => {
  const maybeWindow = window as Window & { ea?: ElectronAPI };
  if (!maybeWindow.ea) {
    throw new MissingCredentialsSPError(
      'Proton Drive sync is only available in the desktop app.',
    );
  }
  return maybeWindow.ea;
};

/**
 * Proton Drive sync provider (desktop only).
 *
 * Reuses the entire WebDAV transport. At runtime it asks the Electron main
 * process to ensure an `rclone serve webdav` bridge is running against the
 * user's Proton Drive remote, then points the WebDAV API at that local
 * loopback endpoint. No Proton credentials are stored by the app.
 *
 * Uses SyncProviderId.WebDAV as the generic parameter to reuse all WebDAV
 * infrastructure; the actual id is SyncProviderId.ProtonDrive for credential
 * separation and UI distinction — casts are safe because at runtime these are
 * just string values (same approach as NextcloudProvider).
 */
export class ProtonDriveProvider extends WebdavBaseProvider<
  typeof PROVIDER_ID_WEBDAV,
  ProtonDrivePrivateCfg
> {
  override readonly id =
    SyncProviderId.ProtonDrive as unknown as typeof PROVIDER_ID_WEBDAV;

  constructor(extraPath?: string) {
    const deps: WebdavBaseDeps<typeof PROVIDER_ID_WEBDAV, ProtonDrivePrivateCfg> = {
      logger: OP_LOG_SYNC_LOGGER,
      platformInfo: APP_PROVIDER_PLATFORM_INFO,
      webFetch: APP_WEB_FETCH,
      nativeHttp: APP_WEBDAV_NATIVE_HTTP,
      // Separate credential store keyed by SyncProviderId.ProtonDrive.
      credentialStore: new SyncCredentialStore(
        SyncProviderId.ProtonDrive,
      ) as unknown as WebdavBaseDeps<
        typeof PROVIDER_ID_WEBDAV,
        ProtonDrivePrivateCfg
      >['credentialStore'],
    };
    super(deps, extraPath);
  }

  protected override get logLabel(): string {
    return 'ProtonDrive';
  }

  /**
   * Proton Drive credentials live in the user's rclone config, not in app
   * storage — there is nothing for the app to clear. Override the WebDAV base
   * (which would blank userName/password) with a deliberate no-op.
   * See the contract on SyncProviderBase.clearAuthCredentials.
   */
  clearAuthCredentials(): Promise<void> {
    return Promise.resolve();
  }

  override async isReady(): Promise<boolean> {
    if (!IS_ELECTRON) {
      return false;
    }
    const cfg = (await this.privateCfg.load()) as unknown as ProtonDrivePrivateCfg | null;
    return !!(cfg && cfg.rcloneRemoteName && cfg.syncFolderPath);
  }

  protected override async _cfgOrError(): Promise<WebdavPrivateCfg> {
    const cfg = (await this.privateCfg.load()) as unknown as ProtonDrivePrivateCfg | null;
    if (!cfg) {
      throw new MissingCredentialsSPError('Proton Drive configuration is missing.');
    }
    if (!cfg.rcloneRemoteName) {
      throw new MissingCredentialsSPError(
        'Proton Drive rclone remote name is not configured. Please check your sync settings.',
      );
    }

    const serve = await getElectronApi().protonDriveEnsureServer({
      remoteName: cfg.rcloneRemoteName,
      rcloneBinaryPath: cfg.rcloneBinaryPath || undefined,
    });
    if (serve instanceof Error) {
      throw serve;
    }

    return {
      ...cfg,
      baseUrl: serve.baseUrl,
      userName: serve.userName,
      password: serve.password,
    } as WebdavPrivateCfg;
  }
}
