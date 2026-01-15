import { describe, it, expect } from 'vitest';
import * as zlib from 'zlib';
import { promisify } from 'util';

const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);

/**
 * Decompress gzip body, handling base64 encoding from Android clients.
 * This is the logic extracted from sync.routes.ts for testing.
 */
const decompressBody = async (
  rawBody: Buffer,
  contentTransferEncoding: string | undefined,
): Promise<Buffer> => {
  // Check if body is base64-encoded (from Android CapacitorHttp)
  if (contentTransferEncoding === 'base64') {
    // Body is base64 string encoded as buffer - decode it first
    const base64String = rawBody.toString('utf-8');
    const binaryData = Buffer.from(base64String, 'base64');
    return gunzipAsync(binaryData);
  }

  // Standard binary gzip body
  return gunzipAsync(rawBody);
};

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
