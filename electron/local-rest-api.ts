import { ipcMain } from 'electron';
import { log, warn } from 'electron-log/main';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { networkInterfaces } from 'os';
import { randomUUID } from 'crypto';
import { IPC } from './shared-with-frontend/ipc-events.const';
import { getIsAppReady, getWin } from './main-window';
import { GlobalConfigState } from '../src/app/features/config/global-config.model';
import {
  LOCAL_REST_API_HOST,
  LOCAL_REST_API_MAX_BODY_BYTES,
  LOCAL_REST_API_MAX_CONCURRENT_REQUESTS,
  LOCAL_REST_API_PORT,
  LOCAL_REST_API_TIMEOUT_MS,
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from './shared-with-frontend/local-rest-api.model';

const JSON_HEADERS = {
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  'Content-Type': 'application/json; charset=utf-8',
};

let server: Server | null = null;
let isInitialized = false;
let isEnabled = false;
let isListening = false;
let isStopping = false;
const pendingRequests = new Map<
  string,
  {
    resolve: (response: LocalRestApiResponsePayload) => void;
    timeout: NodeJS.Timeout;
  }
>();

const writeJson = (
  res: ServerResponse,
  status: number,
  body: LocalRestApiResponsePayload['body'],
): void => {
  const responseJson = JSON.stringify(body);
  res.writeHead(status, {
    ...JSON_HEADERS,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'Content-Length': Buffer.byteLength(responseJson),
  });
  res.end(responseJson);
};

const readJsonBody = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bufferChunk.length;
    if (totalBytes > LOCAL_REST_API_MAX_BODY_BYTES) {
      throw new Error('Request body too large');
    }
    chunks.push(bufferChunk);
  }

  if (!chunks.length) {
    return undefined;
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const getQueryObject = (url: URL): Record<string, string | string[]> => {
  const query: Record<string, string | string[]> = {};

  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    query[key] = values.length <= 1 ? (values[0] ?? '') : values;
  }

  return query;
};

const forwardRequestToRenderer = async (
  payload: LocalRestApiRequestPayload,
): Promise<LocalRestApiResponsePayload> => {
  const mainWindow = getWin();

  return new Promise<LocalRestApiResponsePayload>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(payload.requestId);
      reject(new Error('Renderer request timed out'));
    }, LOCAL_REST_API_TIMEOUT_MS);

    pendingRequests.set(payload.requestId, {
      resolve,
      timeout,
    });

    mainWindow.webContents.send(IPC.LOCAL_REST_API_REQUEST, payload);
  });
};

const handleResponse = (_event: unknown, payload: LocalRestApiResponsePayload): void => {
  const pending = pendingRequests.get(payload.requestId);
  if (!pending) {
    return;
  }

  clearTimeout(pending.timeout);
  pendingRequests.delete(payload.requestId);
  pending.resolve(payload);
};

let currentHost = LOCAL_REST_API_HOST;
// Cached allowlist built from local network interfaces when binding to 0.0.0.0.
// Null when the server is not in all-interfaces mode.
let allowedHostsCache: Set<string> | null = null;

const buildAllowedHosts = (): Set<string> => {
  const hosts = new Set<string>();
  hosts.add('localhost');
  hosts.add(`localhost:${LOCAL_REST_API_PORT}`);
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4') {
        hosts.add(iface.address);
        hosts.add(`${iface.address}:${LOCAL_REST_API_PORT}`);
      }
    }
  }
  return hosts;
};

const isAllowedHost = (host: string): boolean => {
  if (currentHost === '0.0.0.0') {
    // Use the allowlist built from local interfaces at listen time to prevent DNS rebinding
    // even in all-interfaces mode.
    return allowedHostsCache?.has(host) ?? false;
  }
  const allowedHosts = new Set([
    `${currentHost}:${LOCAL_REST_API_PORT}`,
    `localhost:${LOCAL_REST_API_PORT}`,
    currentHost,
    'localhost',
  ]);
  return allowedHosts.has(host);
};

const isForceEnabledForDev = (): boolean =>
  process.env.NODE_ENV === 'DEV' && process.env.SP_FORCE_LOCAL_REST_API === '1';

