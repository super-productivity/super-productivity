import {
  FastifyReply,
  FastifyRequest,
  type RequestPayload,
  type preParsingHookHandler,
} from 'fastify';
import { Transform, type TransformCallback } from 'node:stream';
import { z } from 'zod';
import { SUPER_SYNC_MAX_OPS_PER_UPLOAD } from '@sp/shared-schema';
import { Logger } from '../logger';
import { type CompressedJsonBodyParseResult } from './compressed-body-parser';

type ZodIssue = z.ZodError['issues'][number];

/**
 * Static client-facing message for encrypted-op snapshot rejection.
 * The thrown error's `message` contains the encrypted-op count and must
 * NOT be echoed to the client (data-volume side-channel).
 */
export const ENCRYPTED_OPS_CLIENT_MESSAGE =
  'Server-side snapshot is unavailable because operations are end-to-end encrypted. ' +
  'Use the client app\'s "Sync Now" button to decrypt and restore locally.';

/**
 * Helper to create validation error response.
 * In production, hides detailed Zod error info to prevent schema leakage.
 */
export const createValidationErrorResponse = (
  zodIssues: ZodIssue[],
): { error: string; details?: ZodIssue[] } => {
  if (process.env.NODE_ENV === 'production') {
    return { error: 'Validation failed' };
  }
  return { error: 'Validation failed', details: zodIssues };
};

// Two-stage protection against zip bombs:
// 1. Pre-check: Reject compressed data > limit (typical ratio ~10:1)
// 2. Post-check: Reject decompressed data > limit (catches edge cases)
//
// Different limits for ops vs snapshots:
// - Ops uploads are incremental and smaller
// - Snapshots can be larger for backup/repair imports
export const MAX_COMPRESSED_SIZE_OPS = 10 * 1024 * 1024; // 10MB for /ops
export const MAX_COMPRESSED_SIZE_SNAPSHOT = 30 * 1024 * 1024; // 30MB for /snapshot (matches bodyLimit)
// B9: per-endpoint decompressed caps. A blanket 100MB lets a 10MB gzip body
// expand to 100MB of JSON.parse work, which stalls the event loop. Ops are
// incremental so 30MB raw is plenty (matches the largest expected SYNC_IMPORT
// op fanout); snapshots get 60MB to fit the 50MB cacheable cap plus headroom
// for the JSON-vs-compressed ratio.
export const MAX_DECOMPRESSED_SIZE_OPS = 30 * 1024 * 1024; // 30MB for /ops
export const MAX_DECOMPRESSED_SIZE_SNAPSHOT = 60 * 1024 * 1024; // 60MB for /snapshot
// Route-level guard that mirrors the shared contract but runs before Zod's
// per-op validation and before SyncService can build large prefetch queries.
export const MAX_OPS_PER_BATCH = SUPER_SYNC_MAX_OPS_PER_UPLOAD;

// Fastify's route bodyLimit runs before our parser can decode Android's
// Content-Transfer-Encoding: base64 wrapper. Use the raw base64 envelope limit
// at the HTTP layer, then enforce the true binary gzip limit in
// parseCompressedJsonBody().
export const getMaxRawBodySizeForCompressedPayload = (
  maxCompressedSize: number,
): number => Math.ceil(maxCompressedSize / 3) * 4 + 4;

export const MAX_RAW_BODY_SIZE_OPS = getMaxRawBodySizeForCompressedPayload(
  MAX_COMPRESSED_SIZE_OPS,
);
export const MAX_RAW_BODY_SIZE_SNAPSHOT = getMaxRawBodySizeForCompressedPayload(
  MAX_COMPRESSED_SIZE_SNAPSHOT,
);

type PayloadTooLargeError = Error & {
  code: string;
  statusCode: number;
};

export const createPayloadTooLargeError = (limitBytes: number): PayloadTooLargeError =>
  Object.assign(new Error(`Request body exceeded ${limitBytes} byte limit`), {
    code: 'FST_ERR_CTP_BODY_TOO_LARGE',
    statusCode: 413,
  });

