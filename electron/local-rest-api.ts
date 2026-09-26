import { app, ipcMain } from 'electron';
import { log, warn } from 'electron-log/main';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { randomBytes, randomUUID } from 'crypto';
import { join } from 'path';
import { readSecretFile, writeSecretFile } from './secure-file';
import { timingSafeEqualLenient } from './crypto-utils';
import { readRequestBody, UNAUTHORIZED_HEADERS, writeJsonResponse } from './http-utils';
import { initAssistantAccess, isAssistantAccessEnabled } from './mcp/assistant-access';
import { handleMcpHttpRequest, McpHttpDeps } from './mcp/mcp-http';
import { RendererTimeoutError } from './mcp/mcp-tools';
import { ASSISTANT_ACCESS_PATH } from './shared-with-frontend/assistant-access.model';
import { IPC } from './shared-with-frontend/ipc-events.const';
import { getIsAppReady, getWin } from './main-window';
import { loadSimpleStoreAll, saveSimpleStore } from './simple-store';
import { SimpleStoreKey } from './shared-with-frontend/simple-store.const';
import {
  LOCAL_REST_API_HOST,
  LOCAL_REST_API_MAX_BODY_BYTES,
  LOCAL_REST_API_MAX_CONCURRENT_REQUESTS,
  LOCAL_REST_API_PORT,
  LOCAL_REST_API_TIMEOUT_MS,
  LocalRestApiListenError,
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
  LocalRestApiState,
} from './shared-with-frontend/local-rest-api.model';

let server: Server | null = null;
let isInitialized = false;
let isEnabled = false;
// What the persisted device-local setting asks for, which is not the same thing as
// what the main process managed to do about it: enabling fails closed when the
// token cannot be stored, and the saved setting stays `true` regardless. Kept
// apart so a later recovery can tell "the user wants this on" from "it is on".
let isEnabledDesired = false;
let isListening = false;
// Set once the user toggles the API in this session, so the startup read of the
// persisted setting can never overwrite a newer choice.
let hasExplicitEnabledChoice = false;
// Resolves once the persisted switch has been applied at startup.
let startupRead: Promise<void> = Promise.resolve();
// Why the last listen() failed, kept so the settings UI can say so instead of
// showing a switched-on API that nothing serves. Cleared by the next start.
let listenError: LocalRestApiListenError | undefined = undefined;
// Set when enabling failed closed because the token could not be stored.
let isTokenStorageFailed = false;
// A listen() in flight resolves these once it either binds or errors, so the
// enable IPC can answer with the outcome rather than a guess.
let listenSettledResolvers: Array<() => void> = [];
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
const TOKEN_PATTERN = new RegExp(`^[A-Za-z0-9]{${TOKEN_LENGTH}}$`);

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
const TOKEN_LABEL = 'local REST API access token';

const loadPersistedToken = (): string | undefined =>
  readSecretFile(getTokenFilePath(), TOKEN_PATTERN, TOKEN_LABEL);

/**
 * Writes the token or throws; the caller must never activate a token that did
 * not reach the disk. See writeSecretFile() for how the write is made safe.
 */
const persistToken = (token: string): void =>
  writeSecretFile(getTokenFilePath(), token, TOKEN_LABEL);

/** Returns the active token, generating and persisting one if none exists yet. */
const ensureToken = (): string => {
  if (!localRestApiToken) {
    localRestApiToken = loadPersistedToken();
  }
  if (!localRestApiToken) {
    const token = generateToken();
    persistToken(token);
    localRestApiToken = token;
  }
  return localRestApiToken;
};

const regenerateToken = (): string => {
  // Persist before swapping. Regeneration is the revocation path — the user
  // reaches for it precisely when they think the token leaked — so the new
  // token only goes live once the write has landed on disk. Swapping first would let a
  // failed write leave the *old* token on disk and bring it back to life on the
  // next launch, silently breaking the immediate-revocation guarantee.
  const token = generateToken();
  persistToken(token);
  localRestApiToken = token;
  return token;
};

const compareToken = (input: string, expected: string): boolean =>
  timingSafeEqualLenient(Buffer.from(input, 'utf8'), Buffer.from(expected, 'utf8'));

