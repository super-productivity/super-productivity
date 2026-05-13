import { describe, expect, it, vi } from 'vitest';
import { applyRemoteOperations } from '../src/remote-apply';
import type { RemoteOperationApplyStorePort } from '../src/remote-apply';
import type { Operation, OperationApplyPort } from '../src';

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
  markApplied: vi.fn().mockResolvedValue(undefined),
  markFailed: vi.fn().mockResolvedValue(undefined),
  mergeRemoteOpClocks: vi.fn().mockResolvedValue(undefined),
  clearFullStateOpsExcept: vi.fn().mockResolvedValue(0),
});

const createApplier = (
  result: Awaited<ReturnType<OperationApplyPort<Operation<string>>['applyOperations']>>,
): OperationApplyPort<Operation<string>> => ({
  applyOperations: vi.fn().mockResolvedValue(result),
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
    expect(applier.applyOperations).toHaveBeenCalledWith([op2]);
    expect(store.markApplied).toHaveBeenCalledWith([10]);
    expect(store.mergeRemoteOpClocks).toHaveBeenCalledWith([op2]);
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

  it('marks the failed op and remaining unapplied ops as failed', async () => {
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
    expect(store.mergeRemoteOpClocks).toHaveBeenCalledWith([op1]);
    expect(store.markFailed).toHaveBeenCalledWith(['op-2', 'op-3']);
    expect(result.failedOp).toEqual({ op: op2, error });
    expect(result.failedOpIds).toEqual(['op-2', 'op-3']);
  });

  it('marks only the reported failed op if it is not in the appended batch', async () => {
    const op1 = createOperation('op-1');
    const unknownFailedOp = createOperation('unknown-failed-op');
    const store = createStore({ seqs: [1], writtenOps: [op1], skippedCount: 0 });
    const applier = createApplier({
      appliedOps: [],
      failedOp: { op: unknownFailedOp, error: new Error('unexpected') },
    });

    const result = await applyRemoteOperations({ ops: [op1], store, applier });

    expect(store.markFailed).toHaveBeenCalledWith(['unknown-failed-op']);
    expect(result.failedOpIds).toEqual(['unknown-failed-op']);
  });
});
