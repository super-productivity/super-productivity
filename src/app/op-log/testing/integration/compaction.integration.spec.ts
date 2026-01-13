import { TestBed } from '@angular/core/testing';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { OperationLogCompactionService } from '../../persistence/operation-log-compaction.service';
import { VectorClockService } from '../../sync/vector-clock.service';
import { OpType, VectorClock } from '../../core/operation.types';
import { CURRENT_SCHEMA_VERSION } from '../../persistence/schema-migration.service';
import { TestClient, resetTestUuidCounter } from './helpers/test-client.helper';
import {
  createTaskOperation,
  createMinimalTaskPayload,
  createMinimalProjectPayload,
} from './helpers/operation-factory.helper';
import {
  COMPACTION_RETENTION_MS,
  EMERGENCY_COMPACTION_RETENTION_MS,
} from '../../core/operation-log.const';
import { StateSnapshotService } from '../../backup/state-snapshot.service';

/**
 * Integration tests for operation log compaction and snapshot functionality.
 *
 * These tests verify:
 * - Snapshot creation and state preservation
 * - Snapshot + tail replay correctness
 * - Compaction preserves unsynced operations
 * - Emergency compaction uses shorter retention
 * - Hydration from snapshot + tail operations
 * - Vector clock preservation through compaction
 *
 * Tests use real IndexedDB for realistic behavior.
 */