// The 401's WWW-Authenticate header (see UNAUTHORIZED_HEADERS in http-utils)
// tells the scripts written against the unauthenticated API (v18.1.0 onwards)
// what to do, since this 401 is the only thing they will see after upgrading.
const TOKEN_LOCATION_HINT = 'Find the token in Settings → Misc → Access Token.';

const respondUnauthorized = (res: ServerResponse, message: string): void => {
  writeJsonResponse(
    res,
    401,
    {
      ok: false,
      error: {
        code: 'UNAUTHORIZED',
        message,
      },
    },
    UNAUTHORIZED_HEADERS,
  );
};

const respondDisabled = (res: ServerResponse): void =>
  writeJsonResponse(res, 503, {
    ok: false,
    error: { code: 'API_DISABLED', message: 'Local REST API is disabled' },
  });

const isCurrentToken = (candidate: string): boolean =>
  !!localRestApiToken && compareToken(candidate, localRestApiToken);

const BEARER_SCHEME = 'bearer';

/**
 * Pulls the credential out of an `Authorization: Bearer <token>` header, or
 * returns undefined if the header is not a bearer credential.
 *
 * Scanned by hand rather than matched with `/^Bearer +(.+)$/i`, which CodeQL
 * flags as polynomial: the space run and the credential can both match a space,
 * so an input that fails the anchor after the spaces is retried at every split
 * of them. The reachable inputs are not that input — the retry needs a suffix
 * that fails `$`, and no character `.` rejects can reach the handler: Node
 * answers 400 for `\n` and `\r`, and it decodes header values as latin1, which
 * cannot produce a code point above U+00FF, so U+2028 and U+2029 never arrive.
 * So no live DoS is being closed here; a single left-to-right pass simply costs
 * the same on every input and removes the question. Behaviour is unchanged —
 * RFC 7235 auth schemes are case-insensitive, so "bearer <token>" is accepted
 * too, at least one space must separate scheme from credential, and the
 * credential is the rest of the header verbatim.
 */
const parseBearerToken = (authHeader: string | undefined): string | undefined => {
  if (
    !authHeader ||
    authHeader.length <= BEARER_SCHEME.length ||
    authHeader.slice(0, BEARER_SCHEME.length).toLowerCase() !== BEARER_SCHEME
  ) {
    return undefined;
  }
  let tokenStart = BEARER_SCHEME.length;
  while (tokenStart < authHeader.length && authHeader[tokenStart] === ' ') {
    tokenStart++;
  }
  // No separating space, or nothing after it.
  if (tokenStart === BEARER_SCHEME.length || tokenStart === authHeader.length) {
    return undefined;
  }
  return authHeader.slice(tokenStart);
};

const readJsonBody = async (req: IncomingMessage): Promise<unknown> => {
  const raw = await readRequestBody(req, LOCAL_REST_API_MAX_BODY_BYTES);
  if (raw === 'TOO_LARGE') {
    throw new Error('Request body too large');
  }

  if (!raw.length) {
    return undefined;
  }

  return JSON.parse(raw.toString('utf8'));
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
  timeoutMs: number = LOCAL_REST_API_TIMEOUT_MS,
): Promise<LocalRestApiResponsePayload> => {
  const mainWindow = getWin();

  return new Promise<LocalRestApiResponsePayload>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(payload.requestId);
      reject(new Error('Renderer request timed out'));
    }, timeoutMs);

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

const mcpDeps: McpHttpDeps = {
  isAllowedHost: (host) => !!host && ALLOWED_HOSTS.has(host),
  isAtConcurrencyLimit: () =>
    pendingRequests.size >= LOCAL_REST_API_MAX_CONCURRENT_REQUESTS,
  parseBearerToken: (header) => parseBearerToken(header),
  serverVersion: app.getVersion(),
  forward: async (request) => {
    if (!getIsAppReady()) {
      return {
        status: 503,
        body: { ok: false, error: { code: 'APP_NOT_READY', message: '' } },
      };
    }
    try {
      const response = await forwardRequestToRenderer(
        {
          requestId: randomUUID(),
          method: request.method,
          path: request.path,
          query: request.query ?? {},
          body: request.body,
          ...(request.source ? { source: request.source } : {}),
        },
        request.timeoutMs,
      );
      return { status: response.status, body: response.body };
    } catch (error) {
      if (error instanceof Error && error.message === 'Renderer request timed out') {
        throw new RendererTimeoutError();
      }
      throw error;
    }
  },
};

