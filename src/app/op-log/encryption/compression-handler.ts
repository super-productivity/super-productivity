import { CompressError, DecompressError } from '../core/errors/sync-errors';
import { OpLog } from '../../core/log';

/**
 * Reads all bytes from a ReadableStream without using the Response constructor,
 * which masks stream errors with "Failed to fetch" (WHATWG Fetch #676).
 */
const readAllBytes = async (
  readable: ReadableStream<Uint8Array>,
): Promise<Uint8Array> => {
  const reader = readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
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

/**
 * Compresses a string using gzip and returns the raw bytes.
 * Use this for binary transmission (e.g., HTTP with Content-Encoding: gzip).
 */
// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
export async function compressWithGzip(input: string): Promise<Uint8Array> {
  try {
    const stream = new CompressionStream('gzip');
    const writer = stream.writable.getWriter();
    // Write and read concurrently, awaiting both, so close() cannot race
    // ahead of a pending write on slower engines (older Android WebViews).
    const writePromise = writer
      .write(new TextEncoder().encode(input))
      .then(() => writer.close());
    const readPromise = readAllBytes(stream.readable);
    const [, compressed] = await Promise.all([writePromise, readPromise]);
    return compressed;
  } catch (error) {
    OpLog.err(error);
    throw new CompressError(error);
  }
}

/**
 * Compresses a string using gzip and returns base64-encoded result.
 * Use this for JSON payloads where binary data needs string encoding.
 */
// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
export async function compressWithGzipToString(input: string): Promise<string> {
  try {
    const stream = new CompressionStream('gzip');
    const writer = stream.writable.getWriter();
    const writePromise = writer
      .write(new TextEncoder().encode(input))
      .then(() => writer.close());
    const readPromise = readAllBytes(stream.readable);
    const [, compressed] = await Promise.all([writePromise, readPromise]);

    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64DataUrl = reader.result as string;
        // Format is "data:[<mediatype>][;base64],<data>"
        const base64 = base64DataUrl.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(new Blob([compressed as unknown as BlobPart]));
    });
  } catch (error) {
    OpLog.err(error);
    throw new CompressError(error);
  }
}

/**
 * Sanitizes base64 input that may have been corrupted during network
 * transfer (e.g., WebDAV servers adding BOM, trailing whitespace,
 * or partial uploads causing truncated padding). See issue #6581.
 */
const sanitizeBase64 = (input: string): string => {
  // Strip non-base64 characters (keep only A-Z, a-z, 0-9, +, /, =)
  const cleaned = input.replace(/[^A-Za-z0-9+/=]/g, '');
  // Fix truncated padding: base64 length must be a multiple of 4
  const remainder = cleaned.length % 4;
  if (remainder === 0) {
    return cleaned;
  }
  // remainder=1 is never valid (1 char = 6 bits, need at least 8 for a byte),
  // so strip the dangling char; remainder 2 or 3: add = padding
  if (remainder === 1) {
    return cleaned.slice(0, -1);
  }
  return cleaned + '='.repeat(4 - remainder);
};

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
export async function decompressGzipFromString(
  compressedBase64: string,
): Promise<string> {
  try {
    const sanitized = sanitizeBase64(compressedBase64);
    const binary = atob(sanitized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const stream = new DecompressionStream('gzip');
    const writer = stream.writable.getWriter();

    // Write and read concurrently - writer.close() can hang if we don't consume readable
    const writePromise = writer.write(bytes).then(() => writer.close());
    const readPromise = readAllBytes(stream.readable);

    const [, decompressed] = await Promise.all([writePromise, readPromise]);
    const decoded = new TextDecoder().decode(decompressed);
    return decoded;
  } catch (error) {
    OpLog.err(error);
    if (compressedBase64) {
      OpLog.err('base64 input length:', compressedBase64.length);
    }
    throw new DecompressError(error);
  }
}
