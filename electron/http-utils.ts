import { IncomingMessage, ServerResponse } from 'http';

export const JSON_CONTENT_TYPE_HEADERS = {
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  'Content-Type': 'application/json; charset=utf-8',
};

// RFC 7235 requires a challenge on every 401. Shared by the REST API and MCP
// listeners, which both sit on the same loopback HTTP server.
export const UNAUTHORIZED_HEADERS = {
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  'WWW-Authenticate': 'Bearer',
};

/** Reads the full request body, capping it at `maxBytes`. */
export const readRequestBody = async (
  req: IncomingMessage,
  maxBytes: number,
): Promise<Buffer | 'TOO_LARGE'> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      return 'TOO_LARGE';
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
};

export const writeJsonResponse = (
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void => {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    ...JSON_CONTENT_TYPE_HEADERS,
    /* eslint-disable-next-line @typescript-eslint/naming-convention */
    'Content-Length': String(Buffer.byteLength(json)),
    ...extraHeaders,
  });
  res.end(json);
};

export const writeEmptyResponse = (
  res: ServerResponse,
  status: number,
  extraHeaders: Record<string, string> = {},
): void => {
  res.writeHead(status, extraHeaders);
  res.end();
};
