import type { SyncLogger } from '@sp/sync-core';
import type { ProviderPlatformInfo } from '../../platform/provider-platform-info';
import type { WebFetchFactory } from '../../platform/web-fetch-factory';
import type { NativeHttpExecutor } from '../../http/native-http-retry';
import { WebDavHttpAdapter } from './webdav-http-adapter';
import { WebdavApi } from './webdav-api';
import type { WebdavPrivateCfg } from './webdav.model';

export interface TestWebdavConnectionDeps {
  logger: SyncLogger;
  platformInfo: ProviderPlatformInfo;
  webFetch: WebFetchFactory;
  nativeHttp: NativeHttpExecutor;
}

/**
 * Probe a WebDAV server with a draft cfg without persisting credentials
 * or constructing a full provider instance. Used by host UIs (e.g. the
 * Super Productivity "Test connection" button in `dialog-sync-cfg`) to
 * validate user input.
 *
 * Returns `{ success, error?, fullUrl }`. The user-facing `error` /
 * `fullUrl` are intentionally readable (the user is debugging their own
 * server config); the privacy invariant — no raw error / URL ever reaches
 * a structured logger — lives in `WebdavApi.testConnection`'s
 * `errorMeta`-routed log call.
 */
export const testWebdavConnection = async (
  cfg: WebdavPrivateCfg,
  deps: TestWebdavConnectionDeps,
): Promise<{ success: boolean; error?: string; fullUrl: string }> => {
  const httpAdapter = new WebDavHttpAdapter({
    logger: deps.logger,
    platformInfo: deps.platformInfo,
    webFetch: deps.webFetch,
    nativeHttp: deps.nativeHttp,
  });
  const api = new WebdavApi({
    logger: deps.logger,
    getCfg: async () => cfg,
    httpAdapter,
  });
  return api.testConnection(cfg);
};
