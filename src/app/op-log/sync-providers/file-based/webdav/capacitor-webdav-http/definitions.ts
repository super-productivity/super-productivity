export interface WebDavHttpPlugin {
  request(options: WebDavHttpOptions): Promise<WebDavHttpResponse>;
}

export interface WebDavHttpOptions {
  url: string;
  method: string;
  headers?: Record<string, string>;
  data?: string | null;
  /**
   * Forwarded from `NativeHttpRequestConfig.responseType`. The native plugin
   * implementations return text-only today (matching the design intent of the
   * `WebDavHttp` plugin — XML / multistatus must not be auto-parsed). If a
   * future plugin implementation honors this field, callers can opt into
   * `'json'` explicitly.
   */
  responseType?: 'text' | 'json';
}

export interface WebDavHttpResponse {
  data: string;
  status: number;
  headers: Record<string, string>;
  url: string;
}
