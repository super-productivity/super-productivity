import { describe, expect, it, vi } from 'vitest';
import { replayOperationBatch } from '../src/replay-coordinator';
import type {
  ActionDispatchPort,
  ArchiveSideEffectPort,
  DeferredLocalActionsPort,
  Operation,
  RemoteApplyWindowPort,
  SyncActionLike,
} from '../src';

interface BulkReplayAction extends SyncActionLike {
  operations: Operation<string>[];
}

interface ReplayAction extends SyncActionLike {
  opId: string;
  archiveAffecting?: boolean;
}

const createOperation = (id: string): Operation<string> => ({
  id,
  actionType: '[Test] Action',
  opType: 'UPD',
  entityType: 'TASK',
  entityId: id,
  payload: {},
  clientId: 'client-1',
  vectorClock: { client1: 1 },
  timestamp: 1,
  schemaVersion: 1,
});

const createRemoteApplyWindow = (callOrder: string[]): RemoteApplyWindowPort => ({
  startApplyingRemoteOps: vi.fn(() => {
    callOrder.push('startApplyingRemoteOps');
  }),
  endApplyingRemoteOps: vi.fn(() => {
    callOrder.push('endApplyingRemoteOps');
  }),
  startPostSyncCooldown: vi.fn(() => {
    callOrder.push('startPostSyncCooldown');
  }),
});

const createDeferredLocalActions = (callOrder: string[]): DeferredLocalActionsPort => ({
  processDeferredActions: vi.fn(async () => {
    callOrder.push('processDeferredActions');
  }),
});

