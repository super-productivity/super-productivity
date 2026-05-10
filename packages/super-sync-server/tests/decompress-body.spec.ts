import { describe, it, expect } from 'vitest';
import * as zlib from 'zlib';
import { promisify } from 'util';
import {
  decompressBody,
  parseCompressedJsonBody,
} from '../src/sync/compressed-body-parser';

const gzipAsync = promisify(zlib.gzip);

describe('decompressBody helper', () => {
  const testPayload = { message: 'Hello from Android', count: 42 };

  describe('standard binary gzip', () => {
    it('should decompress raw gzip buffer', async () => {
      const jsonPayload = JSON.stringify(testPayload);
      const compressed = await gzipAsync(Buffer.from(jsonPayload, 'utf-8'));

      const decompressed = await decompressBody(compressed, undefined);

      expect(JSON.parse(decompressed.toString('utf-8'))).toEqual(testPayload);
    });

    it('should decompress gzip buffer with explicit undefined transfer encoding', async () => {
      const jsonPayload = JSON.stringify(testPayload);
      const compressed = await gzipAsync(Buffer.from(jsonPayload, 'utf-8'));

      const decompressed = await decompressBody(compressed, undefined);

      expect(JSON.parse(decompressed.toString('utf-8'))).toEqual(testPayload);
    });
  });

  describe('base64-encoded gzip (Android)', () => {
    it('should decode base64 and decompress gzip', async () => {
      const jsonPayload = JSON.stringify(testPayload);
      const compressed = await gzipAsync(Buffer.from(jsonPayload, 'utf-8'));
      // Base64 encode as Android CapacitorHttp does
      const base64Payload = compressed.toString('base64');
      // Convert base64 string to buffer (as Fastify receives it)
      const rawBody = Buffer.from(base64Payload, 'utf-8');

      const decompressed = await decompressBody(rawBody, 'base64');

      expect(JSON.parse(decompressed.toString('utf-8'))).toEqual(testPayload);
    });

    it('should handle large payloads with base64 encoding', async () => {
      const largePayload = {
        tasks: Array.from({ length: 100 }, (_, i) => ({
          id: `task-${i}`,
          title: `Task number ${i} with description text`,
          done: i % 2 === 0,
        })),
      };
      const jsonPayload = JSON.stringify(largePayload);
      const compressed = await gzipAsync(Buffer.from(jsonPayload, 'utf-8'));
      const base64Payload = compressed.toString('base64');
      const rawBody = Buffer.from(base64Payload, 'utf-8');

      const decompressed = await decompressBody(rawBody, 'base64');

      expect(JSON.parse(decompressed.toString('utf-8'))).toEqual(largePayload);
    });

    it('should throw error for invalid base64 data', async () => {
      const invalidBase64 = Buffer.from('not valid base64!!!@#$%', 'utf-8');

      await expect(decompressBody(invalidBase64, 'base64')).rejects.toThrow();
    });

    it('should throw error for valid base64 but invalid gzip data', async () => {
      // Valid base64 but not gzip data
      const notGzip = Buffer.from('SGVsbG8gV29ybGQ=', 'utf-8'); // "Hello World" in base64

      await expect(decompressBody(notGzip, 'base64')).rejects.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle empty payload', async () => {
      const jsonPayload = JSON.stringify({});
      const compressed = await gzipAsync(Buffer.from(jsonPayload, 'utf-8'));

      const decompressed = await decompressBody(compressed, undefined);

      expect(JSON.parse(decompressed.toString('utf-8'))).toEqual({});
    });

    it('should handle base64 empty payload', async () => {
      const jsonPayload = JSON.stringify({});
      const compressed = await gzipAsync(Buffer.from(jsonPayload, 'utf-8'));
      const base64Payload = compressed.toString('base64');
      const rawBody = Buffer.from(base64Payload, 'utf-8');

      const decompressed = await decompressBody(rawBody, 'base64');

      expect(JSON.parse(decompressed.toString('utf-8'))).toEqual({});
    });

    it('should handle unicode content in base64 gzip', async () => {
      const unicodePayload = {
        emoji: '🚀💻🎉',
        chinese: '你好世界',
        arabic: 'مرحبا بالعالم',
      };
      const jsonPayload = JSON.stringify(unicodePayload);
      const compressed = await gzipAsync(Buffer.from(jsonPayload, 'utf-8'));
      const base64Payload = compressed.toString('base64');
      const rawBody = Buffer.from(base64Payload, 'utf-8');

      const decompressed = await decompressBody(rawBody, 'base64');

      expect(JSON.parse(decompressed.toString('utf-8'))).toEqual(unicodePayload);
    });
  });
});