export const getHeaderString = (
  value: string | string[] | number | undefined,
): string | undefined => {
  if (Array.isArray(value)) return value[0];
  if (typeof value === 'number') return String(value);
  return value;
};

export const hasHeaderToken = (
  value: string | string[] | number | undefined,
  expectedToken: string,
): boolean =>
  getHeaderString(value)
    ?.split(',')
    .some((token) => token.trim().toLowerCase() === expectedToken) ?? false;

export const getParsedContentLength = (
  value: string | string[] | number | undefined,
): number | null => {
  const contentLength = getHeaderString(value);
  if (contentLength === undefined) return null;

  const parsed = Number.parseInt(contentLength, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

class RawBodyLimitTransform extends Transform {
  receivedEncodedLength = 0;

  constructor(private readonly limitBytes: number) {
    super();
  }

  _transform(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    const chunkBytes = Buffer.isBuffer(chunk)
      ? chunk.length
      : Buffer.byteLength(chunk, encoding);
    this.receivedEncodedLength += chunkBytes;

    if (this.receivedEncodedLength > this.limitBytes) {
      callback(createPayloadTooLargeError(this.limitBytes));
      return;
    }

    callback(null, chunk);
  }
}

export const createRawBodyLimitPreParsingHook =
  (maxCompressedSize: number, maxBase64RawSize: number): preParsingHookHandler =>
  (
    request: FastifyRequest,
    _reply: FastifyReply,
    payload: RequestPayload,
    done,
  ): void => {
    const isBase64GzipRequest =
      hasHeaderToken(request.headers['content-encoding'], 'gzip') &&
      hasHeaderToken(request.headers['content-transfer-encoding'], 'base64');
    const rawBodyLimit = isBase64GzipRequest ? maxBase64RawSize : maxCompressedSize;
    const contentLength = getParsedContentLength(request.headers['content-length']);

    if (contentLength !== null && contentLength > rawBodyLimit) {
      done(createPayloadTooLargeError(rawBodyLimit));
      return;
    }

    done(null, payload.pipe(new RawBodyLimitTransform(rawBodyLimit)));
  };

// Error helper
export const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : 'Unknown error';

type CompressedJsonBodyParseFailure = Extract<
  CompressedJsonBodyParseResult,
  { ok: false }
>;

interface CompressedBodyFailureLogOptions {
  payloadLabel: 'upload' | 'snapshot';
  decompressFailureLabel: 'ops upload' | 'snapshot';
  maxCompressedSize: number;
  maxDecompressedSize: number;
}

export const sendCompressedBodyParseFailure = (
  reply: FastifyReply,
  userId: number,
  failure: CompressedJsonBodyParseFailure,
  options: CompressedBodyFailureLogOptions,
): FastifyReply => {
  if (failure.reason === 'compressed-payload-too-large') {
    Logger.warn(
      `[user:${userId}] Compressed ${options.payloadLabel} too large: ${failure.compressedSize} bytes (max ${options.maxCompressedSize})`,
    );
  } else if (failure.reason === 'decompressed-payload-too-large') {
    Logger.warn(
      `[user:${userId}] Decompressed ${options.payloadLabel} too large: ${failure.decompressedSize} bytes (max ${options.maxDecompressedSize})`,
    );
  } else if (failure.reason === 'decompress-failed') {
    Logger.warn(
      `[user:${userId}] Failed to decompress ${options.decompressFailureLabel}: ${errorMessage(failure.cause)}`,
    );
  } else if (failure.reason === 'invalid-json') {
    Logger.warn(
      `[user:${userId}] Decompressed ${options.decompressFailureLabel} is not valid JSON: ${errorMessage(failure.cause)}`,
    );
  }

  return reply.status(failure.statusCode).send({ error: failure.error });
};
