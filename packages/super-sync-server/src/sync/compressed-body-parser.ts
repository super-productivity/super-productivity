import * as zlib from 'zlib';
import { promisify } from 'util';

const gunzipAsync = promisify(zlib.gunzip);

export type CompressedJsonBodyParseFailureReason =
  | 'expected-compressed-buffer'
  | 'compressed-payload-too-large'
  | 'decompressed-payload-too-large'
  | 'decompress-failed';

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
): Promise<Buffer> => {
  if (contentTransferEncoding === 'base64') {
    const base64String = rawBody.toString('utf-8');
    const binaryData = Buffer.from(base64String, 'base64');
    return gunzipAsync(binaryData);
  }

  return gunzipAsync(rawBody);
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

  if (rawBody.length > options.maxCompressedSize) {
    return {
      ok: false,
      statusCode: 413,
      error: 'Compressed payload too large',
      reason: 'compressed-payload-too-large',
      compressedSize: rawBody.length,
    };
  }

  try {
    const decompressed = await decompressBody(rawBody, contentTransferEncoding);

    if (decompressed.length > options.maxDecompressedSize) {
      return {
        ok: false,
        statusCode: 413,
        error: 'Decompressed payload too large',
        reason: 'decompressed-payload-too-large',
        compressedSize: rawBody.length,
        decompressedSize: decompressed.length,
      };
    }

    return {
      ok: true,
      body: JSON.parse(decompressed.toString('utf-8')),
      compressedSize: rawBody.length,
      decompressedSize: decompressed.length,
      isBase64: contentTransferEncoding === 'base64',
    };
  } catch (cause) {
    return {
      ok: false,
      statusCode: 400,
      error: 'Failed to decompress gzip body',
      reason: 'decompress-failed',
      compressedSize: rawBody.length,
      cause,
    };
  }
};
