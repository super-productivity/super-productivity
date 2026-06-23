import { COMPRESS_THRESHOLD_BYTES, decodeValue, encodeValue } from './value-codec';

describe('value-codec', () => {
  const big = (): Record<string, unknown> => ({
    // Repetitive, highly-compressible synthetic state-cache-like blob, comfortably
    // over the threshold so it takes the gzip path.
    items: Array.from({ length: 2000 }, (_, i) => ({
      id: `entity-${i}`,
      title: `synthetic task title ${i}`,
      done: false,
    })),
  });

  it('leaves a small value as plain JSON (no marker, byte-identical)', () => {
    const value = { op: { id: 'a' }, source: 'local', appliedAt: 1 };
    const encoded = encodeValue(value);
    expect(encoded).toBe(JSON.stringify(value));
    expect(encoded.startsWith('~')).toBe(false);
    expect(decodeValue(encoded)).toEqual(value);
  });

  it('compresses a large value (marker present, smaller) and round-trips it', () => {
    const value = big();
    const plain = JSON.stringify(value);
    const encoded = encodeValue(value);

    expect(encoded.startsWith('~gz1:')).toBe(true);
    expect(encoded.length).toBeLessThan(plain.length); // actually shrank
    expect(decodeValue(encoded)).toEqual(value); // exact round-trip
  });

  it('decodes a plain (unmarked) value of ANY size — back-compat for pre-codec rows', () => {
    // A large value written as plain JSON before compression existed must still read.
    const value = big();
    const plain = JSON.stringify(value);
    expect(decodeValue(plain)).toEqual(value);
  });

  it('does not mistake a string value that contains the marker for compressed data', () => {
    // JSON.stringify wraps it in quotes, so it starts with `"`, not the marker.
    const value = { note: '~gz1:not-actually-compressed' };
    const encoded = encodeValue(value);
    expect(encoded.startsWith('~gz1:')).toBe(false);
    expect(decodeValue(encoded)).toEqual(value);
  });

  it('round-trips values straddling the threshold boundary', () => {
    for (const len of [COMPRESS_THRESHOLD_BYTES - 50, COMPRESS_THRESHOLD_BYTES + 50]) {
      const value = { pad: 'x'.repeat(len) };
      expect(decodeValue(encodeValue(value))).toEqual(value);
    }
  });

  it('preserves unicode through the gzip path', () => {
    const value = { text: '日本語 🚀 emoji '.repeat(400) }; // multi-byte, over threshold
    const encoded = encodeValue(value);
    expect(encoded.startsWith('~gz1:')).toBe(true);
    expect(decodeValue(encoded)).toEqual(value);
  });
});
