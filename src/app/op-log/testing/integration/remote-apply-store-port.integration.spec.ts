import { TestBed } from '@angular/core/testing';
import { Provider } from '@angular/core';
import { applyRemoteOperations } from '@sp/sync-core';
import type { OperationApplyPort } from '@sp/sync-core';
import { ActionType, EntityType, Operation, OpType } from '../../core/operation.types';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { CLIENT_ID_PROVIDER, ClientIdProvider } from '../../util/client-id.provider';
import { OP_LOG_DB_ADAPTER_FACTORY } from '../../persistence/op-log-db-adapter.token';
import { SqliteOpLogAdapter } from '../../persistence/sqlite-op-log-adapter';
import { createSqlJsDb } from '../../persistence/sql-js-db.test-helper';

/**
 * The store-port composed flows run against BOTH backends: the default
 * IndexedDB adapter and a sql.js-backed `SqliteOpLogAdapter` (B2 Stage 2 — the
 * "second pass against SqliteOpLogAdapter" gate from
 * docs/sync-and-op-log/sqlite-migration.md). This exercises the store's
 * COMPOSED transactions (the apply/mark/merge-clock path, full-state clearing,
 * vector-clock persistence) on a real SQL engine — not just the adapter in
 * isolation.
 */
const defineStorePortContract = (
  label: string,
  backendProviders: () => Promise<Provider[]>,
): void => {
  describe(`RemoteOperationApplyStorePort Integration (${label})`, () => {
    let store: OperationLogStoreService;

    const mockClientIdProvider: ClientIdProvider = {
      loadClientId: () => Promise.resolve('testClient'),
      getOrGenerateClientId: () => Promise.resolve('testClient'),
      clearCache: () => {},
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
      const applyOperationsSpy = jasmine
        .createSpy('applyOperations')
        .and.callFake(async (ops: Operation[], options) => {
          await options?.onReducersCommitted?.(ops);
          return result;
        });

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
          ...(await backendProviders()),
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

      expect(applyOperationsSpy).toHaveBeenCalledOnceWith(
        [newOp],
        jasmine.objectContaining({ onReducersCommitted: jasmine.any(Function) }),
      );
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

    it('should persist partial apply failures against the real store entries', async () => {
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
      expect(result.failedOpIds).toEqual([failedOp.id]);

      const appliedEntry = await store.getOpById(appliedOp.id);
      const failedEntry = await store.getOpById(failedOp.id);
      const remainingEntry = await store.getOpById(remainingOp.id);
      expect(appliedEntry?.applicationStatus).toBe('applied');
      expect(failedEntry?.applicationStatus).toBe('failed');
      expect(failedEntry?.retryCount).toBe(1);
      expect(remainingEntry?.applicationStatus).toBe('archive_pending');
      expect(remainingEntry?.retryCount).toBeUndefined();
      expect(
        (await store.getFailedRemoteOps()).map((entry) => entry.op.id).sort(),
      ).toEqual([failedOp.id, remainingOp.id].sort());
      expect(await store.getVectorClock()).toEqual({
        clientA: 2,
        clientB: 4,
        clientC: 6,
      });
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

    it('should keep a reducer-failed full-state operation pending and recoverable', async () => {
      const importOp = createOperation('failed-import', {
        opType: OpType.SyncImport,
        clientId: 'importClient',
        vectorClock: { importClient: 9 },
      });
      const reducerError = new Error('full-state reducer failed');
      const applier: OperationApplyPort<Operation> = {
        applyOperations: async (_ops, options) => {
          await options?.onReducersCommitted?.(
            [],
            [{ op: importOp, error: reducerError }],
          );
          return {
            appliedOps: [],
            reducerFailures: [{ op: importOp, error: reducerError }],
          };
        },
      };

      await expectAsync(
        applyRemoteOperations({
          ops: [importOp],
          store,
          applier,
          isFullStateOperation: (op) => op.opType === OpType.SyncImport,
        }),
      ).toBeRejectedWithError(/full-state operation.*failed/i);

      const stored = await store.getOpById(importOp.id);
      expect(stored?.applicationStatus).toBe('pending');
      expect(stored?.rejectedAt).toBeUndefined();
      expect(stored?.reducerRejectedAt).toBeUndefined();
      expect((await store.getPendingRemoteOps()).map((entry) => entry.op.id)).toEqual([
        importOp.id,
      ]);
    });

    it('should retain a third-client clock from an operation after a full-state import', async () => {
      const importOp = createOperation('ordered-import', {
        opType: OpType.SyncImport,
        clientId: 'importClient',
        vectorClock: { importClient: 9, obsoleteClient: 4 },
      });
      const postImportOp = createOperation('ordered-post-import', {
        clientId: 'thirdClient',
        vectorClock: { importClient: 9, thirdClient: 6 },
      });
      await store.setVectorClock({ staleClient: 5, testClient: 7 });
      const { applier } = createApplier({ appliedOps: [importOp, postImportOp] });

      await applyRemoteOperations({
        ops: [importOp, postImportOp],
        store,
        applier,
        isFullStateOperation: (op) => op.opType === OpType.SyncImport,
      });

      expect(await store.getVectorClock()).toEqual({
        importClient: 9,
        testClient: 7,
        thirdClient: 6,
      });
    });

    it('should reset at each full-state operation and merge only the final suffix', async () => {
      const firstImport = createOperation('first-import', {
        opType: OpType.SyncImport,
        clientId: 'firstImportClient',
        vectorClock: { firstImportClient: 1 },
      });
      const betweenImports = createOperation('between-imports', {
        clientId: 'betweenClient',
        vectorClock: { firstImportClient: 1, betweenClient: 3 },
      });
      const secondImport = createOperation('second-import', {
        opType: OpType.BackupImport,
        clientId: 'secondImportClient',
        vectorClock: { secondImportClient: 4, obsoleteImportEntry: 8 },
      });
      const finalSuffix = createOperation('final-suffix', {
        clientId: 'suffixClient',
        vectorClock: { secondImportClient: 4, suffixClient: 6 },
      });
      await store.setVectorClock({ staleClient: 5, testClient: 7 });
      const ops = [firstImport, betweenImports, secondImport, finalSuffix];
      const { applier } = createApplier({ appliedOps: ops });

      await applyRemoteOperations({
        ops,
        store,
        applier,
        isFullStateOperation: (op) =>
          op.opType === OpType.SyncImport || op.opType === OpType.BackupImport,
      });

      expect(await store.getVectorClock()).toEqual({
        secondImportClient: 4,
        testClient: 7,
        suffixClient: 6,
      });
    });
  });
};

defineStorePortContract('IndexedDB', async () => []);

defineStorePortContract('sql.js (real SQLite)', async () => {
  // One shared sql.js database; the store's single adapter reads/writes it.
  // OperationLogStoreService.init() now calls adapter.init() for self-managing
  // backends (no adoptConnection) and skips the IndexedDB open (Phase B3), so the
  // store itself creates the SQLite tables — no pre-init needed. This spec thus
  // exercises the store running fully on SQLite with `_db` undefined.
  const db = await createSqlJsDb();
  return [
    { provide: OP_LOG_DB_ADAPTER_FACTORY, useValue: () => new SqliteOpLogAdapter(db) },
  ];
});
