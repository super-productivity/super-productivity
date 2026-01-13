export interface WebDavHttpPlugin {
  request(options: WebDavHttpOptions): Promise<WebDavHttpResponse>;
}

export interface WebDavHttpOptions {
  url: string;
  method: string;
  headers?: Record<string, string>;
  data?: string | null;
  responseType?: 'text' | 'json';
}

export interface WebDavHttpResponse {
  data: string;
  status: number;
  headers: Record<string, string>;
  url: string;
}
