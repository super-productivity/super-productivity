export const LOCAL_REST_API_HOST = '127.0.0.1';
export const LOCAL_REST_API_PORT = 3876;
export const LOCAL_REST_API_TIMEOUT_MS = 15000;
export const LOCAL_REST_API_MAX_BODY_BYTES = 1024 * 1024;

export interface LocalRestApiRequestPayload {
  requestId: string;
  method: string;
  path: string;
  query: Record<string, string | string[]>;
  body?: unknown;
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
