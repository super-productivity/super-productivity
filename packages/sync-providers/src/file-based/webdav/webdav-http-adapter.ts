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
} from '../../errors';
import { errorMeta, urlPathOnly } from '../../log/error-meta';
import { WebDavHttpStatus } from './webdav.const';

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

  constructor(private readonly _deps: WebDavHttpAdapterDeps) {}

  async request(options: WebDavHttpRequest): Promise<WebDavHttpResponse> {
    const scrubbedUrl = urlPathOnly(options.url);

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
          headers: options.headers ?? {},
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
            // never the raw fetch error. The original-error meta below
            // is structured (errorName/errorCode), so the embedded URL
            // some browsers put in `error.message` (Firefox:
            // "NetworkError when attempting to fetch resource at <url>")
            // never reaches a log.
            throw new PotentialCorsError(scrubbedUrl);
          }
          throw fetchError;
        }
      }

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

      this._deps.logger.critical(
        `${WebDavHttpAdapter.L}.request() error`,
        errorMeta(e, { url: scrubbedUrl, method: options.method }),
      );
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
      throw new AuthFailSPError();
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
