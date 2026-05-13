import { CapacitorHttp, HttpResponse } from '@capacitor/core';
import {
  executeNativeRequestWithRetry as packageExecuteNativeRequestWithRetry,
  isTransientNetworkError as packageIsTransientNetworkError,
  type NativeHttpExecutor,
  type NativeHttpRequestConfig,
  type NativeHttpResponse,
} from '@sp/sync-providers/http';
import { OP_LOG_SYNC_LOGGER } from '../core/sync-logger.adapter';

export type NativeRequestConfig = NativeHttpRequestConfig;

/**
 * App-side adapter: wires CapacitorHttp + OP_LOG_SYNC_LOGGER into the
 * package-owned retry helper. Existing callers keep their positional API.
 *
 * The package version (with `{ executor, logger, label, delay }` options)
 * is the canonical interface — provider files that move into
 * `@sp/sync-providers` should call it directly.
 */
export const executeNativeRequestWithRetry = async (
  config: NativeRequestConfig,
  label: string = 'NativeHttp',
  requestFn: (opts: NativeRequestConfig) => Promise<HttpResponse> = (opts) =>
    CapacitorHttp.request(opts),
  delayFn?: (ms: number) => Promise<void>,
): Promise<HttpResponse> => {
  const executor: NativeHttpExecutor = (cfg) =>
    requestFn(cfg) as unknown as Promise<NativeHttpResponse>;

  const response = await packageExecuteNativeRequestWithRetry(config, {
    executor,
    logger: OP_LOG_SYNC_LOGGER,
    label,
    delay: delayFn,
  });
  return response as unknown as HttpResponse;
};

export const isTransientNetworkError = packageIsTransientNetworkError;
