import { describe, expect, it, vi } from 'vitest';
import {
  GzipCompressError,
  GzipDecompressError,
  compressWithGzip,
  compressWithGzipToString,
  decompressGzipFromString,
  sanitizeBase64,
} from '../src';
import { NOOP_SYNC_LOGGER } from '../src/sync-logger';

interface MutableCompressionGlobals {
  CompressionStream?: unknown;
  btoa?: unknown;
}

describe('compression helpers', () => {
  it('compresses and decompresses strings losslessly', async () => {
    const payload = JSON.stringify({
      text: 'Hello',
      numbers: [1, 2, 3],
      nested: { active: true, count: 42 },
    });

    const compressed = await compressWithGzipToString(payload);
    expect(compressed).not.toMatch(/^data:/);

    await expect(decompressGzipFromString(compressed)).resolves.toBe(payload);
  });

  it('compresses binary gzip bytes with a valid header', async () => {
    const compressed = await compressWithGzip('Hello, World!');

    expect(compressed).toBeInstanceOf(Uint8Array);
    expect(compressed[0]).toBe(0x1f);
    expect(compressed[1]).toBe(0x8b);
  });

  it('sanitizes base64 noise and repairs truncated padding', () => {
    expect(sanitizeBase64('\ufeffab+c/=\u00a0')).toBe('ab+c/===');
    expect(sanitizeBase64('abc')).toBe('abc=');
    expect(sanitizeBase64('abcde')).toBe('abcd');
  });

  it('decompresses real gzip payloads with base64 transport noise', async () => {
    const payload = JSON.stringify({ task: 'test' });
    const compressed = await compressWithGzipToString(payload);

    await expect(decompressGzipFromString(`\ufeff${compressed}`)).resolves.toBe(payload);
    await expect(decompressGzipFromString(`${compressed}\u00a0`)).resolves.toBe(payload);
    await expect(
      decompressGzipFromString(`${compressed.slice(0, 5)}\u200b${compressed.slice(5)}`),
    ).resolves.toBe(payload);
  });

  it('wraps truncated base64 decompression failures after sanitization', async () => {
    const compressed = await compressWithGzipToString(
      JSON.stringify({ task: 'test', data: 'x'.repeat(200) }),
    );
    const truncLen = compressed.length - (compressed.length % 4 || 4) + 1;
    const truncated = compressed.slice(0, truncLen);

    expect(truncated.length % 4).toBe(1);
    await expect(decompressGzipFromString(truncated)).rejects.toThrow(
      GzipDecompressError,
    );
  });

  it('logs only sanitized metadata on decompression failure', async () => {
    const invalidGzip = btoa('not gzip data');
    const logger = {
      ...NOOP_SYNC_LOGGER,
      err: vi.fn(),
    };

    await expect(decompressGzipFromString(invalidGzip, { logger })).rejects.toThrow(
      GzipDecompressError,
    );

    expect(logger.err).toHaveBeenCalledWith(
      '[sync-core compression] gzip decompression failed',
      expect.objectContaining({ name: expect.any(String) }),
      {
        inputLength: invalidGzip.length,
        sanitizedInputLength: invalidGzip.length,
      },
    );
    expect(logger.err.mock.calls[0][1]).not.toBeInstanceOf(Error);
  });

  it('wraps and logs gzip byte compression failures with safe metadata', async () => {
    class ThrowingCompressionStream {
      constructor() {
        throw new Error('compression stream failed');
      }
    }
    const compressionGlobals = globalThis as unknown as MutableCompressionGlobals;
    const originalCompressionStream = compressionGlobals.CompressionStream;
    const logger = {
      ...NOOP_SYNC_LOGGER,
      err: vi.fn(),
    };

    compressionGlobals.CompressionStream = ThrowingCompressionStream;
    try {
      await expect(compressWithGzip('private payload', { logger })).rejects.toThrow(
        GzipCompressError,
      );
    } finally {
      compressionGlobals.CompressionStream = originalCompressionStream;
    }

    expect(logger.err).toHaveBeenCalledWith(
      '[sync-core compression] gzip compression failed',
      expect.objectContaining({ name: 'Error' }),
      { inputLength: 'private payload'.length },
    );
  });

  it('wraps and logs base64 conversion failures in string compression', async () => {
    class HostCompressError extends Error {
      override name = 'HostCompressError';
    }
    const compressionGlobals = globalThis as unknown as MutableCompressionGlobals;
    const originalBtoa = compressionGlobals.btoa;
    const logger = {
      ...NOOP_SYNC_LOGGER,
      err: vi.fn(),
    };

    compressionGlobals.btoa = () => {
      throw new Error('base64 failed');
    };
    try {
      await expect(
        compressWithGzipToString('private payload', {
          logger,
          createCompressError: (error) => new HostCompressError(error.message),
        }),
      ).rejects.toThrow(HostCompressError);
    } finally {
      compressionGlobals.btoa = originalBtoa;
    }

    expect(logger.err).toHaveBeenCalledWith(
      '[sync-core compression] gzip string compression failed',
      expect.objectContaining({ name: 'Error' }),
      { inputLength: 'private payload'.length },
    );
  });

  it('preserves compression errors when the logger throws', async () => {
    class ThrowingCompressionStream {
      constructor() {
        throw new Error('compression stream failed');
      }
    }
    const compressionGlobals = globalThis as unknown as MutableCompressionGlobals;
    const originalCompressionStream = compressionGlobals.CompressionStream;
    const throwingLogger = {
      ...NOOP_SYNC_LOGGER,
      err: () => {
        throw new Error('logger failed');
      },
    };

    compressionGlobals.CompressionStream = ThrowingCompressionStream;
    try {
      await expect(
        compressWithGzip('private payload', { logger: throwingLogger }),
      ).rejects.toThrow(GzipCompressError);
    } finally {
      compressionGlobals.CompressionStream = originalCompressionStream;
    }
  });

  it('lets the host wrap compression errors', async () => {
    class HostDecompressError extends Error {
      override name = 'HostDecompressError';
    }

    await expect(
      decompressGzipFromString(btoa('not gzip data'), {
        createDecompressError: (error) => new HostDecompressError(error.message),
      }),
    ).rejects.toThrow(HostDecompressError);
  });

  it('preserves the original compression error when the logger throws', async () => {
    const throwingLogger = {
      ...NOOP_SYNC_LOGGER,
      err: () => {
        throw new Error('logger failed');
      },
    };

    await expect(
      decompressGzipFromString(btoa('not gzip data'), { logger: throwingLogger }),
    ).rejects.toThrow(GzipDecompressError);
  });
});
