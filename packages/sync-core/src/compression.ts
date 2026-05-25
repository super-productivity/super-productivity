import { extractErrorMessage } from './error.util';
import { NOOP_SYNC_LOGGER, toSyncLogError } from './sync-logger';
import type { SyncLogMeta, SyncLogger } from './sync-logger';

type CompressionFormat = 'gzip';

interface StreamReadResult {
  done: boolean;
  value?: Uint8Array;
}

interface ReadableStreamDefaultReaderLike {
  read(): Promise<StreamReadResult>;
}

interface ReadableStreamLike {
  getReader(): ReadableStreamDefaultReaderLike;
}

interface WritableStreamDefaultWriterLike {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

interface WritableStreamLike {
  getWriter(): WritableStreamDefaultWriterLike;
}

interface CompressionStreamLike {
  readonly readable: ReadableStreamLike;
  readonly writable: WritableStreamLike;
}

type CompressionStreamCtor = new (format: CompressionFormat) => CompressionStreamLike;
type TextEncoderCtor = new () => { encode(input: string): Uint8Array };
type TextDecoderCtor = new () => { decode(input: Uint8Array): string };

interface CompressionGlobals {
  CompressionStream?: CompressionStreamCtor;
  DecompressionStream?: CompressionStreamCtor;
  TextEncoder?: TextEncoderCtor;
  TextDecoder?: TextDecoderCtor;
  atob?: (input: string) => string;
  btoa?: (input: string) => string;
}

export interface GzipCompressionOptions {
  logger?: SyncLogger;
  createCompressError?: (error: Error) => Error;
  createDecompressError?: (error: Error) => Error;
  logMessages?: Partial<GzipCompressionLogMessages>;
}

export interface GzipCompressionLogMessages {
  compressBytesFailed: string;
  compressStringFailed: string;
  decompressFailed: string;
}

export class GzipCompressError extends Error {
  override name = 'GzipCompressError';

  constructor(error: Error) {
    super(error.message);
  }
}

export class GzipDecompressError extends Error {
  override name = 'GzipDecompressError';

  constructor(error: Error) {
    super(error.message);
  }
}

export class CompressionApiUnavailableError extends Error {
  override name = 'CompressionApiUnavailableError';

