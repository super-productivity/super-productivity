import { describe, expect, it } from 'vitest';
import {
  isSameDuplicateOperation,
  isSameDuplicateTimestamp,
  pruneVectorClockForStorage,
  resolveConflictForExistingOp,
  stableJsonStringify,
} from '../src/sync/conflict';
import {
  DuplicateOperationCandidate,
  MAX_VECTOR_CLOCK_SIZE,
  Operation,
} from '../src/sync/sync.types';

const op = (overrides: Partial<Operation> = {}): Operation => ({
  id: 'op-1',
  clientId: 'client-a',
  actionType: 'ADD_TASK',
  opType: 'CRT',
  entityType: 'TASK',
  entityId: 'task-1',
  payload: { title: 'A' },
  vectorClock: { 'client-a': 1 },
  timestamp: 1_000,
  schemaVersion: 1,
  ...overrides,
});

const duplicateCandidate = (
  overrides: Partial<DuplicateOperationCandidate> = {},
): DuplicateOperationCandidate => ({
  id: 'op-1',
  userId: 1,
  clientId: 'client-a',
  actionType: 'ADD_TASK',
  opType: 'CRT',
  entityType: 'TASK',
  entityId: 'task-1',
  payload: { title: 'A' },
  vectorClock: { 'client-a': 1 },
  schemaVersion: 1,
  clientTimestamp: 1_000,
  receivedAt: 1_000,
  isPayloadEncrypted: false,
  syncImportReason: null,
  ...overrides,
});

describe('conflict helpers', () => {
  it('accepts matching duplicate operations regardless of JSON key order', () => {
    const incoming = op({
      payload: { title: 'A', nested: { b: 2, a: 1 } },
    });
    const existing = duplicateCandidate({
      payload: { nested: { a: 1, b: 2 }, title: 'A' },
    });

    expect(isSameDuplicateOperation(existing, 1, incoming, 60_000)).toBe(true);
  });

  it('rejects duplicate ids when operation content differs', () => {
    const incoming = op({ payload: { title: 'B' } });

    expect(isSameDuplicateOperation(duplicateCandidate(), 1, incoming, 60_000)).toBe(
      false,
    );
  });

  it('accepts encrypted retries whose ciphertext differs from the stored payload', () => {
    // Regression: when encryption is on, encrypt() generates a fresh random IV
    // per call, so a retry of the same logical op produces different ciphertext.
    // The server must still recognize it as a duplicate, otherwise the client
    // sees INVALID_OP_ID and marks the op as permanently rejected even though
    // the server already committed it (partial-success retry on flaky network).
    const incoming = op({
      payload: 'BASE64-CIPHERTEXT-WITH-FRESH-IV',
      isPayloadEncrypted: true,
    });
    const existing = duplicateCandidate({
      payload: 'BASE64-CIPHERTEXT-WITH-ORIGINAL-IV',
      isPayloadEncrypted: true,
    });

    expect(isSameDuplicateOperation(existing, 1, incoming, 60_000)).toBe(true);
  });

  it('rejects encrypted retries when structural fields differ', () => {
    // The ciphertext bypass must not let through a genuine id collision: if any
    // structural field (here vectorClock) differs, it's not a retry.
    const incoming = op({
      payload: 'BASE64-CIPHERTEXT-A',
      isPayloadEncrypted: true,
      vectorClock: { 'client-a': 2 },
    });
    const existing = duplicateCandidate({
      payload: 'BASE64-CIPHERTEXT-B',
      isPayloadEncrypted: true,
      vectorClock: { 'client-a': 1 },
    });

    expect(isSameDuplicateOperation(existing, 1, incoming, 60_000)).toBe(false);
  });

  it('rejects when only one side is encrypted', () => {
    // A sudden flip in encryption status for the same op id is suspicious and
    // should remain a hard rejection — the bypass only kicks in when both sides
    // declare the payload encrypted.
    const incoming = op({
      payload: 'BASE64-CIPHERTEXT',
      isPayloadEncrypted: true,
    });
    const existing = duplicateCandidate({
      payload: { title: 'A' },
      isPayloadEncrypted: false,
    });

    expect(isSameDuplicateOperation(existing, 1, incoming, 60_000)).toBe(false);
  });

  it('accepts retry timestamps previously clamped at the clock-drift boundary', () => {
    expect(isSameDuplicateTimestamp(160_000, 100_000, 170_000, 180_000, 60_000)).toBe(
      true,
    );
  });

  it('rejects retry timestamps outside the clock-drift boundary', () => {
    expect(isSameDuplicateTimestamp(160_001, 100_000, 170_000, 180_000, 60_000)).toBe(
      false,
    );
  });

  it('classifies concurrent vector clocks as conflicts', () => {
    const result = resolveConflictForExistingOp(
      op({ vectorClock: { 'client-a': 1 } }),
      'task-1',
      { clientId: 'client-b', vectorClock: { 'client-b': 1 } },
    );

    expect(result).toMatchObject({
      hasConflict: true,
      conflictType: 'concurrent',
      existingClock: { 'client-b': 1 },
    });
  });

  it('classifies less-than vector clocks as superseded', () => {
    const result = resolveConflictForExistingOp(
      op({ vectorClock: { 'client-a': 1 } }),
      'task-1',
      { clientId: 'client-a', vectorClock: { 'client-a': 2 } },
    );

    expect(result).toMatchObject({
      hasConflict: true,
      conflictType: 'superseded',
      existingClock: { 'client-a': 2 },
    });
  });

  it('stable-stringifies object keys recursively', () => {
    expect(stableJsonStringify({ z: 1, a: { b: 2, a: 1 } })).toBe(
      '{"a":{"a":1,"b":2},"z":1}',
    );
  });

  it('prunes and mutates vector clocks before storage', () => {
    const incoming = op({
      clientId: 'client-25',
      vectorClock: Object.fromEntries(
        Array.from({ length: 25 }, (_, index) => [`client-${index + 1}`, index + 1]),
      ),
    });
    const originalClock = incoming.vectorClock;

    pruneVectorClockForStorage(incoming);

    expect(incoming.vectorClock).not.toBe(originalClock);
    expect(Object.keys(incoming.vectorClock)).toHaveLength(MAX_VECTOR_CLOCK_SIZE);
    expect(incoming.vectorClock['client-25']).toBe(25);
  });
});
