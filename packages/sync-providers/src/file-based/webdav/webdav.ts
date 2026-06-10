import {
  PROVIDER_ID_WEBDAV,
  WebdavBaseDeps,
  WebdavBaseProvider,
} from './webdav-base-provider';
import type { WebdavPrivateCfg } from './webdav.model';

export type WebdavDeps = WebdavBaseDeps<typeof PROVIDER_ID_WEBDAV, WebdavPrivateCfg>;

/**
 * Standard WebDAV sync provider.
 * Uses the WebDAV protocol for synchronization with any WebDAV-compatible
 * server (ownCloud, Apache mod_dav, Mailbox.org, etc.). Nextcloud has a
 * dedicated subclass that builds the WebDAV URL automatically from
 * `serverUrl` + `userName`.
 */
export class Webdav extends WebdavBaseProvider<
  typeof PROVIDER_ID_WEBDAV,
  WebdavPrivateCfg
> {
  readonly id = PROVIDER_ID_WEBDAV;

  protected override get logLabel(): string {
    return 'Webdav';
  }

  constructor(deps: WebdavDeps, extraPath?: string) {
    super(deps, extraPath);
  }
}
