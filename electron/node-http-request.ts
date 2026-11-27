import * as http from 'http';
import * as https from 'https';
import { PassThrough, Readable } from 'stream';
import * as zlib from 'zlib';

/**
 * Minimal HTTP client for the Electron main process. It replaces node-fetch v2
 * (v3 is ESM-only; Electron main is CommonJS). Global `fetch` is not an option
 * because it ignores `agent`, which carries the proxy and self-signed
 * certificate handling from `createProxyAwareAgent`.
 */
export interface HttpRequestInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  agent?: http.Agent;
  /** Redirects are never followed; callers handle them. */
  redirect: 'manual';
  /** Separate budgets for receiving headers and reading the body; 0 = none. */
  timeout: number;
  /** Maximum decoded body bytes; 0 = unlimited. */
  size: number;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  headers: { get: (name: string) => string | null };
  body: { destroy: () => void };
  text: () => Promise<string>;
}

// Mirrors the defaults node-fetch v2 sent, so servers see the same request
// as before the dependency was dropped. Caller headers win.
const DEFAULT_HEADERS: Record<string, string> = {
  accept: '*/*',
  // eslint-disable-next-line @typescript-eslint/naming-convention
  'accept-encoding': 'gzip,deflate',
  // eslint-disable-next-line @typescript-eslint/naming-convention
  'user-agent': 'node-fetch/1.0 (+https://github.com/bitinn/node-fetch)',
};

const buildHeaders = (init: HttpRequestInit): Record<string, string> => {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(init.headers)) {
    headers[name.toLowerCase()] = value;
  }
  const defaults: Record<string, string> = { ...DEFAULT_HEADERS };
  if (!init.agent) {
    defaults.connection = 'close';
  }
  if (init.body !== undefined) {
    defaults['content-type'] = 'text/plain;charset=UTF-8';
  }
  if (init.body !== undefined || init.method === 'POST' || init.method === 'PUT') {
    headers['content-length'] = String(Buffer.byteLength(init.body ?? ''));
  }
  return { ...defaults, ...headers };
};

interface BodySource {
  stream: Readable;
  /** Destroys the decoded stream and the socket-backed response together. */
  destroy: () => void;
}

const startBodyTimer = (
  url: string,
  timeout: number,
  fail: (error: Error) => void,
): NodeJS.Timeout | undefined =>
  timeout > 0
    ? setTimeout(
        () =>
          fail(
            new Error(
              `Response timeout while trying to fetch ${url} (over ${timeout}ms)`,
            ),
          ),
        timeout,
      )
    : undefined;

const readText = (
  { stream, destroy }: BodySource,
  url: string,
  { timeout, size }: Pick<HttpRequestInit, 'timeout' | 'size'>,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    const fail = (error: Error): void => {
      clearTimeout(timer);
      destroy();
      reject(error);
    };
    const failBody = (error: Error): void =>
      fail(
        new Error(`Invalid response body while trying to fetch ${url}: ${error.message}`),
      );
    const timer = startBodyTimer(url, timeout, fail);
    if (stream.errored) {
      failBody(stream.errored);
      return;
    }
    stream.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (size > 0 && bytes > size) {
        fail(new Error(`content size at ${url} over limit: ${size}`));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('end', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    stream.on('error', failBody);
  });

const ZLIB_OPTIONS = {
  flush: zlib.constants.Z_SYNC_FLUSH,
  finishFlush: zlib.constants.Z_SYNC_FLUSH,
};

// Some servers send raw deflate for `Content-Encoding: deflate`; like
// node-fetch v2, sniff the first byte to pick zlib-wrapped vs raw inflate.
const inflate = (res: http.IncomingMessage): Readable => {
  const out = new PassThrough();
  let started = false;
  res.once('data', (chunk: Buffer) => {
    started = true;
    const inflater =
      (chunk[0] & 0x0f) === 0x08
        ? zlib.createInflate(ZLIB_OPTIONS)
        : zlib.createInflateRaw(ZLIB_OPTIONS);
    inflater.on('error', (error) => out.destroy(error));
    inflater.write(chunk);
    res.pipe(inflater).pipe(out);
  });
  res.once('end', () => {
    if (!started) {
      out.end();
    }
  });
  return out;
};

const decodeBody = (res: http.IncomingMessage, method: string): Readable => {
  const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase();
  const hasBody = method !== 'HEAD' && res.statusCode !== 204 && res.statusCode !== 304;
  if (!hasBody || !['gzip', 'x-gzip', 'deflate'].includes(encoding)) {
    return res;
  }
  const decoded =
    encoding === 'deflate' ? inflate(res) : res.pipe(zlib.createGunzip(ZLIB_OPTIONS));
  res.on('error', (error) => decoded.destroy(error));
  return decoded;
};

const toBodySource = (res: http.IncomingMessage, method: string): BodySource => {
  const stream = decodeBody(res, method);
  // Errors before text() is called would otherwise crash the main process;
  // readText reports them via `stream.errored` or its own listener.
  stream.on('error', () => undefined);
  return {
    stream,
    destroy: () => {
      stream.destroy();
      res.destroy();
    },
  };
};

const toResponse = (
  url: string,
  res: http.IncomingMessage,
  init: HttpRequestInit,
): HttpResponse => {
  const status = res.statusCode ?? 0;
  const source = toBodySource(res, init.method);
  let bodyUsed = false;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => {
        const value = res.headers[name.toLowerCase()];
        return value === undefined ? null : [value].flat().join(', ');
      },
    },
    body: { destroy: source.destroy },
    text: () => {
      if (bodyUsed) {
        return Promise.reject(new Error(`body used already for: ${url}`));
      }
      bodyUsed = true;
      return readText(source, url, init);
    },
  };
};

/** Sends one request without following redirects; see {@link HttpRequestInit}. */
export const nodeHttpRequest = (
  url: string,
  init: HttpRequestInit,
): Promise<HttpResponse> =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const send = target.protocol === 'https:' ? https.request : http.request;
    const req = send(
      target,
      { method: init.method, headers: buildHeaders(init), agent: init.agent },
      (res) => {
        clearTimeout(timer);
        resolve(toResponse(url, res, init));
      },
    );
    const timer =
      init.timeout > 0
        ? setTimeout(() => {
            reject(new Error(`network timeout at: ${url}`));
            req.destroy();
          }, init.timeout)
        : undefined;
    req.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`request to ${url} failed, reason: ${error.message}`));
    });
    req.end(init.body);
  });
