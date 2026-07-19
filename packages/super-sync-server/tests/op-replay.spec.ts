import { CURRENT_SCHEMA_VERSION } from '@sp/shared-schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resolveExpectedFirstSeq,
  assertContiguousReplayBatch,
  assertReplayStateSize,
  EncryptedOpsNotSupportedError,
  LegacyRepairReplayUnsupportedError,
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

  it('deletes EVERY entity of a multi-entity batch DEL, not just the scalar (#8340)', () => {
    const state = replayOpsToState(
      [
        row({
          id: 'op-2',
          serverSeq: 2,
          opType: 'DEL',
          // deleteTasks stores the full set in entityIds and the scalar = entityIds[0].
          entityId: 'task-1',
          entityIds: ['task-1', 'task-2', 'task-3'],
          payload: {},
        }),
      ],
      {
        TASK: {
          'task-1': { title: 'A' },
          'task-2': { title: 'B' },
          'task-3': { title: 'C' },
          'task-4': { title: 'D' },
        },
      },
    );

    // Before the fix only task-1 (the scalar) was deleted; task-2/task-3 survived.
    expect(state).toEqual({ TASK: { 'task-4': { title: 'D' } } });
  });

  it('falls back to the scalar entityId when a DEL has an empty entityIds array', () => {
    const state = replayOpsToState(
      [
        row({
          id: 'op-2',
          serverSeq: 2,
          opType: 'DEL',
          entityId: 'task-1',
          entityIds: [],
          payload: {},
        }),
      ],
      { TASK: { 'task-1': { title: 'A' }, 'task-2': { title: 'B' } } },
    );

    expect(state).toEqual({ TASK: { 'task-2': { title: 'B' } } });
  });

  it('skips prototype-pollution keys inside a multi-entity DEL set', () => {
    const state = replayOpsToState(
      [
        row({
          id: 'op-2',
          serverSeq: 2,
          opType: 'DEL',
          entityId: 'task-1',
          entityIds: ['task-1', '__proto__', 'task-2'],
          payload: {},
        }),
      ],
      { TASK: { 'task-1': { title: 'A' }, 'task-2': { title: 'B' } } },
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

  it('rejects legacy repairs whose missing causal base makes server replay ambiguous', () => {
    expect(() =>
      replayOpsToState([
        row({
          opType: 'REPAIR',
          entityType: 'ALL',
          entityId: null,
          payload: { appDataComplete: { TASK: {} } },
          repairBaseServerSeq: null,
        }),
      ]),
    ).toThrowError(LegacyRepairReplayUnsupportedError);
  });

  it('replays a repair with an explicit causal base as a full-state operation', () => {
    const state = replayOpsToState([
      row({
        opType: 'REPAIR',
        entityType: 'ALL',
        entityId: null,
        payload: { appDataComplete: { TASK: { repaired: { done: true } } } },
        repairBaseServerSeq: 0,
      }),
    ]);

    expect(state).toEqual({ TASK: { repaired: { done: true } } });
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

  it('rejects a leading gap at a legacy repair without a causal base', () => {
    expect(() =>
      _resolveExpectedFirstSeq(
        [
          row({
            serverSeq: 10,
            opType: 'REPAIR',
            repairBaseServerSeq: null,
          }),
        ],
        0,
        0,
        10,
      ),
    ).toThrow('Expected operation serverSeq 1 but got 10');
  });
});
