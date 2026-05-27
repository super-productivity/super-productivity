import {
  COMPRESS_THRESHOLD,
  SENTINEL,
  decodeFromPersist,
  encodeForPersist,
} from './plugin-data-codec';
import { compressWithGzipToString } from '../../op-log/encryption/compression-handler';
import { MAX_PLUGIN_DATA_SIZE } from '../plugin-persistence.model';

describe('plugin-data-codec', () => {
  it('returns short input unchanged (below threshold)', async () => {
    const input = JSON.stringify({ hello: 'world' });
    expect(input.length).toBeLessThan(COMPRESS_THRESHOLD);
    const encoded = await encodeForPersist(input);
    expect(encoded).toBe(input);
    expect(await decodeFromPersist(encoded)).toBe(input);
  });

  it('compresses and round-trips a large redundant JSON blob', async () => {
    const blob = JSON.stringify({
      docs: Object.fromEntries(
        Array.from({ length: 5 }, (_outer, i) => [
          `ctx-${i}`,
          {
            type: 'doc',
            content: Array.from({ length: 40 }, (_inner, j) => ({
              type: 'paragraph',
              content: [{ type: 'text', text: `Paragraph ${j} in context ${i}.` }],
            })),
          },
        ]),
      ),
    });
    expect(blob.length).toBeGreaterThan(COMPRESS_THRESHOLD);

    const encoded = await encodeForPersist(blob);
    expect(encoded.startsWith(SENTINEL)).toBe(true);
    expect(encoded.length).toBeLessThan(blob.length / 2);

    expect(await decodeFromPersist(encoded)).toBe(blob);
  });

  it('passes through legacy uncompressed data (no sentinel)', async () => {
    const legacy = JSON.stringify({ version: 1, payload: 'whatever' });
    expect(await decodeFromPersist(legacy)).toBe(legacy);
  });

  it('rejects a malformed sentinel-prefixed blob', async () => {
    await expectAsync(decodeFromPersist(SENTINEL + '!!!not-base64!!!')).toBeRejected();
  });

  it('aborts when the decompressed payload would exceed the size cap', async () => {
    // A highly redundant string of 4× MAX_PLUGIN_DATA_SIZE compresses to a
    // small base64 blob but decompresses past the codec's MAX_DECOMPRESSED_SIZE
    // ceiling (2× MAX_PLUGIN_DATA_SIZE). The decode must throw before the full
    // expansion is realised — a gzip-bomb defence.
    const massive = 'A'.repeat(MAX_PLUGIN_DATA_SIZE * 4);
    const compressed = await compressWithGzipToString(massive);
    expect(compressed.length).toBeLessThan(massive.length / 10);

    await expectAsync(decodeFromPersist(SENTINEL + compressed)).toBeRejectedWithError(
      /decompressed size exceeded/,
    );
  });
});
