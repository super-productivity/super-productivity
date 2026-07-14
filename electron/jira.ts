import fetch, { RequestInit, Response } from 'node-fetch';
import { createProxyAwareAgent } from './proxy-agent';
import {
  JiraElectronRequest,
  JiraElectronResponse,
  JIRA_MAIN_REQUEST_TIMEOUT_MS,
  JIRA_MAX_RESPONSE_BYTES,
} from './shared-with-frontend/jira-request.model';

const MAX_REQUEST_ID_LENGTH = 256;
const MAX_URL_LENGTH = 16 * 1024;
const MAX_HEADER_BYTES = 64 * 1024;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_ERROR_MESSAGE_LENGTH = 2_000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

type FetchImplementation = (url: string, init: RequestInit) => Promise<Response>;
type AgentFactory = typeof createProxyAwareAgent;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getRequestId = (request: unknown): string =>
  isRecord(request) && typeof request.requestId === 'string'
    ? request.requestId.slice(0, MAX_REQUEST_ID_LENGTH)
    : '';

const validateHeaders = (headers: unknown): Record<string, string> => {
  if (!isRecord(headers)) {
    throw new Error('Invalid Jira request headers');
  }

  const entries = Object.entries(headers);
  let byteLength = 0;
  for (const [name, value] of entries) {
    if (!name || typeof value !== 'string') {
      throw new Error('Invalid Jira request headers');
    }
    byteLength += Buffer.byteLength(name) + Buffer.byteLength(value);
  }

  if (byteLength > MAX_HEADER_BYTES) {
    throw new Error('Jira request headers are too large');
  }

  return Object.fromEntries(entries) as Record<string, string>;
};

const validateJiraRequest = (request: unknown): JiraElectronRequest => {
  if (!isRecord(request)) {
    throw new Error('Invalid Jira request');
  }

  if (
    typeof request.requestId !== 'string' ||
    request.requestId.length === 0 ||
    request.requestId.length > MAX_REQUEST_ID_LENGTH
  ) {
    throw new Error('Invalid Jira request id');
  }

  if (
    typeof request.url !== 'string' ||
    request.url.length === 0 ||
    request.url.length > MAX_URL_LENGTH
  ) {
    throw new Error('Invalid Jira URL');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(request.url);
  } catch {
    throw new Error('Invalid Jira URL');
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('Jira URL must use HTTP or HTTPS');
  }

  if (!isRecord(request.requestInit)) {
    throw new Error('Invalid Jira request options');
  }
  const { method, headers, body } = request.requestInit;
  if (method !== 'GET' && method !== 'POST' && method !== 'PUT') {
    throw new Error('Invalid Jira request method');
  }
  if (body !== undefined && typeof body !== 'string') {
    throw new Error('Invalid Jira request body');
  }
  if (typeof body === 'string' && Buffer.byteLength(body) > MAX_BODY_BYTES) {
    throw new Error('Jira request body is too large');
  }
  if (
    request.allowSelfSignedCertificate !== undefined &&
    typeof request.allowSelfSignedCertificate !== 'boolean'
  ) {
    throw new Error('Invalid Jira certificate setting');
  }

  return {
    requestId: request.requestId,
    url: parsedUrl.href,
    requestInit: {
      method,
      headers: validateHeaders(headers),
      ...(typeof body === 'string' ? { body } : {}),
    },
    allowSelfSignedCertificate: request.allowSelfSignedCertificate === true,
  };
};

const errorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : 'Jira request failed';
  return message.slice(0, MAX_ERROR_MESSAGE_LENGTH) || 'Jira request failed';
};

const discardResponseBody = (response: Response): void => {
  const body = response.body as unknown;
  if (isRecord(body) && typeof body.destroy === 'function') {
    body.destroy.call(body);
  }
};

export const executeJiraRequest = async (
  rawRequest: unknown,
  fetchImplementation: FetchImplementation = fetch,
  agentFactory: AgentFactory = createProxyAwareAgent,
): Promise<JiraElectronResponse> => {
  const requestId = getRequestId(rawRequest);

  try {
    const request = validateJiraRequest(rawRequest);
    const response = await fetchWithSafeRedirects(
      request,
      fetchImplementation,
      agentFactory,
    );

    if (!response.ok) {
      discardResponseBody(response);
      return {
        requestId: request.requestId,
        error: {
          // Response bodies can contain issue data or internal server details.
          // Keep them out of the renderer and its exportable logs.
          message: `HTTP ${response.status}`,
          status: response.status,
        },
      };
    }

    const text = await response.text();
    let parsedResponse: unknown = {};
    if (text) {
      try {
        parsedResponse = JSON.parse(text) as unknown;
      } catch {
        parsedResponse = text;
      }
    }

    return {
      requestId: request.requestId,
      response: parsedResponse,
    };
  } catch (error) {
    return {
      requestId,
      error: { message: errorMessage(error) },
    };
  }
};

const isSafeRedirect = (currentUrl: URL, nextUrl: URL): boolean =>
  nextUrl.origin === currentUrl.origin ||
  (currentUrl.protocol === 'http:' &&
    nextUrl.protocol === 'https:' &&
    nextUrl.hostname === currentUrl.hostname);

const fetchWithSafeRedirects = async (
  request: JiraElectronRequest,
  fetchImplementation: FetchImplementation,
  agentFactory: AgentFactory,
): Promise<Response> => {
  let currentUrl = request.url;
  let method = request.requestInit.method;
  let body = request.requestInit.body;

  for (let redirectCount = 0; ; redirectCount += 1) {
    const agent = agentFactory(currentUrl, request.allowSelfSignedCertificate);
    const response = await fetchImplementation(currentUrl, {
      method,
      headers: request.requestInit.headers,
      ...(body !== undefined ? { body } : {}),
      ...(agent ? { agent } : {}),
      redirect: 'manual',
      timeout: JIRA_MAIN_REQUEST_TIMEOUT_MS,
      size: JIRA_MAX_RESPONSE_BYTES,
    });

    if (!REDIRECT_STATUS_CODES.has(response.status)) {
      return response;
    }

    const location = response.headers?.get('location');
    if (!location) {
      return response;
    }
    discardResponseBody(response);
    if (redirectCount >= MAX_REDIRECTS) {
      throw new Error('Too many Jira redirects');
    }

    const currentParsedUrl = new URL(currentUrl);
    const nextUrl = new URL(location, currentParsedUrl);
    if (!isSafeRedirect(currentParsedUrl, nextUrl)) {
      throw new Error('Unsafe Jira redirect blocked');
    }

    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) && method === 'POST')
    ) {
      method = 'GET';
      body = undefined;
    }
    currentUrl = nextUrl.href;
  }
};
