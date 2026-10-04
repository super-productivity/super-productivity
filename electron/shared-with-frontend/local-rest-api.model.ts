export const LOCAL_REST_API_HOST = '127.0.0.1';
export const LOCAL_REST_API_PORT = 3876;
export const LOCAL_REST_API_TIMEOUT_MS = 15000;
export const LOCAL_REST_API_MAX_BODY_BYTES = 1024 * 1024;
export const LOCAL_REST_API_MAX_CONCURRENT_REQUESTS = 50;

export type LocalRestApiListenError = 'PORT_IN_USE' | 'PERMISSION_DENIED' | 'UNKNOWN';

/** What the main process reports about the API on this device. */
export interface LocalRestApiState {
  isEnabled: boolean;
  isListening: boolean;
  error?: LocalRestApiListenError | 'TOKEN_STORAGE';
}

export interface LocalRestApiRequestPayload {
  requestId: string;
  method: string;
  path: string;
  query: Record<string, string | string[]>;
  body?: unknown;
  /**
   * Set by the main process only, for assistant (MCP) calls. HTTP clients have
   * no way to set it, so the renderer can reserve routes for it.
   */
  source?: 'mcp';
}

export interface LocalRestApiSuccessBody {
  ok: true;
  data: unknown;
}

export interface LocalRestApiErrorBody {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface LocalRestApiResponsePayload {
  requestId: string;
  status: number;
  body: LocalRestApiSuccessBody | LocalRestApiErrorBody;
}
