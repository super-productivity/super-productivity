import { NOOP_SYNC_LOGGER, toSyncLogError, type SyncLogger } from '@sp/sync-core';

/**
 * Max retries for transient network errors (e.g., iOS NSURLErrorNetworkConnectionLost).
 * iOS NSURLSession does NOT auto-retry POST requests (non-idempotent per RFC 7231).
 * Retries are safe for Dropbox uploads: conditional writes (mode: 'update' with revToMatch
 * or mode: 'add') ensure duplicates fail with UploadRevToMatchMismatchAPIError.
 * Retries are safe for SuperSync: the server uses idempotent operations.
 * @see https://developer.apple.com/library/archive/qa/qa1941/_index.html
 */
const MAX_RETRIES = 2;

const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;
const DEFAULT_READ_TIMEOUT_MS = 120_000;

export interface NativeHttpRequestConfig {
  url: string;
  method: string;
  headers: Record<string, string>;
  data?: string;
  responseType?: 'text' | 'json';
  connectTimeout?: number;
  readTimeout?: number;
}

export interface NativeHttpResponse {
  status: number;
  headers: Record<string, string>;
  data: unknown;
  url?: string;
}

export type NativeHttpExecutor = (
  config: NativeHttpRequestConfig,
) => Promise<NativeHttpResponse>;

export interface ExecuteNativeRequestOptions {
  executor: NativeHttpExecutor;
  logger?: SyncLogger;
  label?: string;
  delay?: (ms: number) => Promise<void>;
  /**
   * Maximum number of retries on transient network errors. Defaults to
   * `MAX_RETRIES` (2). Pass `0` to disable retries (e.g. one-shot
   * user-initiated auth code exchange where automatic retry is not
   * appropriate).
   */
  maxRetries?: number;
}

const defaultDelay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Execute a native HTTP request with retry logic for transient network errors.
 * Only network-level errors thrown by the executor are retried;
 * HTTP response errors (401, 404, etc.) are handled by the caller.
 *
 * The executor is injected so this helper stays platform-agnostic — hosts
 * provide CapacitorHttp on native platforms, fetch on web/Electron, or a
 * test double in unit tests.
 */
export const executeNativeRequestWithRetry = async (
  config: NativeHttpRequestConfig,
  options: ExecuteNativeRequestOptions,
): Promise<NativeHttpResponse> => {
  const {
    executor,
    logger = NOOP_SYNC_LOGGER,
    label = 'NativeHttp',
    delay = defaultDelay,
    maxRetries = MAX_RETRIES,
  } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await executor({
        url: config.url,
        method: config.method,
        headers: config.headers,
        data: config.data,
        responseType: config.responseType ?? 'text',
        connectTimeout: config.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT_MS,
        readTimeout: config.readTimeout ?? DEFAULT_READ_TIMEOUT_MS,
      });
    } catch (retryErr) {
      if (attempt < maxRetries && isTransientNetworkError(retryErr)) {
        const delayMs = 1000 * (attempt + 1);
        // toSyncLogError drops .code on Error instances, so we read it directly
        // off the raw error to preserve platform-specific transient codes
        // (NSURLErrorDomain, SocketTimeoutException, …) in the retry log.
        const rawCode = (retryErr as { code?: unknown } | null)?.code;
        logger.warn(
          `${label} transient network error, retrying in ${delayMs}ms ` +
            `(attempt ${attempt + 1}/${maxRetries})`,
          {
            url: config.url,
            attempt: attempt + 1,
            maxRetries,
            delayMs,
            errorName: toSyncLogError(retryErr).name,
            errorCode:
              typeof rawCode === 'string' || typeof rawCode === 'number'
                ? rawCode
                : undefined,
          },
        );
        await delay(delayMs);
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
  const errorCode = (e as { code?: string } | null)?.code;
  if (typeof errorCode === 'string') {
    if (errorCode === 'NSURLErrorDomain') {
      return true;
    }
    if (
      errorCode === 'SocketTimeoutException' ||
      errorCode === 'UnknownHostException' ||
      errorCode === 'ConnectException'
    ) {
      return true;
    }
  }

  const message = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return (
    message.includes('network connection was lost') ||
    // Intentionally broad: matches "request timed out", "connection timed out", "operation timed out", etc.
    // Narrowing to "request timed out" would miss legitimate transient network errors.
    message.includes('timed out') ||
    message.includes('not connected to the internet') ||
    message.includes('internet connection appears to be offline') ||
    message.includes('cannot find host') ||
    message.includes('hostname could not be found') ||
    message.includes('cannot connect to host') ||
    message.includes('could not connect to the server')
  );
};