describe('replayOperationBatch', () => {
  it('dispatches a bulk action, yields, runs archive effects, then closes the sync window', async () => {
    const callOrder: string[] = [];
    const ops = [createOperation('op-1'), createOperation('op-2')];
    const dispatcher: ActionDispatchPort<BulkReplayAction> = {
      dispatch: vi.fn(() => {
        callOrder.push('dispatchBulk');
      }),
    };
    const archiveSideEffects: ArchiveSideEffectPort<ReplayAction> = {
      handleOperation: vi.fn(async (action) => {
        callOrder.push(`archive:${action.opId}`);
      }),
    };
    const yieldToEventLoop = vi.fn(async () => {
      callOrder.push('yield');
    });
    const onRemoteArchiveDataApplied = vi.fn(() => {
      callOrder.push('remoteArchiveDataApplied');
    });

    const result = await replayOperationBatch({
      ops,
      dispatcher,
      createBulkApplyAction: (operations) => ({
        type: '[Test] Bulk Apply',
        operations,
      }),
      remoteApplyWindow: createRemoteApplyWindow(callOrder),
      deferredLocalActions: createDeferredLocalActions(callOrder),
      archiveSideEffects,
      operationToAction: (op) => ({
        type: '[Test] Action',
        opId: op.id,
        archiveAffecting: op.id === 'op-2',
      }),
      isArchiveAffectingAction: (action) => action.archiveAffecting === true,
      onRemoteArchiveDataApplied,
      yieldToEventLoop,
    });

    expect(result).toEqual({ appliedOps: ops });
    expect(dispatcher.dispatch).toHaveBeenCalledWith({
      type: '[Test] Bulk Apply',
      operations: ops,
    });
    expect(archiveSideEffects.handleOperation).toHaveBeenCalledTimes(2);
    expect(onRemoteArchiveDataApplied).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual([
      'startApplyingRemoteOps',
      'dispatchBulk',
      'yield',
      'archive:op-1',
      'archive:op-2',
      'yield',
      'yield',
      'remoteArchiveDataApplied',
      'startPostSyncCooldown',
      'endApplyingRemoteOps',
      'processDeferredActions',
    ]);
  });

  it('waits for the post-dispatch yield before archive handling starts', async () => {
    const ops = [createOperation('op-1')];
    const archiveSideEffects: ArchiveSideEffectPort<ReplayAction> = {
      handleOperation: vi.fn(async () => undefined),
    };
    let releaseFirstYield: (() => void) | undefined;
    const yieldToEventLoop = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          if (releaseFirstYield === undefined) {
            releaseFirstYield = resolve;
            return;
          }
          resolve();
        }),
    );

    const applyPromise = replayOperationBatch({
      ops,
      dispatcher: { dispatch: vi.fn() },
      createBulkApplyAction: (operations) => ({
        type: '[Test] Bulk Apply',
        operations,
      }),
      remoteApplyWindow: createRemoteApplyWindow([]),
      deferredLocalActions: createDeferredLocalActions([]),
      archiveSideEffects,
      operationToAction: (op) => ({ type: '[Test] Action', opId: op.id }),
      yieldToEventLoop,
    });

    await Promise.resolve();

    expect(archiveSideEffects.handleOperation).not.toHaveBeenCalled();
    expect(releaseFirstYield).toBeDefined();

    releaseFirstYield?.();
    await applyPromise;

    expect(archiveSideEffects.handleOperation).toHaveBeenCalledTimes(1);
  });

  it('skips archive handling and post-sync cooldown for local hydration', async () => {
    const callOrder: string[] = [];
    const op = createOperation('op-1');
    const archiveSideEffects: ArchiveSideEffectPort<ReplayAction> = {
      handleOperation: vi.fn(async () => undefined),
    };
    const remoteApplyWindow = createRemoteApplyWindow(callOrder);

    const result = await replayOperationBatch({
      ops: [op],
      applyOptions: { isLocalHydration: true },
      dispatcher: {
        dispatch: vi.fn(() => {
          callOrder.push('dispatchBulk');
        }),
      },
      createBulkApplyAction: (operations) => ({
        type: '[Test] Bulk Apply',
        operations,
      }),
      remoteApplyWindow,
      deferredLocalActions: createDeferredLocalActions(callOrder),
      archiveSideEffects,
      operationToAction: (operation) => ({ type: '[Test] Action', opId: operation.id }),
      yieldToEventLoop: vi.fn(async () => {
        callOrder.push('yield');
      }),
    });

    expect(result).toEqual({ appliedOps: [op] });
    expect(archiveSideEffects.handleOperation).not.toHaveBeenCalled();
    expect(remoteApplyWindow.startPostSyncCooldown).not.toHaveBeenCalled();
    expect(callOrder).toEqual([
      'startApplyingRemoteOps',
      'dispatchBulk',
      'yield',
      'endApplyingRemoteOps',
      'processDeferredActions',
    ]);
  });

  it('reports partial archive failures and still flushes deferred local actions', async () => {
    const callOrder: string[] = [];
    const op1 = createOperation('op-1');
    const op2 = createOperation('op-2');
    const archiveError = new Error('archive failed');
    const archiveSideEffects: ArchiveSideEffectPort<ReplayAction> = {
      handleOperation: vi.fn(async (action) => {
        callOrder.push(`archive:${action.opId}`);
        if (action.opId === 'op-2') {
          throw archiveError;
        }
      }),
    };
    const onArchiveSideEffectError = vi.fn();
    const onRemoteArchiveDataApplied = vi.fn();

    const result = await replayOperationBatch({
      ops: [op1, op2],
      dispatcher: {
        dispatch: vi.fn(() => {
          callOrder.push('dispatchBulk');
        }),
      },
      createBulkApplyAction: (operations) => ({
        type: '[Test] Bulk Apply',
        operations,
      }),
      remoteApplyWindow: createRemoteApplyWindow(callOrder),
      deferredLocalActions: createDeferredLocalActions(callOrder),
      archiveSideEffects,
      operationToAction: (op) => ({
        type: '[Test] Action',
        opId: op.id,
        archiveAffecting: true,
      }),
      isArchiveAffectingAction: (action) => action.archiveAffecting === true,
      onArchiveSideEffectError,
      onRemoteArchiveDataApplied,
      yieldToEventLoop: vi.fn(async () => {
        callOrder.push('yield');
      }),
    });

    expect(result).toEqual({
      appliedOps: [op1],
      failedOp: {
        op: op2,
        error: archiveError,
      },
    });
    expect(onArchiveSideEffectError).toHaveBeenCalledWith({
      op: op2,
      processedCount: 1,
      error: archiveError,
    });
    expect(onRemoteArchiveDataApplied).not.toHaveBeenCalled();
    expect(callOrder).toEqual([
      'startApplyingRemoteOps',
      'dispatchBulk',
      'yield',
      'archive:op-1',
      'yield',
      'archive:op-2',
      'startPostSyncCooldown',
      'endApplyingRemoteOps',
      'processDeferredActions',
    ]);
  });

  it('fails fast when archive side effects are configured without operation conversion', async () => {
    const callOrder: string[] = [];
    const archiveSideEffects: ArchiveSideEffectPort<ReplayAction> = {
      handleOperation: vi.fn(async () => undefined),
    };
    const dispatcher: ActionDispatchPort<BulkReplayAction> = {
      dispatch: vi.fn(),
    };

    await expect(
      replayOperationBatch({
        ops: [createOperation('op-1')],
        dispatcher,
        createBulkApplyAction: (operations) => ({
          type: '[Test] Bulk Apply',
          operations,
        }),
        remoteApplyWindow: createRemoteApplyWindow(callOrder),
        deferredLocalActions: createDeferredLocalActions(callOrder),
        archiveSideEffects,
      }),
    ).rejects.toThrow(
      'replayOperationBatch requires operationToAction when archiveSideEffects is provided.',
    );

    expect(dispatcher.dispatch).not.toHaveBeenCalled();
    expect(archiveSideEffects.handleOperation).not.toHaveBeenCalled();
    expect(callOrder).toEqual([]);
  });

  it('closes the sync window and flushes deferred actions when dispatch throws', async () => {
    const callOrder: string[] = [];
    const dispatchError = new Error('dispatch failed');

    await expect(
      replayOperationBatch({
        ops: [createOperation('op-1')],
        dispatcher: {
          dispatch: vi.fn(() => {
            callOrder.push('dispatchBulk');
            throw dispatchError;
          }),
        },
        createBulkApplyAction: (operations) => ({
          type: '[Test] Bulk Apply',
          operations,
        }),
        remoteApplyWindow: createRemoteApplyWindow(callOrder),
        deferredLocalActions: createDeferredLocalActions(callOrder),
        yieldToEventLoop: vi.fn(async () => {
          callOrder.push('yield');
        }),
      }),
    ).rejects.toBe(dispatchError);

    expect(callOrder).toEqual([
      'startApplyingRemoteOps',
      'dispatchBulk',
      'startPostSyncCooldown',
      'endApplyingRemoteOps',
      'processDeferredActions',
    ]);
  });

  it('closes the sync window even when post-sync cooldown throws', async () => {
    const callOrder: string[] = [];
    const cooldownError = new Error('cooldown failed');
    const remoteApplyWindow = createRemoteApplyWindow(callOrder);
    vi.mocked(remoteApplyWindow.startPostSyncCooldown).mockImplementation(() => {
      callOrder.push('startPostSyncCooldown');
      throw cooldownError;
    });
    const onPostSyncCooldownError = vi.fn();

    await replayOperationBatch({
      ops: [createOperation('op-1')],
      dispatcher: { dispatch: vi.fn() },
      createBulkApplyAction: (operations) => ({
        type: '[Test] Bulk Apply',
        operations,
      }),
      remoteApplyWindow,
      deferredLocalActions: createDeferredLocalActions(callOrder),
      yieldToEventLoop: vi.fn(async () => undefined),
    });

    expect(onPostSyncCooldownError).not.toHaveBeenCalled();

    await replayOperationBatch({
      ops: [createOperation('op-2')],
      dispatcher: { dispatch: vi.fn() },
      createBulkApplyAction: (operations) => ({
        type: '[Test] Bulk Apply',
        operations,
      }),
      remoteApplyWindow,
      deferredLocalActions: createDeferredLocalActions(callOrder),
      onPostSyncCooldownError,
      yieldToEventLoop: vi.fn(async () => undefined),
    });

    expect(onPostSyncCooldownError).toHaveBeenCalledWith(cooldownError);
    expect(callOrder.slice(-3)).toEqual([
      'startPostSyncCooldown',
      'endApplyingRemoteOps',
      'processDeferredActions',
    ]);
  });

  it('does not open a sync window for an empty operation batch', async () => {
    const callOrder: string[] = [];
    const result = await replayOperationBatch({
      ops: [],
      dispatcher: { dispatch: vi.fn() },
      createBulkApplyAction: (operations) => ({
        type: '[Test] Bulk Apply',
        operations,
      }),
      remoteApplyWindow: createRemoteApplyWindow(callOrder),
      deferredLocalActions: createDeferredLocalActions(callOrder),
    });

    expect(result).toEqual({ appliedOps: [] });
    expect(callOrder).toEqual([]);
  });
});
