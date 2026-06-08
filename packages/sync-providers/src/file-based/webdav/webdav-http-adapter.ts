import type { SyncLogger } from '@sp/sync-core';
import type { ProviderPlatformInfo } from '../../platform/provider-platform-info';
import type { WebFetchFactory } from '../../platform/web-fetch-factory';
import type { NativeHttpExecutor } from '../../http/native-http-retry';
import {
  AuthFailSPError,
  HttpNotOkAPIError,
  PotentialCorsError,
  RemoteFileNotFoundAPIError,
  TooManyRequestsAPIError,
  WebDavNativeRequestError,
} from '../../errors';
import { errorMeta } from '../../log/error-meta';
import { WebDavHttpHeader, WebDavHttpStatus } from './webdav.const';

export interface WebDavHttpRequest {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string | null;
}

export interface WebDavHttpResponse {
  status: number;
  headers: Record<string, string>;
  data: string;
}

export interface WebDavHttpAdapterDeps {
  platformInfo: ProviderPlatformInfo;
  webFetch: WebFetchFactory;
  /**
   * Native HTTP path for WebDAV. On Capacitor platforms this is wired to the
   * app-side `WebDavHttp` plugin (which bypasses `CapacitorHttp`'s JSON
   * auto-parse / empty-body bugs on Android/iOS). On web/Electron it can
   * point at the same `fetch`-wrapping executor; the adapter selects the
   * native path only when `platformInfo.isNativePlatform` is true.
   */
  nativeHttp: NativeHttpExecutor;
  logger: SyncLogger;
}

export class WebDavHttpAdapter {
  private static readonly L = 'WebDavHttpAdapter';

  /**
   * Sync correctness (#7144): force revalidation on the NATIVE HTTP path. iOS
   * `URLSession` caches GETs by default and an upstream reverse proxy / CDN may
   * cache too — a stale `sync-data.json` both hides remote changes and defeats
   * the content-hash conflict check, silently overwriting newer remote data.
   *
   * Native-only, intentionally: the web/fetch path uses the CORS-safe fetch
   * `cache: 'no-store'` option instead. `Cache-Control` is not a CORS-safelisted
   * request header, so adding it to a cross-origin browser request would require
   * the WebDAV server to allow it in preflight and could break web sync. Native
   * HTTP is not subject to CORS, so the headers are safe here and additionally
   * instruct upstream proxies to revalidate.
   */
  private static readonly NO_CACHE_HEADERS: Record<string, string> = {
    [WebDavHttpHeader.CACHE_CONTROL]: 'no-cache, no-store',
    Pragma: 'no-cache',
  };

  /**
   * Non-sensitive, cache-relevant response headers worth surfacing in a shared
   * log capture so we can tell whether a stale read came from a client cache or
   * an upstream proxy. Deliberately excludes anything that can carry user data
   * or secrets (set-cookie, www-authenticate, content-location, location).
   */
  private static readonly _CACHE_HEADER_ALLOWLIST = [
    'etag',
    'age',
    'cache-control',
    'date',
    'last-modified',
    'expires',
    'x-cache',
    'cf-cache-status',
    'x-served-by',
    'via',
    'x-proxy-cache',
  ] as const;

  constructor(private readonly _deps: WebDavHttpAdapterDeps) {}

  async request(options: WebDavHttpRequest): Promise<WebDavHttpResponse> {
    const scrubbedUrl = this._urlHostOnly(options.url);

    try {
      let response: WebDavHttpResponse;

      if (this._deps.platformInfo.isNativePlatform) {
        // On native platforms (Android + iOS), use the injected WebDavHttp
        // executor. This bypasses CapacitorHttp which has issues with WebDAV
        // responses (empty bodies on Android/Koofr, broken JSON auto-parsing
        // on iOS).
        this._deps.logger.normal(`${WebDavHttpAdapter.L}.request() native`, {
          method: options.method,
          url: scrubbedUrl,
          bodyChars: options.body != null ? options.body.length : 0,
        });
        const nativeResp = await this._deps.nativeHttp({
          url: options.url,
          method: options.method,
          headers: {
            ...(options.headers ?? {}),
            ...WebDavHttpAdapter.NO_CACHE_HEADERS,
          },
          data: options.body ?? undefined,
          responseType: 'text',
        });
        response = {
          status: nativeResp.status,
          headers: nativeResp.headers ?? {},
          data: typeof nativeResp.data === 'string' ? nativeResp.data : '',
        };
      } else {
        this._deps.logger.normal(`${WebDavHttpAdapter.L}.request() fetch`, {
          method: options.method,
          url: scrubbedUrl,
          bodyChars: options.body != null ? options.body.length : 0,
        });
        try {
          const fetchImpl = this._deps.webFetch();
          const fetchResponse = await fetchImpl(options.url, {
            method: options.method,
            headers: options.headers,
            body: options.body,
            // Disable HTTP caching to ensure we get fresh metadata for sync operations
            cache: 'no-store',
          });

          response = await this._convertFetchResponse(fetchResponse);
        } catch (fetchError) {
          if (this._isLikelyCors(fetchError)) {
            // Privacy: PotentialCorsError carries only the scrubbed URL,
            // never the raw fetch error. The original-error meta below is
            // structured (errorName/errorCode), so the embedded URL some
            // browsers put in `error.message` never reaches a log.
            throw new PotentialCorsError(scrubbedUrl);
          }
          throw fetchError;
        }
      }

      // Diagnostic (#7144): surface cache-relevant response headers so a shared
      // log capture reveals whether a stale read originated from the client
      // cache or an upstream proxy. Allowlisted, non-sensitive metadata only.
      this._deps.logger.normal(`${WebDavHttpAdapter.L}.response()`, {
        method: options.method,
        url: scrubbedUrl,
        status: response.status,
        bodyChars: response.data.length,
        cacheHeaders: WebDavHttpAdapter._pickCacheHeaders(response.headers),
      });

      // Check for common HTTP errors
      this._checkHttpStatus(response.status, scrubbedUrl, response.data);

      return response;
    } catch (e) {
      if (
        e instanceof AuthFailSPError ||
        e instanceof PotentialCorsError ||
        e instanceof HttpNotOkAPIError ||
        e instanceof RemoteFileNotFoundAPIError ||
        e instanceof TooManyRequestsAPIError
      ) {
        throw e;
      }

      const nativeErrorCode = WebDavHttpAdapter._readErrorCode(e);
      this._deps.logger.critical(
        `${WebDavHttpAdapter.L}.request() error`,
        errorMeta(e, {
          ...(nativeErrorCode !== undefined ? { errorCode: nativeErrorCode } : {}),
          url: scrubbedUrl,
          method: options.method,
        }),
      );

      if (this._deps.platformInfo.isNativePlatform) {
        throw new WebDavNativeRequestError(
          this._formatNativeErrorMessage(e),
          nativeErrorCode,
        );
      }

      // Create a fake Response object for the error
      const errorResponse = new Response(`HTTP error for ${scrubbedUrl}`, {
        status: WebDavHttpStatus.INTERNAL_SERVER_ERROR,
      });
      throw new HttpNotOkAPIError(errorResponse);
    }
  }

