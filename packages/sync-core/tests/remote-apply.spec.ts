import { describe, expect, it, vi } from 'vitest';
import { applyRemoteOperations } from '../src/remote-apply';
import type { RemoteOperationApplyStorePort } from '../src/remote-apply';
import type {
  Operation,
  OperationApplyPort,
  ReducerCommitAwareOperationApplyPort,
} from '../src';

const createOperation = (id: string, opType = 'UPD'): Operation<string> => ({
  id,
  actionType: '[Test] Action',
  opType,
  entityType: 'TASK',
  entityId: id,
  payload: {},
  clientId: 'client-1',
  vectorClock: { client1: 1 },
  timestamp: 1,
  schemaVersion: 1,
});

const createStore = (appendResult: {
  seqs: number[];
  writtenOps: Operation<string>[];
  skippedCount: number;
}): RemoteOperationApplyStorePort<Operation<string>> => ({
  appendBatchSkipDuplicates: vi.fn().mockResolvedValue(appendResult),
  mergeRemoteOpClocks: vi.fn().mockResolvedValue(undefined),
  markReducersCommittedAndMergeClocks: vi.fn().mockResolvedValue(undefined),
  markApplied: vi.fn().mockResolvedValue(undefined),
  markFailed: vi.fn().mockResolvedValue(undefined),
  clearFullStateOpsExcept: vi.fn().mockResolvedValue(0),
});

const createApplier = (
  result: Awaited<ReturnType<OperationApplyPort<Operation<string>>['applyOperations']>>,
): ReducerCommitAwareOperationApplyPort<Operation<string>> => ({
  applyOperations: vi.fn(async (ops, options) => {
    await options?.onReducersCommitted?.(ops);
    return result;
  }),
});