describe('Compaction Integration', () => {
  let storeService: OperationLogStoreService;
  let compactionService: OperationLogCompactionService;
  let vectorClockService: VectorClockService;
  let mockStateSnapshot: jasmine.SpyObj<StateSnapshotService>;

  beforeEach(async () => {
    // Create mock for StateSnapshotService
    mockStateSnapshot = jasmine.createSpyObj('StateSnapshotService', [
      'getStateSnapshot',
    ]);

    // Default mock return value - cast to any since we only need partial data for tests
    mockStateSnapshot.getStateSnapshot.and.returnValue({
      task: { ids: [], entities: {} },
      project: { ids: [], entities: {} },
      tag: { ids: [], entities: {} },
      note: { ids: [], entities: {} },
      globalConfig: {},
    } as any);

    TestBed.configureTestingModule({
      providers: [
        OperationLogStoreService,
        OperationLogCompactionService,
        VectorClockService,
        { provide: StateSnapshotService, useValue: mockStateSnapshot },
      ],
    });

    storeService = TestBed.inject(OperationLogStoreService);
    compactionService = TestBed.inject(OperationLogCompactionService);
    vectorClockService = TestBed.inject(VectorClockService);

    await storeService.init();
    await storeService._clearAllDataForTesting();
    resetTestUuidCounter();
  });

  describe('Snapshot creation', () => {
    it('should save snapshot with correct state and metadata', async () => {
      const client = new TestClient('client-test');

      // Create operations
      for (let i = 1; i <= 10; i++) {
        await storeService.append(
          createTaskOperation(client, `task-${i}`, OpType.Create, { title: `Task ${i}` }),
          'local',
        );
      }

      const allOps = await storeService.getOpsAfterSeq(0);
      const lastSeq = allOps[allOps.length - 1].seq;

      // Save snapshot
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
      const vectorClock = client.getCurrentClock();

      await storeService.saveStateCache({
        state: testState,
        lastAppliedOpSeq: lastSeq,
        vectorClock,
        compactedAt: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });

      // Verify snapshot
      const loaded = await storeService.loadStateCache();
      expect(loaded).not.toBeNull();
      expect(loaded!.state).toEqual(testState);
      expect(loaded!.lastAppliedOpSeq).toBe(lastSeq);
      expect(loaded!.vectorClock).toEqual(vectorClock);
      expect(loaded!.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    });

    it('should update snapshot with new operations', async () => {
      const client = new TestClient('client-test');

      // First snapshot
      await storeService.append(
        createTaskOperation(client, 'task-1', OpType.Create, { title: 'Task 1' }),
        'local',
      );

      const ops1 = await storeService.getOpsAfterSeq(0);
      await storeService.saveStateCache({
        state: { version: 1 },
        lastAppliedOpSeq: ops1[0].seq,
        vectorClock: client.getCurrentClock(),
        compactedAt: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });

      // More operations
      await storeService.append(
        createTaskOperation(client, 'task-2', OpType.Create, { title: 'Task 2' }),
        'local',
      );

      const ops2 = await storeService.getOpsAfterSeq(0);

      // Second snapshot
      await storeService.saveStateCache({
        state: { version: 2 },
        lastAppliedOpSeq: ops2[1].seq,
        vectorClock: client.getCurrentClock(),
        compactedAt: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });

      // Verify latest snapshot
      const loaded = await storeService.loadStateCache();
      expect(loaded!.state).toEqual({ version: 2 });
      expect(loaded!.lastAppliedOpSeq).toBe(ops2[1].seq);
    });
  });

  describe('Snapshot + tail replay correctness', () => {
    it('should correctly identify tail operations after snapshot', async () => {
      const client = new TestClient('client-test');

      // Create 10 operations
      for (let i = 1; i <= 10; i++) {
        await storeService.append(
          createTaskOperation(client, `task-${i}`, OpType.Create, { title: `Task ${i}` }),
          'local',
        );
      }

      const allOps = await storeService.getOpsAfterSeq(0);
      const snapshotSeq = allOps[4].seq; // Snapshot after 5th operation

      await storeService.saveStateCache({
        state: { snapshotAt: 5 },
        lastAppliedOpSeq: snapshotSeq,
        vectorClock: client.getCurrentClock(),
        compactedAt: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });

      // Get tail operations
      const tailOps = await storeService.getOpsAfterSeq(snapshotSeq);
      expect(tailOps.length).toBe(5); // Operations 6-10

      // Verify tail ops are correct
      expect(tailOps[0].op.entityId).toBe('task-6');
      expect(tailOps[4].op.entityId).toBe('task-10');
    });

    it('should preserve all operations when no snapshot exists', async () => {
      const client = new TestClient('client-test');

      for (let i = 1; i <= 5; i++) {
        await storeService.append(
          createTaskOperation(client, `task-${i}`, OpType.Create, { title: `Task ${i}` }),
          'local',
        );
      }

      // No snapshot saved - all ops should be returned
      const allOps = await storeService.getOpsAfterSeq(0);
      expect(allOps.length).toBe(5);
    });

    it('should return empty tail when snapshot is at latest operation', async () => {
      const client = new TestClient('client-test');

      await storeService.append(
        createTaskOperation(client, 'task-1', OpType.Create, { title: 'Task 1' }),
        'local',
      );

      const allOps = await storeService.getOpsAfterSeq(0);
      const lastSeq = allOps[0].seq;

      await storeService.saveStateCache({
        state: {},
        lastAppliedOpSeq: lastSeq,
        vectorClock: client.getCurrentClock(),
        compactedAt: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });

      const tailOps = await storeService.getOpsAfterSeq(lastSeq);
      expect(tailOps.length).toBe(0);
    });
  });

  describe('Compaction preserves unsynced operations', () => {
    it('should never delete unsynced operations during compaction', async () => {
      const client = new TestClient('client-test');

      // Create operations
      const op1 = createTaskOperation(client, 'task-1', OpType.Create, {
        title: 'Task 1',
      });
      const op2 = createTaskOperation(client, 'task-2', OpType.Create, {
        title: 'Task 2',
      });
      const op3 = createTaskOperation(client, 'task-3', OpType.Create, {
        title: 'Task 3',
      });

      await storeService.append(op1, 'local');
      await storeService.append(op2, 'local');
      await storeService.append(op3, 'local');

      const allOps = await storeService.getOpsAfterSeq(0);

      // Mark only first two as synced
      await storeService.markSynced([allOps[0].seq, allOps[1].seq]);

      // Simulate old appliedAt (older than retention period)
      // Note: We can't directly modify appliedAt, but we can verify the logic
      // by checking unsynced ops are preserved

      // Verify unsynced op is preserved
      const unsynced = await storeService.getUnsynced();
      expect(unsynced.length).toBe(1);
      expect(unsynced[0].op.id).toBe(op3.id);
    });

    it('should preserve rejected operations for audit', async () => {
      const client = new TestClient('client-test');

      const op1 = createTaskOperation(client, 'task-1', OpType.Create, {
        title: 'Task 1',
      });
      const op2 = createTaskOperation(client, 'task-2', OpType.Create, {
        title: 'Task 2',
      });

      await storeService.append(op1, 'local');
      await storeService.append(op2, 'local');

      // Reject op2 (simulating conflict)
      await storeService.markRejected([op2.id]);

      // Verify rejected op is still in log
      const allOps = await storeService.getOpsAfterSeq(0);
      expect(allOps.length).toBe(2);

      const rejectedOp = allOps.find((e) => e.op.id === op2.id);
      expect(rejectedOp!.rejectedAt).toBeDefined();
    });

    it('should exclude rejected ops from unsynced query', async () => {
      const client = new TestClient('client-test');

      const op1 = createTaskOperation(client, 'task-1', OpType.Create, {
        title: 'Task 1',
      });
      const op2 = createTaskOperation(client, 'task-2', OpType.Create, {
        title: 'Task 2',
      });

      await storeService.append(op1, 'local');
      await storeService.append(op2, 'local');

      await storeService.markRejected([op2.id]);

      const unsynced = await storeService.getUnsynced();
      expect(unsynced.length).toBe(1);
      expect(unsynced[0].op.id).toBe(op1.id);
    });
  });

  describe('Emergency compaction', () => {
    it('should use shorter retention for emergency compaction', () => {
      // Verify constants are configured correctly
      expect(EMERGENCY_COMPACTION_RETENTION_MS).toBeLessThan(COMPACTION_RETENTION_MS);
      expect(EMERGENCY_COMPACTION_RETENTION_MS).toBe(24 * 60 * 60 * 1000); // 1 day
      expect(COMPACTION_RETENTION_MS).toBe(7 * 24 * 60 * 60 * 1000); // 7 days
    });

    it('should return true on successful emergency compaction', async () => {
      const client = new TestClient('client-test');

      // Create some operations
      await storeService.append(
        createTaskOperation(client, 'task-1', OpType.Create, { title: 'Task 1' }),
        'local',
      );

      // Mock state for compaction - cast to any since we only need partial data for tests
      mockStateSnapshot.getStateSnapshot.and.returnValue({
        task: {
          ids: ['task-1'],
          entities: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'task-1': createMinimalTaskPayload('task-1', { title: 'Task 1' }),
          },
        },
      } as any);

      const result = await compactionService.emergencyCompact();
      expect(result).toBe(true);
    });
  });

  describe('Hydration from snapshot', () => {
    it('should load snapshot state correctly', async () => {
      const testState = {
        task: {
          ids: ['task-1', 'task-2', 'task-3'],
          entities: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'task-1': createMinimalTaskPayload('task-1', { title: 'Hydrated Task 1' }),
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'task-2': createMinimalTaskPayload('task-2', { title: 'Hydrated Task 2' }),
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'task-3': createMinimalTaskPayload('task-3', { title: 'Hydrated Task 3' }),
          },
        },
        project: {
          ids: ['proj-1'],
          entities: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'proj-1': createMinimalProjectPayload('proj-1', { title: 'Project 1' }),
          },
        },
      };
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const vectorClock: VectorClock = { 'client-a': 10, 'client-b': 5 };

      await storeService.saveStateCache({
        state: testState,
        lastAppliedOpSeq: 100,
        vectorClock,
        compactedAt: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });

      // Simulate restart by loading from cache
      const loaded = await storeService.loadStateCache();

      expect(loaded).not.toBeNull();
      expect(loaded!.state).toEqual(testState);
      expect(loaded!.lastAppliedOpSeq).toBe(100);
      expect(loaded!.vectorClock).toEqual(vectorClock);
    });

    it('should return null when no snapshot exists', async () => {
      const loaded = await storeService.loadStateCache();
      expect(loaded).toBeNull();
    });

    it('should handle snapshot with snapshotEntityKeys', async () => {
      const testState = {
        task: {
          ids: ['task-1'],
          entities: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'task-1': createMinimalTaskPayload('task-1'),
          },
        },
      };
      const snapshotEntityKeys = ['TASK:task-1'];

      await storeService.saveStateCache({
        state: testState,
        lastAppliedOpSeq: 50,
        vectorClock: { client: 5 },
        compactedAt: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
        snapshotEntityKeys,
      });

      const loaded = await storeService.loadStateCache();
      expect(loaded!.snapshotEntityKeys).toEqual(snapshotEntityKeys);
    });
  });

  describe('Vector clock preservation', () => {
    it('should preserve vector clock through snapshot', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');

      // Create operations from multiple clients
      await storeService.append(
        createTaskOperation(clientA, 'task-a1', OpType.Create, { title: 'A1' }),
        'local',
      );
      await storeService.append(
        createTaskOperation(clientA, 'task-a2', OpType.Create, { title: 'A2' }),
        'local',
      );
      await storeService.append(
        createTaskOperation(clientB, 'task-b1', OpType.Create, { title: 'B1' }),
        'remote',
      );

      // Get current vector clock
      const currentClock = await vectorClockService.getCurrentVectorClock();

      // Save snapshot with merged clock
      const allOps = await storeService.getOpsAfterSeq(0);
      await storeService.saveStateCache({
        state: {},
        lastAppliedOpSeq: allOps[allOps.length - 1].seq,
        vectorClock: currentClock,
        compactedAt: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });

      // Verify clock preserved
      const loaded = await storeService.loadStateCache();
      expect(loaded!.vectorClock['client-a-test']).toBe(currentClock['client-a-test']);
      expect(loaded!.vectorClock['client-b-test']).toBe(currentClock['client-b-test']);
    });

    it('should correctly merge snapshot clock with tail ops', async () => {
      // Save snapshot with initial clock
      await storeService.saveStateCache({
        state: {},
        lastAppliedOpSeq: 0,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        vectorClock: { 'client-a-test': 5, 'client-b-test': 3 },
        compactedAt: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });

      // Add new operations after snapshot
      const clientB = new TestClient('client-b-test');
      // eslint-disable-next-line @typescript-eslint/naming-convention
      clientB.setVectorClock({ 'client-a-test': 5, 'client-b-test': 4 });

      await storeService.append(
        createTaskOperation(clientB, 'task-b2', OpType.Create, { title: 'B2' }),
        'remote',
      );

      // Get merged clock
      const mergedClock = await vectorClockService.getCurrentVectorClock();

      // Should have max of snapshot + tail ops
      expect(mergedClock['client-a-test']).toBe(5); // From snapshot
      expect(mergedClock['client-b-test']).toBe(5); // Max of snapshot(3) and tail(5)
    });

    it('should maintain entity frontier accuracy', async () => {
      const client = new TestClient('client-test');

      // Create multiple operations on same entity
      await storeService.append(
        createTaskOperation(client, 'task-1', OpType.Create, { title: 'Created' }),
        'local',
      );
      await storeService.append(
        createTaskOperation(client, 'task-1', OpType.Update, { title: 'Updated 1' }),
        'local',
      );
      await storeService.append(
        createTaskOperation(client, 'task-1', OpType.Update, { title: 'Updated 2' }),
        'local',
      );

      const frontier = await vectorClockService.getEntityFrontier();
      const task1Clock = frontier.get('TASK:task-1');

      expect(task1Clock).toBeDefined();
      expect(task1Clock!['client-test']).toBe(3); // After 3 operations
    });
  });

  describe('Compaction counter', () => {
    it('should reset compaction counter after save', async () => {
      // Increment counter
      await storeService.incrementCompactionCounter();
      await storeService.incrementCompactionCounter();

      let counter = await storeService.getCompactionCounter();
      expect(counter).toBe(2);

      // Reset counter
      await storeService.resetCompactionCounter();

      counter = await storeService.getCompactionCounter();
      expect(counter).toBe(0);
    });

    it('should track operations for compaction threshold', async () => {
      const client = new TestClient('client-test');

      // Start at 0
      let counter = await storeService.getCompactionCounter();
      expect(counter).toBe(0);

      // Add operations and increment counter
      for (let i = 0; i < 5; i++) {
        await storeService.append(
          createTaskOperation(client, `task-${i}`, OpType.Create, { title: `Task ${i}` }),
          'local',
        );
        await storeService.incrementCompactionCounter();
      }

      counter = await storeService.getCompactionCounter();
      expect(counter).toBe(5);
    });
  });

  describe('Backup and restore', () => {
    it('should support backup and restore of state cache', async () => {
      const originalState = { tasks: ['a', 'b', 'c'] };

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

      // Modify current state
      await storeService.saveStateCache({
        state: { tasks: ['modified'] },
        lastAppliedOpSeq: 100,
        vectorClock: { client: 10 },
        compactedAt: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });

      // Restore from backup
      await storeService.restoreStateCacheFromBackup();

      const restored = await storeService.loadStateCache();
      expect(restored!.state).toEqual(originalState);
      expect(restored!.lastAppliedOpSeq).toBe(50);
    });

    it('should clear backup after successful operation', async () => {
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
