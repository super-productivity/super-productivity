import * as zlib from 'zlib';

/**
 * Promise wrappers for zlib so callers don't block the event loop while
 * (de)compressing large snapshots (up to MAX_SNAPSHOT_DECOMPRESSED_BYTES =
 * 100MB). `util.promisify(zlib.gunzip)` does not forward an `options`
 * argument, hence the hand-rolled wrappers.
 */
export const gunzipAsync = (
  buffer: Buffer,
  options?: zlib.ZlibOptions,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const callback: zlib.CompressCallback = (err, result) => {
      if (err) reject(err);
      else resolve(result);
    };
    if (options) {
      zlib.gunzip(buffer, options, callback);
    } else {
      zlib.gunzip(buffer, callback);
    }
  });

export const gzipAsync = (buffer: Buffer, options?: zlib.ZlibOptions): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const callback: zlib.CompressCallback = (err, result) => {
      if (err) reject(err);
      else resolve(result);
    };
    if (options) {
      zlib.gzip(buffer, options, callback);
    } else {
      zlib.gzip(buffer, callback);
    }
  });

export const isDecompressedPayloadTooLargeError = (cause: unknown): boolean => {
  const code =
    cause !== null && typeof cause === 'object' && 'code' in cause
      ? String((cause as { code?: unknown }).code)
      : undefined;

  if (code === 'ERR_BUFFER_TOO_LARGE' || code === 'ERR_OUT_OF_RANGE') {
    return true;
  }

  const message = cause instanceof Error ? cause.message : '';
  return (
    message.includes('maxOutputLength') ||
    message.includes('Cannot create a Buffer larger than')
  );
};
