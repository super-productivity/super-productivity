import type { SyncLogger } from '@sp/sync-core';
import {
  compressWithGzip as compressWithGzipCore,
  compressWithGzipToString as compressWithGzipToStringCore,
  decompressGzipFromString as decompressGzipFromStringCore,
} from '@sp/sync-core';
import { CompressError, DecompressError } from '../core/errors/sync-errors';
import { OP_LOG_SYNC_LOGGER } from '../core/sync-logger.adapter';

const APP_COMPRESSION_LOG_MESSAGES = {
  compressBytesFailed: '[compression-handler] gzip compression failed',
  compressStringFailed: '[compression-handler] gzip string compression failed',
  decompressFailed: '[compression-handler] gzip decompression failed',
};

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
export async function compressWithGzip(
  input: string,
  logger: SyncLogger = OP_LOG_SYNC_LOGGER,
): Promise<Uint8Array> {
  return compressWithGzipCore(input, {
    logger,
    createCompressError: (error) => new CompressError(error),
    logMessages: APP_COMPRESSION_LOG_MESSAGES,
  });
}

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
export async function compressWithGzipToString(
  input: string,
  logger: SyncLogger = OP_LOG_SYNC_LOGGER,
): Promise<string> {
  return compressWithGzipToStringCore(input, {
    logger,
    createCompressError: (error) => new CompressError(error),
    logMessages: APP_COMPRESSION_LOG_MESSAGES,
  });
}

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
export async function decompressGzipFromString(
  compressedBase64: string,
  logger: SyncLogger = OP_LOG_SYNC_LOGGER,
): Promise<string> {
  return decompressGzipFromStringCore(compressedBase64, {
    logger,
    createDecompressError: (error) => new DecompressError(error),
    logMessages: APP_COMPRESSION_LOG_MESSAGES,
  });
}
