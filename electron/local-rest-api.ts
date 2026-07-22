import { app, ipcMain } from 'electron';
import { log, warn } from 'electron-log/main';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
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
const pendingRequests = new Map<
  string,
  {
    resolve: (response: LocalRestApiResponsePayload) => void;
    timeout: NodeJS.Timeout;
  }
>();

// The access token is owned by the main process, not the synced config: it
// authenticates a loopback server that only exists on this one machine, so
// syncing it would leak an authentication secret into the op-log and to every
// other device for no benefit. It is persisted to a 0600 file under userData so
// it survives restarts, and the renderer reads/regenerates it over IPC.
const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const TOKEN_LENGTH = 32;
// Largest multiple of the alphabet size that fits in a byte. Bytes at or above
// it are discarded instead of folded in with `%`, which would make the first
// `256 % 62` characters slightly more likely than the rest.
const MAX_UNBIASED_BYTE = Math.floor(256 / TOKEN_ALPHABET.length) * TOKEN_ALPHABET.length;

let localRestApiToken: string | undefined = undefined;
let generatedForcedDevToken: string | undefined = undefined;

// Alphanumeric so it survives being copied out of the settings UI and pasted
// into a shell command without quoting.
const generateToken = (): string => {
  let token = '';
  while (token.length < TOKEN_LENGTH) {
    for (const byte of randomBytes(TOKEN_LENGTH)) {
      if (byte >= MAX_UNBIASED_BYTE) {
        continue;
      }
      token += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
      if (token.length === TOKEN_LENGTH) {
        break;
      }
    }
  }
  return token;
};

const getTokenFilePath = (): string =>
  join(app.getPath('userData'), 'local-rest-api-token');

const loadPersistedToken = (): string | undefined => {
  try {
    const filePath = getTokenFilePath();
    if (!existsSync(filePath)) {
      return undefined;
    }
    const token = readFileSync(filePath, 'utf8').trim();
    return token || undefined;
  } catch (error) {
    warn('[local-rest-api] Failed to read access token file', error);
    return undefined;
  }
};

