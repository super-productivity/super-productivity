import { CompressError, DecompressError } from '../core/errors/sync-errors';
import { OpLog } from '../../core/log';

/**
 * Compresses a string using gzip and returns the raw bytes.
 * Use this for binary transmission (e.g., HTTP with Content-Encoding: gzip).
 */
// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
export async function compressWithGzip(input: string): Promise<Uint8Array> {
  try {
    const stream = new CompressionStream('gzip');
    const writer = stream.writable.getWriter();
    writer.write(new TextEncoder().encode(input));
    writer.close();
    const compressed = await new Response(stream.readable).arrayBuffer();
    return new Uint8Array(compressed);
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
    writer.write(new TextEncoder().encode(input));
    writer.close();
    const compressed = await new Response(stream.readable).arrayBuffer();

    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64DataUrl = reader.result as string;
        // Format is "data:[<mediatype>][;base64],<data>"
        const base64 = base64DataUrl.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(new Blob([compressed]));
    });
  } catch (error) {
    OpLog.err(error);
    throw new CompressError(error);
  }
}

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
export async function decompressGzipFromString(
  compressedBase64: string,
): Promise<string> {
  try {
    // Decode base64 to binary using atob (more reliable than fetch with data URIs)
    const binary = atob(compressedBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const stream = new DecompressionStream('gzip');
    const writer = stream.writable.getWriter();

    // Write and read concurrently - writer.close() can hang if we don't consume readable
    const writePromise = writer.write(bytes).then(() => writer.close());
    const readPromise = new Response(stream.readable).arrayBuffer();

    const [, decompressed] = await Promise.all([writePromise, readPromise]);
    const decoded = new TextDecoder().decode(decompressed);
    return decoded;
  } catch (error) {
    OpLog.err(error);
    throw new DecompressError(error);
  }
}
