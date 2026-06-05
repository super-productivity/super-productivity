import { ipcMain } from 'electron';
import { error, log, warn } from 'electron-log/main';
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
// Helpers — exported for unit tests
// ---------------------------------------------------------------------------

// Returns true for the IPv4 "bind to all interfaces" address.
export const isAllInterfaces = (host: string): boolean => host === '0.0.0.0';

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

// Resolves the bind host from the SP_LOCAL_REST_API_HOST env var only.
// Returns LOCAL_REST_API_HOST if the var is unset, not a valid IP, or IPv6.
export const resolveHostFromEnv = (): string => {
  const envHost = process.env['SP_LOCAL_REST_API_HOST'];
  if (!envHost) {
    return LOCAL_REST_API_HOST;
  }
  const ipVersion = isIP(envHost);
  if (ipVersion === 0) {
    warn(
      `[local-rest-api] SP_LOCAL_REST_API_HOST="${envHost}" is not a valid IP address — ignoring, falling back to ${LOCAL_REST_API_HOST}`,
    );
    return LOCAL_REST_API_HOST;
  }
  if (ipVersion === 6) {
    warn(
      `[local-rest-api] SP_LOCAL_REST_API_HOST="${envHost}" is an IPv6 address — IPv6 is not supported, falling back to ${LOCAL_REST_API_HOST}`,
    );
    return LOCAL_REST_API_HOST;
  }
  return envHost;
};

export const resolveHost = (cfg: GlobalConfigState): string => {
  if (process.env['SP_LOCAL_REST_API_HOST']) {
    return resolveHostFromEnv();
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

// TTL cache for all-interfaces allowlist — avoids a syscall on every request.
const ALL_INTERFACES_CACHE_TTL_MS = 1000;
let allInterfacesHostsCache: Set<string> | null = null;
let allInterfacesCachedAt = 0;

// Listen-failure backoff state.
const MAX_LISTEN_RETRIES = 5;
let listenRetryCount = 0;
let isStarting = false;

const pendingRequests = new Map<
  string,
  {
    resolve: (response: LocalRestApiResponsePayload) => void;
    reject: (reason: Error) => void;
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
      reject,
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
    const now = Date.now();
    if (
      !allInterfacesHostsCache ||
      now - allInterfacesCachedAt >= ALL_INTERFACES_CACHE_TTL_MS
    ) {
      allInterfacesHostsCache = buildAllInterfacesAllowedHosts();
      allInterfacesCachedAt = now;
    }
    return allInterfacesHostsCache.has(host);
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
  } catch (bodyError) {
    writeJson(res, 400, {
      ok: false,
      error: {
        code: 'INVALID_REQUEST_BODY',
        message: bodyError instanceof Error ? bodyError.message : 'Invalid request body',
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
  } catch (requestError) {
    warn('[local-rest-api] Request failed', requestUrl.pathname, requestError);
    const isTimeout =
      requestError instanceof Error &&
      requestError.message === 'Renderer request timed out';
    writeJson(res, isTimeout ? 504 : 500, {
      ok: false,
      error: {
        code: isTimeout ? 'RENDERER_TIMEOUT' : 'INTERNAL_ERROR',
        message:
          requestError instanceof Error ? requestError.message : 'Unknown internal error',
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

  if (
    desiredEnabled &&
    !isListening &&
    !isStarting &&
    listenRetryCount <= MAX_LISTEN_RETRIES
  ) {
    currentHost = desiredHost;
    localhostAllowedHosts = buildLocalhostAllowedHosts(currentHost);
    allInterfacesHostsCache = null;
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

  // Persistent safety net: catches post-listen server errors (e.g. EMFILE) that
  // would otherwise become uncaught exceptions and crash the app.
  server.on('error', (serverError: Error) => {
    if (isListening) {
      isListening = false;
      warn('[local-rest-api] Server error while listening', serverError);
      reconcile();
    }
    // Errors during listen are handled by the one-shot listener in startServer;
    // by that point isListening is already false, so this guard is a no-op.
  });

  if (isForceEnabledForDev()) {
    warn('[local-rest-api] Enabled by SP_FORCE_LOCAL_REST_API=1 for DEV runtime');
    desiredEnabled = true;
    desiredHost = resolveHostFromEnv();
    reconcile();
  }
};

const startServer = (): void => {
  if (!server || isListening || isStopping || isStarting) {
    return;
  }

  isStarting = true;

  // One-shot error listener for this particular listen attempt.
  const onListenError = (listenError: Error): void => {
    isStarting = false;
    isListening = false;
    listenRetryCount++;
    if (listenRetryCount > MAX_LISTEN_RETRIES) {
      error(
        `[local-rest-api] Giving up after ${MAX_LISTEN_RETRIES} consecutive listen failures`,
        listenError,
      );
      return;
    }
    const backoff = Math.pow(2, listenRetryCount - 1);
    const delay = Math.min(1000 * backoff, 30_000);
    warn(
      `[local-rest-api] Failed to start server (attempt ${listenRetryCount}/${MAX_LISTEN_RETRIES}), retrying in ${delay} ms`,
      listenError,
    );
    setTimeout(reconcile, delay);
  };
  server.once('error', onListenError);

  server.listen(LOCAL_REST_API_PORT, currentHost, () => {
    server?.removeListener('error', onListenError);
    isStarting = false;
    isListening = true;
    listenRetryCount = 0;
    if (isAllInterfaces(currentHost)) {
      log(`[local-rest-api] Listening on all interfaces, port ${LOCAL_REST_API_PORT}`);
    } else {
      log(`[local-rest-api] Listening on http://${currentHost}:${LOCAL_REST_API_PORT}`);
    }
    // Converge to desired state if it changed while we were starting up.
    reconcile();
  });
};

const stopServer = (): void => {
  if (!server || !isListening || isStopping) {
    return;
  }

  isStopping = true;

  // Cancel all in-flight renderer round-trips: clear their timeouts and reject
  // their promises so the handleHttpRequest coroutines don't stay suspended.
  for (const { timeout, reject: rejectPending } of pendingRequests.values()) {
    clearTimeout(timeout);
    rejectPending(new Error('Server stopped'));
  }
  pendingRequests.clear();

  // Close keep-alive connections immediately so server.close() resolves promptly.
  server.closeAllConnections();
  server.close((stopError) => {
    isStopping = false;
    isListening = false;

    if (stopError) {
      warn('[local-rest-api] Failed to stop server', stopError);
    } else {
      log('[local-rest-api] Server stopped');
    }

    reconcile();
  });
};

export const updateLocalRestApiConfig = (cfg: GlobalConfigState): void => {
  const isForcedForDev = isForceEnabledForDev();
  desiredEnabled = isForcedForDev || !!cfg.misc.isLocalRestApiEnabled;
  desiredHost = resolveHost(cfg);
  listenRetryCount = 0;
  reconcile();
};
