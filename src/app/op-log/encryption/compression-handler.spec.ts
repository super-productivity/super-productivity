import { OpLog } from '../../core/log';
import { DecompressError } from '../core/errors/sync-errors';
import {
  compressWithGzip,
  compressWithGzipToString,
  decompressGzipFromString,
} from './compression-handler';

describe('compression-handler', () => {
  beforeEach(() => {
    spyOn(OpLog, 'err').and.stub();
    spyOn(console, 'log').and.stub();
  });

  describe('compressWithGzipToString / decompressGzipFromString', () => {
    it('compresses and decompresses strings losslessly', async () => {
      const payload = {
        text: 'Hello 😀',
        numbers: [1, 2, 3],
        nested: { active: true, count: 42 },
      };
      const serialized = JSON.stringify(payload);

      const compressed = await compressWithGzipToString(serialized);
      expect(typeof compressed).toBe('string');
      expect(compressed.startsWith('data:')).toBeFalse();

      const decompressed = await decompressGzipFromString(compressed);

      expect(decompressed).toEqual(serialized);
      expect(JSON.parse(decompressed)).toEqual(payload);
    });

    it('throws DecompressError when base64 cannot be decoded', async () => {
      // 'invalid-base64!@#' contains characters not valid in base64
      await expectAsync(
        decompressGzipFromString('invalid-base64!@#'),
      ).toBeRejectedWithError(DecompressError);
    });

    it('throws DecompressError when data is valid base64 but not valid gzip', async () => {
      // Valid base64 but not gzip data
      const invalidGzip = btoa('not gzip data');
      await expectAsync(decompressGzipFromString(invalidGzip)).toBeRejectedWithError(
        DecompressError,
      );
    });

    // Issue #6581: decompressGzipFromString should sanitize base64 input
    // to handle data corruption from WebDAV servers, partial uploads, etc.

    it('gives DecompressError (not atob error) for truncated base64 (len%4=1)', async () => {
      const original = JSON.stringify({ task: 'test', data: 'x'.repeat(200) });
      const compressed = await compressWithGzipToString(original);
      // Remove chars to create len%4=1 — previously threw opaque atob() error
      const truncLen = compressed.length - (compressed.length % 4 || 4) + 1;
      const truncated = compressed.slice(0, truncLen);
      expect(truncated.length % 4).toBe(1);
      // Should throw DecompressError from gzip (not from atob parsing)
      await expectAsync(decompressGzipFromString(truncated)).toBeRejectedWithError(
        DecompressError,
      );
    });

    it('decompresses base64 with leading BOM from WebDAV', async () => {
      const original = JSON.stringify({ task: 'test' });
      const compressed = await compressWithGzipToString(original);
      const withBOM = '\ufeff' + compressed;
      const result = await decompressGzipFromString(withBOM);
      expect(result).toEqual(original);
    });

    it('decompresses base64 with non-breaking space appended', async () => {
      const original = JSON.stringify({ task: 'test' });
      const compressed = await compressWithGzipToString(original);
      const withNBSP = compressed + '\u00a0';
      const result = await decompressGzipFromString(withNBSP);
      expect(result).toEqual(original);
    });

    it('decompresses base64 with embedded zero-width space', async () => {
      const original = JSON.stringify({ task: 'test' });
      const compressed = await compressWithGzipToString(original);
      const withZWS = compressed.slice(0, 5) + '\u200b' + compressed.slice(5);
      const result = await decompressGzipFromString(withZWS);
      expect(result).toEqual(original);
    });

    it('still throws DecompressError for genuinely corrupt data', async () => {
      await expectAsync(
        decompressGzipFromString('!!!completely-broken-data!!!'),
      ).toBeRejectedWithError(DecompressError);
    });
  });

  describe('compressWithGzip (binary)', () => {
    it('should compress a string to gzip bytes with valid header', async () => {
      const input = 'Hello, World!';

      const result = await compressWithGzip(input);

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBeGreaterThan(0);
      // Gzip magic number: 0x1f, 0x8b
      expect(result[0]).toBe(0x1f);
      expect(result[1]).toBe(0x8b);
    });

    it('should produce smaller output for repetitive data', async () => {
      const repetitiveInput = 'AAAA'.repeat(1000); // 4000 bytes of 'A'

      const result = await compressWithGzip(repetitiveInput);

      // Compressed should be much smaller than original
      expect(result.length).toBeLessThan(repetitiveInput.length / 10);
    });

    it('should handle empty string', async () => {
      const input = '';

      const result = await compressWithGzip(input);

      expect(result).toBeInstanceOf(Uint8Array);
      // Even empty string produces gzip header
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle unicode characters', async () => {
      const input = '日本語テスト 🎉 émojis';

      const result = await compressWithGzip(input);

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result[0]).toBe(0x1f);
      expect(result[1]).toBe(0x8b);
    });

    it('should achieve good compression for JSON payloads', async () => {
      const jsonPayload = JSON.stringify({
        tasks: Array.from({ length: 100 }, (_, i) => ({
          id: `task-${i}`,
          title: `Task number ${i} with some longer description`,
          done: i % 2 === 0,
        })),
      });

      const result = await compressWithGzip(jsonPayload);

      // JSON typically compresses well - should be less than 50% of original
      expect(result.length).toBeLessThan(jsonPayload.length * 0.5);
    });

    it('should produce valid gzip that can be decompressed by DecompressionStream', async () => {
      const original = 'Test payload for round-trip verification';

      const compressed = await compressWithGzip(original);

      // Decompress using DecompressionStream (same API used by server-side Node.js zlib)
      const stream = new DecompressionStream('gzip');
      const writer = stream.writable.getWriter();
      writer.write(compressed as BufferSource);
      writer.close();
      const decompressed = await new Response(stream.readable).arrayBuffer();
      const decoded = new TextDecoder().decode(decompressed);

      expect(decoded).toBe(original);
    });
  });
});