const persistToken = (token: string): void => {
  try {
    writeFileSync(getTokenFilePath(), token, { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    warn('[local-rest-api] Failed to persist access token file', error);
  }
};

/** Returns the active token, generating and persisting one if none exists yet. */
const ensureToken = (): string => {
  if (!localRestApiToken) {
    localRestApiToken = loadPersistedToken();
  }
  if (!localRestApiToken) {
    localRestApiToken = generateToken();
    persistToken(localRestApiToken);
  }
  return localRestApiToken;
};

const regenerateToken = (): string => {
  localRestApiToken = generateToken();
  persistToken(localRestApiToken);
  return localRestApiToken;
};

const compareToken = (input: string, expected: string): boolean => {
  const inputBuffer = Buffer.from(input, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  if (inputBuffer.length !== expectedBuffer.length) {
    // Perform a dummy comparison with expectedBuffer to mitigate timing attacks on length differences
    timingSafeEqual(expectedBuffer, expectedBuffer);
    return false;
  }

  return timingSafeEqual(inputBuffer, expectedBuffer);
};

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

const ALLOWED_HOSTS = new Set([
  `${LOCAL_REST_API_HOST}:${LOCAL_REST_API_PORT}`,
  `localhost:${LOCAL_REST_API_PORT}`,
  LOCAL_REST_API_HOST,
  'localhost',
]);

const isForceEnabledForDev = (): boolean =>
  process.env.NODE_ENV === 'DEV' && process.env.SP_FORCE_LOCAL_REST_API === '1';

const getForcedDevToken = (): string => {
  if (process.env.SP_FORCE_LOCAL_REST_API_TOKEN) {
    return process.env.SP_FORCE_LOCAL_REST_API_TOKEN;
  }

  if (!generatedForcedDevToken) {
    generatedForcedDevToken = generateToken();
    // Printed to stdout, never electron-log: the app has a user-visible log
    // export and the house rule is to never write secrets into it.
    console.log(
      '[local-rest-api] Generated temporary access token for SP_FORCE_LOCAL_REST_API=1: ' +
        generatedForcedDevToken +
        '\n[local-rest-api] Set SP_FORCE_LOCAL_REST_API_TOKEN to choose it explicitly.',
    );
  }

  return generatedForcedDevToken;
};

const handleHttpRequest = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  // Reject everything while disabled. server.close() stops accepting new
  // sockets, but an in-flight keep-alive connection could still be served
  // during the close window; this makes the off switch immediate.
  if (!isEnabled) {
    writeJson(res, 503, {
      ok: false,
      error: {
        code: 'API_DISABLED',
        message: 'Local REST API is disabled',
      },
    });
    return;
  }

  // Block DNS rebinding: reject requests with unexpected Host headers
  const host = req.headers.host;
  if (!host || !ALLOWED_HOSTS.has(host)) {
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
  const origin = req.headers.origin;
  if (origin && origin !== 'null') {
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

  const requestUrl = new URL(req.url ?? '/', `http://${LOCAL_REST_API_HOST}`);
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

  // Validate authorization token. The token is sent in the "Authorization"
  // header as "Bearer <token>". RFC 7235 auth schemes are case-insensitive, so
  // "bearer <token>" is accepted too.
  const authHeader = req.headers.authorization;
  const bearerMatch = authHeader?.match(/^Bearer +(.+)$/i);
  if (!bearerMatch) {
    writeJson(res, 401, {
      ok: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authorization token required',
      },
    });
    return;
  }

  const tokenToValidate = bearerMatch[1];
  if (!localRestApiToken || !compareToken(tokenToValidate, localRestApiToken)) {
    writeJson(res, 401, {
      ok: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid authorization token',
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

  // The renderer reads and regenerates the token over IPC; it is never stored
  // in the synced config.
  ipcMain.handle(IPC.LOCAL_REST_API_GET_TOKEN, () =>
    isForceEnabledForDev() ? getForcedDevToken() : ensureToken(),
  );
  ipcMain.handle(IPC.LOCAL_REST_API_REGENERATE_TOKEN, () => regenerateToken());

  server = createServer((req, res) => {
    void handleHttpRequest(req, res);
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    isListening = false;
    if (error.code === 'EADDRINUSE') {
      warn(
        `[local-rest-api] Port ${LOCAL_REST_API_PORT} is in use — API could not start. ` +
          `Another process is holding it; free it and toggle the API off/on to retry.`,
      );
      return;
    }
    warn('[local-rest-api] Server error', error);
  });

  if (isForceEnabledForDev()) {
    warn('[local-rest-api] Enabled by SP_FORCE_LOCAL_REST_API=1 for DEV runtime');
    localRestApiToken = getForcedDevToken();
    isEnabled = true;
    startServer();
  }
};

const startServer = (): void => {
  if (!server || isListening) {
    return;
  }

  server.listen(LOCAL_REST_API_PORT, LOCAL_REST_API_HOST, () => {
    isListening = true;
    log(
      `[local-rest-api] Listening on http://${LOCAL_REST_API_HOST}:${LOCAL_REST_API_PORT}`,
    );
  });
};

const stopServer = (): void => {
  if (!server || !isListening) {
    return;
  }

  // Reset eagerly: server.close() only invokes its callback once every socket
  // has closed, so a lingering keep-alive connection would otherwise leave
  // isListening=true forever and make a later re-enable a no-op (#7484).
  isListening = false;

  server.close((error) => {
    if (error) {
      warn('[local-rest-api] Failed to stop server', error);
      return;
    }

    log('[local-rest-api] Server stopped');
  });

  // Force keep-alive sockets shut so the API stops serving immediately on
  // disable and close() can actually complete.
  server.closeAllConnections();
};

export const updateLocalRestApiConfig = (cfg: GlobalConfigState): void => {
  const isForcedForDev = isForceEnabledForDev();
  const nextEnabled = isForcedForDev || !!cfg.misc.isLocalRestApiEnabled;
  // Ensure a token exists whenever the server is (about to be) serving, so
  // enabling the API never starts an unreachable server with no credential.
  if (nextEnabled) {
    localRestApiToken = isForcedForDev ? getForcedDevToken() : ensureToken();
  }
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
