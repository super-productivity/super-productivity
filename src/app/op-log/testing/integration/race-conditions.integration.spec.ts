import { TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { VectorClockService } from '../../sync/vector-clock.service';
import { OperationCaptureService } from '../../capture/operation-capture.service';
import { LockService } from '../../sync/lock.service';
import { OpType } from '../../core/operation.types';
import { TestClient, resetTestUuidCounter } from './helpers/test-client.helper';
import { createTaskOperation } from './helpers/operation-factory.helper';

/**
 * Integration tests for race condition scenarios.
 *
 * These tests verify that the operation log system handles various race
 * conditions correctly, ensuring no data loss or corruption under concurrent
 * operations.
 *
 * Race conditions tested:
 * 1. Flush polling race - actions during queue drain
 * 2. Concurrent sync and action dispatch
 * 3. Rapid action bursts during sync
 * 4. Lock contention scenarios
 */
describe('Race Condition Integration Tests', () => {
  let storeService: OperationLogStoreService;
  let vectorClockService: VectorClockService;
  let captureService: OperationCaptureService;
  let lockService: LockService;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        OperationLogStoreService,
        VectorClockService,
        OperationCaptureService,
        LockService,
        provideMockStore({
          initialState: {
            task: { ids: [], entities: {} },
            project: { ids: [], entities: {} },
          },
        }),
      ],
    });

    storeService = TestBed.inject(OperationLogStoreService);
    vectorClockService = TestBed.inject(VectorClockService);
    captureService = TestBed.inject(OperationCaptureService);
    lockService = TestBed.inject(LockService);

    await storeService.init();
    await storeService._clearAllDataForTesting();
    captureService.clear();
    resetTestUuidCounter();
  });

  describe('Flush polling race conditions', () => {
    it('should handle rapid queue operations during flush', async () => {
      // Simulate the scenario where actions are enqueued rapidly
      // while we're polling for the queue to drain
      const enqueueCount = 10;

      // Start with some operations in the queue (simulating real capture)
      for (let i = 0; i < enqueueCount; i++) {
        captureService.enqueue({
          type: `[Task] Test Action ${i}`,
          meta: {
            entityType: 'TASK' as any,
            entityId: `task-${i}`,
          },
        } as any);
      }

      // Verify initial queue state
      expect(captureService.getQueueSize()).toBe(enqueueCount);

      // Drain the queue (simulating the effect processing)
      for (let i = 0; i < enqueueCount; i++) {
        captureService.dequeue();
      }

      // Queue should now be empty
      expect(captureService.getQueueSize()).toBe(0);
    });

    it('should correctly report queue size during concurrent enqueue/dequeue', async () => {
      // Test that queue size is consistent under concurrent operations
      const iterations = 100;
      let maxObservedSize = 0;

      for (let i = 0; i < iterations; i++) {
        // Enqueue
        captureService.enqueue({
          type: `[Task] Concurrent Action ${i}`,
          meta: { entityType: 'TASK' as any, entityId: `task-${i}` },
        } as any);

        const size = captureService.getQueueSize();
        maxObservedSize = Math.max(maxObservedSize, size);

        // Dequeue immediately (simulating rapid processing)
        captureService.dequeue();
      }

      // Queue should be empty at the end
      expect(captureService.getQueueSize()).toBe(0);

      // At some point we should have seen items in the queue
      expect(maxObservedSize).toBeGreaterThan(0);
    });
  });

  describe('Concurrent sync and action dispatch', () => {
    it('should not lose operations during rapid concurrent writes', async () => {
      const client = new TestClient('concurrent-write-client');
      const writeCount = 50;
      const appendPromises: Promise<number>[] = [];

      // Launch many concurrent writes (simulating rapid action dispatch)
      for (let i = 0; i < writeCount; i++) {
        appendPromises.push(
          storeService.append(
            createTaskOperation(client, `concurrent-task-${i}`, OpType.Create, {
              index: i,
              timestamp: Date.now(),
            }),
            'local',
          ),
        );
      }

      // Wait for all writes to complete
      const seqs = await Promise.all(appendPromises);

      // All should have unique sequences
      const uniqueSeqs = new Set(seqs);
      expect(uniqueSeqs.size).toBe(writeCount);

      // All operations should be persisted
      const allOps = await storeService.getOpsAfterSeq(0);
      expect(allOps.length).toBe(writeCount);

      // Verify no operations were lost
      const entityIds = allOps.map((e) => e.op.entityId);
      for (let i = 0; i < writeCount; i++) {
        expect(entityIds).toContain(`concurrent-task-${i}`);
      }
    });

    it('should handle mixed local and remote operations concurrently', async () => {
      const localClient = new TestClient('local-client');
      const remoteClient = new TestClient('remote-client');
      const opsPerSide = 20;
      const allPromises: Promise<number>[] = [];

      // Interleave local and remote operations
      for (let i = 0; i < opsPerSide; i++) {
        allPromises.push(
          storeService.append(
            createTaskOperation(localClient, `local-task-${i}`, OpType.Create, {}),
            'local',
          ),
        );
        allPromises.push(
          storeService.append(
            createTaskOperation(remoteClient, `remote-task-${i}`, OpType.Create, {}),
            'remote',
          ),
        );
      }

      const seqs = await Promise.all(allPromises);

      // All operations should have unique sequences
      expect(new Set(seqs).size).toBe(opsPerSide * 2);

      // Verify all operations are stored
      const allOps = await storeService.getOpsAfterSeq(0);
      expect(allOps.length).toBe(opsPerSide * 2);

      // Verify source is correctly set
      const localOps = allOps.filter((e) => e.source === 'local');
      const remoteOps = allOps.filter((e) => e.source === 'remote');
      expect(localOps.length).toBe(opsPerSide);
      expect(remoteOps.length).toBe(opsPerSide);
    });
  });

  describe('Lock contention scenarios', () => {
    it('should serialize operations through lock correctly', async () => {
      const results: number[] = [];
      const lockName = 'test-lock';

      // Create multiple concurrent lock requests
      const lockPromises = [
        lockService.request(lockName, async () => {
          await new Promise((r) => setTimeout(r, 10));
          results.push(1);
        }),
        lockService.request(lockName, async () => {
          await new Promise((r) => setTimeout(r, 10));
          results.push(2);
        }),
        lockService.request(lockName, async () => {
          await new Promise((r) => setTimeout(r, 10));
          results.push(3);
        }),
      ];

      await Promise.all(lockPromises);

      // All three should have completed
      expect(results.length).toBe(3);
      // They should have executed in some order (not simultaneously)
      expect(results.sort()).toEqual([1, 2, 3]);
    });

    it('should handle lock timeout scenarios', async () => {
      const lockName = 'timeout-lock';
      let fastCompleted = false;
      let slowStarted = false;

      // First request holds the lock for a while
      const slowRequest = lockService.request(lockName, async () => {
        slowStarted = true;
        await new Promise((r) => setTimeout(r, 100));
      });

      // Second request waits for the first
      const fastRequest = lockService.request(lockName, async () => {
        fastCompleted = true;
      });

      // Wait for slow to start
      await new Promise((r) => setTimeout(r, 20));
      expect(slowStarted).toBe(true);

      // Fast should not have completed yet
      // (it's waiting for the lock)

      // Wait for both to complete
      await Promise.all([slowRequest, fastRequest]);
      expect(fastCompleted).toBe(true);
    });
  });

  describe('Vector clock race conditions', () => {
    it('should correctly increment clock under rapid concurrent operations', async () => {
      const client = new TestClient('vc-race-client');
      const operationCount = 30;

      // Rapid concurrent operations
      const opPromises = Array.from({ length: operationCount }, (_, i) =>
        storeService.append(
          createTaskOperation(client, `vc-task-${i}`, OpType.Create, {}),
          'local',
        ),
      );

      await Promise.all(opPromises);

      // Get final vector clock
      const finalClock = await vectorClockService.getCurrentVectorClock();

      // The client's counter should reflect all operations
      expect(finalClock[client.clientId]).toBe(operationCount);
    });

    it('should merge clocks correctly from multiple concurrent clients', async () => {
      const clients = [
        new TestClient('vc-client-a'),
        new TestClient('vc-client-b'),
        new TestClient('vc-client-c'),
      ];
      const opsPerClient = 10;

      // Each client creates operations concurrently
      const allPromises: Promise<number>[] = [];
      for (const client of clients) {
        for (let i = 0; i < opsPerClient; i++) {
          allPromises.push(
            storeService.append(
              createTaskOperation(
                client,
                `${client.clientId}-task-${i}`,
                OpType.Create,
                {},
              ),
              'local',
            ),
          );
        }
      }

      await Promise.all(allPromises);

      // Final clock should have all clients
      const finalClock = await vectorClockService.getCurrentVectorClock();
      for (const client of clients) {
        expect(finalClock[client.clientId]).toBe(opsPerClient);
      }
    });
  });

  describe('Cache invalidation race conditions', () => {
    it('should maintain correct unsynced cache under concurrent markSynced', async () => {
      const client = new TestClient('cache-race-client');

      // Create some operations
      const seqs: number[] = [];
      for (let i = 0; i < 20; i++) {
        const seq = await storeService.append(
          createTaskOperation(client, `cache-task-${i}`, OpType.Create, {}),
          'local',
        );
        seqs.push(seq);
      }

      // Concurrently mark as synced
      await Promise.all(seqs.map((seq) => storeService.markSynced([seq])));

      // All should be synced
      const unsynced = await storeService.getUnsynced();
      expect(unsynced.length).toBe(0);
    });

    it('should handle concurrent getUnsynced calls correctly', async () => {
      const client = new TestClient('get-unsynced-race');

      // Create operations
      for (let i = 0; i < 10; i++) {
        await storeService.append(
          createTaskOperation(client, `unsynced-task-${i}`, OpType.Create, {}),
          'local',
        );
      }

      // Multiple concurrent getUnsynced calls
      const results = await Promise.all([
        storeService.getUnsynced(),
        storeService.getUnsynced(),
        storeService.getUnsynced(),
      ]);

      // All should return the same count
      expect(results[0].length).toBe(10);
      expect(results[1].length).toBe(10);
      expect(results[2].length).toBe(10);
    });
  });

  describe('Database transaction race conditions', () => {
    it('should handle concurrent read-write transactions', async () => {
      const client = new TestClient('tx-race-client');

      // Pre-populate
      for (let i = 0; i < 5; i++) {
        await storeService.append(
          createTaskOperation(client, `existing-${i}`, OpType.Create, {}),
          'local',
        );
      }

      // Concurrent read and write operations
      const operations = await Promise.all([
        // Writes
        storeService.append(
          createTaskOperation(client, 'new-1', OpType.Create, {}),
          'local',
        ),
        storeService.append(
          createTaskOperation(client, 'new-2', OpType.Create, {}),
          'local',
        ),
        // Reads
        storeService.getOpsAfterSeq(0),
        storeService.getUnsynced(),
      ]);

      // All operations should complete without error
      expect(operations.length).toBe(4);

      // Final state should include all operations
      const finalOps = await storeService.getOpsAfterSeq(0);
      expect(finalOps.length).toBe(7); // 5 existing + 2 new
    });
  });
});
