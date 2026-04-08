import { SyncProviderId } from '../../provider.const';
import { WebdavBaseProvider } from './webdav-base-provider';
import { WebdavPrivateCfg } from './webdav.model';
import { MissingCredentialsSPError } from '../../../core/errors/sync-errors';
import { NextcloudPrivateCfg } from './nextcloud.model';
import { SyncCredentialStore } from '../../credential-store.service';

/**
 * Nextcloud sync provider.
 * Extends WebdavBaseProvider but auto-constructs the WebDAV base URL from
 * a simpler serverUrl + userName, so users don't need to know the DAV path.
 *
 * Uses SyncProviderId.WebDAV as the generic parameter to reuse all WebDAV
 * infrastructure. The actual id is SyncProviderId.Nextcloud for credential
 * separation and UI distinction — casts are safe because at runtime these
 * are just string values.
 */
export class NextcloudProvider extends WebdavBaseProvider<SyncProviderId.WebDAV> {
  override readonly id = SyncProviderId.Nextcloud as unknown as SyncProviderId.WebDAV;

  constructor(extraPath?: string) {
    super(extraPath);
    // Separate credential store keyed by SyncProviderId.Nextcloud
    this.privateCfg = new SyncCredentialStore(
      SyncProviderId.Nextcloud as unknown as SyncProviderId.WebDAV,
    );
  }

  protected override get logLabel(): string {
    return 'Nextcloud';
  }

  /**
   * Builds the full WebDAV base URL from serverUrl + userName.
   * e.g., https://cloud.example.com -> https://cloud.example.com/remote.php/dav/files/john/
   */
  private _buildNextcloudBaseUrl(cfg: NextcloudPrivateCfg): string {
    let serverUrl = cfg.serverUrl.trim();
    if (serverUrl.endsWith('/')) {
      serverUrl = serverUrl.slice(0, -1);
    }
    return `${serverUrl}/remote.php/dav/files/${encodeURIComponent(cfg.userName.trim())}/`;
  }

  protected override async _cfgOrError(): Promise<WebdavPrivateCfg> {
    const cfg = (await this.privateCfg.load()) as unknown as NextcloudPrivateCfg | null;
    if (!cfg) {
      throw new MissingCredentialsSPError('Nextcloud configuration is missing.');
    }
    if (!cfg.serverUrl) {
      throw new MissingCredentialsSPError(
        'Nextcloud server URL is not configured. Please check your sync settings.',
      );
    }
    if (!/^https?:\/\//i.test(cfg.serverUrl)) {
      throw new MissingCredentialsSPError(
        'Nextcloud server URL must start with https:// or http://',
      );
    }
    if (!cfg.userName) {
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
      baseUrl: this._buildNextcloudBaseUrl(cfg),
    };
  }

  override async isReady(): Promise<boolean> {
    const cfg = (await this.privateCfg.load()) as unknown as NextcloudPrivateCfg | null;
    return !!(cfg && cfg.serverUrl && cfg.userName && cfg.password && cfg.syncFolderPath);
  }
}
