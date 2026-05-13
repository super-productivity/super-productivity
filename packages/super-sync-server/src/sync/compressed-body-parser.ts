import { gunzipAsync, isDecompressedPayloadTooLargeError } from './gzip';

export type CompressedJsonBodyParseFailureReason =
  | 'expected-compressed-buffer'
  | 'compressed-payload-too-large'
  | 'decompressed-payload-too-large'
  | 'decompress-failed'
  | 'invalid-json'
  | 'unsupported-content-encoding';

/**
 * RFC 7230 allows `Content-Encoding` to be mixed-case (`Gzip`), padded
 * (` gzip `) or a layered list (`gzip, deflate`). Normalize for the
 * single-token gzip check, and explicitly reject layered encodings — we only
 * decompress one layer, so anything else risks silent data loss or bombs.
 */
export const normalizeContentEncoding = (
  raw: string | string[] | undefined,
): { value: string; layered: boolean } => {
  const first = Array.isArray(raw) ? raw[0] : raw;
  const value = String(first ?? '')
    .trim()
    .toLowerCase();
  return { value, layered: value.includes(',') };
};

/**
 * Returns true when the header indicates an unambiguous, single-token gzip
 * encoding. Used by route handlers to decide whether to call the gzip parser
 * instead of relying on case-sensitive `=== 'gzip'` comparisons.
 */
export const isSingleTokenGzipEncoding = (
  raw: string | string[] | undefined,
): boolean => {
  const { value, layered } = normalizeContentEncoding(raw);
  return value === 'gzip' && !layered;
};

export type CompressedJsonBodyParseResult =
  | {
      ok: true;
      body: unknown;
      compressedSize: number;
      decompressedSize: number;
      isBase64: boolean;
    }
  | {
      ok: false;
      statusCode: 400 | 413;
      error: string;
      reason: CompressedJsonBodyParseFailureReason;
      compressedSize?: number;
      decompressedSize?: number;
      cause?: unknown;
    };

export interface ParseCompressedJsonBodyOptions {
  maxCompressedSize: number;
  maxDecompressedSize: number;
}

/**
 * Decompress gzip body, handling base64 encoding from Android clients.
 * Android WebView can't send binary fetch bodies, so the client sends
 * base64-encoded gzip data with Content-Transfer-Encoding: base64 header.
 */
export const decompressBody = async (
  rawBody: Buffer,
  contentTransferEncoding: string | undefined,
  maxDecompressedSize?: number,
): Promise<Buffer> => {
  const gunzipOptions =
    maxDecompressedSize === undefined
      ? undefined
      : { maxOutputLength: maxDecompressedSize };

  if (contentTransferEncoding === 'base64') {
    const binaryData = Buffer.from(rawBody.toString('utf-8'), 'base64');
    return gunzipAsync(binaryData, gunzipOptions);
  }

  return gunzipAsync(rawBody, gunzipOptions);
};

export const parseCompressedJsonBody = async (
  rawBody: unknown,
  contentTransferEncoding: string | undefined,
  options: ParseCompressedJsonBodyOptions,
): Promise<CompressedJsonBodyParseResult> => {
  if (!Buffer.isBuffer(rawBody)) {
    return {
      ok: false,
      statusCode: 400,
      error: 'Expected compressed body with Content-Encoding: gzip',
      reason: 'expected-compressed-buffer',
    };
  }

  // For base64 transport, measure the BINARY gzip length, not the
  // base64-encoded rawBody length. Otherwise `maxCompressedSize` (documented
  // in bytes of gzip) effectively shrinks to ~75% for Android clients.
  // Decode once here and reuse the binary buffer for the gunzip call below
  // (avoids ~13 MB of redundant allocation per request at the 10 MB cap).
  const isBase64 = contentTransferEncoding === 'base64';
  const binaryBody = isBase64
    ? Buffer.from(rawBody.toString('utf-8'), 'base64')
    : rawBody;
  const compressedSize = binaryBody.length;

  if (compressedSize > options.maxCompressedSize) {
    return {
      ok: false,
      statusCode: 413,
      error: 'Compressed payload too large',
      reason: 'compressed-payload-too-large',
      compressedSize,
    };
  }

  const gunzipOptions = { maxOutputLength: options.maxDecompressedSize };
  let decompressed: Buffer;
  try {
    decompressed = await gunzipAsync(binaryBody, gunzipOptions);
  } catch (cause) {
    if (isDecompressedPayloadTooLargeError(cause)) {
      return {
        ok: false,
        statusCode: 413,
        error: 'Decompressed payload too large',
        reason: 'decompressed-payload-too-large',
        compressedSize,
        cause,
      };
    }

    return {
      ok: false,
      statusCode: 400,
      error: 'Failed to decompress gzip body',
      reason: 'decompress-failed',
      compressedSize,
      cause,
    };
  }

  if (decompressed.length > options.maxDecompressedSize) {
    return {
      ok: false,
      statusCode: 413,
      error: 'Decompressed payload too large',
      reason: 'decompressed-payload-too-large',
      compressedSize,
      decompressedSize: decompressed.length,
    };
  }

  try {
    return {
      ok: true,
      body: JSON.parse(decompressed.toString('utf-8')),
      compressedSize,
      decompressedSize: decompressed.length,
      isBase64,
    };
  } catch (cause) {
    return {
      ok: false,
      statusCode: 400,
      error: 'Invalid JSON in decompressed body',
      reason: 'invalid-json',
      compressedSize,
      decompressedSize: decompressed.length,
      cause,
    };
  }
};
