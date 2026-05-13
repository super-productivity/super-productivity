import {
  testWebdavConnection as packageTestWebdavConnection,
  type WebdavPrivateCfg,
} from '@sp/sync-providers/webdav';
import { OP_LOG_SYNC_LOGGER } from '../../../core/sync-logger.adapter';
import { APP_PROVIDER_PLATFORM_INFO } from '../../platform/app-provider-platform-info';
import { APP_WEB_FETCH } from '../../platform/app-web-fetch';
import { APP_WEBDAV_NATIVE_HTTP } from './capacitor-webdav-http/app-webdav-native-http';

/**
 * App-side wrapper around the package's `testWebdavConnection` helper.
 * Composes the four app singletons (logger, platform info, web fetch,
 * native HTTP) so UI call sites only need the draft cfg.
 */
export const testWebdavConnection = (
  cfg: WebdavPrivateCfg,
): Promise<{ success: boolean; error?: string; fullUrl: string }> =>
  packageTestWebdavConnection(cfg, {
    logger: OP_LOG_SYNC_LOGGER,
    platformInfo: APP_PROVIDER_PLATFORM_INFO,
    webFetch: APP_WEB_FETCH,
    nativeHttp: APP_WEBDAV_NATIVE_HTTP,
  });
