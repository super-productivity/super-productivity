import { JiraImageAuthConfig } from './shared-with-frontend/jira-request.model';

interface JiraImageAuthState {
  origin: string;
  basePath: string;
  authorization: string;
}

let currentAuth: JiraImageAuthState | null = null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';
const isOptionalNullableString = (value: unknown): value is string | null | undefined =>
  value === undefined || isNullableString(value);

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
    (usePAT !== undefined && typeof usePAT !== 'boolean')
  ) {
    throw new Error('Invalid Jira image authentication config');
  }

  return {
    host,
    userName,
    password,
    usePAT: usePAT === true,
  };
};

// TODO simplify and do encoding in frontend service
export const setupRequestHeadersForImages = (rawConfig: unknown): void => {
  currentAuth = null;
  const config = parseImageAuthConfig(rawConfig);
  const parsedUrl = new URL(
    /^[a-z][a-z\d+.-]*:\/\//i.test(config.host as string)
      ? (config.host as string)
      : `https://${config.host}`,
  );
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('Jira URL must use HTTP or HTTPS');
  }

  const password = config.password || '';
  const encoded = Buffer.from(`${config.userName || ''}:${password}`).toString('base64');
  const trimmedPath = parsedUrl.pathname.replace(/\/+$/, '');

  currentAuth = {
    origin: parsedUrl.origin,
    basePath: trimmedPath || '/',
    authorization: config.usePAT ? `Bearer ${password}` : `Basic ${encoded}`,
  };
};

export const applyJiraImageAuth = (
  rawUrl: string,
  requestHeaders: Record<string, string>,
  resourceType: string,
): void => {
  if (!currentAuth || resourceType !== 'image') {
    return;
  }

  let requestUrl: URL;
  try {
    requestUrl = new URL(rawUrl);
  } catch {
    return;
  }

  const isInBasePath =
    currentAuth.basePath === '/' ||
    requestUrl.pathname === currentAuth.basePath ||
    requestUrl.pathname.startsWith(`${currentAuth.basePath}/`);
  if (requestUrl.origin !== currentAuth.origin || !isInBasePath) {
    return;
  }

  for (const headerName of Object.keys(requestHeaders)) {
    if (headerName.toLowerCase() === 'authorization') {
      delete requestHeaders[headerName];
    }
  }
  requestHeaders.authorization = currentAuth.authorization;
};

export const clearRequestHeadersForImages = (): void => {
  currentAuth = null;
};
