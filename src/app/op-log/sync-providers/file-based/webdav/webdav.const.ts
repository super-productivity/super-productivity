/**
 * WebDAV HTTP status codes
 */
export const WebDavHttpStatus = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  MULTI_STATUS: 207,
  MOVED_PERMANENTLY: 301,
  NOT_MODIFIED: 304,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  PRECONDITION_FAILED: 412,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
} as const;

/**
 * WebDAV HTTP methods
 */
export const WebDavHttpMethod = {
  GET: 'GET',
  PUT: 'PUT',
  DELETE: 'DELETE',
  HEAD: 'HEAD',
  PROPFIND: 'PROPFIND',
  MKCOL: 'MKCOL',
} as const;

/**
 * WebDAV HTTP headers
 */
export const WebDavHttpHeader = {
  AUTHORIZATION: 'Authorization',
  CONTENT_TYPE: 'Content-Type',
  ETAG: 'ETag',
  IF_MATCH: 'If-Match',
  IF_NONE_MATCH: 'If-None-Match',
  IF_MODIFIED_SINCE: 'If-Modified-Since',
  IF_UNMODIFIED_SINCE: 'If-Unmodified-Since',
  LAST_MODIFIED: 'Last-Modified',
  CONTENT_LENGTH: 'Content-Length',
  DEPTH: 'Depth',
  RANGE: 'Range',
} as const;
