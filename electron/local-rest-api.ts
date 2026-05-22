import { ipcMain } from 'electron';
import { log, warn } from 'electron-log/main';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { isIP } from 'net';
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

// ---------------------------------------------------------------------------
// Pure helpers — exported for unit tests
// ---------------------------------------------------------------------------

// Returns true for any "bind to all interfaces" address (IPv4 and IPv6 any).
export const isAllInterfaces = (host: string): boolean =>
  host === '0.0.0.0' || host === '::' || host === '::0';

// Builds the Host allowlist for a specific-address bind (e.g. 127.0.0.1).
export const buildLocalhostAllowedHosts = (host: string): Set<string> =>
  new Set([
    `${host}:${LOCAL_REST_API_PORT}`,
    `localhost:${LOCAL_REST_API_PORT}`,
    host,
    'localhost',
  ]);

// Builds the Host allowlist for all-interfaces mode from the machine's current IPv4
// addresses. Called per request so new adapters (VPN, WSL vEthernet) are included
// without a server restart.
export const buildAllInterfacesAllowedHosts = (): Set<string> => {
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

export const resolveHost = (cfg: GlobalConfigState): string => {
  const envHost = process.env['SP_LOCAL_REST_API_HOST'];
  if (envHost) {
    if (isIP(envHost) === 0) {
      warn(
        `[local-rest-api] SP_LOCAL_REST_API_HOST="${envHost}" is not a valid IP address — ignoring, falling back to ${LOCAL_REST_API_HOST}`,
      );
      return LOCAL_REST_API_HOST;
    }
    return envHost;
  }
  return cfg.misc.isLocalRestApiEnabled && cfg.misc.isLocalRestApiExternalAccessEnabled
    ? '0.0.0.0'
    : LOCAL_REST_API_HOST;
};

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let server: Server | null = null;
let isInitialized = false;
let isListening = false;
let isStopping = false;

// Desired state — written by updateLocalRestApiConfig, consumed by reconcile().
let desiredEnabled = false;
let desiredHost = LOCAL_REST_API_HOST;

// Current running state — written only by startServer/stopServer callbacks.
let currentHost = LOCAL_REST_API_HOST;
// Memoised allowlist for non-all-interfaces mode; recomputed when currentHost changes.
let localhostAllowedHosts: Set<string> = buildLocalhostAllowedHosts(LOCAL_REST_API_HOST);

const pendingRequests = new Map<
  string,
  {
    resolve: (response: LocalRestApiResponsePayload) => void;
    timeout: NodeJS.Timeout;
  }
>();

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

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

export const isAllowedHost = (host: string): boolean => {
  if (isAllInterfaces(currentHost)) {
    // Rebuild from current interfaces per request — handles VPN/WSL adapters appearing after start.
    return buildAllInterfacesAllowedHosts().has(host);
  }
  return localhostAllowedHosts.has(host);
};

const isForceEnabledForDev = (): boolean =>
  process.env.NODE_ENV === 'DEV' && process.env.SP_FORCE_LOCAL_REST_API === '1';

const handleHttpRequest = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  // Block DNS rebinding: reject requests with unexpected Host headers.
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

// ---------------------------------------------------------------------------
// Server lifecycle — desired-state + reconcile model
// ---------------------------------------------------------------------------

// Brings the running server into alignment with desiredEnabled/desiredHost.
// Must be called whenever desired state changes or a stop/start completes.
const reconcile = (): void => {
  if (isStopping) {
    // stopServer's callback will call reconcile() once the stop completes.
    return;
  }

  if (desiredEnabled && !isListening) {
    currentHost = desiredHost;
    localhostAllowedHosts = buildLocalhostAllowedHosts(currentHost);
    startServer();
  } else if (!desiredEnabled && isListening) {
    stopServer();
  } else if (desiredEnabled && isListening && desiredHost !== currentHost) {
    // Host changed while running — stop first; reconcile() in the callback restarts.
    stopServer();
  }
  // Otherwise already in the correct state.
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

  if (isForceEnabledForDev()) {
    warn('[local-rest-api] Enabled by SP_FORCE_LOCAL_REST_API=1 for DEV runtime');
    desiredEnabled = true;
    reconcile();
  }
};

const startServer = (): void => {
  if (!server || isListening || isStopping) {
    return;
  }

  // One-shot error listener for this particular listen attempt.
  const onListenError = (error: Error): void => {
    isListening = false;
    warn('[local-rest-api] Failed to start server', error);
    // Single retry after 1 s — covers transient TIME_WAIT / EADDRINUSE after host change.
    setTimeout(reconcile, 1000);
  };
  server.once('error', onListenError);

  server.listen(LOCAL_REST_API_PORT, currentHost, () => {
    server?.removeListener('error', onListenError);
    isListening = true;
    if (isAllInterfaces(currentHost)) {
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

  // Cancel all in-flight renderer round-trips so their timeouts don't fire after the
  // sockets are gone.
  for (const { timeout } of pendingRequests.values()) {
    clearTimeout(timeout);
  }
  pendingRequests.clear();

  // Close keep-alive connections immediately so server.close() resolves promptly.
  server.closeAllConnections();
  server.close((error) => {
    isStopping = false;
    isListening = false;

    if (error) {
      warn('[local-rest-api] Failed to stop server', error);
    } else {
      log('[local-rest-api] Server stopped');
    }

    onStopped?.();
    reconcile();
  });
};

export const updateLocalRestApiConfig = (cfg: GlobalConfigState): void => {
  const isForcedForDev = isForceEnabledForDev();
  desiredEnabled = isForcedForDev || !!cfg.misc.isLocalRestApiEnabled;
  desiredHost = resolveHost(cfg);
  reconcile();
};
