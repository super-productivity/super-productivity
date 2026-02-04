import { CapacitorHttp, HttpResponse } from '@capacitor/core';
import { SyncLog } from '../../core/log';

/**
 * Max retries for transient network errors (e.g., iOS NSURLErrorNetworkConnectionLost).
 * iOS NSURLSession does NOT auto-retry POST requests (non-idempotent per RFC 7231).
 * Retries are safe for Dropbox uploads: conditional writes (mode: 'update' with revToMatch
 * or mode: 'add') ensure duplicates fail with UploadRevToMatchMismatchAPIError.
 * Retries are safe for SuperSync: the server uses idempotent operations.
 * @see https://developer.apple.com/library/archive/qa/qa1941/_index.html
 */
const MAX_RETRIES = 2;

export interface NativeRequestConfig {
  url: string;
  method: string;
  headers: Record<string, string>;
  data?: string;
  responseType?: 'text' | 'json';
  connectTimeout?: number;
  readTimeout?: number;
}

const defaultDelay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Execute a CapacitorHttp request with retry logic for transient network errors.
 * Only network-level errors thrown by CapacitorHttp are retried;
 * HTTP response errors (401, 404, etc.) are handled by the caller.
 *
 * @param config - CapacitorHttp request configuration
 * @param label - Logging label for the caller (e.g., 'DropboxApi', 'SuperSync')
 * @param requestFn - Optional custom request function (for testing). Defaults to CapacitorHttp.request.
 * @param delayFn - Optional delay function (for testing). Defaults to setTimeout-based delay.
 */
export const executeNativeRequestWithRetry = async (
  config: NativeRequestConfig,
  label: string = 'NativeHttp',
  requestFn: (opts: NativeRequestConfig) => Promise<HttpResponse> = (opts) =>
    CapacitorHttp.request(opts),
  delayFn: (ms: number) => Promise<void> = defaultDelay,
): Promise<HttpResponse> => {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await requestFn({
        url: config.url,
        method: config.method,
        headers: config.headers,
        data: config.data,
        responseType: config.responseType ?? 'text',
        connectTimeout: config.connectTimeout ?? 30000,
        readTimeout: config.readTimeout ?? 120000,
      });
    } catch (retryErr) {
      if (attempt < MAX_RETRIES && isTransientNetworkError(retryErr)) {
        const delayMs = 1000 * (attempt + 1);
        SyncLog.warn(
          `${label} transient network error on ${config.url}, ` +
            `retrying in ${delayMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
          retryErr,
        );
        await delayFn(delayMs);
        continue;
      }
      throw retryErr;
    }
  }
  // Unreachable: loop always returns or throws, but TypeScript needs this
  throw new Error('All retry attempts exhausted');
};

/**
 * Checks if an error is a transient network error that should be retried.
 *
 * Uses a hybrid detection strategy:
 *
 * **iOS (primary):** Checks `error.code === 'NSURLErrorDomain'`. Capacitor's
 * HttpRequestHandler.swift calls `call.reject(error.localizedDescription, (error as NSError).domain, error, nil)`,
 * so the domain string (always `"NSURLErrorDomain"` for network errors) lands on `error.code`
 * in JavaScript. This is locale-proof — it works regardless of the device language.
 * Note: SSL errors also have NSURLErrorDomain, but retrying them is harmless
 * (they fail instantly and consistently — at most 2 extra immediate failures).
 *
 * **Android (primary):** Checks `error.code` against Java exception class names like
 * `'SocketTimeoutException'`, `'UnknownHostException'`, and `'ConnectException'`.
 * Capacitor's CapacitorHttp.java uses `call.reject(e.getLocalizedMessage(), e.getClass().getSimpleName(), e)`.
 *
 * **Fallback:** English string matching on the error message for web/Electron/unknown platforms.
 */
export const isTransientNetworkError = (e: unknown): boolean => {
  // Check error.code first (locale-proof for iOS and Android)
  const errorCode = (e as { code?: string } | null)?.code;
  if (typeof errorCode === 'string') {
    // iOS: NSURLErrorDomain covers all network errors (connection lost, timeout, DNS, etc.)
    if (errorCode === 'NSURLErrorDomain') {
      return true;
    }
    // Android: Java exception class names
    if (
      errorCode === 'SocketTimeoutException' ||
      errorCode === 'UnknownHostException' ||
      errorCode === 'ConnectException'
    ) {
      return true;
    }
  }

  // Fallback: English string matching for web/Electron/unknown platforms
  const message = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return (
    message.includes('network connection was lost') ||
    message.includes('timed out') ||
    message.includes('not connected to the internet') ||
    message.includes('internet connection appears to be offline') ||
    message.includes('cannot find host') ||
    message.includes('hostname could not be found') ||
    message.includes('cannot connect to host') ||
    message.includes('could not connect to the server')
  );
};
