export const JIRA_MAIN_REQUEST_TIMEOUT_MS = 20_000;
export const JIRA_MAX_RESPONSE_BYTES = 25 * 1024 * 1024;

export type JiraRequestMethod = 'GET' | 'POST' | 'PUT';

export interface JiraElectronRequestInit {
  method: JiraRequestMethod;
  headers: Record<string, string>;
  body?: string;
}

export interface JiraElectronRequest {
  requestId: string;
  url: string;
  requestInit: JiraElectronRequestInit;
  allowSelfSignedCertificate: boolean;
}

export interface JiraElectronResponse {
  requestId: string;
  response?: unknown;
  error?: {
    status?: number;
    message: string;
  };
}

export interface JiraCapabilityEnvelope<TPayload> {
  capabilityToken: string;
  payload: TPayload;
}

export interface JiraImageAuthConfig {
  host: string | null;
  userName: string | null;
  password?: string | null;
  usePAT: boolean;
}

export interface JiraElectronApi {
  makeRequest(request: JiraElectronRequest): Promise<JiraElectronResponse>;
  setupImgHeaders(config: JiraImageAuthConfig): Promise<void>;
  clearImgHeaders(): Promise<void>;
}
