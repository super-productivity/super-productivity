import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { inject, Injectable, InjectionToken } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import type { NativeHttpExecutor } from '@sp/sync-providers/http';
import { PluginHttp, PluginHttpOptions } from './plugin-issue-provider.model';
import { IS_NATIVE_PLATFORM } from '../../util/is-native-platform';
// Reuses the app's OkHttp/URLSession-backed native HTTP executor. It lives under
// the WebDAV sync feature today, but is protocol-agnostic (a thin {url, method,
// headers, data} → response pipe). A future refactor could lift it to a neutral
// `NativeHttp` home shared by sync and plugins. See issue #8558.
import { APP_WEBDAV_NATIVE_HTTP } from '../../op-log/sync-providers/file-based/webdav/capacitor-webdav-http/app-webdav-native-http';

const DEFAULT_TIMEOUT = 30000;
const MIN_TIMEOUT = 1000;
const MAX_TIMEOUT = 120000;

/**
 * WebDAV/CalDAV verbs that Java's `HttpURLConnection` (the engine behind
 * Capacitor's native `CapacitorHttp`, which intercepts every non-GET/HEAD/
 * OPTIONS/TRACE XHR on-device) refuses with `ProtocolException`. On native
 * platforms these are issued through the OkHttp/URLSession-backed executor
 * instead, which accepts arbitrary method strings. Standard verbs keep using the
 * normal `HttpClient` path (it handles JSON + works on every platform).
 *
 * Scoped to the verbs the CalDAV calendar plugin actually uses (discovery +
 * event query). Entries MUST stay within the set the native `WebDavHttp` plugin
 * implements (e.g. it rejects `MKCALENDAR`). `PATCH` is also rejected by
 * `HttpURLConnection` and would belong here, but it's used by other providers
 * (GitHub, Google Calendar) whose JSON round-trips need separate on-device
 * verification — tracked separately, intentionally not rerouted here.
 * See issue #8558.
 */
const NATIVE_HTTP_METHODS = new Set(['PROPFIND', 'REPORT']);

/**
 * Whether plugin HTTP runs in a native Capacitor context. Injectable so tests
 * can exercise the native-reroute branch without a device.
 */
export const PLUGIN_HTTP_IS_NATIVE = new InjectionToken<boolean>(
  'PLUGIN_HTTP_IS_NATIVE',
  {
    providedIn: 'root',
    factory: () => IS_NATIVE_PLATFORM,
  },
);

/** The native HTTP executor used for WebDAV verbs. Injectable for test override. */
export const PLUGIN_HTTP_NATIVE_EXECUTOR = new InjectionToken<NativeHttpExecutor>(
  'PLUGIN_HTTP_NATIVE_EXECUTOR',
  { providedIn: 'root', factory: () => APP_WEBDAV_NATIVE_HTTP },
);

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  'metadata.google.internal',
]);

// Cloud metadata endpoints that must ALWAYS be blocked, even when allowPrivateNetwork is true
const ALLOWED_HTTP_METHODS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'PROPFIND',
  'REPORT',
  'MKCALENDAR',
  'PROPPATCH',
]);

const CLOUD_METADATA_HOSTNAMES = new Set([
  '169.254.169.254', // AWS/Azure instance metadata
  'metadata.google.internal', // GCP instance metadata
  'fd00:ec2::254', // AWS IMDSv2 IPv6
]);

const isPrivateIp = (hostname: string): boolean => {
  // IPv4 private ranges
  if (
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  ) {
    return true;
  }
  // IPv6 ULA, link-local, loopback, IPv4-mapped
  const lower = hostname.toLowerCase();
  return (
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe80') ||
    lower.startsWith('::ffff:')
  );
};

export interface PluginHttpHelperOpts {
  allowPrivateNetwork?: boolean;
}

@Injectable({ providedIn: 'root' })
export class PluginHttpService {
  private _http = inject(HttpClient);
  private _isNativePlatform = inject(PLUGIN_HTTP_IS_NATIVE);
  private _nativeHttp = inject(PLUGIN_HTTP_NATIVE_EXECUTOR);

  createHttpHelper(
    getHeaders: () => Record<string, string> | Promise<Record<string, string>>,
    opts?: PluginHttpHelperOpts,
  ): PluginHttp {
    const allowPrivateNetwork = opts?.allowPrivateNetwork ?? false;
    const doRequest = <T>(
      method: string,
      url: string,
      body?: unknown,
      options?: PluginHttpOptions,
    ): Promise<T> =>
      this._request<T>(method, url, body, options, getHeaders, allowPrivateNetwork);
    return {
      get: <T>(url: string, options?: PluginHttpOptions) =>
        doRequest<T>('GET', url, undefined, options),
      post: <T>(url: string, body: unknown, options?: PluginHttpOptions) =>
        doRequest<T>('POST', url, body, options),
      put: <T>(url: string, body: unknown, options?: PluginHttpOptions) =>
        doRequest<T>('PUT', url, body, options),
      patch: <T>(url: string, body: unknown, options?: PluginHttpOptions) =>
        doRequest<T>('PATCH', url, body, options),
      delete: <T>(url: string, options?: PluginHttpOptions) =>
        doRequest<T>('DELETE', url, undefined, options),
      request: <T>(
        method: string,
        url: string,
        body?: unknown,
        options?: PluginHttpOptions,
      ) => doRequest<T>(method, url, body, options),
    };
  }

