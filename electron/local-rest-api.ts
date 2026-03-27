import { ipcMain } from 'electron';
import { log, warn } from 'electron-log/main';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import { IPC } from './shared-with-frontend/ipc-events.const';
import { getIsAppReady, getWin } from './main-window';
import { GlobalConfigState } from '../src/app/features/config/global-config.model';
import {
  LOCAL_REST_API_HOST,
  LOCAL_REST_API_MAX_BODY_BYTES,
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

const handleHttpRequest = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
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

  server.close((error) => {
    if (error) {
      warn('[local-rest-api] Failed to stop server', error);
      return;
    }

    isListening = false;
    log('[local-rest-api] Server stopped');
  });
};

export const updateLocalRestApiConfig = (cfg: GlobalConfigState): void => {
  const nextEnabled = !!cfg.misc.isLocalRestApiEnabled;
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
