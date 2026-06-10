import {
  PROVIDER_ID_NEXTCLOUD,
  WebdavBaseDeps,
  WebdavBaseProvider,
} from './webdav-base-provider';
import { MissingCredentialsSPError } from '../../errors';
import type { NextcloudPrivateCfg } from './nextcloud.model';
import type { WebdavPrivateCfg } from './webdav.model';

export type NextcloudDeps = WebdavBaseDeps<
  typeof PROVIDER_ID_NEXTCLOUD,
  NextcloudPrivateCfg
>;

/**
 * Nextcloud sync provider.
 * Extends `WebdavBaseProvider` but auto-constructs the WebDAV base URL
 * from a simpler `serverUrl` + file-owner `userName`, so users don't
 * need to know the DAV path. Authentication can use `loginName` when a
 * Nextcloud instance accepts email login but keeps a different DAV
 * username in /remote.php/dav/files/<userName>/.
 *
 * Uses its own `PROVIDER_ID_NEXTCLOUD` literal (not WebDAV) for
 * credential separation and UI distinction.
 */
export class NextcloudProvider extends WebdavBaseProvider<
  typeof PROVIDER_ID_NEXTCLOUD,
  NextcloudPrivateCfg
> {
  readonly id = PROVIDER_ID_NEXTCLOUD;

  constructor(deps: NextcloudDeps, extraPath?: string) {
    super(deps, extraPath);
  }

  protected override get logLabel(): string {
    return 'Nextcloud';
  }

  /**
   * Builds the full WebDAV base URL from serverUrl + userName.
   * e.g., https://cloud.example.com -> https://cloud.example.com/remote.php/dav/files/john/
   */
  static buildBaseUrl(cfg: Pick<NextcloudPrivateCfg, 'serverUrl' | 'userName'>): string {
    let serverUrl = cfg.serverUrl.trim();
    if (serverUrl.endsWith('/')) {
      serverUrl = serverUrl.slice(0, -1);
    }
    return `${serverUrl}/remote.php/dav/files/${encodeURIComponent(cfg.userName.trim())}/`;
  }

  static getAuthUserName(
    cfg: Pick<NextcloudPrivateCfg, 'loginName' | 'userName'>,
  ): string {
    return cfg.loginName?.trim() || cfg.userName.trim();
  }

  protected override async _cfgOrError(): Promise<WebdavPrivateCfg> {
    const cfg = await this.privateCfg.load();
    if (!cfg) {
      throw new MissingCredentialsSPError('Nextcloud configuration is missing.');
    }
    if (!cfg.serverUrl?.trim()) {
      throw new MissingCredentialsSPError(
        'Nextcloud server URL is not configured. Please check your sync settings.',
      );
    }
    if (!/^https?:\/\//i.test(cfg.serverUrl.trim())) {
      throw new MissingCredentialsSPError(
        'Nextcloud server URL must start with https:// or http://',
      );
    }
    if (!cfg.userName?.trim()) {
      throw new MissingCredentialsSPError(
        'Nextcloud username is not configured. Please check your sync settings.',
      );
    }
    if (!cfg.password) {
      throw new MissingCredentialsSPError(
        'Nextcloud password is not configured. Please check your sync settings.',
      );
    }
    return {
      ...cfg,
      baseUrl: NextcloudProvider.buildBaseUrl(cfg),
      userName: NextcloudProvider.getAuthUserName(cfg),
    };
  }

  override async isReady(): Promise<boolean> {
    const cfg = await this.privateCfg.load();
    return !!(
      cfg &&
      cfg.serverUrl?.trim() &&
      cfg.userName?.trim() &&
      cfg.password &&
      cfg.syncFolderPath?.trim()
    );
  }
}
