import { session } from 'electron';
import fetch, { RequestInit, Response } from 'node-fetch';
import { createProxyAwareAgent } from './proxy-agent';
import {
  JiraElectronRequest,
  JiraElectronResponse,
  JiraImageAuthConfig,
  JIRA_MAIN_REQUEST_TIMEOUT_MS,
  JIRA_MAX_RESPONSE_BYTES,
} from './shared-with-frontend/jira-request.model';

const MAX_REQUEST_ID_LENGTH = 256;
const MAX_URL_LENGTH = 16 * 1024;
const MAX_HEADER_BYTES = 64 * 1024;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_ERROR_MESSAGE_LENGTH = 2_000;

type FetchImplementation = (url: string, init: RequestInit) => Promise<Response>;
type AgentFactory = typeof createProxyAwareAgent;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';
const isOptionalNullableString = (value: unknown): value is string | null | undefined =>
  value === undefined || isNullableString(value);

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
  if (typeof request.allowSelfSignedCertificate !== 'boolean') {
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
    allowSelfSignedCertificate: request.allowSelfSignedCertificate,
  };
};

const errorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : 'Jira request failed';
  return message.slice(0, MAX_ERROR_MESSAGE_LENGTH) || 'Jira request failed';
};

export const executeJiraRequest = async (
  rawRequest: unknown,
  fetchImplementation: FetchImplementation = fetch,
  agentFactory: AgentFactory = createProxyAwareAgent,
): Promise<JiraElectronResponse> => {
  const requestId = getRequestId(rawRequest);

  try {
    const request = validateJiraRequest(rawRequest);
    const agent = agentFactory(request.url, request.allowSelfSignedCertificate);
    const response = await fetchImplementation(request.url, {
      method: request.requestInit.method,
      headers: request.requestInit.headers,
      ...(request.requestInit.body !== undefined
        ? { body: request.requestInit.body }
        : {}),
      ...(agent ? { agent } : {}),
      // A redirect must not silently turn a reviewed Jira request into a request
      // to a different destination. Jira itself may still be hosted anywhere.
      redirect: 'error',
      timeout: JIRA_MAIN_REQUEST_TIMEOUT_MS,
      size: JIRA_MAX_RESPONSE_BYTES,
    });
    const text = await response.text();

    if (!response.ok) {
      return {
        requestId: request.requestId,
        error: {
          message: (text || response.statusText || `HTTP ${response.status}`).slice(
            0,
            MAX_ERROR_MESSAGE_LENGTH,
          ),
          status: response.status,
        },
      };
    }

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

const parseImageAuthConfig = (config: unknown): JiraImageAuthConfig => {
  if (!isRecord(config)) {
    throw new Error('Invalid Jira image authentication config');
  }
  const { host, userName, password, usePAT } = config;

  if (
    typeof host !== 'string' ||
    host.trim().length === 0 ||
    !isNullableString(userName) ||
    !isOptionalNullableString(password) ||
    typeof usePAT !== 'boolean'
  ) {
    throw new Error('Invalid Jira image authentication config');
  }

  return {
    host,
    userName,
    password,
    usePAT,
  };
};

// TODO simplify and do encoding in frontend service
export const setupRequestHeadersForImages = (rawConfig: unknown): void => {
  const config = parseImageAuthConfig(rawConfig);
  const host = config.host as string;
  const parsedUrl = new URL(
    /^[a-z][a-z\d+.-]*:\/\//i.test(host) ? host : `https://${host}`,
  );
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('Jira URL must use HTTP or HTTPS');
  }

  const password = config.password || '';
  const encoded = Buffer.from(`${config.userName || ''}:${password}`).toString('base64');
  const filter = {
    urls: [`${parsedUrl.protocol}//${parsedUrl.host}/*`],
  };

  // Only the last attached listener is used. The filter is limited to the
  // configured Jira origin so credentials cannot be added to other requests.
  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    details.requestHeaders.authorization = config.usePAT
      ? `Bearer ${password}`
      : `Basic ${encoded}`;
    callback({ requestHeaders: details.requestHeaders });
  });
};
