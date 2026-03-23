import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { PluginHttp, PluginHttpOptions } from './plugin-issue-provider.model';

const DEFAULT_TIMEOUT = 30000;
const MIN_TIMEOUT = 1000;
const MAX_TIMEOUT = 120000;

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  'metadata.google.internal',
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

@Injectable({ providedIn: 'root' })
export class PluginHttpService {
  private _http = inject(HttpClient);

  createHttpHelper(
    getHeaders: () => Record<string, string> | Promise<Record<string, string>>,
  ): PluginHttp {
    return {
      get: <T>(url: string, options?: PluginHttpOptions) =>
        this._request<T>('GET', url, undefined, options, getHeaders),
      post: <T>(url: string, body: unknown, options?: PluginHttpOptions) =>
        this._request<T>('POST', url, body, options, getHeaders),
      put: <T>(url: string, body: unknown, options?: PluginHttpOptions) =>
        this._request<T>('PUT', url, body, options, getHeaders),
      patch: <T>(url: string, body: unknown, options?: PluginHttpOptions) =>
        this._request<T>('PATCH', url, body, options, getHeaders),
      delete: <T>(url: string, options?: PluginHttpOptions) =>
        this._request<T>('DELETE', url, undefined, options, getHeaders),
    };
  }

  private async _request<T>(
    method: string,
    url: string,
    body: unknown | undefined,
    options: PluginHttpOptions | undefined,
    getHeaders: () => Record<string, string> | Promise<Record<string, string>>,
  ): Promise<T> {
    this._validateUrl(url);

    const authHeaders = await Promise.resolve(getHeaders());
    const mergedHeaders = { ...options?.headers, ...authHeaders };

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

    const obs$ = this._http
      .request<T>(method, url, {
        body,
        headers: new HttpHeaders(mergedHeaders),
        params,
      })
      .pipe(timeout(timeoutMs));

    return firstValueFrom(obs$);
  }

  private _validateUrl(url: string): void {
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
    if (BLOCKED_HOSTNAMES.has(hostname) || isPrivateIp(hostname)) {
      throw new Error(
        `[PluginHttp] Requests to private/local networks are not allowed: ${hostname}`,
      );
    }
  }
}
