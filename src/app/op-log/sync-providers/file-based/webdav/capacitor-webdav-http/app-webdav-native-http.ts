import type { NativeHttpExecutor } from '@sp/sync-providers';
import { WebDavHttp } from './index';

/**
 * App-side adapter wiring the Capacitor `WebDavHttp` plugin into the package's
 * `NativeHttpExecutor` port. The plugin bypasses `CapacitorHttp` (which has
 * JSON auto-parse and empty-body bugs on Android/iOS for WebDAV responses).
 *
 * On web/Electron the `WebDavHttp` plugin's `web: () => import('./web')`
 * fallback (registered in `./index.ts`) uses `fetch` under the hood. The
 * package's `WebDavHttpAdapter` decides whether to call this native executor
 * (`platformInfo.isNativePlatform === true`) or call `fetch` directly via the
 * `WebFetchFactory`.
 */
export const APP_WEBDAV_NATIVE_HTTP: NativeHttpExecutor = async (config) => {
  const data =
    typeof config.data === 'string'
      ? config.data
      : config.data == null
        ? null
        : JSON.stringify(config.data);

  const r = await WebDavHttp.request({
    url: config.url,
    method: config.method,
    headers: config.headers,
    data,
    // Forward responseType so a future native impl that honors it returns
    // text verbatim (XML, multistatus) instead of parsing JSON. The web
    // fallback always returns text today.
    responseType: config.responseType ?? 'text',
  });

  return {
    status: r.status,
    headers: r.headers ?? {},
    data: r.data ?? '',
    url: r.url,
  };
};
