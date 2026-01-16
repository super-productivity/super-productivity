import { CapacitorHttp, HttpResponse, registerPlugin } from '@capacitor/core';
import { IS_ANDROID_WEB_VIEW } from '../../../../util/is-android-web-view';
import { PFLog } from '../../../../core/log';
import {
  AuthFailSPError,
  PotentialCorsError,
  HttpNotOkAPIError,
  RemoteFileNotFoundAPIError,
  TooManyRequestsAPIError,
} from '../../../core/errors/sync-errors';
import { WebDavHttpStatus } from './webdav.const';
import { Capacitor } from '@capacitor/core';

// Define and register our WebDAV plugin
interface WebDavHttpPluginRequest {
  url: string;
  method: string;
  headers?: Record<string, string>;
  data?: string | null;
}

interface WebDavHttpPluginResponse {
  status: number;
  headers?: Record<string, string>;
  data?: string;
}

interface WebDavHttpPlugin {
  request(options: WebDavHttpPluginRequest): Promise<WebDavHttpPluginResponse>;
}

const WebDavHttp = registerPlugin<WebDavHttpPlugin>('WebDavHttp');

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

export class WebDavHttpAdapter {
  private static readonly L = 'WebDavHttpAdapter';
  private static readonly WEBDAV_METHODS = [
    'PROPFIND',
    'MKCOL',
    'MOVE',
    'COPY',
    'LOCK',
    'UNLOCK',
    'PROPPATCH',
  ];

  // Make platform checks testable by making them class properties
  protected get isAndroidWebView(): boolean {
    return IS_ANDROID_WEB_VIEW;
  }

  protected get isNativePlatform(): boolean {
    return Capacitor.isNativePlatform();
  }

  async request(options: WebDavHttpRequest): Promise<WebDavHttpResponse> {
    try {
      let response: WebDavHttpResponse;

      if (this.isNativePlatform) {
        // Check if this is a WebDAV method
        const isWebDavMethod = WebDavHttpAdapter.WEBDAV_METHODS.includes(
          options.method.toUpperCase(),
        );

        // On Android, use custom WebDavHttp plugin for WebDAV methods (better retry handling)
        // On iOS, use CapacitorHttp for all methods (including WebDAV)
        if (isWebDavMethod && this.isAndroidWebView) {
          // Use our custom WebDAV plugin for WebDAV methods on Android
          PFLog.log(
            `${WebDavHttpAdapter.L}.request() using WebDavHttp for ${options.method}`,
          );
          const webdavResponse = await WebDavHttp.request({
            url: options.url,
            method: options.method,
            headers: options.headers,
            data: options.body,
          });
          response = this._convertWebDavResponse(webdavResponse);
        } else {
          // Use standard CapacitorHttp for:
          // - All methods on iOS (including WebDAV)
          // - Regular HTTP methods on Android
          PFLog.log(
            `${WebDavHttpAdapter.L}.request() using CapacitorHttp for ${options.method}`,
          );
          const capacitorResponse = await CapacitorHttp.request({
            url: options.url,
            method: options.method,
            headers: options.headers,
            data: options.body,
          });
          response = this._convertCapacitorResponse(capacitorResponse);
        }
      } else {
        // Use fetch for other platforms
        try {
          const fetchResponse = await fetch(options.url, {
            method: options.method,
            headers: options.headers,
            body: options.body,
            // Disable HTTP caching to ensure we get fresh metadata for sync operations
            cache: 'no-store',
          });

          response = await this._convertFetchResponse(fetchResponse);
        } catch (fetchError) {
          // Check if it's a CORS error
          if (this._isCorsError(fetchError)) {
            throw new PotentialCorsError(options.url);
          }
          throw fetchError;
        }
      }

      // Check for common HTTP errors
      this._checkHttpStatus(response.status, options.url, response.data);

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

      PFLog.error(`${WebDavHttpAdapter.L}.request() error`, {
        url: options.url,
        method: options.method,
        error: e,
      });
      // Create a fake Response object for the error
      const errorResponse = new Response('Network error', {
        status: WebDavHttpStatus.INTERNAL_SERVER_ERROR,
        statusText: `Network error: ${e}`,
      });
      throw new HttpNotOkAPIError(errorResponse);
    }
  }

  private _convertCapacitorResponse(response: HttpResponse): WebDavHttpResponse {
    return {
      status: response.status,
      headers: response.headers || {},
      data: response.data || '',
    };
  }

  private _convertWebDavResponse(response: WebDavHttpPluginResponse): WebDavHttpResponse {
    return {
      status: response.status,
      headers: response.headers || {},
      data: response.data || '',
    };
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

  private _checkHttpStatus(status: number, url: string, body?: string): void {
    if (status === WebDavHttpStatus.NOT_MODIFIED) {
      // 304 Not Modified is not an error - let it pass through
      return;
    }

    if (status === WebDavHttpStatus.UNAUTHORIZED) {
      throw new AuthFailSPError();
    }

    if (status === WebDavHttpStatus.NOT_FOUND) {
      throw new RemoteFileNotFoundAPIError(url);
    }

    if (status === WebDavHttpStatus.TOO_MANY_REQUESTS) {
      throw new TooManyRequestsAPIError();
    }

    if (status < 200 || status >= 300) {
      // Create a fake Response object for the error
      // Ensure status is valid (200-599) for Response constructor
      const safeStatus = status >= 200 && status <= 599 ? status : 500;
      const errorResponse = new Response('', {
        status: safeStatus,
        statusText: `HTTP ${status} for ${url}`,
      });
      throw new HttpNotOkAPIError(errorResponse, body);
    }
  }

  private _isCorsError(error: unknown): boolean {
    // CORS errors in browsers typically manifest as TypeError
    // However, "Failed to fetch" can occur for many reasons (network down, DNS, etc.)
    // We can only make an educated guess based on the error and context

    if (!(error instanceof TypeError)) {
      return false;
    }

    const message = error.message.toLowerCase();

    // Explicit CORS mentions are most reliable
    if (message.includes('cors') || message.includes('cross-origin')) {
      return true;
    }

    // "Failed to fetch" could be CORS, but we need additional context
    // In a browser environment with a properly configured server,
    // this is often CORS, but we should be cautious about false positives
    if (
      message.includes('failed to fetch') ||
      message.includes('network request failed')
    ) {
      // For WebDAV, if we can reach the server at all (e.g., OPTIONS request works),
      // but the actual request fails with "failed to fetch", it's likely CORS
      // However, without making a test request, we can't be certain

      // Log a warning about the ambiguity
      PFLog.warn(
        `${WebDavHttpAdapter.L}._isCorsError() Ambiguous network error - might be CORS:`,
        error,
      );

      // Return true since CORS is a common cause in browser environments
      // and we want to provide helpful guidance to users
      return true;
    }

    return false;
  }
}
