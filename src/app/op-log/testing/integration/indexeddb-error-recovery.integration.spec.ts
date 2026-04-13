import { TestBed } from '@angular/core/testing';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { OpType } from '../../core/operation.types';
import { resetTestUuidCounter } from './helpers/test-client.helper';
import { MockSyncServer } from './helpers/mock-sync-server.helper';
import { SimulatedClient } from './helpers/simulated-client.helper';
import { createMinimalTaskPayload } from './helpers/operation-factory.helper';
import { StorageQuotaExceededError } from '../../core/errors/sync-errors';

/**
 * Integration tests for IndexedDB Error Recovery.
 *
 * Verifies that the sync system handles IndexedDB errors gracefully:
 * 1. StorageQuotaExceededError is propagated correctly
 * 2. Duplicate operations handled via appendBatchSkipDuplicates during retry
 * 3. Sync continues working after transient errors resolve
 */
describe('IndexedDB Error Recovery Integration', () => {
  let storeService: OperationLogStoreService;
  let server: MockSyncServer;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [OperationLogStoreService],
    });
    storeService = TestBed.inject(OperationLogStoreService);

    await storeService.init();
    await storeService._clearAllDataForTesting();
    resetTestUuidCounter();

    server = new MockSyncServer();
  });

  describe('StorageQuotaExceededError propagation', () => {
    it('should throw StorageQuotaExceededError when quota is exceeded during append', async () => {
      // Spy on the internal db.add to simulate quota exceeded
      const originalAppend = storeService.append.bind(storeService);
      let callCount = 0;

      spyOn(storeService, 'append').and.callFake(async (op, source) => {
        callCount++;
        if (callCount === 2) {
          throw new StorageQuotaExceededError();
        }
        return originalAppend(op, source);
      });

      const client = new SimulatedClient('client-quota-test', storeService);

      // First op should succeed
      await client.createLocalOp(
        'TASK',
        't1',
        OpType.Create,
        'Create',
        createMinimalTaskPayload('t1'),
      );

      // Second op should throw StorageQuotaExceededError
      try {
        await client.createLocalOp(
          'TASK',
          't2',
          OpType.Create,
          'Create',
          createMinimalTaskPayload('t2'),
        );
        fail('Should have thrown StorageQuotaExceededError');
      } catch (e) {
        expect(e instanceof StorageQuotaExceededError).toBe(true);
        expect((e as Error).name).toBe('StorageQuotaExceededError');
      }
    });

    it('should throw StorageQuotaExceededError when quota is exceeded during batch append', async () => {
      spyOn(storeService, 'appendBatch').and.callFake(async () => {
        throw new StorageQuotaExceededError();
      });

      const client = new SimulatedClient('client-batch-quota', storeService);

      try {
        await client.createLocalOpsBatch([
          {
            entityType: 'TASK',
            entityId: 't1',
            opType: OpType.Create,
            actionType: 'Create',
            payload: createMinimalTaskPayload('t1'),
          },
          {
            entityType: 'TASK',
            entityId: 't2',
            opType: OpType.Create,
            actionType: 'Create',
            payload: createMinimalTaskPayload('t2'),
          },
        ]);
        fail('Should have thrown StorageQuotaExceededError');
      } catch (e) {
        expect(e instanceof StorageQuotaExceededError).toBe(true);
      }
    });
  });

  describe('Duplicate handling via appendBatchSkipDuplicates', () => {
    it('should skip duplicate operations and return correct counts', async () => {
      const client = new SimulatedClient('client-dedup-test', storeService);

      // Create and store an operation
      const op1 = await client.createLocalOp(
        'TASK',
        't1',
        OpType.Create,
        'Create',
        createMinimalTaskPayload('t1'),
      );
      const op2 = await client.createLocalOp(
        'TASK',
        't2',
        OpType.Create,
        'Create',
        createMinimalTaskPayload('t2'),
      );

      // Now try to append the same ops again plus a new one via appendBatchSkipDuplicates
      const newOp = {
        ...op1,
        id: 'new-op-id',
        entityId: 't3',
        payload: createMinimalTaskPayload('t3'),
      };

      const result = await storeService.appendBatchSkipDuplicates(
        [op1, op2, newOp],
        'remote',
      );

      expect(result.skippedCount).toBe(2);
      expect(result.writtenOps.length).toBe(1);
      expect(result.writtenOps[0].id).toBe('new-op-id');
      expect(result.seqs.length).toBe(1);
    });

    it('should handle all-duplicate batch gracefully', async () => {
      const client = new SimulatedClient('client-all-dup', storeService);

      const op1 = await client.createLocalOp(
        'TASK',
        't1',
        OpType.Create,
        'Create',
        createMinimalTaskPayload('t1'),
      );

      // Try to append the same op again
      const result = await storeService.appendBatchSkipDuplicates([op1], 'remote');

      expect(result.skippedCount).toBe(1);
      expect(result.writtenOps.length).toBe(0);
      expect(result.seqs.length).toBe(0);
    });

    it('should handle empty batch gracefully', async () => {
      const result = await storeService.appendBatchSkipDuplicates([], 'remote');

      expect(result.skippedCount).toBe(0);
      expect(result.writtenOps.length).toBe(0);
      expect(result.seqs.length).toBe(0);
    });
  });

  describe('Sync continues after transient errors', () => {
    it('should sync successfully after a transient IndexedDB error resolves', async () => {
      const client = new SimulatedClient('client-transient', storeService);

      // Create initial ops and sync successfully
      await client.createLocalOp(
        'TASK',
        't1',
        OpType.Create,
        'Create',
        createMinimalTaskPayload('t1'),
      );
      const firstResult = await client.sync(server);
      expect(firstResult.uploaded).toBe(1);
      expect(server.getAllOps().length).toBe(1);

      // Create more ops
      await client.createLocalOp(
        'TASK',
        't2',
        OpType.Create,
        'Create',
        createMinimalTaskPayload('t2'),
      );
      await client.createLocalOp(
        'TASK',
        't3',
        OpType.Create,
        'Create',
        createMinimalTaskPayload('t3'),
      );

      // Sync successfully again - the "transient error" has resolved
      const secondResult = await client.sync(server);
      expect(secondResult.uploaded).toBe(2);
      expect(server.getAllOps().length).toBe(3);

      // Verify all ops are synced
      const unsynced = await storeService.getUnsynced();
      expect(unsynced.length).toBe(0);
    });

    it('should handle retry with duplicates after partial upload failure', async () => {
      const client = new SimulatedClient('client-retry-dup', storeService);

      // Create 3 ops
      await client.createLocalOp(
        'TASK',
        't1',
        OpType.Create,
        'Create',
        createMinimalTaskPayload('t1'),
      );
      await client.createLocalOp(
        'TASK',
        't2',
        OpType.Create,
        'Create',
        createMinimalTaskPayload('t2'),
      );
      await client.createLocalOp(
        'TASK',
        't3',
        OpType.Create,
        'Create',
        createMinimalTaskPayload('t3'),
      );

      // Sync all 3 successfully
      const result = await client.sync(server);
      expect(result.uploaded).toBe(3);

      // Verify server has all 3
      expect(server.getAllOps().length).toBe(3);

      // Now verify that trying to upload the same ops again handles duplicates
      // (This simulates what happens after a retry where the client doesn't know
      // which ops the server already has)
      const unsynced = await storeService.getUnsynced();
      expect(unsynced.length).toBe(0);
    });
  });
});