// `new URL` throws on request targets Node's parser accepts, such as `//`.
const parseRequestUrl = (req: IncomingMessage): URL | undefined => {
  try {
    return new URL(req.url ?? '/', `http://${LOCAL_REST_API_HOST}`);
  } catch {
    return undefined;
  }
};

const handleHttpRequest = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  const requestUrl = parseRequestUrl(req);
  if (!requestUrl) {
    writeJsonResponse(res, 400, {
      ok: false,
      error: { code: 'INVALID_URL', message: 'Invalid request target' },
    });
    return;
  }

  // The assistant endpoint shares this listener but not its switch, its
  // credential or its (looser) Origin rule, so it is routed before any of them.
  if (requestUrl.pathname === ASSISTANT_ACCESS_PATH) {
    await handleMcpHttpRequest(req, res, mcpDeps);
    return;
  }

  // Reject everything while disabled. server.close() stops accepting new
  // sockets, but an in-flight keep-alive connection could still be served
  // during the close window; this makes the off switch immediate.
  if (!isEnabled) {
    respondDisabled(res);
    return;
  }

  // Block DNS rebinding: reject requests with unexpected Host headers
  const host = req.headers.host;
  if (!host || !ALLOWED_HOSTS.has(host)) {
    writeJsonResponse(res, 403, {
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
    writeJsonResponse(res, 403, {
      ok: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Requests from web origins are not allowed',
      },
    });
    return;
  }

  if (pendingRequests.size >= LOCAL_REST_API_MAX_CONCURRENT_REQUESTS) {
    writeJsonResponse(res, 429, {
      ok: false,
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: `Too many concurrent requests (limit: ${LOCAL_REST_API_MAX_CONCURRENT_REQUESTS})`,
      },
    });
    return;
  }

  const method = req.method ?? 'GET';

  if (method === 'GET' && requestUrl.pathname === '/health') {
    writeJsonResponse(res, 200, {
      ok: true,
      data: {
        server: 'up',
        rendererReady: getIsAppReady(),
      },
    });
    return;
  }

  // Validate authorization token. The token is sent in the "Authorization"
  // header as "Bearer <token>".
  const tokenToValidate = parseBearerToken(req.headers.authorization);
  if (tokenToValidate === undefined) {
    respondUnauthorized(
      res,
      `Authorization token required — send "Authorization: Bearer <token>". ${TOKEN_LOCATION_HINT}`,
    );
    return;
  }

  if (!isCurrentToken(tokenToValidate)) {
    respondUnauthorized(res, `Invalid authorization token. ${TOKEN_LOCATION_HINT}`);
    return;
  }

  if (!getIsAppReady()) {
    writeJsonResponse(res, 503, {
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
    writeJsonResponse(res, 400, {
      ok: false,
      error: {
        code: 'INVALID_REQUEST_BODY',
        message: error instanceof Error ? error.message : 'Invalid request body',
      },
    });
    return;
  }

  // Check again, now that the body is in. The token was only validated against
  // the headers, and a body can take arbitrarily long to arrive — Node's
  // request timeout here is 300s, and the renderer's own 15s budget only starts
  // once the request is forwarded. Without this, whoever holds a leaked token
  // can bank mutating requests: open them, wait out the rotation, then let the
  // bodies land. "Regenerating invalidates the previous token immediately" has
  // to hold for a request that was authenticated but not yet executed.
  if (!isCurrentToken(tokenToValidate)) {
    respondUnauthorized(res, `Invalid authorization token. ${TOKEN_LOCATION_HINT}`);
    return;
  }

  // Same for the off switch: the assistant endpoint can keep this listener up
  // after REST is switched off, so a body still arriving must not run then.
  if (!isEnabled) {
    respondDisabled(res);
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
    writeJsonResponse(res, rendererResponse.status, rendererResponse.body);
  } catch (error) {
    warn('[local-rest-api] Request failed', requestUrl.pathname, error);
    const isTimeout =
      error instanceof Error && error.message === 'Renderer request timed out';
    writeJsonResponse(res, isTimeout ? 504 : 500, {
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
  // in the synced config. Both handlers throw when the token cannot be stored,
  // and only reconcile once it could — see startServerIfDesired().
  ipcMain.handle(IPC.LOCAL_REST_API_GET_TOKEN, () => {
    if (isForceEnabledForDev()) {
      return getForcedDevToken();
    }
    const token = ensureToken();
    startServerIfDesired();
    return token;
  });
  // In forced-dev mode the getter serves the forced token, so regenerating a
  // real one would activate a credential the getter never returns — and would
  // overwrite the user's actual persisted token file. Keep it a no-op.
  ipcMain.handle(IPC.LOCAL_REST_API_REGENERATE_TOKEN, () => {
    if (isForceEnabledForDev()) {
      return getForcedDevToken();
    }
    const token = regenerateToken();
    startServerIfDesired();
    return token;
  });

  ipcMain.handle(IPC.LOCAL_REST_API_GET_STATE, async () => {
    await startupRead;
    return getLocalRestApiState();
  });
  ipcMain.handle(IPC.LOCAL_REST_API_SET_ENABLED, async (_ev, enabled: unknown) => {
    if (typeof enabled !== 'boolean') {
      throw new Error('Invalid enabled value');
    }
    // Forced-dev mode ignores the setting entirely; writing it would change
    // what the next normal launch does without the user having chosen that.
    if (!isForceEnabledForDev()) {
      await startupRead;
      // Persist first: a switch that reports "off" but comes back on after a
      // restart would break the one promise the off switch makes.
      hasExplicitEnabledChoice = true;
      await saveSimpleStore(SimpleStoreKey.LOCAL_REST_API_ENABLED, enabled);
      applyLocalRestApiEnabled(enabled);
      await settleAfterApply();
    }
    return getLocalRestApiState();
  });

  server = createServer((req, res) => {
    handleHttpRequest(req, res).catch((error: unknown) => {
      // An escaped rejection would reach start-app's uncaughtException handler,
      // which exits the app. Log the code only: the message can carry request
      // content.
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      warn('[local-rest-api] Request handler failed', code ?? 'UNKNOWN');
      // A client that disconnected mid-upload has no socket left to answer on.
      if (req.destroyed || res.headersSent) {
        return;
      }
      writeJsonResponse(res, 500, {
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal error' },
      });
    });
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    isListening = false;
    listenError = toListenError(error.code);
    settleListen();
    if (error.code === 'EADDRINUSE') {
      warn(
        `[local-rest-api] Port ${LOCAL_REST_API_PORT} is in use — API could not start. ` +
          `Another process is holding it; free it and toggle the API off/on to retry.`,
      );
      return;
    }
    warn('[local-rest-api] Server error', error);
  });

  initAssistantAccess({
    onListenerNeedChanged: async () => {
      if (isListenerWanted()) {
        startServer();
      } else {
        stopServer();
      }
      await settleAfterApply();
    },
    getListenerStatus: () => ({
      isListening,
      ...(listenError ? { error: listenError } : {}),
    }),
  });

  if (isForceEnabledForDev()) {
    warn('[local-rest-api] Enabled by SP_FORCE_LOCAL_REST_API=1 for DEV runtime');
    localRestApiToken = getForcedDevToken();
    isEnabled = true;
    isEnabledDesired = true;
    startServer();
    return;
  }

  startupRead = restorePersistedEnabled();
};

/**
 * Applies the persisted switch once userData is final. initLocalRestApi() runs
 * from initIpcInterfaces(), before start-app.ts moves userData for Snap and
 * --user-data-dir; reading earlier would restore another profile's setting.
 */
const restorePersistedEnabled = async (): Promise<void> => {
  await app.whenReady();
  const enabled = await readPersistedEnabled();
  // A toggle that landed while the file was being read is newer than it.
  if (!hasExplicitEnabledChoice) {
    applyEnabled(enabled);
  }
};

const toListenError = (code: string | undefined): LocalRestApiListenError => {
  if (code === 'EADDRINUSE') {
    return 'PORT_IN_USE';
  }
  // A sandbox without the permission to accept connections (Mac App Store
  // without com.apple.security.network.server, a Snap without network-bind)
  // refuses the bind itself.
  if (code === 'EPERM' || code === 'EACCES') {
    return 'PERMISSION_DENIED';
  }
  return 'UNKNOWN';
};

const settleListen = (): void => {
  const resolvers = listenSettledResolvers;
  listenSettledResolvers = [];
  resolvers.forEach((resolve) => resolve());
};

const waitForListenSettled = (): Promise<void> =>
  new Promise((resolve) => {
    listenSettledResolvers.push(resolve);
  });

const startServer = (): void => {
  if (!server || isListening) {
    return;
  }

  listenError = undefined;
  server.listen(LOCAL_REST_API_PORT, LOCAL_REST_API_HOST, () => {
    isListening = true;
    settleListen();
    log(
      `[local-rest-api] Listening on http://${LOCAL_REST_API_HOST}:${LOCAL_REST_API_PORT}`,
    );
  });
};

/**
 * Brings the API up if the saved setting wants it and only a storage failure
 * stopped it. Both token IPCs call this because they are the point at which the
 * main process learns that storage works again — otherwise the setting reads
 * "enabled" while nothing listens, and stays that way until the next settings
 * change or restart. It cannot switch the API on by itself: `isEnabledDesired`
 * only ever comes from the saved setting.
 */
const startServerIfDesired = (): void => {
  if (!isEnabledDesired || isEnabled) {
    return;
  }
  log('[local-rest-api] Access token is available again — starting the server');
  isEnabled = true;
  isTokenStorageFailed = false;
  startServer();
};

/** The listener serves the REST API and assistant access; either keeps it up. */
const isListenerWanted = (): boolean => isEnabled || isAssistantAccessEnabled();

const stopServer = (): void => {
  if (!server || !isListening || isListenerWanted()) {
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

/**
 * Applies the enabled state in memory: mints the token if needed and starts or
 * stops the listener. Persisting the choice is the caller's job — see the
 * SET_ENABLED handler — so this stays synchronous and testable.
 *
 * The switch is deliberately owned by this device alone. It used to live in the
 * synced misc config, which meant enabling the API on one computer started a
 * listener on every other synced desktop the next time it sent its settings.
 */
export const applyLocalRestApiEnabled = (enabled: boolean): void => {
  hasExplicitEnabledChoice = true;
  applyEnabled(enabled);
};

const applyEnabled = (enabled: boolean): void => {
  const isForcedForDev = isForceEnabledForDev();
  const nextEnabled = isForcedForDev || enabled;
  isEnabledDesired = nextEnabled;
  // Ensure a token exists whenever the server is (about to be) serving, so
  // enabling the API never starts an unreachable server with no credential.
  if (nextEnabled) {
    try {
      localRestApiToken = isForcedForDev ? getForcedDevToken() : ensureToken();
      isTokenStorageFailed = false;
    } catch (error) {
      // Without a durably stored token the credential would die on the next
      // launch, so fail closed rather than start a server the user cannot keep
      // using. The renderer surfaces the failure when it reads the token.
      warn('[local-rest-api] Could not store the access token — not starting', error);
      isTokenStorageFailed = true;
      isEnabled = false;
      stopServer();
      return;
    }
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
    listenError = undefined;
    stopServer();
  }
};

export const getLocalRestApiState = (): LocalRestApiState => ({
  isEnabled: isEnabledDesired,
  isListening,
  ...(isTokenStorageFailed
    ? { error: 'TOKEN_STORAGE' as const }
    : isEnabledDesired && listenError
      ? { error: listenError }
      : {}),
});

/** Resolves once a pending listen() has bound or failed (bounded, just in case). */
const settleAfterApply = async (): Promise<void> => {
  if (!isListenerWanted() || isListening || listenError) {
    return;
  }
  await Promise.race([
    waitForListenSettled(),
    new Promise<void>((resolve) => setTimeout(resolve, 2000)),
  ]);
};

const readPersistedEnabled = async (): Promise<boolean> => {
  try {
    const all = await loadSimpleStoreAll();
    return all[SimpleStoreKey.LOCAL_REST_API_ENABLED] === true;
  } catch (error) {
    warn('[local-rest-api] Could not read the enabled setting — staying off', error);
    return false;
  }
};
