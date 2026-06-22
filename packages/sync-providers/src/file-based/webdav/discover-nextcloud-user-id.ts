import type { SyncLogger } from '@sp/sync-core';
import type { ProviderPlatformInfo } from '../../platform/provider-platform-info';
import type { WebFetchFactory } from '../../platform/web-fetch-factory';
import type { NativeHttpExecutor } from '../../http/native-http-retry';
import { AuthFailSPError } from '../../errors';
import { errorMeta } from '../../log/error-meta';
import { WebDavHttpAdapter } from './webdav-http-adapter';
import { WebDavHttpHeader, WebDavHttpMethod, WebDavHttpStatus } from './webdav.const';
import { NextcloudProvider } from './nextcloud';
import type { NextcloudPrivateCfg } from './nextcloud.model';

/** OCS APIs reject requests that lack this header (CSRF guard). */
const OCS_API_REQUEST_HEADER = 'OCS-APIRequest';

export interface DiscoverNextcloudUserIdDeps {
  logger: SyncLogger;
  platformInfo: ProviderPlatformInfo;
  webFetch: WebFetchFactory;
  nativeHttp: NativeHttpExecutor;
}

export interface DiscoverNextcloudUserIdResult {
  success: boolean;
  userId?: string;
  error?: string;
  errorCode?: number;
}

type DiscoverCfg = Pick<
  NextcloudPrivateCfg,
  'serverUrl' | 'userName' | 'loginName' | 'password'
>;

/**
 * Ask a Nextcloud server for the authenticated account's canonical user ID
 * via the OCS API, so the user never has to look it up by hand (issue #7617:
 * the WebDAV files path needs the internal user ID, which differs from the
 * email/login name people naturally enter and is awkward to find manually).
 *
 * Authenticates with `loginName || userName` + app password — whichever the
 * user filled in — and returns `<ocs.data.id>`. A 401 means the credentials
 * are wrong (cleanly distinct from the 404 "wrong user ID" path); a 200 that
 * isn't an OCS payload means the server isn't Nextcloud / has OCS disabled.
 *
 * Same readability/privacy contract as `testConnection`: the returned `error`
 * is human-readable for the config UI and must never be routed to a structured
 * logger (the privacy invariant lives in the `errorMeta`-routed log below).
 */
export const discoverNextcloudUserId = async (
  cfg: DiscoverCfg,
  deps: DiscoverNextcloudUserIdDeps,
): Promise<DiscoverNextcloudUserIdResult> => {
  // Match the provider's own `_cfgOrError` scheme check: refuse a missing/wrong
  // scheme up front so credentials are never sent to a schemeless/typo'd host,
  // and the user gets a clear message instead of a raw fetch TypeError.
  if (!/^https?:\/\//i.test(cfg.serverUrl?.trim() ?? '')) {
    return {
      success: false,
      error: 'Server URL must start with https:// or http://',
    };
  }

  const httpAdapter = new WebDavHttpAdapter({
    logger: deps.logger,
    platformInfo: deps.platformInfo,
    webFetch: deps.webFetch,
    nativeHttp: deps.nativeHttp,
  });

  try {
    const auth = btoa(`${NextcloudProvider.getAuthUserName(cfg)}:${cfg.password}`);
    const response = await httpAdapter.request({
      url: _buildOcsUserUrl(cfg.serverUrl),
      method: WebDavHttpMethod.GET,
      headers: {
        [WebDavHttpHeader.AUTHORIZATION]: `Basic ${auth}`,
        [OCS_API_REQUEST_HEADER]: 'true',
        Accept: 'application/json',
      },
    });

    const userId = _parseOcsUserId(response.data);
    if (userId) {
      return { success: true, userId };
    }
    return {
      success: false,
      error:
        'The server responded but did not return a user ID. ' +
        'Is this a Nextcloud server with the OCS API enabled?',
    };
  } catch (e) {
    deps.logger.normal('discoverNextcloudUserId() failed', errorMeta(e));
    if (e instanceof AuthFailSPError) {
      return {
        success: false,
        error:
          'Authentication failed (HTTP 401). Check your login name / email and app password.',
        errorCode: WebDavHttpStatus.UNAUTHORIZED,
      };
    }
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error occurred',
    };
  }
};

/** `https://host[/base]` (+ optional trailing slash) -> OCS current-user URL. */
const _buildOcsUserUrl = (serverUrl: string): string => {
  let s = serverUrl.trim();
  if (s.endsWith('/')) {
    s = s.slice(0, -1);
  }
  return `${s}/ocs/v2.php/cloud/user?format=json`;
};

/**
 * Pull `ocs.data.id` out of an OCS JSON response. Returns null on anything
 * unexpected (non-JSON login-page HTML, missing/empty id) so the caller can
 * surface a "not a Nextcloud OCS endpoint" message rather than throwing.
 */
const _parseOcsUserId = (body: string): string | null => {
  try {
    const parsed = JSON.parse(body) as { ocs?: { data?: { id?: unknown } } };
    const id = parsed?.ocs?.data?.id;
    return typeof id === 'string' && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
};