  /**
   * Web-platform CORS detection. `fetch` rejects with a generic
   * `TypeError` for cross-origin, offline, DNS, and server-unreachable
   * cases — there is no portable distinguishing signal. Match on
   * substrings the major browsers actually emit:
   *
   * - Chrome / Safari: `"Failed to fetch"` / `"Load failed"`
   * - Firefox: `"NetworkError when attempting to fetch resource at <url>"`
   *   (URL leak is contained by `PotentialCorsError(scrubbedUrl)`).
   * - Explicit: `"CORS"`, `"cross-origin"`, `"opaque"`.
   *
   * Bias is intentional: WebDAV's most common deployment failure mode
   * IS misconfigured CORS, so over-attributing offline / DNS to CORS
   * still surfaces an actionable hint to the user. Native-platform
   * paths never hit this branch.
   */
  private _isLikelyCors(error: unknown): boolean {
    if (!(error instanceof TypeError)) return false;
    const m = error.message.toLowerCase();
    return (
      m.includes('cors') ||
      m.includes('cross-origin') ||
      m.includes('opaque') ||
      m.includes('failed to fetch') ||
      m.includes('load failed') ||
      m.includes('network request failed') ||
      m.includes('networkerror when attempting')
    );
  }

  private _urlHostOnly(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return '[invalid-webdav-url]';
    }
  }

  private _formatNativeErrorMessage(error: unknown): string {
    const message =
      error instanceof Error && error.message
        ? error.message
        : typeof error === 'string' && error
          ? error
          : 'Native WebDAV request failed';
    return WebDavHttpAdapter._redactUrlParts(message);
  }

  private static _readErrorCode(error: unknown): string | number | undefined {
    const rawCode = (error as { code?: unknown } | null)?.code;
    return typeof rawCode === 'string' || typeof rawCode === 'number'
      ? rawCode
      : undefined;
  }

  private static _redactUrlParts(message: string): string {
    return message.replace(/https?:\/\/[^\s"'<>]+/gi, (rawUrl) => {
      try {
        const url = new URL(rawUrl);
        return `${url.protocol}//${url.host}`;
      } catch {
        return '[redacted-url]';
      }
    });
  }

  /**
   * Serialize the allowlisted cache-relevant headers (case-insensitive) into a
   * compact, log-safe string like `etag=W/"a1"; age=3; x-cache=HIT`. Returns
   * `'none'` when the response carries no such headers (already a useful
   * signal). `SyncLogMeta` only holds primitives, hence a string not an object.
   */
  private static _pickCacheHeaders(headers: Record<string, string>): string {
    const lower: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      lower[key.toLowerCase()] = value;
    }
    const parts: string[] = [];
    for (const key of WebDavHttpAdapter._CACHE_HEADER_ALLOWLIST) {
      if (lower[key] !== undefined) {
        parts.push(`${key}=${lower[key]}`);
      }
    }
    return parts.length > 0 ? parts.join('; ') : 'none';
  }

  private async _convertFetchResponse(response: Response): Promise<WebDavHttpResponse> {
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      status: response.status,
      headers,
      data: await response.text(),
    };
  }

  private _checkHttpStatus(status: number, scrubbedUrl: string, body?: string): void {
    if (status === WebDavHttpStatus.NOT_MODIFIED) {
      // 304 Not Modified is not an error - let it pass through
      return;
    }

    if (status === WebDavHttpStatus.UNAUTHORIZED) {
      throw new AuthFailSPError('Authentication failed (HTTP 401)');
    }

    if (status === WebDavHttpStatus.NOT_FOUND) {
      throw new RemoteFileNotFoundAPIError(scrubbedUrl);
    }

    if (status === WebDavHttpStatus.TOO_MANY_REQUESTS) {
      throw new TooManyRequestsAPIError({ status });
    }

    if (status < 200 || status >= 300) {
      // Create a fake Response object for the error
      // Ensure status is valid (200-599) for Response constructor
      const safeStatus = status >= 200 && status <= 599 ? status : 500;
      const errorResponse = new Response(`HTTP ${status} for ${scrubbedUrl}`, {
        status: safeStatus,
      });
      // body retained for HttpNotOkAPIError.detail (UI surfacing) but the
      // WebDAV catch-site below logs only safe SyncLogMeta primitives.
      throw new HttpNotOkAPIError(errorResponse, body);
    }
  }
}