describe('applyRemoteOperations', () => {
  it('appends remote ops as pending and applies only written ops', async () => {
    const op1 = createOperation('op-1');
    const op2 = createOperation('op-2');
    const store = createStore({ seqs: [10], writtenOps: [op2], skippedCount: 1 });
    const applier = createApplier({ appliedOps: [op2] });

    const result = await applyRemoteOperations({
      ops: [op1, op2],
      store,
      applier,
    });

    expect(store.appendBatchSkipDuplicates).toHaveBeenCalledWith([op1, op2], 'remote', {
      pendingApply: true,
    });
    expect(applier.applyOperations).toHaveBeenCalledWith(
      [op2],
      jasmineLikeObjectContainingFunction(),
    );
    expect(store.mergeRemoteOpClocks).toHaveBeenCalledWith([op2]);
    expect(store.markReducersCommittedAndMergeClocks).toHaveBeenCalledWith([10], [op2]);
    expect(store.markApplied).toHaveBeenCalledWith([10]);
    expect(result).toEqual({
      appendedOps: [op2],
      skippedCount: 1,
      appliedOps: [op2],
      appliedSeqs: [10],
      clearedFullStateOpCount: 0,
      failedOpIds: [],
    });
  });

  it('does not apply when every incoming op is skipped as a duplicate', async () => {
    const op = createOperation('op-1');
    const store = createStore({ seqs: [], writtenOps: [], skippedCount: 1 });
    const applier = createApplier({ appliedOps: [] });

    const result = await applyRemoteOperations({ ops: [op], store, applier });

    expect(applier.applyOperations).not.toHaveBeenCalled();
    expect(store.markApplied).not.toHaveBeenCalled();
    expect(store.mergeRemoteOpClocks).not.toHaveBeenCalled();
    expect(store.markReducersCommittedAndMergeClocks).not.toHaveBeenCalled();
    expect(result).toEqual({
      appendedOps: [],
      skippedCount: 1,
      appliedOps: [],
      appliedSeqs: [],
      clearedFullStateOpCount: 0,
      failedOpIds: [],
    });
  });

  it('clears older full-state ops after successfully applying a full-state op', async () => {
    const fullStateOp = createOperation('sync-import-1', 'SYNC_IMPORT');
    const store = createStore({
      seqs: [1],
      writtenOps: [fullStateOp],
      skippedCount: 0,
    });
    vi.mocked(store.clearFullStateOpsExcept).mockResolvedValue(3);
    const applier = createApplier({ appliedOps: [fullStateOp] });

    const result = await applyRemoteOperations({
      ops: [fullStateOp],
      store,
      applier,
      isFullStateOperation: (op) => op.opType === 'SYNC_IMPORT',
    });

    expect(store.clearFullStateOpsExcept).toHaveBeenCalledWith(['sync-import-1']);
    expect(result.clearedFullStateOpCount).toBe(3);
  });

  it('cleanup preserves a batch full-state op whose archive handling failed (quarantined)', async () => {
    // Both imports reducer-committed; the LATER one failed only its archive
    // side effects. Cleanup keyed on the applied one must not delete the
    // quarantined entry, or markFailed misses it and the change is lost
    // from the next startup replay.
    const appliedImport = createOperation('sync-import-1', 'SYNC_IMPORT');
    const failedImport = createOperation('sync-import-2', 'SYNC_IMPORT');
    const error = new Error('archive failure');
    const store = createStore({
      seqs: [1, 2],
      writtenOps: [appliedImport, failedImport],
      skippedCount: 0,
    });
    const applier = createApplier({
      appliedOps: [appliedImport],
      failedOp: { op: failedImport, error },
    });

    await applyRemoteOperations({
      ops: [appliedImport, failedImport],
      store,
      applier,
      isFullStateOperation: (op) => op.opType === 'SYNC_IMPORT',
    });

    expect(store.clearFullStateOpsExcept).toHaveBeenCalledWith([
      'sync-import-1',
      'sync-import-2',
    ]);
    expect(store.markFailed).toHaveBeenCalledWith(['sync-import-2']);
  });

  it('checkpoints the whole reducer batch but charges only the attempted archive failure', async () => {
    const op1 = createOperation('op-1');
    const op2 = createOperation('op-2');
    const op3 = createOperation('op-3');
    const error = new Error('archive failure');
    const store = createStore({
      seqs: [1, 2, 3],
      writtenOps: [op1, op2, op3],
      skippedCount: 0,
    });
    const applier = createApplier({
      appliedOps: [op1],
      failedOp: { op: op2, error },
    });

    const result = await applyRemoteOperations({
      ops: [op1, op2, op3],
      store,
      applier,
    });

    expect(store.markApplied).toHaveBeenCalledWith([1]);
    expect(store.markReducersCommittedAndMergeClocks).toHaveBeenCalledWith(
      [1, 2, 3],
      [op1, op2, op3],
    );
    expect(store.markFailed).toHaveBeenCalledWith(['op-2']);
    expect(result.failedOp).toEqual({ op: op2, error });
    expect(result.failedOpIds).toEqual(['op-2']);
  });

  it('rejects reducer-failed ops while checkpointing and applying successful successors', async () => {
    const op1 = createOperation('op-1');
    const op2 = createOperation('op-2');
    const op3 = createOperation('op-3');
    const reducerError = new Error('reducer failure');
    const store = createStore({
      seqs: [1, 2, 3],
      writtenOps: [op1, op2, op3],
      skippedCount: 0,
    });
    const applier: ReducerCommitAwareOperationApplyPort<Operation<string>> = {
      applyOperations: vi.fn(async (_ops, options) => {
        await options.onReducersCommitted([op1, op3], [{ op: op2, error: reducerError }]);
        return {
          appliedOps: [op1, op3],
          reducerFailures: [{ op: op2, error: reducerError }],
        };
      }),
    };

    const result = await applyRemoteOperations({
      ops: [op1, op2, op3],
      store,
      applier,
    });

    expect(store.markReducersCommittedAndMergeClocks).toHaveBeenCalledWith(
      [1, 3],
      [op1, op3],
      ['op-2'],
    );
    expect(store.markApplied).toHaveBeenCalledWith([1, 3]);
    expect(store.markFailed).not.toHaveBeenCalled();
    expect(result.appliedOps).toEqual([op1, op3]);
    expect(result.reducerFailedOpIds).toEqual(['op-2']);
    expect(result.reducerFailures).toEqual([{ op: op2, error: reducerError }]);
  });

  it('fails closed before checkpointing when a full-state reducer fails', async () => {
    const fullStateOp = {
      ...createOperation('sync-import'),
      opType: 'SYNC_IMPORT',
    };
    const reducerError = new Error('full-state reducer failure');
    const store = createStore({
      seqs: [1],
      writtenOps: [fullStateOp],
      skippedCount: 0,
    });
    const applier: ReducerCommitAwareOperationApplyPort<Operation<string>> = {
      applyOperations: vi.fn(async (_ops, options) => {
        await options.onReducersCommitted([], [{ op: fullStateOp, error: reducerError }]);
        return {
          appliedOps: [],
          reducerFailures: [{ op: fullStateOp, error: reducerError }],
        };
      }),
    };

    await expect(
      applyRemoteOperations({
        ops: [fullStateOp],
        store,
        applier,
        isFullStateOperation: (op) => op.opType === 'SYNC_IMPORT',
      }),
    ).rejects.toThrow(/full-state.*reducer/i);

    expect(store.markReducersCommittedAndMergeClocks).not.toHaveBeenCalled();
    expect(store.markApplied).not.toHaveBeenCalled();
  });

  it('rejects an applier result whose failed op is not in the appended batch', async () => {
    const op1 = createOperation('op-1');
    const unknownFailedOp = createOperation('unknown-failed-op');
    const store = createStore({ seqs: [1], writtenOps: [op1], skippedCount: 0 });
    const applier = createApplier({
      appliedOps: [],
      failedOp: { op: unknownFailedOp, error: new Error('unexpected') },
    });

    await expect(applyRemoteOperations({ ops: [op1], store, applier })).rejects.toThrow(
      'unknown-failed-op',
    );
    expect(store.markFailed).not.toHaveBeenCalled();
  });

  it('fails closed when the applier ignores the reducer-commit callback', async () => {
    const op = createOperation('op-1');
    const store = createStore({ seqs: [1], writtenOps: [op], skippedCount: 0 });
    const applier: OperationApplyPort<Operation<string>> = {
      applyOperations: vi.fn().mockResolvedValue({ appliedOps: [op] }),
    };

    await expect(applyRemoteOperations({ ops: [op], store, applier })).rejects.toThrow(
      'reducer-commit callback',
    );
    expect(store.markApplied).not.toHaveBeenCalled();
  });

  it('fails closed when the reducer-commit callback omits an appended op', async () => {
    const op1 = createOperation('op-1');
    const op2 = createOperation('op-2');
    const store = createStore({
      seqs: [1, 2],
      writtenOps: [op1, op2],
      skippedCount: 0,
    });
    const applier: OperationApplyPort<Operation<string>> = {
      applyOperations: vi.fn(async (_ops, options) => {
        await options?.onReducersCommitted?.([op1]);
        return { appliedOps: [op1, op2] };
      }),
    };

    await expect(
      applyRemoteOperations({ ops: [op1, op2], store, applier }),
    ).rejects.toThrow('entire appended batch');
    expect(store.markApplied).not.toHaveBeenCalled();
  });

  it('fails closed when the reducer-commit callback is invoked twice', async () => {
    const op = createOperation('op-1');
    const store = createStore({ seqs: [1], writtenOps: [op], skippedCount: 0 });
    const applier: OperationApplyPort<Operation<string>> = {
      applyOperations: vi.fn(async (ops, options) => {
        await options?.onReducersCommitted?.(ops);
        await options?.onReducersCommitted?.(ops);
        return { appliedOps: ops };
      }),
    };

    await expect(applyRemoteOperations({ ops: [op], store, applier })).rejects.toThrow(
      'exactly once',
    );
    expect(store.markApplied).not.toHaveBeenCalled();
  });

  it('uses authoritative written operations for clocks, cleanup, and results', async () => {
    const writtenImport = createOperation('sync-import-1', 'SYNC_IMPORT');
    writtenImport.vectorClock = { authoritative: 7 };
    const callbackClone = {
      ...writtenImport,
      vectorClock: { forgedCallback: 99 },
    };
    const appliedClone = {
      ...writtenImport,
      opType: 'UPD',
      vectorClock: { forgedResult: 100 },
    };
    const store = createStore({
      seqs: [11],
      writtenOps: [writtenImport],
      skippedCount: 0,
    });
    const applier: OperationApplyPort<Operation<string>> = {
      applyOperations: vi.fn(async (_ops, options) => {
        await options?.onReducersCommitted?.([callbackClone]);
        return { appliedOps: [appliedClone] };
      }),
    };

    const result = await applyRemoteOperations({
      ops: [writtenImport],
      store,
      applier,
      isFullStateOperation: (op) => op.opType === 'SYNC_IMPORT',
    });

    expect(store.markReducersCommittedAndMergeClocks).toHaveBeenCalledWith(
      [11],
      [writtenImport],
    );
    expect(store.clearFullStateOpsExcept).toHaveBeenCalledWith(['sync-import-1']);
    expect(result.appendedOps[0]).toBe(writtenImport);
    expect(result.appliedOps[0]).toBe(writtenImport);
  });

  it('rejects applied operations that are not the exact ordered written prefix', async () => {
    const op1 = createOperation('op-1');
    const op2 = createOperation('op-2');
    const store = createStore({
      seqs: [1, 2],
      writtenOps: [op1, op2],
      skippedCount: 0,
    });
    const applier = createApplier({ appliedOps: [op2, op1] });

    await expect(
      applyRemoteOperations({ ops: [op1, op2], store, applier }),
    ).rejects.toThrow('exact ordered prefix');
    expect(store.markApplied).not.toHaveBeenCalled();
  });

  it('rejects a partial applied prefix without the next failed operation', async () => {
    const op1 = createOperation('op-1');
    const op2 = createOperation('op-2');
    const store = createStore({
      seqs: [1, 2],
      writtenOps: [op1, op2],
      skippedCount: 0,
    });
    const applier = createApplier({ appliedOps: [op1] });

    await expect(
      applyRemoteOperations({ ops: [op1, op2], store, applier }),
    ).rejects.toThrow('failed operation immediately after the applied prefix');
    expect(store.markApplied).not.toHaveBeenCalled();
  });

  it('rejects a failed operation that is not immediately after the applied prefix', async () => {
    const op1 = createOperation('op-1');
    const op2 = createOperation('op-2');
    const op3 = createOperation('op-3');
    const store = createStore({
      seqs: [1, 2, 3],
      writtenOps: [op1, op2, op3],
      skippedCount: 0,
    });
    const applier = createApplier({
      appliedOps: [op1],
      failedOp: { op: op3, error: new Error('wrong failure') },
    });

    await expect(
      applyRemoteOperations({ ops: [op1, op2, op3], store, applier }),
    ).rejects.toThrow('failed operation immediately after the applied prefix');
    expect(store.markFailed).not.toHaveBeenCalled();
  });

  it('throws synchronously from a malformed reducer-commit callback', async () => {
    const op1 = createOperation('op-1');
    const op2 = createOperation('op-2');
    const store = createStore({
      seqs: [1, 2],
      writtenOps: [op1, op2],
      skippedCount: 0,
    });
    let callbackThrewSynchronously = false;
    const applier: OperationApplyPort<Operation<string>> = {
      applyOperations: vi.fn(async (_ops, options) => {
        try {
          void options?.onReducersCommitted?.([op2, op1]);
        } catch (error) {
          callbackThrewSynchronously = true;
          throw error;
        }
        return { appliedOps: [op1, op2] };
      }),
    };

    await expect(
      applyRemoteOperations({ ops: [op1, op2], store, applier }),
    ).rejects.toThrow('entire appended batch in order');
    expect(callbackThrewSynchronously).toBe(true);
  });

  it('throws synchronously from a duplicate reducer-commit callback', async () => {
    const op = createOperation('op-1');
    const store = createStore({ seqs: [1], writtenOps: [op], skippedCount: 0 });
    let duplicateCallbackThrewSynchronously = false;
    const applier: OperationApplyPort<Operation<string>> = {
      applyOperations: vi.fn(async (ops, options) => {
        void options?.onReducersCommitted?.(ops);
        try {
          void options?.onReducersCommitted?.(ops);
        } catch (error) {
          duplicateCallbackThrewSynchronously = true;
          throw error;
        }
        return { appliedOps: ops };
      }),
    };

    await expect(applyRemoteOperations({ ops: [op], store, applier })).rejects.toThrow(
      'exactly once',
    );
    expect(duplicateCallbackThrewSynchronously).toBe(true);
  });

  it('preserves the applier error when an unawaited reducer checkpoint also fails', async () => {
    const op = createOperation('op-1');
    const applyError = new Error('dispatcher failed');
    const checkpointError = new Error('checkpoint failed');
    const store = createStore({ seqs: [1], writtenOps: [op], skippedCount: 0 });
    vi.mocked(store.markReducersCommittedAndMergeClocks).mockRejectedValue(
      checkpointError,
    );
    const applier: ReducerCommitAwareOperationApplyPort<Operation<string>> = {
      applyOperations: vi.fn(async (ops, options) => {
        void options.onReducersCommitted(ops);
        throw applyError;
      }),
    };

    await expect(applyRemoteOperations({ ops: [op], store, applier })).rejects.toBe(
      applyError,
    );
  });

  it('preserves a callback-contract error when the first reducer checkpoint also fails', async () => {
    const op = createOperation('op-1');
    const checkpointError = new Error('checkpoint failed');
    const store = createStore({ seqs: [1], writtenOps: [op], skippedCount: 0 });
    vi.mocked(store.markReducersCommittedAndMergeClocks).mockRejectedValue(
      checkpointError,
    );
    let callbackContractError: unknown;
    const applier: ReducerCommitAwareOperationApplyPort<Operation<string>> = {
      applyOperations: vi.fn(async (ops, options) => {
        void options.onReducersCommitted(ops);
        try {
          void options.onReducersCommitted(ops);
        } catch (error) {
          callbackContractError = error;
          throw error;
        }
        return { appliedOps: ops };
      }),
    };

    let thrown: unknown;
    try {
      await applyRemoteOperations({ ops: [op], store, applier });
    } catch (error) {
      thrown = error;
    }

    expect(callbackContractError).toBeInstanceOf(Error);
    expect(thrown).toBe(callbackContractError);
  });

  it('does not start reducer application when the pre-apply clock merge fails', async () => {
    const op = createOperation('op-1');
    const clockError = new Error('clock merge failed');
    const store = createStore({ seqs: [1], writtenOps: [op], skippedCount: 0 });
    vi.mocked(store.mergeRemoteOpClocks).mockRejectedValue(clockError);
    const applier = createApplier({ appliedOps: [op] });
    const onRemoteClocksDurable = vi.fn();

    await expect(
      applyRemoteOperations({
        ops: [op],
        store,
        applier,
        onRemoteClocksDurable,
      }),
    ).rejects.toBe(clockError);

    expect(onRemoteClocksDurable).not.toHaveBeenCalled();
    expect(applier.applyOperations).not.toHaveBeenCalled();
    expect(store.markReducersCommittedAndMergeClocks).not.toHaveBeenCalled();
    expect(store.markApplied).not.toHaveBeenCalled();
  });

  it('signals durable remote clocks before a later atomic checkpoint failure', async () => {
    const op = createOperation('op-1');
    const checkpointError = new Error('checkpoint failed');
    const store = createStore({ seqs: [1], writtenOps: [op], skippedCount: 0 });
    vi.mocked(store.markReducersCommittedAndMergeClocks).mockRejectedValue(
      checkpointError,
    );
    const onRemoteClocksDurable = vi.fn();

    await expect(
      applyRemoteOperations({
        ops: [op],
        store,
        applier: createApplier({ appliedOps: [op] }),
        onRemoteClocksDurable,
      }),
    ).rejects.toBe(checkpointError);

    expect(onRemoteClocksDurable).toHaveBeenCalledWith([op]);
    expect(store.markApplied).not.toHaveBeenCalled();
  });

  it('signals durable remote clocks before later bookkeeping can fail', async () => {
    const op = createOperation('op-1');
    const markAppliedError = new Error('mark applied failed');
    const store = createStore({ seqs: [1], writtenOps: [op], skippedCount: 0 });
    vi.mocked(store.markApplied).mockRejectedValue(markAppliedError);
    const onRemoteClocksDurable = vi.fn();

    await expect(
      applyRemoteOperations({
        ops: [op],
        store,
        applier: createApplier({ appliedOps: [op] }),
        onRemoteClocksDurable,
      }),
    ).rejects.toBe(markAppliedError);

    expect(onRemoteClocksDurable).toHaveBeenCalledWith([op]);
  });

  it('merges clocks before applying reducers and keeps the atomic checkpoint afterward', async () => {
    const op = createOperation('op-1');
    const store = createStore({ seqs: [1], writtenOps: [op], skippedCount: 0 });
    const callOrder: string[] = [];
    vi.mocked(store.mergeRemoteOpClocks).mockImplementation(async () => {
      callOrder.push('mergeRemoteOpClocks');
    });
    vi.mocked(store.markReducersCommittedAndMergeClocks).mockImplementation(async () => {
      callOrder.push('markReducersCommittedAndMergeClocks');
    });
    const applier: ReducerCommitAwareOperationApplyPort<Operation<string>> = {
      applyOperations: vi.fn(async (ops, options) => {
        callOrder.push('applyOperations');
        await options?.onReducersCommitted?.(ops);
        return { appliedOps: ops };
      }),
    };

    await applyRemoteOperations({ ops: [op], store, applier });

    expect(callOrder).toEqual([
      'mergeRemoteOpClocks',
      'applyOperations',
      'markReducersCommittedAndMergeClocks',
    ]);
  });
});

const jasmineLikeObjectContainingFunction = (): object =>
  expect.objectContaining({ onReducersCommitted: expect.any(Function) });
