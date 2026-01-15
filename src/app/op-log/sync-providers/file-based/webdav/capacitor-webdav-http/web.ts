import { WebPlugin } from '@capacitor/core';
import type {
  WebDavHttpPlugin,
  WebDavHttpOptions,
  WebDavHttpResponse,
} from './definitions';

export class WebDavHttpWeb extends WebPlugin implements WebDavHttpPlugin {
  async request(options: WebDavHttpOptions): Promise<WebDavHttpResponse> {
    const { url, method, headers, data } = options;

    // For web platform, we can use fetch with any HTTP method including WebDAV
    const response = await fetch(url, {
      method,
      headers,
      body: data || undefined,
    });

    // Get response headers
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    // Get response data
    const responseData = await response.text();

    return {
      data: responseData,
      status: response.status,
      headers: responseHeaders,
      url: response.url,
    };
  }
}
