export {
  PROVIDER_ID_NEXTCLOUD,
  PROVIDER_ID_WEBDAV,
  WebdavBaseProvider,
  type WebdavBaseDeps,
  type WebdavProviderId,
} from './file-based/webdav/webdav-base-provider';
export { Webdav, type WebdavDeps } from './file-based/webdav/webdav';
export { NextcloudProvider, type NextcloudDeps } from './file-based/webdav/nextcloud';
export type { WebdavPrivateCfg } from './file-based/webdav/webdav.model';
export type { NextcloudPrivateCfg } from './file-based/webdav/nextcloud.model';
export {
  testWebdavConnection,
  type TestWebdavConnectionDeps,
} from './file-based/webdav/test-connection';
export {
  discoverNextcloudUserId,
  type DiscoverNextcloudUserIdDeps,
  type DiscoverNextcloudUserIdResult,
} from './file-based/webdav/discover-nextcloud-user-id';