  private async _request<T>(
    method: string,
    url: string,
    body: unknown | undefined,
    options: PluginHttpOptions | undefined,
    getHeaders: () => Record<string, string> | Promise<Record<string, string>>,
    allowPrivateNetwork: boolean,
  ): Promise<T> {
    const upperMethod = method.toUpperCase();
    if (!ALLOWED_HTTP_METHODS.has(upperMethod)) {
      throw new Error(`[PluginHttp] HTTP method not allowed: ${method}`);
    }
    this._validateUrl(url, allowPrivateNetwork);

    const authHeaders = await Promise.resolve(getHeaders());
    const mergedHeaders = { ...options?.headers, ...authHeaders };

    // On-device, route WebDAV/CalDAV verbs through the native OkHttp/URLSession
    // executor — Capacitor's CapacitorHttp would otherwise reject them via
    // Android's HttpURLConnection. See issue #8558.
    if (this._isNativePlatform && NATIVE_HTTP_METHODS.has(upperMethod)) {
      return this._requestViaNativeHttp<T>(
        upperMethod,
        url,
        body,
        options,
        mergedHeaders,
      );
    }

    let params = new HttpParams();
    if (options?.params) {
      for (const [k, v] of Object.entries(options.params)) {
        params = params.set(k, v);
      }
    }

    const timeoutMs = Math.min(
      Math.max(options?.timeout ?? DEFAULT_TIMEOUT, MIN_TIMEOUT),
      MAX_TIMEOUT,
    );

    const responseType = options?.responseType === 'text' ? 'text' : 'json';

    const obs$ = this._http
      .request(upperMethod, url, {
        body,
        headers: new HttpHeaders(mergedHeaders),
        params,
        responseType,
      })
      .pipe(timeout(timeoutMs));

    return firstValueFrom(obs$) as Promise<T>;
  }

  /**
   * Issue a request through the native HTTP executor (OkHttp on Android,
   * URLSession on iOS). Returns text verbatim; on non-2xx it rejects with an
   * error carrying `.status`, mirroring `HttpClient`'s `HttpErrorResponse` so
   * plugin status checks (e.g. 404 on delete, 429/503 retry) behave identically.
   *
   * Note: `options.timeout` is not honored here — the native executor uses its
   * own fixed timeout (~30s). Acceptable for the current CalDAV callers, which
   * set no custom timeout.
   */
  private async _requestViaNativeHttp<T>(
    method: string,
    url: string,
    body: unknown,
    options: PluginHttpOptions | undefined,
    headers: Record<string, string>,
  ): Promise<T> {
    let finalUrl = url;
    if (options?.params && Object.keys(options.params).length) {
      const withParams = new URL(url);
      for (const [k, v] of Object.entries(options.params)) {
        withParams.searchParams.set(k, v);
      }
      finalUrl = withParams.toString();
    }

    const data =
      body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body);

    const res = await this._nativeHttp({
      url: finalUrl,
      method,
      headers,
      data,
      responseType: options?.responseType === 'text' ? 'text' : 'json',
    });

    if (res.status < 200 || res.status >= 300) {
      throw Object.assign(
        new Error(`[PluginHttp] Request failed with status ${res.status}`),
        { status: res.status },
      );
    }

    if (options?.responseType === 'text') {
      return (typeof res.data === 'string' ? res.data : String(res.data ?? '')) as T;
    }
    // Default responseType is 'json'; the native executor returns text, so parse
    // it here to match the HttpClient path. Fall back to the raw text if it
    // isn't valid JSON (e.g. an empty body).
    if (typeof res.data === 'string') {
      try {
        return (res.data ? JSON.parse(res.data) : null) as T;
      } catch {
        return res.data as T;
      }
    }
    return res.data as T;
  }

  private _validateUrl(url: string, allowPrivateNetwork: boolean): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`[PluginHttp] Invalid URL: ${url}`);
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`[PluginHttp] Unsupported URL scheme: ${parsed.protocol}`);
    }
    // Strip brackets from IPv6 addresses (URL.hostname may include them)
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

    // Always block cloud metadata endpoints (SSRF protection), even when allowPrivateNetwork is true
    if (CLOUD_METADATA_HOSTNAMES.has(hostname.toLowerCase())) {
      throw new Error(
        `[PluginHttp] Requests to cloud metadata endpoints are not allowed: ${hostname}`,
      );
    }

    if (!allowPrivateNetwork) {
      if (BLOCKED_HOSTNAMES.has(hostname) || isPrivateIp(hostname)) {
        throw new Error(
          `[PluginHttp] Requests to private/local networks are not allowed: ${hostname}`,
        );
      }
    }
  }
}