const handleHttpRequest = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  // Block DNS rebinding: reject requests with unexpected Host headers
  const host = req.headers.host;
  if (!host || !isAllowedHost(host)) {
    writeJson(res, 403, {
      ok: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Invalid Host header',
      },
    });
    return;
  }

  // Block browser-CSRF: reject any request that arrives with a web Origin.
  // The intended consumers are CLI tools and scripts (no Origin header).
  // Browsers always set Origin on cross-origin POSTs (and on simple POSTs
  // with text/plain bodies, which CORS does not preflight); rejecting here
  // closes that gap on top of the Host-header check above.
  // Origin: null (from sandboxed iframes or data: URIs) is also rejected.
  const origin = req.headers.origin;
  if (origin) {
    writeJson(res, 403, {
      ok: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Requests from web origins are not allowed',
      },
    });
    return;
  }

  if (pendingRequests.size >= LOCAL_REST_API_MAX_CONCURRENT_REQUESTS) {
    writeJson(res, 429, {
      ok: false,
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: `Too many concurrent requests (limit: ${LOCAL_REST_API_MAX_CONCURRENT_REQUESTS})`,
      },
    });
    return;
  }

  // Use localhost as the URL base — we only need pathname and query, not the authority.
  const requestUrl = new URL(req.url ?? '/', `http://localhost`);
  const method = req.method ?? 'GET';

  if (method === 'GET' && requestUrl.pathname === '/health') {
    writeJson(res, 200, {
      ok: true,
      data: {
        server: 'up',
        rendererReady: getIsAppReady(),
      },
    });
    return;
  }

  if (!getIsAppReady()) {
    writeJson(res, 503, {
      ok: false,
      error: {
        code: 'APP_NOT_READY',
        message: 'Renderer is not ready yet',
      },
    });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    writeJson(res, 400, {
      ok: false,
      error: {
        code: 'INVALID_REQUEST_BODY',
        message: error instanceof Error ? error.message : 'Invalid request body',
      },
    });
    return;
  }

  try {
    const rendererResponse = await forwardRequestToRenderer({
      requestId: randomUUID(),
      method,
      path: requestUrl.pathname,
      query: getQueryObject(requestUrl),
      body,
    });
    writeJson(res, rendererResponse.status, rendererResponse.body);
  } catch (error) {
    warn('[local-rest-api] Request failed', requestUrl.pathname, error);
    const isTimeout =
      error instanceof Error && error.message === 'Renderer request timed out';
    writeJson(res, isTimeout ? 504 : 500, {
      ok: false,
      error: {
        code: isTimeout ? 'RENDERER_TIMEOUT' : 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Unknown internal error',
      },
    });
  }
};

export const initLocalRestApi = (): void => {
  if (isInitialized) {
    return;
  }
  isInitialized = true;

  ipcMain.on(IPC.LOCAL_REST_API_RESPONSE, handleResponse);

  server = createServer((req, res) => {
    void handleHttpRequest(req, res);
  });

  server.on('error', (error) => {
    isListening = false;
    warn('[local-rest-api] Server error', error);
  });

  if (isForceEnabledForDev()) {
    warn('[local-rest-api] Enabled by SP_FORCE_LOCAL_REST_API=1 for DEV runtime');
    isEnabled = true;
    startServer();
  }
};

const startServer = (): void => {
  if (!server || isListening || isStopping) {
    return;
  }

  server.listen(LOCAL_REST_API_PORT, currentHost, () => {
    isListening = true;
    if (currentHost === '0.0.0.0') {
      allowedHostsCache = buildAllowedHosts();
      log(`[local-rest-api] Listening on all interfaces, port ${LOCAL_REST_API_PORT}`);
    } else {
      log(`[local-rest-api] Listening on http://${currentHost}:${LOCAL_REST_API_PORT}`);
    }
  });
};

const stopServer = (onStopped?: () => void): void => {
  if (!server || !isListening || isStopping) {
    onStopped?.();
    return;
  }

  isStopping = true;
  // Close existing keep-alive connections immediately so server.close() resolves promptly.
  server.closeAllConnections();
  server.close((error) => {
    isStopping = false;
    isListening = false;
    allowedHostsCache = null;

    if (error) {
      warn('[local-rest-api] Failed to stop server', error);
    } else {
      log('[local-rest-api] Server stopped');
    }

    onStopped?.();
  });
};

const resolveHost = (cfg: GlobalConfigState): string => {
  if (process.env['SP_LOCAL_REST_API_HOST']) {
    return process.env['SP_LOCAL_REST_API_HOST'];
  }
  return cfg.misc.isLocalRestApiEnabled && cfg.misc.isLocalRestApiExternalAccessEnabled
    ? '0.0.0.0'
    : LOCAL_REST_API_HOST;
};

export const updateLocalRestApiConfig = (cfg: GlobalConfigState): void => {
  const isForcedForDev = isForceEnabledForDev();
  const nextEnabled = isForcedForDev || !!cfg.misc.isLocalRestApiEnabled;
  const nextHost = resolveHost(cfg);
  const hostChanged = nextHost !== currentHost;

  if (hostChanged && isListening) {
    stopServer(() => {
      currentHost = nextHost;
      isEnabled = nextEnabled;
      if (nextEnabled) {
        startServer();
      }
    });
    return;
  }

  currentHost = nextHost;

  if (nextEnabled === isEnabled) {
    if (nextEnabled && !isListening) {
      startServer();
    } else if (!nextEnabled && isListening) {
      stopServer();
    }
    return;
  }

  isEnabled = nextEnabled;
  if (isEnabled) {
    startServer();
  } else {
    stopServer();
  }
};
