import { ipcMain } from 'electron';
import { IPC } from '../shared-with-frontend/ipc-events.const';
import * as https from 'https';
import * as http from 'http';
import * as zlib from 'zlib';
import { Readable } from 'stream';

interface UrlMetadataResult {
  title: string | null;
  error?: string;
}

const MAX_REDIRECTS = 5;

const fetchUrlMetadata = async (
  url: string,
  redirectCount = 0,
): Promise<UrlMetadataResult> => {
  try {
    // Prevent infinite redirect loops
    if (redirectCount > MAX_REDIRECTS) {
      return { title: null, error: 'Too many redirects' };
    }

    // Skip file:// URLs
    if (url.startsWith('file://')) {
      return { title: null };
    }

    // Normalize protocol-relative URLs (//example.com) to https://
    let normalizedUrl = url;
    if (url.startsWith('//')) {
      normalizedUrl = 'https:' + url;
    }

    // Determine protocol
    const isHttps = normalizedUrl.startsWith('https://');
    const httpModule = isHttps ? https : http;

    return await new Promise<UrlMetadataResult>((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ title: null, error: 'Timeout' });
      }, 5000);

      // Add User-Agent and Accept headers to look like a real browser
      const options = new URL(normalizedUrl);
      const requestOptions = {
        hostname: options.hostname,
        port: options.port,
        path: options.pathname + options.search,
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Accept-Language': 'en-US,en;q=0.9',
        },
      };

      const req = httpModule.get(requestOptions, async (res) => {
        // Handle rate limiting / bot protection
        if (res.statusCode === 429 || res.statusCode === 403) {
          clearTimeout(timeout);
          resolve({ title: null, error: 'Rate limited or blocked' });
          return;
        }

        // Follow redirects
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          clearTimeout(timeout);
          // Recursively fetch from redirect location, incrementing redirect count
          const redirectResult = await fetchUrlMetadata(
            res.headers.location,
            redirectCount + 1,
          );
          resolve(redirectResult);
          return;
        }

        // Only accept 2xx responses
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          clearTimeout(timeout);
          resolve({ title: null, error: `HTTP ${res.statusCode}` });
          return;
        }

        // Handle content encoding (gzip, deflate, br)
        let stream: Readable = res;
        const encoding = res.headers['content-encoding'];

        if (encoding === 'gzip') {
          stream = res.pipe(zlib.createGunzip());
        } else if (encoding === 'deflate') {
          stream = res.pipe(zlib.createInflate());
        } else if (encoding === 'br') {
          stream = res.pipe(zlib.createBrotliDecompress());
        }

        let html = '';
        let resolved = false;
        stream.setEncoding('utf8');

        stream.on('data', (chunk: string) => {
          html += chunk;
          // Stop early if we've found the title (optimization)
          if (html.includes('</title>') || html.length > 50000) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);

              const title = extractTitle(html);
              stream.destroy();
              resolve({ title });
            }
          }
        });

        stream.on('end', () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            const title = extractTitle(html);
            resolve({ title });
          }
        });

        stream.on('error', (err) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            console.log('[Electron] Stream error:', err.message);
            resolve({ title: null, error: err.message });
          }
        });

        res.on('close', () => {});
      });

      req.on('error', (err) => {
        clearTimeout(timeout);
        console.log('[Electron] Request error:', err.message);
        resolve({ title: null, error: err.message });
      });

      req.setTimeout(5000, () => {
        req.destroy();
        clearTimeout(timeout);
        resolve({ title: null, error: 'Request timeout' });
      });
    });
  } catch (error) {
    console.log('[Electron] Exception in fetchUrlMetadata:', (error as Error).message);
    return { title: null, error: (error as Error).message };
  }
};

export const initUrlMetadataIpc = (): void => {
  ipcMain.handle(IPC.FETCH_URL_METADATA, async (_ev, url: string) => {
    return await fetchUrlMetadata(url);
  });
};

const extractTitle = (html: string): string | null => {
  // Try <title> tag
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    return decodeHtmlEntities(titleMatch[1].trim());
  }

  // Try OpenGraph og:title
  const ogTitleMatch = html.match(
    /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i,
  );
  if (ogTitleMatch && ogTitleMatch[1]) {
    return decodeHtmlEntities(ogTitleMatch[1].trim());
  }

  // Try OpenGraph og:title (reversed attribute order)
  const ogTitleMatch2 = html.match(
    /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i,
  );
  if (ogTitleMatch2 && ogTitleMatch2[1]) {
    return decodeHtmlEntities(ogTitleMatch2[1].trim());
  }

  return null;
};

const decodeHtmlEntities = (text: string): string => {
  const entities: Record<string, string> = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '&amp;': '&',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '&lt;': '<',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '&gt;': '>',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '&quot;': '"',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '&#39;': "'",
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '&apos;': "'",
  };

  return text.replace(/&[^;]+;/g, (entity) => entities[entity] || entity);
};
