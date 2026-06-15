import { describe, it, expect } from 'vitest';
import { computeOpStorageBytes, APPROX_BYTES_PER_OP } from '../src/sync/sync.const';

describe('computeOpStorageBytes', () => {
  const op = {
    payload: { note: '日本語✓', items: [1, 2, 3] },
    vectorClock: { 'client-a': 3, 'client-b': 7 },
  };
  const payloadBytes = Buffer.byteLength(JSON.stringify(op.payload), 'utf8');
  const clockBytes = Buffer.byteLength(JSON.stringify(op.vectorClock), 'utf8');

  it('measures payload + vector clock in UTF-8 bytes', () => {
    const sized = computeOpStorageBytes(op);
    expect(sized.fallback).toBe(false);
    expect(sized.bytes).toBe(payloadBytes + clockBytes);
  });

  it('uses the cached payload byte size instead of re-stringifying the payload', () => {
    // A cached size that differs from the real one proves the payload is NOT
    // re-measured: the result must reflect the cached value, not JSON.stringify.
    const sized = computeOpStorageBytes(op, 12345);
    expect(sized.bytes).toBe(12345 + clockBytes);
  });

  it('matches the uncached result when the cached payload size is exact', () => {
    expect(computeOpStorageBytes(op, payloadBytes).bytes).toBe(
      computeOpStorageBytes(op).bytes,
    );
  });

  it('always re-measures the (mutable, pruned-at-storage) vector clock', () => {
    // The clock is pruned after validation, so a cached payload size must still
    // be combined with a freshly-measured clock — not a cached total.
    const prunedClockOp = { payload: op.payload, vectorClock: { 'client-a': 3 } };
    const sized = computeOpStorageBytes(prunedClockOp, payloadBytes);
    expect(sized.bytes).toBe(
      payloadBytes + Buffer.byteLength(JSON.stringify(prunedClockOp.vectorClock), 'utf8'),
    );
    expect(sized.bytes).not.toBe(computeOpStorageBytes(op, payloadBytes).bytes);
  });

  it('fails closed to APPROX_BYTES_PER_OP for an unserializable payload (no cache)', () => {
    const badOp = { payload: { big: BigInt(1) }, vectorClock: {} };
    const sized = computeOpStorageBytes(badOp);
    expect(sized).toEqual({ bytes: APPROX_BYTES_PER_OP, fallback: true });
  });

  it('fails closed when the vector clock is unserializable even with a cached payload size', () => {
    const badClockOp = { payload: op.payload, vectorClock: { big: BigInt(1) } };
    const sized = computeOpStorageBytes(badClockOp, payloadBytes);
    expect(sized).toEqual({ bytes: APPROX_BYTES_PER_OP, fallback: true });
  });
});
