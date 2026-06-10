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
