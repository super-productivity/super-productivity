import { TestBed } from '@angular/core/testing';
import { applyRemoteOperations } from '@sp/sync-core';
import type { OperationApplyPort } from '@sp/sync-core';
import { ActionType, EntityType, Operation, OpType } from '../../core/operation.types';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { CLIENT_ID_PROVIDER, ClientIdProvider } from '../../util/client-id.provider';

describe('RemoteOperationApplyStorePort Integration', () => {
  let store: OperationLogStoreService;

  const mockClientIdProvider: ClientIdProvider = {
    loadClientId: () => Promise.resolve('testClient'),
    getOrGenerateClientId: () => Promise.resolve('testClient'),
  };

  const createOperation = (
    id: string,
    overrides: Partial<Operation> = {},
  ): Operation => ({
    id,
    actionType: '[Task] Update' as ActionType,
    opType: OpType.Update,
    entityType: 'TASK' as EntityType,
    entityId: id,
    payload: {},
    clientId: 'remoteClient',
    vectorClock: { remoteClient: 1 },
    timestamp: 1,
    schemaVersion: 1,
    ...overrides,
  });

  const createApplier = (
    result: Awaited<ReturnType<OperationApplyPort<Operation>['applyOperations']>>,
  ): {
    applier: OperationApplyPort<Operation>;
    applyOperationsSpy: jasmine.Spy;
  } => {
    const applyOperationsSpy = jasmine.createSpy('applyOperations').and.resolveTo(result);

    return {
      applier: { applyOperations: applyOperationsSpy },
      applyOperationsSpy,
    };
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        OperationLogStoreService,
        { provide: CLIENT_ID_PROVIDER, useValue: mockClientIdProvider },
      ],
    });

    store = TestBed.inject(OperationLogStoreService);
    await store.init();
    await store._clearAllDataForTesting();
  });

  it('should append, apply, mark, merge clocks, and skip duplicates through the real store port', async () => {
    const duplicateOp = createOperation('remote-duplicate', {
      clientId: 'clientA',
      vectorClock: { clientA: 1 },
    });
    const newOp = createOperation('remote-new', {
      clientId: 'clientB',
      vectorClock: { clientB: 3 },
    });
    await store.append(duplicateOp, 'remote');

    const { applier, applyOperationsSpy } = createApplier({ appliedOps: [newOp] });

    const result = await applyRemoteOperations({
      ops: [duplicateOp, newOp],
      store,
      applier,
    });

    expect(applyOperationsSpy).toHaveBeenCalledOnceWith([newOp]);
    expect(result.appendedOps).toEqual([newOp]);
    expect(result.skippedCount).toBe(1);
    expect(result.appliedOps).toEqual([newOp]);
    expect(result.failedOpIds).toEqual([]);

    const duplicateEntry = await store.getOpById(duplicateOp.id);
    const newEntry = await store.getOpById(newOp.id);
    expect(duplicateEntry?.applicationStatus).toBe('applied');
    expect(newEntry?.source).toBe('remote');
    expect(newEntry?.syncedAt).toBeDefined();
    expect(newEntry?.applicationStatus).toBe('applied');
    expect(result.appliedSeqs).toEqual(newEntry ? [newEntry.seq] : []);
    expect(await store.getPendingRemoteOps()).toEqual([]);
    expect(await store.getFailedRemoteOps()).toEqual([]);
    expect(await store.getVectorClock()).toEqual({ clientB: 3 });
  });

  it('should persist partial apply failures against the real IndexedDB entries', async () => {
    const appliedOp = createOperation('remote-applied', {
      clientId: 'clientA',
      vectorClock: { clientA: 2 },
    });
    const failedOp = createOperation('remote-failed', {
      clientId: 'clientB',
      vectorClock: { clientB: 4 },
    });
    const remainingOp = createOperation('remote-remaining', {
      clientId: 'clientC',
      vectorClock: { clientC: 6 },
    });
    const error = new Error('archive write failed');
    const { applier } = createApplier({
      appliedOps: [appliedOp],
      failedOp: { op: failedOp, error },
    });

    const result = await applyRemoteOperations({
      ops: [appliedOp, failedOp, remainingOp],
      store,
      applier,
    });

    expect(result.failedOp).toEqual({ op: failedOp, error });
    expect(result.failedOpIds).toEqual([failedOp.id, remainingOp.id]);

    const appliedEntry = await store.getOpById(appliedOp.id);
    const failedEntry = await store.getOpById(failedOp.id);
    const remainingEntry = await store.getOpById(remainingOp.id);
    expect(appliedEntry?.applicationStatus).toBe('applied');
    expect(failedEntry?.applicationStatus).toBe('failed');
    expect(failedEntry?.retryCount).toBe(1);
    expect(remainingEntry?.applicationStatus).toBe('failed');
    expect(remainingEntry?.retryCount).toBe(1);
    expect((await store.getFailedRemoteOps()).map((entry) => entry.op.id).sort()).toEqual(
      [failedOp.id, remainingOp.id].sort(),
    );
    expect(await store.getVectorClock()).toEqual({ clientA: 2 });
  });

  it('should clear older full-state ops and reset the vector clock after an applied remote import', async () => {
    const oldImportOp = createOperation('old-import', {
      opType: OpType.SyncImport,
      clientId: 'oldImportClient',
      vectorClock: { oldImportClient: 1 },
    });
    const newImportOp = createOperation('new-import', {
      opType: OpType.SyncImport,
      clientId: 'importClient',
      vectorClock: { importClient: 9, deadClient: 4 },
    });
    const postImportOp = createOperation('post-import-op', {
      clientId: 'importClient',
      vectorClock: { importClient: 10 },
    });
    await store.append(oldImportOp, 'remote');
    await store.setVectorClock({ staleClient: 5, testClient: 7 });

    const { applier } = createApplier({
      appliedOps: [newImportOp, postImportOp],
    });

    const result = await applyRemoteOperations({
      ops: [newImportOp, postImportOp],
      store,
      applier,
      isFullStateOperation: (op) => op.opType === OpType.SyncImport,
    });

    expect(result.clearedFullStateOpCount).toBe(1);
    expect(await store.getOpById(oldImportOp.id)).toBeUndefined();
    expect((await store.getOpById(newImportOp.id))?.applicationStatus).toBe('applied');
    expect((await store.getOpById(postImportOp.id))?.applicationStatus).toBe('applied');
    expect(await store.getVectorClock()).toEqual({
      importClient: 10,
      testClient: 7,
    });
  });
});