describe('parseCompressedJsonBody helper', () => {
  const testPayload = { message: 'Hello from compressed JSON', count: 42 };

  it('should parse gzip-compressed JSON', async () => {
    const compressed = await gzipAsync(Buffer.from(JSON.stringify(testPayload), 'utf-8'));

    const result = await parseCompressedJsonBody(compressed, undefined, {
      maxCompressedSize: compressed.length,
      maxDecompressedSize: 1024,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toEqual(testPayload);
      expect(result.isBase64).toBe(false);
    }
  });

  it('should parse base64 gzip-compressed JSON', async () => {
    const compressed = await gzipAsync(Buffer.from(JSON.stringify(testPayload), 'utf-8'));
    const rawBody = Buffer.from(compressed.toString('base64'), 'utf-8');

    const result = await parseCompressedJsonBody(rawBody, 'base64', {
      maxCompressedSize: rawBody.length,
      maxDecompressedSize: 1024,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toEqual(testPayload);
      expect(result.isBase64).toBe(true);
    }
  });

  it('should return 400 for non-buffer gzip bodies', async () => {
    const result = await parseCompressedJsonBody('not-a-buffer', undefined, {
      maxCompressedSize: 1024,
      maxDecompressedSize: 1024,
    });

    expect(result).toEqual({
      ok: false,
      statusCode: 400,
      error: 'Expected compressed body with Content-Encoding: gzip',
      reason: 'expected-compressed-buffer',
    });
  });

  it('should return 413 when encoded payload exceeds the limit', async () => {
    const compressed = await gzipAsync(Buffer.from(JSON.stringify(testPayload), 'utf-8'));

    const result = await parseCompressedJsonBody(compressed, undefined, {
      maxCompressedSize: compressed.length - 1,
      maxDecompressedSize: 1024,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.statusCode).toBe(413);
      expect(result.error).toBe('Compressed payload too large');
      expect(result.reason).toBe('compressed-payload-too-large');
    }
  });

  it('should return 413 when decoded payload exceeds the limit', async () => {
    const compressed = await gzipAsync(Buffer.from(JSON.stringify(testPayload), 'utf-8'));

    const result = await parseCompressedJsonBody(compressed, undefined, {
      maxCompressedSize: compressed.length,
      maxDecompressedSize: 1,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.statusCode).toBe(413);
      expect(result.error).toBe('Decompressed payload too large');
      expect(result.reason).toBe('decompressed-payload-too-large');
    }
  });

  it('should return 400 for invalid gzip data', async () => {
    const result = await parseCompressedJsonBody(
      Buffer.from('not valid gzip data', 'utf-8'),
      undefined,
      {
        maxCompressedSize: 1024,
        maxDecompressedSize: 1024,
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.statusCode).toBe(400);
      expect(result.error).toBe('Failed to decompress gzip body');
      expect(result.reason).toBe('decompress-failed');
    }
  });

  it('should return 400 for invalid base64 gzip data', async () => {
    const result = await parseCompressedJsonBody(
      Buffer.from('this is not valid base64 gzip!!!@#$%', 'utf-8'),
      'base64',
      {
        maxCompressedSize: 1024,
        maxDecompressedSize: 1024,
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.statusCode).toBe(400);
      expect(result.error).toBe('Failed to decompress gzip body');
      expect(result.reason).toBe('decompress-failed');
    }
  });
});
