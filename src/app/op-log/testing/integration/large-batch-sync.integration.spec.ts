import { TestBed } from '@angular/core/testing';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { OpType } from '../../core/operation.types';
import { resetTestUuidCounter } from './helpers/test-client.helper';
import { MockSyncServer } from './helpers/mock-sync-server.helper';
import { SimulatedClient } from './helpers/simulated-client.helper';
import { createMinimalTaskPayload } from './helpers/operation-factory.helper';

// Timeout constants for large batch tests - creating/syncing 500-1000 ops
// can exceed the default 2000ms timeout under load
const LARGE_BATCH_TIMEOUT = 15000;

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
      'should upload 500 operations in a single batch',
      async () => {
        const client = new SimulatedClient('client-load-test', storeService);
        const batchSize = 500;

        // Create large batch of operations
        const startTime = Date.now();
        for (let i = 0; i < batchSize; i++) {
          await client.createLocalOp(
            'TASK',
            `task-${i}`,
            OpType.Create,
            'Create',
            createMinimalTaskPayload(`task-${i}`),
          );
        }
        const creationTime = Date.now() - startTime;
        console.log(`Created ${batchSize} ops in ${creationTime}ms`);

        // Sync
        const syncStartTime = Date.now();
        const result = await client.sync(server);
        const syncTime = Date.now() - syncStartTime;
        console.log(`Synced ${batchSize} ops in ${syncTime}ms`);

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
      'should download 1000 operations using pagination',
      async () => {
        const clientA = new SimulatedClient('client-a', storeService);
        const clientB = new SimulatedClient('client-b', storeService);
        const totalOps = 1000;

        // Client A populates server (in batches to avoid timeout during setup)
        // Note: We bypass clientA.sync() for speed and populate server directly if possible,
        // but SimulatedClient.createLocalOp + sync is safer to ensure valid data.
        // We'll do it in chunks of 500.
        for (let i = 0; i < totalOps; i += 500) {
          for (let j = 0; j < 500; j++) {
            const idx = i + j;
            await clientA.createLocalOp(
              'TASK',
              `task-${idx}`,
              OpType.Create,
              'Create',
              createMinimalTaskPayload(`task-${idx}`),
            );
          }
          await clientA.sync(server);
        }

        expect(server.getAllOps().length).toBe(totalOps);

        // Client B syncs - should download all 1000
        // Mock server default limit is 500, so this should trigger multiple internal fetches
        // if SimulatedClient/SyncService handles it, OR we have to call sync multiple times.
        //
        // SimulatedClient.sync() calls downloadFromServer once.
        // In real app, `OperationLogSyncService` handles pagination internally or by repeated calls.
        // SimulatedClient `downloadFromServer` downloads ONE batch (limit 500).

        // First sync
        const result1 = await clientB.sync(server);
        expect(result1.downloaded).toBe(500);

        // Second sync
        const result2 = await clientB.sync(server);
        expect(result2.downloaded).toBe(500);

        // Third sync - empty
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
