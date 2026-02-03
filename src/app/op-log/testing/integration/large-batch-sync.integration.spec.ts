import { TestBed } from '@angular/core/testing';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { OpType } from '../../core/operation.types';
import { resetTestUuidCounter } from './helpers/test-client.helper';
import { MockSyncServer } from './helpers/mock-sync-server.helper';
import { SimulatedClient } from './helpers/simulated-client.helper';
import { createMinimalTaskPayload } from './helpers/operation-factory.helper';

const LARGE_BATCH_TIMEOUT = 5000;

/**
 * Integration tests for Large Batch Sync scenarios.
 *
 * These tests verify:
 * - Syncing large numbers of operations (upload/download)
 * - Pagination handling
 * - Performance/stability under load
 */
describe('Large Batch Sync Integration', () => {
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

  describe('Large Batch Upload', () => {
    it(
      'should upload 50 operations in a single batch',
      async () => {
        const client = new SimulatedClient('client-load-test', storeService);
        const batchSize = 50;

        // Create batch of operations
        const items = Array.from({ length: batchSize }, (_, i) => ({
          entityType: 'TASK',
          entityId: `task-${i}`,
          opType: OpType.Create,
          actionType: 'Create',
          payload: createMinimalTaskPayload(`task-${i}`),
        }));
        await client.createLocalOpsBatch(items);

        // Sync
        const result = await client.sync(server);

        expect(result.uploaded).toBe(batchSize);
        expect(server.getAllOps().length).toBe(batchSize);

        // Verify all marked synced
        const unsynced = await storeService.getUnsynced();
        expect(unsynced.length).toBe(0);
      },
      LARGE_BATCH_TIMEOUT,
    );
  });

  describe('Large Batch Download (Pagination)', () => {
    it(
      'should download 100 operations using pagination',
      async () => {
        const clientA = new SimulatedClient('client-a', storeService);
        const clientB = new SimulatedClient('client-b', storeService);
        const totalOps = 100;

        // Client A populates server using batch creation
        const items = Array.from({ length: totalOps }, (_, i) => ({
          entityType: 'TASK',
          entityId: `task-${i}`,
          opType: OpType.Create,
          actionType: 'Create',
          payload: createMinimalTaskPayload(`task-${i}`),
        }));
        await clientA.createLocalOpsBatch(items);
        await clientA.sync(server);

        expect(server.getAllOps().length).toBe(totalOps);

        // Client B downloads with limit=50, exercising pagination (100/50 = 2 pages)
        clientB.downloadLimit = 50;

        // First sync — downloads first 50
        const result1 = await clientB.sync(server);
        expect(result1.downloaded).toBe(50);

        // Second sync — downloads remaining 50
        const result2 = await clientB.sync(server);
        expect(result2.downloaded).toBe(50);

        // Third sync — empty
        const result3 = await clientB.sync(server);
        expect(result3.downloaded).toBe(0);

        // Verify total
        const allOps = await clientB.getAllOps();
        expect(allOps.length).toBe(totalOps);
      },
      LARGE_BATCH_TIMEOUT,
    );
  });
});