  constructor(apiName: string) {
    super(`${apiName} is not available in this runtime.`);
  }
}

/**
 * Sanitizes base64 input that may have been corrupted during network transfer.
 */
export const sanitizeBase64 = (input: string): string => {
  const cleaned = input.replace(/[^A-Za-z0-9+/=]/g, '');
  const remainder = cleaned.length % 4;
  if (remainder === 0) {
    return cleaned;
  }

  if (remainder === 1) {
    return cleaned.slice(0, -1);
  }
  return cleaned + '='.repeat(4 - remainder);
};

const globals = (): CompressionGlobals => globalThis as unknown as CompressionGlobals;

const getRequiredGlobal = <T>(
  name: keyof CompressionGlobals,
  value: T | undefined,
): T => {
  if (value === undefined) {
    throw new CompressionApiUnavailableError(name);
  }
  return value;
};

const getCompressionStream = (): CompressionStreamCtor =>
  getRequiredGlobal('CompressionStream', globals().CompressionStream);

const getDecompressionStream = (): CompressionStreamCtor =>
  getRequiredGlobal('DecompressionStream', globals().DecompressionStream);

const getTextEncoder = (): TextEncoderCtor =>
  getRequiredGlobal('TextEncoder', globals().TextEncoder);

const getTextDecoder = (): TextDecoderCtor =>
  getRequiredGlobal('TextDecoder', globals().TextDecoder);

const getAtob = (): ((input: string) => string) =>
  getRequiredGlobal('atob', globals().atob);

const getBtoa = (): ((input: string) => string) =>
  getRequiredGlobal('btoa', globals().btoa);

/**
 * Reads all bytes from a ReadableStream without using the Response constructor,
 * which masks stream errors with "Failed to fetch" (WHATWG Fetch #676).
 */
const readAllBytes = async (readable: ReadableStreamLike): Promise<Uint8Array> => {
  const reader = readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    chunks.push(value);
    totalLength += value.length;
  }
  if (chunks.length === 1) {
    return chunks[0];
  }
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  const btoa = getBtoa();
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = getAtob()(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const logCompressionError = (
  logger: SyncLogger,
  message: string,
  error: unknown,
  meta: SyncLogMeta,
): void => {
  try {
    logger.err(message, toSyncLogError(error), meta);
  } catch {
    // Logging is best-effort and must not mask the original compression error.
  }
};

const toSafeErrorForWrapper = (error: unknown): Error => {
  const syncLogError = toSyncLogError(error);
  const safeError = new Error(extractErrorMessage(error) ?? syncLogError.name);
  safeError.name = syncLogError.name;

  if (syncLogError.code !== undefined) {
    Object.defineProperty(safeError, 'code', {
      value: syncLogError.code,
      enumerable: false,
    });
  }

  return safeError;
};

const toCompressError = (
  error: unknown,
  createCompressError: GzipCompressionOptions['createCompressError'],
): Error => {
  const safeError = toSafeErrorForWrapper(error);
  return createCompressError?.(safeError) ?? new GzipCompressError(safeError);
};

const toDecompressError = (
  error: unknown,
  createDecompressError: GzipCompressionOptions['createDecompressError'],
): Error => {
  const safeError = toSafeErrorForWrapper(error);
  return createDecompressError?.(safeError) ?? new GzipDecompressError(safeError);
};

const getLogger = (options: GzipCompressionOptions | undefined): SyncLogger =>
  options?.logger ?? NOOP_SYNC_LOGGER;

const DEFAULT_LOG_MESSAGES: GzipCompressionLogMessages = {
  compressBytesFailed: '[sync-core compression] gzip compression failed',
  compressStringFailed: '[sync-core compression] gzip string compression failed',
  decompressFailed: '[sync-core compression] gzip decompression failed',
};

const getLogMessages = (
  options: GzipCompressionOptions | undefined,
): GzipCompressionLogMessages => ({
  ...DEFAULT_LOG_MESSAGES,
  ...options?.logMessages,
});

const compressStringToGzipBytes = async (input: string): Promise<Uint8Array> => {
  const stream = new (getCompressionStream())('gzip');
  const writer = stream.writable.getWriter();
  const writePromise = writer
    .write(new (getTextEncoder())().encode(input))
    .then(() => writer.close());
  const readPromise = readAllBytes(stream.readable);
  const [, compressed] = await Promise.all([writePromise, readPromise]);
  return compressed;
};

/**
 * Compresses a string using gzip and returns the raw bytes.
 * Use this for binary transmission, for example HTTP with Content-Encoding.
 */
export const compressWithGzip = async (
  input: string,
  options?: GzipCompressionOptions,
): Promise<Uint8Array> => {
  try {
    return await compressStringToGzipBytes(input);
  } catch (error) {
    logCompressionError(
      getLogger(options),
      getLogMessages(options).compressBytesFailed,
      error,
      {
        inputLength: input.length,
      },
    );
    throw toCompressError(error, options?.createCompressError);
  }
};

/**
 * Compresses a string using gzip and returns a base64-encoded result.
 * Use this for JSON payloads where binary data needs string encoding.
 */
export const compressWithGzipToString = async (
  input: string,
  options?: GzipCompressionOptions,
): Promise<string> => {
  try {
    const compressed = await compressStringToGzipBytes(input);
    return bytesToBase64(compressed);
  } catch (error) {
    logCompressionError(
      getLogger(options),
      getLogMessages(options).compressStringFailed,
      error,
      {
        inputLength: input.length,
      },
    );
    throw toCompressError(error, options?.createCompressError);
  }
};

export const decompressGzipFromString = async (
  compressedBase64: string,
  options?: GzipCompressionOptions,
): Promise<string> => {
  try {
    const sanitized = sanitizeBase64(compressedBase64);
    const bytes = base64ToBytes(sanitized);
    const stream = new (getDecompressionStream())('gzip');
    const writer = stream.writable.getWriter();

    const writePromise = writer.write(bytes).then(() => writer.close());
    const readPromise = readAllBytes(stream.readable);

    const [, decompressed] = await Promise.all([writePromise, readPromise]);
    return new (getTextDecoder())().decode(decompressed);
  } catch (error) {
    logCompressionError(
      getLogger(options),
      getLogMessages(options).decompressFailed,
      error,
      {
        inputLength: compressedBase64.length,
        sanitizedInputLength: sanitizeBase64(compressedBase64).length,
      },
    );
    throw toDecompressError(error, options?.createDecompressError);
  }
};
