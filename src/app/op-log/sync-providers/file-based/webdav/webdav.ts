import { SyncProviderId } from '../../provider.const';
import { WebdavBaseProvider } from './webdav-base-provider';

/**
 * Standard WebDAV sync provider.
 * Uses the WebDAV protocol for synchronization with any WebDAV-compatible server
 * (Nextcloud, ownCloud, Apache mod_dav, etc.).
 */
export class Webdav extends WebdavBaseProvider<SyncProviderId.WebDAV> {
  readonly id = SyncProviderId.WebDAV;

  protected override get logLabel(): string {
    return 'Webdav';
  }
}
