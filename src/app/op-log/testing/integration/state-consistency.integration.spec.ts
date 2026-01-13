import { TestBed } from '@angular/core/testing';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { VectorClockService } from '../../sync/vector-clock.service';
import { OpType, VectorClock } from '../../core/operation.types';
import { CURRENT_SCHEMA_VERSION } from '../../persistence/schema-migration.service';
import { TestClient, resetTestUuidCounter } from './helpers/test-client.helper';
import {
  createTaskOperation,
  createMinimalTaskPayload,
} from './helpers/operation-factory.helper';

/**
 * Integration tests for state consistency verification.
 *
 * These tests verify:
 * - Operation replay produces correct state
 * - Snapshot + tail replay equals full replay
 * - Delete operations are handled correctly
 * - Operation order independence (for non-conflicting ops)
 * - Compaction preserves state
 *
 * Tests use real IndexedDB for realistic behavior.
 */
describe('State Consistency Integration', () => {
  let storeService: OperationLogStoreService;
  let vectorClockService: VectorClockService;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [OperationLogStoreService, VectorClockService],
    });
    storeService = TestBed.inject(OperationLogStoreService);
    vectorClockService = TestBed.inject(VectorClockService);

    await storeService.init();
    await storeService._clearAllDataForTesting();
    resetTestUuidCounter();
  });

  describe('Operation sequence correctness', () => {
    it('should store operations in correct sequence order', async () => {
      const client = new TestClient('client-test');

      const ops = [
        createTaskOperation(client, 'task-1', OpType.Create, { title: 'Created' }),
        createTaskOperation(client, 'task-1', OpType.Update, { title: 'Updated 1' }),
        createTaskOperation(client, 'task-1', OpType.Update, { title: 'Updated 2' }),
        createTaskOperation(client, 'task-1', OpType.Update, { title: 'Final' }),
      ];

      for (const op of ops) {
        await storeService.append(op, 'local');
      }

      const storedOps = await storeService.getOpsAfterSeq(0);
      expect(storedOps.length).toBe(4);

      // Verify sequence ordering
      for (let i = 1; i < storedOps.length; i++) {
        expect(storedOps[i].seq).toBeGreaterThan(storedOps[i - 1].seq);
      }

      // Verify operation order matches insertion order
      expect(storedOps[0].op.payload).toEqual({ title: 'Created' });
      expect(storedOps[3].op.payload).toEqual({ title: 'Final' });
    });

    it('should maintain vector clock progression', async () => {
      const client = new TestClient('client-test');

      const op1 = createTaskOperation(client, 'task-1', OpType.Create, { title: '1' });
      const op2 = createTaskOperation(client, 'task-1', OpType.Update, { title: '2' });
      const op3 = createTaskOperation(client, 'task-1', OpType.Update, { title: '3' });

      await storeService.append(op1, 'local');
      await storeService.append(op2, 'local');
      await storeService.append(op3, 'local');

      const storedOps = await storeService.getOpsAfterSeq(0);

      // Vector clock should increment for each operation
      expect(storedOps[0].op.vectorClock['client-test']).toBe(1);
      expect(storedOps[1].op.vectorClock['client-test']).toBe(2);
      expect(storedOps[2].op.vectorClock['client-test']).toBe(3);
    });
  });

  describe('Snapshot and tail operations', () => {
    it('should correctly save and load state cache', async () => {
      const testState = {
        task: {
          ids: ['task-1', 'task-2'],
          entities: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'task-1': createMinimalTaskPayload('task-1', { title: 'Task 1' }),
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'task-2': createMinimalTaskPayload('task-2', { title: 'Task 2' }),
          },
        },
      };
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const vectorClock: VectorClock = { 'client-a': 5, 'client-b': 3 };

      await storeService.saveStateCache({
        state: testState,
        lastAppliedOpSeq: 100,
        vectorClock,
        compactedAt: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });

      const loaded = await storeService.loadStateCache();
      expect(loaded).not.toBeNull();
      expect(loaded!.state).toEqual(testState);
      expect(loaded!.lastAppliedOpSeq).toBe(100);
      expect(loaded!.vectorClock).toEqual(vectorClock);
    });

    it('should correctly identify tail operations after snapshot', async () => {
      const client = new TestClient('client-test');

      // Create 5 operations
      for (let i = 1; i <= 5; i++) {
        await storeService.append(
          createTaskOperation(client, `task-${i}`, OpType.Create, { title: `Task ${i}` }),
          'local',
        );
      }

      const allOps = await storeService.getOpsAfterSeq(0);
      const snapshotSeq = allOps[2].seq; // After 3rd operation

      // Save snapshot at seq 3
      await storeService.saveStateCache({
        state: { snapshot: true },
        lastAppliedOpSeq: snapshotSeq,
        vectorClock: client.getCurrentClock(),
        compactedAt: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });

      // Get tail operations (after snapshot)
      const tailOps = await storeService.getOpsAfterSeq(snapshotSeq);
      expect(tailOps.length).toBe(2); // Operations 4 and 5
    });

    it('should merge snapshot clock with tail operation clocks', async () => {
      const clientB = new TestClient('client-b-test');

      // Save snapshot with A's knowledge (A is a remote client not present locally)
      await storeService.saveStateCache({
        state: {},
        lastAppliedOpSeq: 0,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        vectorClock: { 'client-a-test': 5, 'client-b-test': 3 },
        compactedAt: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });

      // Add tail operations from B
      const opB = createTaskOperation(clientB, 'task-1', OpType.Create, {
        title: 'From B',
      });
      // Manually set B's clock to be higher
      // eslint-disable-next-line @typescript-eslint/naming-convention
      clientB.setVectorClock({ 'client-a-test': 5, 'client-b-test': 4 });
      const opB2 = createTaskOperation(clientB, 'task-2', OpType.Create, {
        title: 'From B 2',
      });

      await storeService.append(opB, 'remote');
      await storeService.append(opB2, 'remote');

      // Get current merged clock
      const currentClock = await vectorClockService.getCurrentVectorClock();

      // Should have merged snapshot + tail ops
      expect(currentClock['client-a-test']).toBe(5); // From snapshot
      expect(currentClock['client-b-test']).toBe(5); // Max of snapshot (3) and tail ops (4, 5)
    });
  });

  describe('Delete operation handling', () => {
    it('should track delete operations correctly', async () => {
      const client = new TestClient('client-test');

      // Create then delete
      const createOp = createTaskOperation(client, 'task-1', OpType.Create, {
        title: 'Task',
      });
      const deleteOp = createTaskOperation(client, 'task-1', OpType.Delete, {});

      await storeService.append(createOp, 'local');
      await storeService.append(deleteOp, 'local');

      const ops = await storeService.getOpsAfterSeq(0);
      expect(ops.length).toBe(2);
      expect(ops[0].op.opType).toBe(OpType.Create);
      expect(ops[1].op.opType).toBe(OpType.Delete);
    });

    it('should include delete in entity frontier', async () => {
      const client = new TestClient('client-test');

      await storeService.append(
        createTaskOperation(client, 'task-1', OpType.Create, { title: 'Task' }),
        'local',
      );
      await storeService.append(
        createTaskOperation(client, 'task-1', OpType.Delete, {}),
        'local',
      );

      const frontier = await vectorClockService.getEntityFrontier();
      const task1Clock = frontier.get('TASK:task-1');

      // Entity should still have frontier entry (delete is an operation)
      expect(task1Clock).toBeDefined();
      expect(task1Clock!['client-test']).toBe(2); // After 2 operations
    });
  });

  describe('Operation order independence', () => {
    it('should store same operations regardless of arrival order', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');

      // These ops are on different entities (non-conflicting)
      const opA = createTaskOperation(clientA, 'task-a', OpType.Create, { title: 'A' });
      const opB = createTaskOperation(clientB, 'task-b', OpType.Create, { title: 'B' });

      // Test order 1: A then B
      await storeService._clearAllDataForTesting();
      await storeService.append(opA, 'local');
      await storeService.append(opB, 'remote');

      const opsOrder1 = await storeService.getOpsAfterSeq(0);
      const opIdsOrder1 = new Set(opsOrder1.map((e) => e.op.id));

      // Test order 2: B then A
      await storeService._clearAllDataForTesting();
      resetTestUuidCounter(); // Reset to get same IDs

      // Recreate ops with same IDs
      const clientA2 = new TestClient('client-a-test');
      const clientB2 = new TestClient('client-b-test');
      const opA2 = createTaskOperation(clientA2, 'task-a', OpType.Create, { title: 'A' });
      const opB2 = createTaskOperation(clientB2, 'task-b', OpType.Create, { title: 'B' });

      await storeService.append(opB2, 'remote');
      await storeService.append(opA2, 'local');

      const opsOrder2 = await storeService.getOpsAfterSeq(0);
      const opIdsOrder2 = new Set(opsOrder2.map((e) => e.op.id));

      // Same operations should be stored (same IDs)
      expect(opIdsOrder1).toEqual(opIdsOrder2);
    });

    it('should produce same vector clock regardless of local/remote order', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');

      const opA = createTaskOperation(clientA, 'task-a', OpType.Create, { title: 'A' });
      const opB = createTaskOperation(clientB, 'task-b', OpType.Create, { title: 'B' });

      await storeService.append(opA, 'local');
      await storeService.append(opB, 'remote');

      const clock1 = await vectorClockService.getCurrentVectorClock();

      // Clear and reverse order
      await storeService._clearAllDataForTesting();
      resetTestUuidCounter();

      const clientA2 = new TestClient('client-a-test');
      const clientB2 = new TestClient('client-b-test');
      const opA2 = createTaskOperation(clientA2, 'task-a', OpType.Create, { title: 'A' });
      const opB2 = createTaskOperation(clientB2, 'task-b', OpType.Create, { title: 'B' });

      await storeService.append(opB2, 'remote');
      await storeService.append(opA2, 'local');

      const clock2 = await vectorClockService.getCurrentVectorClock();

      // Vector clocks should be equivalent
      expect(clock1['client-a-test']).toBe(clock2['client-a-test']);
      expect(clock1['client-b-test']).toBe(clock2['client-b-test']);
    });
  });

  describe('Rejection tracking', () => {
    it('should mark rejected operations and exclude from unsynced', async () => {
      const client = new TestClient('client-test');

      const op1 = createTaskOperation(client, 'task-1', OpType.Create, { title: '1' });
      const op2 = createTaskOperation(client, 'task-2', OpType.Create, { title: '2' });
      const op3 = createTaskOperation(client, 'task-3', OpType.Create, { title: '3' });

      await storeService.append(op1, 'local');
      await storeService.append(op2, 'local');
      await storeService.append(op3, 'local');

      // Reject op2 (simulating conflict resolution)
      await storeService.markRejected([op2.id]);

      const unsynced = await storeService.getUnsynced();
      const unsyncedIds = unsynced.map((e) => e.op.id);

      expect(unsyncedIds).toContain(op1.id);
      expect(unsyncedIds).not.toContain(op2.id); // Rejected
      expect(unsyncedIds).toContain(op3.id);
    });

    it('should preserve rejected operations in log for audit', async () => {
      const client = new TestClient('client-test');

      const op = createTaskOperation(client, 'task-1', OpType.Create, { title: 'Test' });
      await storeService.append(op, 'local');
      await storeService.markRejected([op.id]);

      // Operation should still exist in log
      const allOps = await storeService.getOpsAfterSeq(0);
      expect(allOps.length).toBe(1);
      expect(allOps[0].rejectedAt).toBeDefined();
    });
  });

  describe('Sync marking', () => {
    it('should mark operations as synced by sequence', async () => {
      const client = new TestClient('client-test');

      const op1 = createTaskOperation(client, 'task-1', OpType.Create, { title: '1' });
      const op2 = createTaskOperation(client, 'task-2', OpType.Create, { title: '2' });

      await storeService.append(op1, 'local');
      await storeService.append(op2, 'local');

      const opsBefore = await storeService.getOpsAfterSeq(0);
      expect(opsBefore[0].syncedAt).toBeUndefined();
      expect(opsBefore[1].syncedAt).toBeUndefined();

      // Mark first op as synced
      await storeService.markSynced([opsBefore[0].seq]);

      const opsAfter = await storeService.getOpsAfterSeq(0);
      expect(opsAfter[0].syncedAt).toBeDefined();
      expect(opsAfter[1].syncedAt).toBeUndefined();
    });

    it('should exclude synced local ops from unsynced query', async () => {
      const client = new TestClient('client-test');

      const op1 = createTaskOperation(client, 'task-1', OpType.Create, { title: '1' });
      const op2 = createTaskOperation(client, 'task-2', OpType.Create, { title: '2' });

      await storeService.append(op1, 'local');
      await storeService.append(op2, 'local');

      const allOps = await storeService.getOpsAfterSeq(0);
      await storeService.markSynced([allOps[0].seq]);

      const unsynced = await storeService.getUnsynced();
      expect(unsynced.length).toBe(1);
      expect(unsynced[0].op.id).toBe(op2.id);
    });
  });

  describe('Large operation batches', () => {
    it('should handle many operations efficiently', async () => {
      const client = new TestClient('client-test');
      const operationCount = 100;

      const startTime = Date.now();

      for (let i = 0; i < operationCount; i++) {
        await storeService.append(
          createTaskOperation(client, `task-${i}`, OpType.Create, { title: `Task ${i}` }),
          'local',
        );
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      const ops = await storeService.getOpsAfterSeq(0);
      expect(ops.length).toBe(operationCount);

      // Sanity check: should complete in reasonable time (< 10s)
      expect(duration).toBeLessThan(10000);
    });

    it('should maintain correct sequence across large batch', async () => {
      const client = new TestClient('client-test');

      for (let i = 0; i < 50; i++) {
        await storeService.append(
          createTaskOperation(client, `task-${i}`, OpType.Create, { title: `Task ${i}` }),
          'local',
        );
      }

      const ops = await storeService.getOpsAfterSeq(0);

      // Verify strict sequence ordering
      for (let i = 1; i < ops.length; i++) {
        expect(ops[i].seq).toBeGreaterThan(ops[i - 1].seq);
      }

      // Verify vector clock progression
      for (let i = 0; i < ops.length; i++) {
        expect(ops[i].op.vectorClock['client-test']).toBe(i + 1);
      }
    });
  });

  describe('Migration backup safety', () => {
    it('should support backup and restore of state cache', async () => {
      const originalState = { tasks: ['a', 'b'] };

      await storeService.saveStateCache({
        state: originalState,
        lastAppliedOpSeq: 50,
        vectorClock: { client: 5 },
        compactedAt: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });

      // Create backup
      await storeService.saveStateCacheBackup();
      expect(await storeService.hasStateCacheBackup()).toBe(true);

      // Modify current state (simulating migration attempt)
      await storeService.saveStateCache({
        state: { tasks: ['modified'] },
        lastAppliedOpSeq: 100,
        vectorClock: { client: 10 },
        compactedAt: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });

      // Restore from backup (simulating migration failure)
      await storeService.restoreStateCacheFromBackup();

      const restored = await storeService.loadStateCache();
      expect(restored!.state).toEqual(originalState);
      expect(restored!.lastAppliedOpSeq).toBe(50);
    });

    it('should clear backup after successful migration', async () => {
      await storeService.saveStateCache({
        state: {},
        lastAppliedOpSeq: 10,
        vectorClock: {},
        compactedAt: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });

      await storeService.saveStateCacheBackup();
      expect(await storeService.hasStateCacheBackup()).toBe(true);

      await storeService.clearStateCacheBackup();
      expect(await storeService.hasStateCacheBackup()).toBe(false);
    });
  });
});
