import { CURRENT_SCHEMA_VERSION } from '@sp/shared-schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resolveExpectedFirstSeq,
  assertContiguousReplayBatch,
  assertReplayStateSize,
  EncryptedOpsNotSupportedError,
  MAX_REPLAY_STATE_SIZE_BYTES,
  replayOpsToState,
  type ReplayOperationRow,
} from '../src/sync/op-replay';

const row = (overrides: Partial<ReplayOperationRow>): ReplayOperationRow => ({
  id: 'op-1',
  serverSeq: 1,
  opType: 'CRT',
  entityType: 'TASK',
  entityId: 'task-1',
  payload: { title: 'Initial' },
  schemaVersion: CURRENT_SCHEMA_VERSION,
  isPayloadEncrypted: false,
  ...overrides,
});

describe('op replay', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the base state for an empty op list', () => {
    const base = { TASK: { 'task-1': { title: 'Existing' } } };

    expect(replayOpsToState([], base)).toEqual(base);
  });

  it('folds CREATE and UPDATE operations into the same entity', () => {
    const state = replayOpsToState([
      row({ id: 'op-1', serverSeq: 1, opType: 'CRT', payload: { title: 'A' } }),
      row({ id: 'op-2', serverSeq: 2, opType: 'UPD', payload: { done: true } }),
    ]);

    expect(state).toEqual({
      TASK: {
        'task-1': {
          title: 'A',
          done: true,
        },
      },
    });
  });

  it('deletes entities for DEL operations', () => {
    const state = replayOpsToState(
      [row({ id: 'op-2', serverSeq: 2, opType: 'DEL', payload: {} })],
      { TASK: { 'task-1': { title: 'A' } } },
    );

    expect(state).toEqual({ TASK: {} });
  });

  it('throws when the replay state exceeds the size guard', () => {
    vi.spyOn(Buffer, 'byteLength').mockReturnValueOnce(MAX_REPLAY_STATE_SIZE_BYTES + 1);

    expect(() => assertReplayStateSize({ TASK: {} })).toThrow(
      'State too large during replay',
    );
  });

  it('rejects encrypted operations', () => {
    expect(() => replayOpsToState([row({ isPayloadEncrypted: true })])).toThrowError(
      EncryptedOpsNotSupportedError,
    );
  });

  it('rejects non-contiguous replay batches', () => {
    expect(() =>
      assertContiguousReplayBatch(
        [row({ serverSeq: 1 }), row({ id: 'op-3', serverSeq: 3 })],
        1,
        3,
      ),
    ).toThrow('Expected seq 2 but got 3');
  });

  it('allows a leading gap when the first surviving op is full-state', () => {
    expect(
      _resolveExpectedFirstSeq(
        [
          row({
            id: 'op-10',
            serverSeq: 10,
            opType: 'SYNC_IMPORT',
            entityType: 'ALL',
            entityId: null,
            payload: { appDataComplete: { TASK: {} } },
          }),
        ],
        0,
        0,
        10,
      ),
    ).toBe(10);
  });

  it('rejects a leading gap when the first surviving op is not full-state', () => {
    expect(() => _resolveExpectedFirstSeq([row({ serverSeq: 10 })], 0, 0, 10)).toThrow(
      'Expected operation serverSeq 1 but got 10',
    );
  });
});
