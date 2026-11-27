import { CapacitorHttp } from '@capacitor/core';
import type { NativeHttpExecutor, NativeHttpResponse } from '@sp/sync-providers/http';
import { APP_PROVIDER_PLATFORM_INFO } from './app-provider-platform-info';

interface TimeoutOptions {
  connectTimeout?: number;
  readTimeout?: number;
}

/**
 * Adapts timeouts to how each Capacitor platform reads them. Android applies
 * `connectTimeout` to the TCP connect and `readTimeout` to waiting for data.
 * iOS has one `URLRequest.timeoutInterval` taken from
 * `connectTimeout ?? readTimeout` (@capacitor/ios HttpRequestHandler.swift),
 * so a short connect timeout would cut off a slow server response; on iOS we
 * drop it and let the read budget apply (#11830).
 */
export const toCapacitorHttpOptions = <T extends TimeoutOptions>(
  opts: T,
  isIosNative: boolean,
): T => {
  if (!isIosNative || opts.readTimeout === undefined) {
    return opts;
  }
  const iosOpts = { ...opts };
  delete iosOpts.connectTimeout;
  return iosOpts;
};

/** Shared CapacitorHttp executor for the sync providers. */
export const APP_NATIVE_HTTP_EXECUTOR: NativeHttpExecutor = (httpCfg) =>
  CapacitorHttp.request(
    toCapacitorHttpOptions(httpCfg, APP_PROVIDER_PLATFORM_INFO.isIosNative),
  ) as unknown as Promise<NativeHttpResponse>;
