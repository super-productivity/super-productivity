import { TestBed } from '@angular/core/testing';
import { OperationLogStoreService } from './operation-log-store.service';
import { VectorClockService } from '../sync/vector-clock.service';
import {
  ActionType,
  Operation,
  OpType,
  EntityType,
  VectorClock,
} from '../core/operation.types';
import { uuidv7 } from '../../util/uuid-v7';

describe('OperationLogStoreService', () => {
  let service: OperationLogStoreService;
  let vectorClockService: VectorClockService;

  // Helper to create test operations
  const createTestOperation = (overrides: Partial<Operation> = {}): Operation => ({
    id: uuidv7(),
    actionType: '[Task] Update' as ActionType,
    opType: OpType.Update,
    entityType: 'TASK' as EntityType,
    entityId: 'task1',
    payload: { title: 'Test Task' },
    clientId: 'testClient',
    vectorClock: { testClient: 1 },
    timestamp: Date.now(),
    schemaVersion: 1,
    ...overrides,
  });

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [OperationLogStoreService, VectorClockService],
    });
    service = TestBed.inject(OperationLogStoreService);
    vectorClockService = TestBed.inject(VectorClockService);
    await service.init();
    // Clear all data from previous tests to ensure test isolation
    await service._clearAllDataForTesting();
  });

  describe('initialization', () => {
    it('should initialize successfully', () => {
      expect(service).toBeTruthy();
    });

    it('should handle concurrent initialization calls safely', async () => {
      // Create a new service instance
      const newService = new OperationLogStoreService();

      // Call init multiple times concurrently
      const initPromises = [newService.init(), newService.init(), newService.init()];

      // All should resolve without error
      await expectAsync(Promise.all(initPromises)).toBeResolved();
    });
  });

  describe('append', () => {
    it('should append operation to log', async () => {
      const op = createTestOperation();
      await service.append(op);

      const ops = await service.getOpsAfterSeq(0);
      expect(ops.length).toBe(1);
      expect(ops[0].op.id).toBe(op.id);
    });

    it('should auto-increment sequence number', async () => {
      const op1 = createTestOperation({ entityId: 'task1' });
      const op2 = createTestOperation({ entityId: 'task2' });
      const op3 = createTestOperation({ entityId: 'task3' });

      await service.append(op1);
      await service.append(op2);
      await service.append(op3);

      const ops = await service.getOpsAfterSeq(0);
      expect(ops.length).toBe(3);
      expect(ops[0].seq).toBeLessThan(ops[1].seq);
      expect(ops[1].seq).toBeLessThan(ops[2].seq);
    });

    it('should set appliedAt timestamp', async () => {
      const beforeTime = Date.now();
      const op = createTestOperation();
      await service.append(op);
      const afterTime = Date.now();

      const ops = await service.getOpsAfterSeq(0);
      expect(ops[0].appliedAt).toBeGreaterThanOrEqual(beforeTime);
      expect(ops[0].appliedAt).toBeLessThanOrEqual(afterTime);
    });

    it('should set source to local by default', async () => {
      const op = createTestOperation();
      await service.append(op);

      const ops = await service.getOpsAfterSeq(0);
      expect(ops[0].source).toBe('local');
      expect(ops[0].syncedAt).toBeUndefined();
    });

    it('should set syncedAt when source is remote', async () => {
      const op = createTestOperation();
      await service.append(op, 'remote');

      const ops = await service.getOpsAfterSeq(0);
      expect(ops[0].source).toBe('remote');
      expect(ops[0].syncedAt).toBeDefined();
    });
  });

  describe('hasOp', () => {
    it('should return true for existing operations', async () => {
      const op = createTestOperation();
      await service.append(op);

      expect(await service.hasOp(op.id)).toBe(true);
    });

    it('should return false for non-existing operations', async () => {
      expect(await service.hasOp('nonExistentId')).toBe(false);
    });
  });

  describe('filterNewOps', () => {
    it('should return all ops when none exist in store', async () => {
      const op1 = createTestOperation({ entityId: 'task1' });
      const op2 = createTestOperation({ entityId: 'task2' });

      const result = await service.filterNewOps([op1, op2]);

      expect(result.length).toBe(2);
      expect(result).toContain(op1);
      expect(result).toContain(op2);
    });

    it('should filter out ops that already exist', async () => {
      const existingOp = createTestOperation({ entityId: 'existing' });
      const newOp = createTestOperation({ entityId: 'new' });

      await service.append(existingOp);

      const result = await service.filterNewOps([existingOp, newOp]);

      expect(result.length).toBe(1);
      expect(result[0].id).toBe(newOp.id);
    });

    it('should return empty array when all ops exist', async () => {
      const op1 = createTestOperation({ entityId: 'task1' });
      const op2 = createTestOperation({ entityId: 'task2' });

      await service.append(op1);
      await service.append(op2);

      const result = await service.filterNewOps([op1, op2]);

      expect(result.length).toBe(0);
    });

    it('should return empty array for empty input', async () => {
      const result = await service.filterNewOps([]);
      expect(result.length).toBe(0);
    });
  });

  describe('getOpsAfterSeq', () => {
    it('should return all operations after given sequence', async () => {
      const op1 = createTestOperation({ entityId: 'task1' });
      const op2 = createTestOperation({ entityId: 'task2' });
      const op3 = createTestOperation({ entityId: 'task3' });

      await service.append(op1);
      await service.append(op2);
      await service.append(op3);

      const allOps = await service.getOpsAfterSeq(0);
      expect(allOps.length).toBe(3);

      // Get ops after the first one
      const opsAfterFirst = await service.getOpsAfterSeq(allOps[0].seq);
      expect(opsAfterFirst.length).toBe(2);
    });

    it('should return empty array if no ops after sequence', async () => {
      const op = createTestOperation();
      await service.append(op);

      const ops = await service.getOpsAfterSeq(0);
      const opsAfterLast = await service.getOpsAfterSeq(ops[0].seq);
      expect(opsAfterLast.length).toBe(0);
    });
  });

  describe('getUnsynced', () => {
    it('should return only unsynced local operations', async () => {
      const localOp = createTestOperation({ entityId: 'localTask' });
      const remoteOp = createTestOperation({ entityId: 'remoteTask' });

      await service.append(localOp, 'local');
      await service.append(remoteOp, 'remote');

      const unsynced = await service.getUnsynced();
      expect(unsynced.length).toBe(1);
      expect(unsynced[0].op.entityId).toBe('localTask');
    });

    it('should exclude rejected operations', async () => {
      const op1 = createTestOperation({ entityId: 'task1' });
      const op2 = createTestOperation({ entityId: 'task2' });

      await service.append(op1);
      await service.append(op2);
      await service.markRejected([op1.id]);

      const unsynced = await service.getUnsynced();
      expect(unsynced.length).toBe(1);
      expect(unsynced[0].op.entityId).toBe('task2');
    });
  });

  describe('getUnsyncedByEntity', () => {
    it('should group unsynced ops by entity', async () => {
      const taskOp1 = createTestOperation({
        entityType: 'TASK' as EntityType,
        entityId: 'task1',
      });
      const taskOp2 = createTestOperation({
        entityType: 'TASK' as EntityType,
        entityId: 'task1',
      });
      const projectOp = createTestOperation({
        entityType: 'PROJECT' as EntityType,
        entityId: 'proj1',
      });

      await service.append(taskOp1);
      await service.append(taskOp2);
      await service.append(projectOp);

      const unsyncedByEntity = await service.getUnsyncedByEntity();
      expect(unsyncedByEntity.get('TASK:task1')?.length).toBe(2);
      expect(unsyncedByEntity.get('PROJECT:proj1')?.length).toBe(1);
    });
  });

  describe('getAppliedOpIds', () => {
    it('should return set of all operation IDs', async () => {
      const op1 = createTestOperation({ entityId: 'task1' });
      const op2 = createTestOperation({ entityId: 'task2' });

      await service.append(op1);
      await service.append(op2);

      const appliedIds = await service.getAppliedOpIds();
      expect(appliedIds.has(op1.id)).toBe(true);
      expect(appliedIds.has(op2.id)).toBe(true);
      expect(appliedIds.size).toBe(2);
    });
  });

  describe('markSynced', () => {
    it('should update syncedAt timestamp for given sequences', async () => {
      const op1 = createTestOperation({ entityId: 'task1' });
      const op2 = createTestOperation({ entityId: 'task2' });

      await service.append(op1);
      await service.append(op2);

      const ops = await service.getOpsAfterSeq(0);
      expect(ops[0].syncedAt).toBeUndefined();

      await service.markSynced([ops[0].seq]);

      const opsAfterMark = await service.getOpsAfterSeq(0);
      expect(opsAfterMark[0].syncedAt).toBeDefined();
      expect(opsAfterMark[1].syncedAt).toBeUndefined();
    });
  });

  describe('markRejected', () => {
    it('should update rejectedAt timestamp for given operation IDs', async () => {
      const op = createTestOperation();
      await service.append(op);

      const opsBefore = await service.getOpsAfterSeq(0);
      expect(opsBefore[0].rejectedAt).toBeUndefined();

      await service.markRejected([op.id]);

      const opsAfter = await service.getOpsAfterSeq(0);
      expect(opsAfter[0].rejectedAt).toBeDefined();
    });
  });

  describe('deleteOpsWhere', () => {
    it('should delete operations matching predicate', async () => {
      const op1 = createTestOperation({ actionType: '[Task] Create' as ActionType });
      const op2 = createTestOperation({ actionType: '[Task] Update' as ActionType });
      const op3 = createTestOperation({ actionType: '[Task] Create' as ActionType });

      await service.append(op1);
      await service.append(op2);
      await service.append(op3);

      await service.deleteOpsWhere(
        (entry) => entry.op.actionType === ('[Task] Create' as ActionType),
      );

      const remaining = await service.getOpsAfterSeq(0);
      expect(remaining.length).toBe(1);
      expect(remaining[0].op.actionType).toBe('[Task] Update' as ActionType);
    });
  });

  describe('getLastSeq', () => {
    it('should return 0 when no operations exist', async () => {
      const lastSeq = await service.getLastSeq();
      expect(lastSeq).toBe(0);
    });

    it('should return last sequence number', async () => {
      const op1 = createTestOperation({ entityId: 'task1' });
      const op2 = createTestOperation({ entityId: 'task2' });

      await service.append(op1);
      await service.append(op2);

      const allOps = await service.getOpsAfterSeq(0);
      const lastSeq = await service.getLastSeq();
      expect(lastSeq).toBe(allOps[allOps.length - 1].seq);
    });
  });

  describe('state cache', () => {
    it('should save and load state cache', async () => {
      const testState = { task: { ids: ['1'], entities: { id1: { id: '1' } } } };
      const vectorClock: VectorClock = { client1: 5 };

      await service.saveStateCache({
        state: testState,
        lastAppliedOpSeq: 100,
        vectorClock,
        compactedAt: Date.now(),
        schemaVersion: 1,
      });

      const loaded = await service.loadStateCache();
      expect(loaded).not.toBeNull();
      expect(loaded!.state).toEqual(testState);
      expect(loaded!.lastAppliedOpSeq).toBe(100);
      expect(loaded!.vectorClock).toEqual(vectorClock);
    });

    it('should return null when no state cache exists', async () => {
      const loaded = await service.loadStateCache();
      expect(loaded).toBeNull();
    });
  });

  describe('migration safety backup', () => {
    it('should save and restore backup', async () => {
      const testState = { task: { ids: ['1'], entities: {} } };

      await service.saveStateCache({
        state: testState,
        lastAppliedOpSeq: 50,
        vectorClock: { client1: 3 },
        compactedAt: Date.now(),
        schemaVersion: 1,
      });

      await service.saveStateCacheBackup();
      expect(await service.hasStateCacheBackup()).toBe(true);

      // Modify current state
      await service.saveStateCache({
        state: { modified: true },
        lastAppliedOpSeq: 100,
        vectorClock: { client1: 10 },
        compactedAt: Date.now(),
        schemaVersion: 2,
      });

      // Restore backup
      await service.restoreStateCacheFromBackup();

      const restored = await service.loadStateCache();
      expect(restored!.lastAppliedOpSeq).toBe(50);
      expect(restored!.state).toEqual(testState);
    });

    it('should clear backup after successful operation', async () => {
      const testState = { task: { ids: [], entities: {} } };

      await service.saveStateCache({
        state: testState,
        lastAppliedOpSeq: 10,
        vectorClock: {},
        compactedAt: Date.now(),
      });

      await service.saveStateCacheBackup();
      expect(await service.hasStateCacheBackup()).toBe(true);

      await service.clearStateCacheBackup();
      expect(await service.hasStateCacheBackup()).toBe(false);
    });
  });

  describe('compaction counter', () => {
    it('should start at 0 when no state cache exists', async () => {
      const count = await service.getCompactionCounter();
      expect(count).toBe(0);
    });

    it('should increment counter', async () => {
      await service.saveStateCache({
        state: {},
        lastAppliedOpSeq: 0,
        vectorClock: {},
        compactedAt: Date.now(),
      });

      const count1 = await service.incrementCompactionCounter();
      expect(count1).toBe(1);

      const count2 = await service.incrementCompactionCounter();
      expect(count2).toBe(2);

      const count3 = await service.getCompactionCounter();
      expect(count3).toBe(2);
    });

    it('should persist counter when no state cache exists (regression test)', async () => {
      // This tests the fix for the bug where incrementCompactionCounter()
      // returned 1 without persisting when no cache existed.
      // Without the fix, each call would return 1 (counter never progressed).

      // No state cache exists yet - verify counter starts at 0
      expect(await service.getCompactionCounter()).toBe(0);

      // First increment should return 1 AND persist it
      const count1 = await service.incrementCompactionCounter();
      expect(count1).toBe(1);

      // Verify it was actually persisted
      const persistedCount1 = await service.getCompactionCounter();
      expect(persistedCount1).toBe(1);

      // Second increment should return 2 (not 1 again!)
      const count2 = await service.incrementCompactionCounter();
      expect(count2).toBe(2);

      // Verify it was persisted
      const persistedCount2 = await service.getCompactionCounter();
      expect(persistedCount2).toBe(2);

      // Third increment to be sure
      const count3 = await service.incrementCompactionCounter();
      expect(count3).toBe(3);
    });

    it('should reset counter', async () => {
      await service.saveStateCache({
        state: {},
        lastAppliedOpSeq: 0,
        vectorClock: {},
        compactedAt: Date.now(),
      });

      await service.incrementCompactionCounter();
      await service.incrementCompactionCounter();
      await service.resetCompactionCounter();

      const count = await service.getCompactionCounter();
      expect(count).toBe(0);
    });

    // =========================================================================
    // Regression test: incrementCompactionCounter counter-only cache handling
    // =========================================================================
    // When incrementCompactionCounter creates a cache entry just to track the
    // counter, loadStateCache should return null since there's no valid snapshot.
    // This prevents unnecessary recovery paths on startup.

    it('should not expose invalid snapshot when incrementCompactionCounter creates counter-only cache', async () => {
      // No state cache exists yet
      const beforeCache = await service.loadStateCache();
      expect(beforeCache).toBeNull();

      // Increment the compaction counter (simulating operation writes before first compaction)
      await service.incrementCompactionCounter();

      // Now check what loadStateCache returns
      const afterCache = await service.loadStateCache();

      // loadStateCache should return null since the cache has state: null
      // (counter-only entry, not a real snapshot)
      expect(afterCache).toBeNull();
    });

    it('should still track compaction counter even when loadStateCache returns null', async () => {
      // Increment counter without a real snapshot existing
      await service.incrementCompactionCounter();
      await service.incrementCompactionCounter();
      await service.incrementCompactionCounter();

      // loadStateCache returns null (no valid snapshot)
      const cache = await service.loadStateCache();
      expect(cache).toBeNull();

      // But the counter should still be tracked correctly
      const counter = await service.getCompactionCounter();
      expect(counter).toBe(3);
    });
  });

  describe('VectorClockService.getCurrentVectorClock', () => {
    it('should return empty clock when no data exists', async () => {
      const clock = await vectorClockService.getCurrentVectorClock();
      expect(clock).toEqual({});
    });

    it('should merge clocks from snapshot and ops', async () => {
      // Save snapshot with initial clock
      await service.saveStateCache({
        state: {},
        lastAppliedOpSeq: 0,
        vectorClock: { clientA: 5, clientB: 3 },
        compactedAt: Date.now(),
      });

      // Add ops with newer clocks
      const op1 = createTestOperation({
        clientId: 'clientA',
        vectorClock: { clientA: 6, clientB: 3 },
      });
      const op2 = createTestOperation({
        clientId: 'clientB',
        vectorClock: { clientA: 6, clientB: 4 },
      });

      await service.append(op1);
      await service.append(op2);

      const clock = await vectorClockService.getCurrentVectorClock();
      expect(clock.clientA).toBe(6);
      expect(clock.clientB).toBe(4);
    });
  });

  describe('VectorClockService.getEntityFrontier', () => {
    it('should return empty map when no ops exist', async () => {
      const frontier = await vectorClockService.getEntityFrontier();
      expect(frontier.size).toBe(0);
    });

    it('should return frontier per entity', async () => {
      const op1 = createTestOperation({
        entityType: 'TASK' as EntityType,
        entityId: 'task1',
        vectorClock: { clientA: 1 },
      });
      const op2 = createTestOperation({
        entityType: 'TASK' as EntityType,
        entityId: 'task1',
        vectorClock: { clientA: 2 },
      });
      const op3 = createTestOperation({
        entityType: 'PROJECT' as EntityType,
        entityId: 'proj1',
        vectorClock: { clientA: 3 },
      });

      await service.append(op1);
      await service.append(op2);
      await service.append(op3);

      const frontier = await vectorClockService.getEntityFrontier();
      expect(frontier.get('TASK:task1')).toEqual({ clientA: 2 }); // Latest for task1
      expect(frontier.get('PROJECT:proj1')).toEqual({ clientA: 3 });
    });

    it('should filter by entity type and id when provided', async () => {
      const op1 = createTestOperation({
        entityType: 'TASK' as EntityType,
        entityId: 'task1',
        vectorClock: { clientA: 1 },
      });
      const op2 = createTestOperation({
        entityType: 'PROJECT' as EntityType,
        entityId: 'proj1',
        vectorClock: { clientA: 2 },
      });

      await service.append(op1);
      await service.append(op2);

      const taskFrontier = await vectorClockService.getEntityFrontier(
        'TASK' as EntityType,
      );
      expect(taskFrontier.size).toBe(1);
      expect(taskFrontier.has('TASK:task1')).toBe(true);
      expect(taskFrontier.has('PROJECT:proj1')).toBe(false);
    });
  });

  describe('transaction atomicity', () => {
    it('should maintain consistency after failed saveStateCache', async () => {
      const op = createTestOperation();
      await service.append(op);

      // Save initial state cache
      await service.saveStateCache({
        state: { initial: true },
        lastAppliedOpSeq: 1,
        vectorClock: { client: 1 },
        compactedAt: Date.now(),
        schemaVersion: 1,
      });

      // Operations should still be accessible
      const ops = await service.getOpsAfterSeq(0);
      expect(ops.length).toBe(1);
      expect(ops[0].op.id).toBe(op.id);
    });

    it('should handle concurrent append operations safely', async () => {
      const ops = Array.from({ length: 10 }, (_, i) =>
        createTestOperation({ entityId: `task-${i}` }),
      );

      // Append all concurrently
      await Promise.all(ops.map((op) => service.append(op)));

      const storedOps = await service.getOpsAfterSeq(0);
      expect(storedOps.length).toBe(10);

      // All should have unique sequence numbers
      const seqNumbers = storedOps.map((op) => op.seq);
      const uniqueSeqs = new Set(seqNumbers);
      expect(uniqueSeqs.size).toBe(10);
    });

    it('should handle concurrent markSynced operations safely', async () => {
      const ops = Array.from({ length: 5 }, (_, i) =>
        createTestOperation({ entityId: `task-${i}` }),
      );

      for (const op of ops) {
        await service.append(op);
      }

      const storedOps = await service.getOpsAfterSeq(0);
      const seqNumbers = storedOps.map((op) => op.seq);

      // Mark synced concurrently
      await Promise.all(seqNumbers.map((seq) => service.markSynced([seq])));

      // All should be synced
      const afterSync = await service.getOpsAfterSeq(0);
      for (const entry of afterSync) {
        expect(entry.syncedAt).toBeDefined();
      }
    });
  });

  describe('appendBatch', () => {
    it('should append multiple operations in a single transaction', async () => {
      const ops = [
        createTestOperation({ entityId: 'task1' }),
        createTestOperation({ entityId: 'task2' }),
        createTestOperation({ entityId: 'task3' }),
      ];

      const seqs = await service.appendBatch(ops);

      expect(seqs.length).toBe(3);
      const storedOps = await service.getOpsAfterSeq(0);
      expect(storedOps.length).toBe(3);
    });

    it('should return sequential sequence numbers', async () => {
      const ops = [
        createTestOperation({ entityId: 'task1' }),
        createTestOperation({ entityId: 'task2' }),
      ];

      const seqs = await service.appendBatch(ops);

      expect(seqs[1]).toBe(seqs[0] + 1);
    });

    it('should set source and syncedAt for remote batch', async () => {
      const ops = [
        createTestOperation({ entityId: 'task1' }),
        createTestOperation({ entityId: 'task2' }),
      ];

      await service.appendBatch(ops, 'remote');

      const storedOps = await service.getOpsAfterSeq(0);
      expect(storedOps[0].source).toBe('remote');
      expect(storedOps[0].syncedAt).toBeDefined();
      expect(storedOps[1].source).toBe('remote');
      expect(storedOps[1].syncedAt).toBeDefined();
    });

    it('should set applicationStatus to pending when pendingApply is true', async () => {
      const ops = [createTestOperation({ entityId: 'task1' })];

      await service.appendBatch(ops, 'remote', { pendingApply: true });

      const storedOps = await service.getOpsAfterSeq(0);
      expect(storedOps[0].applicationStatus).toBe('pending');
    });

    it('should handle empty array', async () => {
      const seqs = await service.appendBatch([]);

      expect(seqs).toEqual([]);
    });
  });

  describe('getOpById', () => {
    it('should return operation entry by ID', async () => {
      const op = createTestOperation();
      await service.append(op);

      const entry = await service.getOpById(op.id);

      expect(entry).toBeDefined();
      expect(entry!.op.id).toBe(op.id);
    });

    it('should return undefined for non-existent ID', async () => {
      const entry = await service.getOpById('non-existent-id');

      expect(entry).toBeUndefined();
    });
  });

  describe('markApplied', () => {
    it('should update applicationStatus from pending to applied', async () => {
      const op = createTestOperation();
      const seq = await service.append(op, 'remote', { pendingApply: true });

      const before = await service.getOpsAfterSeq(0);
      expect(before[0].applicationStatus).toBe('pending');

      await service.markApplied([seq]);

      const after = await service.getOpsAfterSeq(0);
      expect(after[0].applicationStatus).toBe('applied');
    });

    it('should not change status if not pending', async () => {
      const op = createTestOperation();
      const seq = await service.append(op, 'remote'); // Not pending

      await service.markApplied([seq]);

      const after = await service.getOpsAfterSeq(0);
      expect(after[0].applicationStatus).toBe('applied'); // Was already applied
    });

    it('should handle empty array', async () => {
      await service.markApplied([]);
      // Should not throw
    });

    // =========================================================================
    // Regression test: markApplied should handle both 'pending' and 'failed' status
    // =========================================================================
    // When retryFailedRemoteOps() successfully applies a failed op, it calls
    // markApplied() to clear it. markApplied() must handle both 'pending' and
    // 'failed' status transitions to 'applied'.

    it('should update applicationStatus from failed to applied', async () => {
      // Create an op and mark it as pending
      const op = createTestOperation();
      const seq = await service.append(op, 'remote', { pendingApply: true });

      // Mark it as failed (simulating a failed application attempt)
      await service.markFailed([op.id]);

      // Verify it's now in 'failed' status
      const afterFail = await service.getOpsAfterSeq(0);
      expect(afterFail[0].applicationStatus).toBe('failed');

      // Now try to mark it as applied (simulating a successful retry)
      await service.markApplied([seq]);

      // The status should transition from 'failed' to 'applied'
      const afterMarkApplied = await service.getOpsAfterSeq(0);
      expect(afterMarkApplied[0].applicationStatus).toBe('applied');
    });

    it('should remove failed ops from getFailedRemoteOps after markApplied is called', async () => {
      // Create an op and mark it as pending
      const op = createTestOperation();
      await service.append(op, 'remote', { pendingApply: true });

      // Mark it as failed
      await service.markFailed([op.id]);

      // Verify it appears in failed ops
      const failedBefore = await service.getFailedRemoteOps();
      expect(failedBefore.length).toBe(1);

      // Get the seq from failed ops
      const seq = failedBefore[0].seq;

      // Call markApplied (simulating successful retry)
      await service.markApplied([seq]);

      // The op should no longer appear in failed ops
      const failedAfter = await service.getFailedRemoteOps();
      expect(failedAfter.length).toBe(0);
    });
  });

  describe('getPendingRemoteOps', () => {
    it('should return only pending remote operations', async () => {
      const localOp = createTestOperation({ entityId: 'local' });
      const remoteApplied = createTestOperation({ entityId: 'applied' });
      const remotePending = createTestOperation({ entityId: 'pending' });

      await service.append(localOp, 'local');
      await service.append(remoteApplied, 'remote'); // applied by default
      await service.append(remotePending, 'remote', { pendingApply: true });

      const pending = await service.getPendingRemoteOps();

      expect(pending.length).toBe(1);
      expect(pending[0].op.entityId).toBe('pending');
    });

    it('should return empty array when no pending ops', async () => {
      const op = createTestOperation();
      await service.append(op, 'remote');

      const pending = await service.getPendingRemoteOps();

      expect(pending.length).toBe(0);
    });
  });

  describe('markFailed', () => {
    it('should increment retry count', async () => {
      const op = createTestOperation();
      await service.append(op, 'remote', { pendingApply: true });

      await service.markFailed([op.id]);

      const ops = await service.getOpsAfterSeq(0);
      expect(ops[0].retryCount).toBe(1);
      expect(ops[0].applicationStatus).toBe('failed');
    });

    it('should increment retry count on subsequent failures', async () => {
      const op = createTestOperation();
      await service.append(op, 'remote', { pendingApply: true });

      await service.markFailed([op.id]);
      await service.markFailed([op.id]);
      await service.markFailed([op.id]);

      const ops = await service.getOpsAfterSeq(0);
      expect(ops[0].retryCount).toBe(3);
    });

    it('should mark as rejected when max retries reached', async () => {
      const op = createTestOperation();
      await service.append(op, 'remote', { pendingApply: true });

      await service.markFailed([op.id], 3); // maxRetries = 3
      await service.markFailed([op.id], 3);
      await service.markFailed([op.id], 3); // 3rd failure = rejected

      const ops = await service.getOpsAfterSeq(0);
      expect(ops[0].rejectedAt).toBeDefined();
      expect(ops[0].applicationStatus).toBeUndefined();
    });

    it('should handle empty array', async () => {
      await service.markFailed([]);
      // Should not throw
    });
  });

  describe('getFailedRemoteOps', () => {
    it('should return only failed remote operations', async () => {
      const pending = createTestOperation({ entityId: 'pending' });
      const failed = createTestOperation({ entityId: 'failed' });
      const rejected = createTestOperation({ entityId: 'rejected' });

      await service.append(pending, 'remote', { pendingApply: true });
      await service.append(failed, 'remote', { pendingApply: true });
      await service.append(rejected, 'remote', { pendingApply: true });

      await service.markFailed([failed.id]);
      await service.markRejected([rejected.id]);

      const failedOps = await service.getFailedRemoteOps();

      expect(failedOps.length).toBe(1);
      expect(failedOps[0].op.entityId).toBe('failed');
    });

    it('should return empty array when no failed ops', async () => {
      const op = createTestOperation();
      await service.append(op, 'remote');

      const failed = await service.getFailedRemoteOps();

      expect(failed.length).toBe(0);
    });
  });

  describe('crash recovery scenarios', () => {
    it('should allow recovering pending ops after simulated crash', async () => {
      // Simulate: ops stored as pending but never marked applied (crash before dispatch)
      const op1 = createTestOperation({ entityId: 'task1' });
      const op2 = createTestOperation({ entityId: 'task2' });

      await service.appendBatch([op1, op2], 'remote', { pendingApply: true });

      // Simulating "restart" - get pending ops for recovery
      const pending = await service.getPendingRemoteOps();

      expect(pending.length).toBe(2);
      expect(pending.map((p) => p.op.entityId).sort()).toEqual(['task1', 'task2']);
    });

    it('should track partial application progress', async () => {
      const ops = [
        createTestOperation({ entityId: 'task1' }),
        createTestOperation({ entityId: 'task2' }),
        createTestOperation({ entityId: 'task3' }),
      ];

      const seqs = await service.appendBatch(ops, 'remote', { pendingApply: true });

      // Simulate: first op applied, then crash
      await service.markApplied([seqs[0]]);

      const pending = await service.getPendingRemoteOps();

      expect(pending.length).toBe(2);
      expect(pending.map((p) => p.op.entityId).sort()).toEqual(['task2', 'task3']);
    });
  });

  describe('appliedOpIds cache', () => {
    it('should return cached result when no new ops added', async () => {
      const op = createTestOperation();
      await service.append(op);

      // First call builds cache
      const ids1 = await service.getAppliedOpIds();
      // Second call should use cache
      const ids2 = await service.getAppliedOpIds();

      expect(ids1.size).toBe(1);
      expect(ids2.size).toBe(1);
      expect(ids1.has(op.id)).toBe(true);
    });

    it('should invalidate cache when new ops added', async () => {
      const op1 = createTestOperation({ entityId: 'task1' });
      await service.append(op1);

      const ids1 = await service.getAppliedOpIds();
      expect(ids1.size).toBe(1);

      // Add new op
      const op2 = createTestOperation({ entityId: 'task2' });
      await service.append(op2);

      const ids2 = await service.getAppliedOpIds();
      expect(ids2.size).toBe(2);
      expect(ids2.has(op2.id)).toBe(true);
    });

    it('should incrementally update cache when new ops added', async () => {
      // Build initial cache with 5 ops
      const initialOps = Array.from({ length: 5 }, (_, i) =>
        createTestOperation({ entityId: `task-${i}` }),
      );
      for (const op of initialOps) {
        await service.append(op);
      }

      // First call - builds cache
      const ids1 = await service.getAppliedOpIds();
      expect(ids1.size).toBe(5);

      // Add 2 more ops
      const newOp1 = createTestOperation({ entityId: 'new-task-1' });
      const newOp2 = createTestOperation({ entityId: 'new-task-2' });
      await service.append(newOp1);
      await service.append(newOp2);

      // Second call - should incrementally add only new IDs
      const ids2 = await service.getAppliedOpIds();
      expect(ids2.size).toBe(7);
      expect(ids2.has(newOp1.id)).toBe(true);
      expect(ids2.has(newOp2.id)).toBe(true);

      // All original IDs should still be present
      for (const op of initialOps) {
        expect(ids2.has(op.id)).toBe(true);
      }
    });
  });

  describe('unsynced cache', () => {
    it('should return cached result when no changes', async () => {
      const op = createTestOperation();
      await service.append(op);

      // First call builds cache
      const unsynced1 = await service.getUnsynced();
      // Second call should use cache
      const unsynced2 = await service.getUnsynced();

      expect(unsynced1.length).toBe(1);
      expect(unsynced2.length).toBe(1);
      expect(unsynced1[0].op.id).toBe(op.id);
    });

    it('should incrementally add new unsynced ops to cache', async () => {
      // Build initial cache with 3 ops
      const initialOps = Array.from({ length: 3 }, (_, i) =>
        createTestOperation({ entityId: `task-${i}` }),
      );
      for (const op of initialOps) {
        await service.append(op);
      }

      // First call - builds cache
      const unsynced1 = await service.getUnsynced();
      expect(unsynced1.length).toBe(3);

      // Add 2 more ops
      const newOp1 = createTestOperation({ entityId: 'new-task-1' });
      const newOp2 = createTestOperation({ entityId: 'new-task-2' });
      await service.append(newOp1);
      await service.append(newOp2);

      // Second call - should incrementally add new unsynced ops
      const unsynced2 = await service.getUnsynced();
      expect(unsynced2.length).toBe(5);
    });

    it('should invalidate cache when markSynced is called', async () => {
      const op1 = createTestOperation({ entityId: 'task1' });
      const op2 = createTestOperation({ entityId: 'task2' });
      await service.append(op1);
      await service.append(op2);

      // Build cache
      const unsynced1 = await service.getUnsynced();
      expect(unsynced1.length).toBe(2);

      // Mark one as synced
      const ops = await service.getOpsAfterSeq(0);
      await service.markSynced([ops[0].seq]);

      // Cache should be invalidated, returning only the unsynced op
      const unsynced2 = await service.getUnsynced();
      expect(unsynced2.length).toBe(1);
      expect(unsynced2[0].op.id).toBe(op2.id);
    });

    it('should invalidate cache when markRejected is called', async () => {
      const op1 = createTestOperation({ entityId: 'task1' });
      const op2 = createTestOperation({ entityId: 'task2' });
      await service.append(op1);
      await service.append(op2);

      // Build cache
      const unsynced1 = await service.getUnsynced();
      expect(unsynced1.length).toBe(2);

      // Mark one as rejected
      await service.markRejected([op1.id]);

      // Cache should be invalidated, returning only the non-rejected op
      const unsynced2 = await service.getUnsynced();
      expect(unsynced2.length).toBe(1);
      expect(unsynced2[0].op.id).toBe(op2.id);
    });

    it('should not include already synced ops when incrementally updating', async () => {
      // Add initial ops
      const op1 = createTestOperation({ entityId: 'task1' });
      await service.append(op1);

      // Build initial cache
      const unsynced1 = await service.getUnsynced();
      expect(unsynced1.length).toBe(1);

      // Mark as synced - this invalidates the cache
      const ops = await service.getOpsAfterSeq(0);
      await service.markSynced([ops[0].seq]);

      // Add a new unsynced op
      const op2 = createTestOperation({ entityId: 'task2' });
      await service.append(op2);

      // Should only return the new unsynced op
      const unsynced2 = await service.getUnsynced();
      expect(unsynced2.length).toBe(1);
      expect(unsynced2[0].op.id).toBe(op2.id);
    });
  });

  describe('edge cases', () => {
    it('should handle empty arrays for markSynced', async () => {
      await service.markSynced([]);
      // Should not throw
    });

    it('should handle empty arrays for markRejected', async () => {
      await service.markRejected([]);
      // Should not throw
    });

    it('should handle deleteOpsWhere with no matches', async () => {
      const op = createTestOperation();
      await service.append(op);

      await service.deleteOpsWhere(() => false);

      const ops = await service.getOpsAfterSeq(0);
      expect(ops.length).toBe(1);
    });

    it('should handle very large operations', async () => {
      // Create operation with large payload
      const largePayload: Record<string, unknown> = {};
      for (let i = 0; i < 1000; i++) {
        largePayload[`field${i}`] = 'x'.repeat(100);
      }

      const op = createTestOperation({ payload: largePayload });
      await service.append(op);

      const ops = await service.getOpsAfterSeq(0);
      expect(ops.length).toBe(1);
      expect(ops[0].op.payload).toEqual(largePayload);
    });

    it('should handle operations with special characters in payload', async () => {
      const payload = {
        title: 'Task with "quotes" and \n newlines',
        description: 'Unicode: 日本語 🎉 emoji',
        tags: ['special/chars', 'back\\slash'],
      };

      const op = createTestOperation({ payload });
      await service.append(op);

      const ops = await service.getOpsAfterSeq(0);
      expect(ops[0].op.payload).toEqual(payload);
    });

    it('should preserve operation order in getOpsAfterSeq', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 20; i++) {
        const op = createTestOperation({ entityId: `task-${i}` });
        ids.push(op.id);
        await service.append(op);
      }

      const ops = await service.getOpsAfterSeq(0);
      expect(ops.length).toBe(20);

      // Verify order is preserved
      for (let i = 0; i < ops.length - 1; i++) {
        expect(ops[i].seq).toBeLessThan(ops[i + 1].seq);
      }
    });
  });

  describe('import backup', () => {
    it('should save and load import backup', async () => {
      const state = { tasks: ['task1', 'task2'], projects: [] };

      await service.saveImportBackup(state);

      const backup = await service.loadImportBackup();
      expect(backup).not.toBeNull();
      expect(backup!.state).toEqual(state);
      expect(backup!.savedAt).toBeDefined();
      expect(typeof backup!.savedAt).toBe('number');
    });

    it('should return null when no backup exists', async () => {
      const backup = await service.loadImportBackup();
      expect(backup).toBeNull();
    });

    it('should overwrite existing backup on save', async () => {
      const state1 = { version: 1 };
      const state2 = { version: 2 };

      await service.saveImportBackup(state1);
      await service.saveImportBackup(state2);

      const backup = await service.loadImportBackup();
      expect(backup!.state).toEqual(state2);
    });

    it('should clear import backup', async () => {
      const state = { data: 'test' };
      await service.saveImportBackup(state);

      await service.clearImportBackup();

      const backup = await service.loadImportBackup();
      expect(backup).toBeNull();
    });

    it('should check if backup exists with hasImportBackup', async () => {
      expect(await service.hasImportBackup()).toBe(false);

      await service.saveImportBackup({ test: true });

      expect(await service.hasImportBackup()).toBe(true);

      await service.clearImportBackup();

      expect(await service.hasImportBackup()).toBe(false);
    });

    it('should preserve complex nested data structures', async () => {
      const complexState = {
        tasks: {
          ids: ['task1', 'task2'],
          entities: {
            task1: { id: 'task1', title: 'Test', nested: { deep: { value: 123 } } },
            task2: { id: 'task2', title: 'Test 2', tags: ['a', 'b', 'c'] },
          },
        },
        projects: [{ id: 'p1', name: 'Project' }],
        nullValue: null,
        undefinedValue: undefined,
        emptyArray: [],
        emptyObject: {},
      };

      await service.saveImportBackup(complexState);

      const backup = await service.loadImportBackup();
      expect(backup!.state).toEqual(complexState);
    });

    it('should survive clearAllOperations', async () => {
      // Save backup and add some operations
      const backupState = { important: 'data' };
      await service.saveImportBackup(backupState);
      await service.append(createTestOperation());
      await service.append(createTestOperation());

      // Clear all operations
      await service.clearAllOperations();

      // Backup should still exist
      const backup = await service.loadImportBackup();
      expect(backup).not.toBeNull();
      expect(backup!.state).toEqual(backupState);
    });

    it('should be independent from state_cache', async () => {
      // Save both import backup and state cache
      const importBackupState = { type: 'import_backup' };
      const stateCacheState = { type: 'state_cache' };

      await service.saveImportBackup(importBackupState);
      await service.saveStateCache({
        state: stateCacheState,
        lastAppliedOpSeq: 1,
        vectorClock: { client1: 1 } as VectorClock,
        compactedAt: Date.now(),
      });

      // Both should be independent
      const importBackup = await service.loadImportBackup();
      const stateCache = await service.loadStateCache();

      expect(importBackup!.state).toEqual(importBackupState);
      expect(stateCache!.state).toEqual(stateCacheState);

      // Clearing one should not affect the other
      await service.clearImportBackup();

      expect(await service.loadImportBackup()).toBeNull();
      expect((await service.loadStateCache())!.state).toEqual(stateCacheState);
    });
  });

  // ===========================================================================
  // Vector Clock Store Tests (Performance Optimization)
  // ===========================================================================
  // These tests verify the vector_clock object store introduced in DB version 2
  // to consolidate vector clock writes into a single atomic transaction with ops.

  describe('getVectorClock', () => {
    it('should return null when no vector clock exists', async () => {
      const clock = await service.getVectorClock();
      expect(clock).toBeNull();
    });

    it('should return the stored vector clock', async () => {
      await service.setVectorClock({ clientA: 5, clientB: 3 });

      const clock = await service.getVectorClock();
      expect(clock).toEqual({ clientA: 5, clientB: 3 });
    });
  });

  describe('setVectorClock', () => {
    it('should store a new vector clock', async () => {
      await service.setVectorClock({ clientA: 10 });

      const clock = await service.getVectorClock();
      expect(clock).toEqual({ clientA: 10 });
    });

    it('should overwrite existing vector clock', async () => {
      await service.setVectorClock({ clientA: 5 });
      await service.setVectorClock({ clientA: 10, clientB: 3 });

      const clock = await service.getVectorClock();
      expect(clock).toEqual({ clientA: 10, clientB: 3 });
    });

    it('should handle empty vector clock', async () => {
      await service.setVectorClock({});

      const clock = await service.getVectorClock();
      expect(clock).toEqual({});
    });
  });

  describe('getVectorClockEntry', () => {
    it('should return null when no vector clock exists', async () => {
      const entry = await service.getVectorClockEntry();
      expect(entry).toBeNull();
    });

    it('should return full entry with clock and lastUpdate', async () => {
      const beforeTime = Date.now();
      await service.setVectorClock({ clientA: 5 });
      const afterTime = Date.now();

      const entry = await service.getVectorClockEntry();
      expect(entry).not.toBeNull();
      expect(entry!.clock).toEqual({ clientA: 5 });
      expect(entry!.lastUpdate).toBeGreaterThanOrEqual(beforeTime);
      expect(entry!.lastUpdate).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('appendWithVectorClockUpdate', () => {
    it('should append operation and update vector clock atomically for local ops', async () => {
      const op = createTestOperation({
        vectorClock: { testClient: 1 },
      });

      const seq = await service.appendWithVectorClockUpdate(op, 'local');

      // Operation should be stored
      const ops = await service.getOpsAfterSeq(0);
      expect(ops.length).toBe(1);
      expect(ops[0].seq).toBe(seq);
      expect(ops[0].source).toBe('local');

      // Vector clock should be updated
      const clock = await service.getVectorClock();
      expect(clock).toEqual({ testClient: 1 });
    });

    it('should NOT update vector clock for remote ops', async () => {
      // First set a local clock
      await service.setVectorClock({ localClient: 5 });

      const remoteOp = createTestOperation({
        clientId: 'remoteClient',
        vectorClock: { remoteClient: 10 },
      });

      await service.appendWithVectorClockUpdate(remoteOp, 'remote');

      // Vector clock should NOT be updated (remote ops don't change local clock)
      const clock = await service.getVectorClock();
      expect(clock).toEqual({ localClient: 5 });
    });

    it('should update vector clock with each local operation', async () => {
      const op1 = createTestOperation({
        entityId: 'task1',
        vectorClock: { testClient: 1 },
      });
      const op2 = createTestOperation({
        entityId: 'task2',
        vectorClock: { testClient: 2 },
      });
      const op3 = createTestOperation({
        entityId: 'task3',
        vectorClock: { testClient: 3, otherClient: 1 },
      });

      await service.appendWithVectorClockUpdate(op1, 'local');
      let clock = await service.getVectorClock();
      expect(clock).toEqual({ testClient: 1 });

      await service.appendWithVectorClockUpdate(op2, 'local');
      clock = await service.getVectorClock();
      expect(clock).toEqual({ testClient: 2 });

      await service.appendWithVectorClockUpdate(op3, 'local');
      clock = await service.getVectorClock();
      expect(clock).toEqual({ testClient: 3, otherClient: 1 });
    });

    it('should set applicationStatus to pending for remote ops with pendingApply', async () => {
      const op = createTestOperation();

      await service.appendWithVectorClockUpdate(op, 'remote', { pendingApply: true });

      const ops = await service.getOpsAfterSeq(0);
      expect(ops[0].applicationStatus).toBe('pending');
    });

    it('should set applicationStatus to applied for remote ops without pendingApply', async () => {
      const op = createTestOperation();

      await service.appendWithVectorClockUpdate(op, 'remote');

      const ops = await service.getOpsAfterSeq(0);
      expect(ops[0].applicationStatus).toBe('applied');
    });

    it('should set syncedAt for remote ops', async () => {
      const beforeTime = Date.now();
      const op = createTestOperation();

      await service.appendWithVectorClockUpdate(op, 'remote');
      const afterTime = Date.now();

      const ops = await service.getOpsAfterSeq(0);
      expect(ops[0].syncedAt).toBeDefined();
      expect(ops[0].syncedAt).toBeGreaterThanOrEqual(beforeTime);
      expect(ops[0].syncedAt).toBeLessThanOrEqual(afterTime);
    });

    it('should NOT set syncedAt for local ops', async () => {
      const op = createTestOperation();

      await service.appendWithVectorClockUpdate(op, 'local');

      const ops = await service.getOpsAfterSeq(0);
      expect(ops[0].syncedAt).toBeUndefined();
    });

    it('should handle concurrent appends with vector clock updates', async () => {
      const ops = Array.from({ length: 5 }, (_, i) =>
        createTestOperation({
          entityId: `task-${i}`,
          vectorClock: { testClient: i + 1 },
        }),
      );

      // Append concurrently
      await Promise.all(
        ops.map((op) => service.appendWithVectorClockUpdate(op, 'local')),
      );

      const storedOps = await service.getOpsAfterSeq(0);
      expect(storedOps.length).toBe(5);

      // Vector clock should reflect the last write (order may vary due to concurrency)
      const clock = await service.getVectorClock();
      expect(clock!.testClient).toBeGreaterThanOrEqual(1);
      expect(clock!.testClient).toBeLessThanOrEqual(5);
    });
  });

  describe('VectorClockService integration with vector_clock store', () => {
    it('should read from vector_clock store as fast path', async () => {
      // Set vector clock directly in the store
      await service.setVectorClock({ directClient: 100 });

      // VectorClockService should read from the store first
      const clock = await vectorClockService.getCurrentVectorClock();
      expect(clock).toEqual({ directClient: 100 });
    });

    it('should fall back to snapshot+ops when vector_clock store is empty', async () => {
      // Save snapshot with vector clock (simulating pre-upgrade state)
      await service.saveStateCache({
        state: {},
        lastAppliedOpSeq: 0,
        vectorClock: { snapshotClient: 50 },
        compactedAt: Date.now(),
      });

      // Add an op with newer clock
      const op = createTestOperation({
        vectorClock: { snapshotClient: 51 },
      });
      await service.append(op); // Using append, not appendWithVectorClockUpdate

      // VectorClockService should fall back to computing from snapshot+ops
      const clock = await vectorClockService.getCurrentVectorClock();
      expect(clock.snapshotClient).toBe(51);
    });

    it('should prefer vector_clock store over snapshot computation', async () => {
      // Set up both: vector_clock store and snapshot with ops
      await service.setVectorClock({ storeClient: 200 });

      await service.saveStateCache({
        state: {},
        lastAppliedOpSeq: 0,
        vectorClock: { snapshotClient: 50 },
        compactedAt: Date.now(),
      });

      const op = createTestOperation({
        vectorClock: { snapshotClient: 51, opClient: 1 },
      });
      await service.append(op);

      // Should read from vector_clock store, not compute from snapshot+ops
      const clock = await vectorClockService.getCurrentVectorClock();
      expect(clock).toEqual({ storeClient: 200 });
    });
  });

  describe('clearAllOperations', () => {
    it('should remove all operations from the log', async () => {
      // Add several operations
      await service.append(createTestOperation({ entityId: 'task1' }));
      await service.append(createTestOperation({ entityId: 'task2' }));
      await service.append(createTestOperation({ entityId: 'task3' }));

      // Verify they exist
      let ops = await service.getOpsAfterSeq(0);
      expect(ops.length).toBe(3);

      // Clear all operations
      await service.clearAllOperations();

      // Verify they are gone
      ops = await service.getOpsAfterSeq(0);
      expect(ops.length).toBe(0);
    });

    it('should reset lastSeq to 0 after clearing', async () => {
      await service.append(createTestOperation());
      await service.append(createTestOperation());

      const seqBefore = await service.getLastSeq();
      expect(seqBefore).toBeGreaterThan(0);

      await service.clearAllOperations();

      const seqAfter = await service.getLastSeq();
      expect(seqAfter).toBe(0);
    });

    it('should invalidate caches after clearing', async () => {
      // Add operations and build caches
      await service.append(createTestOperation({ entityId: 'task1' }));
      await service.getAppliedOpIds(); // Build appliedOpIds cache
      await service.getUnsynced(); // Build unsynced cache

      // Clear all operations
      await service.clearAllOperations();

      // Subsequent calls should return empty results (not stale cached data)
      const appliedOpIds = await service.getAppliedOpIds();
      expect(appliedOpIds.size).toBe(0);

      const unsynced = await service.getUnsynced();
      expect(unsynced.length).toBe(0);
    });

    it('should not affect state_cache', async () => {
      // Save a state cache
      const stateCache = {
        state: { test: 'data' },
        lastAppliedOpSeq: 5,
        vectorClock: { client1: 5 } as VectorClock,
        compactedAt: Date.now(),
      };
      await service.saveStateCache(stateCache);

      // Add operations
      await service.append(createTestOperation());

      // Clear operations
      await service.clearAllOperations();

      // State cache should still exist
      const loadedCache = await service.loadStateCache();
      expect(loadedCache).not.toBeNull();
      expect(loadedCache?.state).toEqual({ test: 'data' });
    });

    it('should not affect import_backup', async () => {
      // Save an import backup
      const backupState = { preserved: 'backup_data' };
      await service.saveImportBackup(backupState);

      // Add operations
      await service.append(createTestOperation());

      // Clear operations
      await service.clearAllOperations();

      // Import backup should still exist
      const backup = await service.loadImportBackup();
      expect(backup).not.toBeNull();
      expect(backup?.state).toEqual(backupState);
    });
  });

  describe('vector clock cache coherence', () => {
    // Tests for the in-memory _vectorClockCache behavior

    it('should cache vector clock after first read', async () => {
      // Set vector clock in DB
      await service.setVectorClock({ client1: 10 });

      // First read - populates cache
      const clock1 = await service.getVectorClock();
      expect(clock1).toEqual({ client1: 10 });

      // Second read - should return same value (from cache)
      const clock2 = await service.getVectorClock();
      expect(clock2).toEqual({ client1: 10 });

      // Values should be equal but not same reference (defensive copy)
      expect(clock1).not.toBe(clock2);
    });

    it('should update cache when local op is appended', async () => {
      const localOp = createTestOperation({
        vectorClock: { localClient: 5 },
      });

      await service.appendWithVectorClockUpdate(localOp, 'local');

      // Cache should be updated with the new clock
      const clock = await service.getVectorClock();
      expect(clock).toEqual({ localClient: 5 });
    });

    it('should NOT update cache when remote op is appended', async () => {
      // First set a local clock
      await service.setVectorClock({ localClient: 10 });

      // Append a remote op with different clock
      const remoteOp = createTestOperation({
        clientId: 'remoteClient',
        vectorClock: { remoteClient: 99, localClient: 15 },
      });
      await service.appendWithVectorClockUpdate(remoteOp, 'remote');

      // Cache should NOT be updated - still returns local clock
      const clock = await service.getVectorClock();
      expect(clock).toEqual({ localClient: 10 });
    });

    it('should return correct clock after mixed local and remote ops', async () => {
      // Local op 1
      const localOp1 = createTestOperation({
        entityId: 'task1',
        vectorClock: { localClient: 1 },
      });
      await service.appendWithVectorClockUpdate(localOp1, 'local');

      // Remote op (should not affect cache)
      const remoteOp = createTestOperation({
        entityId: 'task2',
        clientId: 'remoteClient',
        vectorClock: { remoteClient: 50, localClient: 5 },
      });
      await service.appendWithVectorClockUpdate(remoteOp, 'remote');

      // Local op 2
      const localOp2 = createTestOperation({
        entityId: 'task3',
        vectorClock: { localClient: 2 },
      });
      await service.appendWithVectorClockUpdate(localOp2, 'local');

      // Cache should reflect the last LOCAL op's clock
      const clock = await service.getVectorClock();
      expect(clock).toEqual({ localClient: 2 });
    });

    it('should clear cache when _clearAllDataForTesting is called', async () => {
      // Set up vector clock
      await service.setVectorClock({ testClient: 100 });

      // Verify it's set
      let clock = await service.getVectorClock();
      expect(clock).toEqual({ testClient: 100 });

      // Clear all data (includes cache)
      await service._clearAllDataForTesting();

      // Cache should be cleared - getVectorClock should return null
      clock = await service.getVectorClock();
      expect(clock).toBeNull();
    });

    it('should re-read from DB after cache is cleared', async () => {
      // Set vector clock and read it (populates cache)
      await service.setVectorClock({ original: 1 });
      await service.getVectorClock();

      // Clear all data
      await service._clearAllDataForTesting();

      // Set a new vector clock directly
      await service.setVectorClock({ newValue: 42 });

      // Should read from DB (cache was cleared)
      const clock = await service.getVectorClock();
      expect(clock).toEqual({ newValue: 42 });
    });

    it('should return defensive copies from cache', async () => {
      await service.setVectorClock({ client: 5 });

      const clock1 = await service.getVectorClock();
      const clock2 = await service.getVectorClock();

      // Modify one copy
      clock1!.client = 999;

      // Other copy and subsequent reads should be unaffected
      expect(clock2).toEqual({ client: 5 });

      const clock3 = await service.getVectorClock();
      expect(clock3).toEqual({ client: 5 });
    });

    it('should clear cache when clearVectorClockCache is called', async () => {
      // Set vector clock and read it (populates cache)
      await service.setVectorClock({ tabA: 10, tabB: 5 });
      const cachedClock = await service.getVectorClock();
      expect(cachedClock).toEqual({ tabA: 10, tabB: 5 });

      // Clear the cache
      service.clearVectorClockCache();

      // Next read should fetch from IndexedDB (which still has the value)
      const freshClock = await service.getVectorClock();
      expect(freshClock).toEqual({ tabA: 10, tabB: 5 });
    });

    it('should force fresh read from IndexedDB after clearVectorClockCache', async () => {
      // This test simulates the multi-tab scenario where another tab updates IndexedDB
      // while this tab has a stale cache.

      // Set initial clock and populate cache
      await service.setVectorClock({ originalClient: 1 });
      await service.getVectorClock();

      // Simulate another tab writing directly to IndexedDB (bypassing our cache)
      // We do this by using setVectorClock which updates both DB and cache
      await service.setVectorClock({ originalClient: 1, anotherTabClient: 99 });

      // Now clear cache to simulate what happens after acquiring a lock
      service.clearVectorClockCache();

      // Should get the updated value from IndexedDB
      const clock = await service.getVectorClock();
      expect(clock).toEqual({ originalClient: 1, anotherTabClient: 99 });
    });
  });

  describe('mergeRemoteOpClocks', () => {
    it('should merge remote ops clocks into local clock', async () => {
      // Set initial local clock
      await service.setVectorClock({ localClient: 5 });

      // Create remote ops with different clocks
      const remoteOps = [
        createTestOperation({
          clientId: 'remoteClientA',
          vectorClock: { remoteClientA: 10 },
        }),
        createTestOperation({
          clientId: 'remoteClientB',
          vectorClock: { remoteClientB: 3, remoteClientA: 5 },
        }),
      ];

      await service.mergeRemoteOpClocks(remoteOps);

      // Local clock should now include all remote clock entries
      const clock = await service.getVectorClock();
      expect(clock).toEqual({
        localClient: 5,
        remoteClientA: 10, // Max of 10 and 5
        remoteClientB: 3,
      });
    });

    it('should take maximum value when merging overlapping clock entries', async () => {
      await service.setVectorClock({ clientA: 5, clientB: 3 });

      const remoteOps = [
        createTestOperation({
          vectorClock: { clientA: 3, clientB: 7, clientC: 1 },
        }),
      ];

      await service.mergeRemoteOpClocks(remoteOps);

      const clock = await service.getVectorClock();
      expect(clock).toEqual({
        clientA: 5, // Local was higher (5 > 3)
        clientB: 7, // Remote was higher (7 > 3)
        clientC: 1, // New from remote
      });
    });

    it('should handle empty ops array', async () => {
      await service.setVectorClock({ localClient: 5 });

      await service.mergeRemoteOpClocks([]);

      const clock = await service.getVectorClock();
      expect(clock).toEqual({ localClient: 5 });
    });

    it('should handle null local clock', async () => {
      // Don't set any local clock

      const remoteOps = [
        createTestOperation({
          vectorClock: { remoteClient: 10 },
        }),
      ];

      await service.mergeRemoteOpClocks(remoteOps);

      const clock = await service.getVectorClock();
      expect(clock).toEqual({ remoteClient: 10 });
    });

    it('should merge SYNC_IMPORT clock correctly (critical for filtering)', async () => {
      // This tests the specific bug scenario:
      // 1. Client B has local clock {B: 5}
      // 2. Client B receives SYNC_IMPORT from Client A with clock {A: 1}
      // 3. After merge, Client B should have clock {A: 1, B: 5}
      // 4. Subsequent ops from B will have clock {A: 1, B: 6}, which is GREATER_THAN {A: 1}

      await service.setVectorClock({ clientB: 5 });

      const syncImportOp = createTestOperation({
        clientId: 'clientA',
        opType: OpType.SyncImport,
        vectorClock: { clientA: 1 },
      });

      await service.mergeRemoteOpClocks([syncImportOp]);

      const clock = await service.getVectorClock();
      expect(clock).toEqual({
        clientA: 1,
        clientB: 5,
      });
    });

    it('should merge multiple ops in sequence correctly', async () => {
      await service.setVectorClock({ localClient: 1 });

      // First batch of remote ops
      await service.mergeRemoteOpClocks([
        createTestOperation({ vectorClock: { clientA: 5 } }),
        createTestOperation({ vectorClock: { clientB: 3 } }),
      ]);

      let clock = await service.getVectorClock();
      expect(clock).toEqual({ localClient: 1, clientA: 5, clientB: 3 });

      // Second batch of remote ops
      await service.mergeRemoteOpClocks([
        createTestOperation({ vectorClock: { clientA: 7, clientC: 2 } }),
      ]);

      clock = await service.getVectorClock();
      expect(clock).toEqual({
        localClient: 1,
        clientA: 7, // Updated from 5 to 7
        clientB: 3,
        clientC: 2, // New entry
      });
    });

    it('should update cache after merge', async () => {
      await service.setVectorClock({ localClient: 5 });

      // Read to populate cache
      await service.getVectorClock();

      // Merge remote clocks
      await service.mergeRemoteOpClocks([
        createTestOperation({ vectorClock: { remoteClient: 10 } }),
      ]);

      // Cache should be updated - next read should include remote clock
      const clock = await service.getVectorClock();
      expect(clock).toEqual({ localClient: 5, remoteClient: 10 });
    });

    it('should persist merged clock to IndexedDB', async () => {
      await service.setVectorClock({ localClient: 5 });

      await service.mergeRemoteOpClocks([
        createTestOperation({ vectorClock: { remoteClient: 10 } }),
      ]);

      // Re-initialize service to force reading from IndexedDB
      await service._clearAllDataForTesting();
      await service.init();
      await service.setVectorClock({ localClient: 5, remoteClient: 10 });

      const clock = await service.getVectorClock();
      expect(clock).toEqual({ localClient: 5, remoteClient: 10 });
    });

    it('should handle ops with overlapping but different clock entries', async () => {
      // Simulate multiple clients with complex clock histories
      await service.setVectorClock({ clientA: 10, clientB: 5, clientC: 3 });

      const remoteOps = [
        createTestOperation({
          vectorClock: { clientA: 8, clientD: 7 }, // clientA lower, clientD new
        }),
        createTestOperation({
          vectorClock: { clientB: 12, clientE: 2 }, // clientB higher, clientE new
        }),
        createTestOperation({
          vectorClock: { clientC: 3, clientF: 1 }, // clientC equal, clientF new
        }),
      ];

      await service.mergeRemoteOpClocks(remoteOps);

      const clock = await service.getVectorClock();
      expect(clock).toEqual({
        clientA: 10, // local was higher (10 > 8)
        clientB: 12, // remote was higher (12 > 5)
        clientC: 3, // equal
        clientD: 7, // new from remote
        clientE: 2, // new from remote
        clientF: 1, // new from remote
      });
    });

    it('should handle op with zero vector clock values', async () => {
      await service.setVectorClock({ clientA: 5 });

      // Some ops might have 0 values (edge case)
      await service.mergeRemoteOpClocks([
        createTestOperation({ vectorClock: { clientA: 0, clientB: 0 } }),
      ]);

      const clock = await service.getVectorClock();
      expect(clock).toEqual({
        clientA: 5, // local higher than 0
        clientB: 0, // 0 merged in
      });
    });

    it('should handle large number of remote ops efficiently', async () => {
      await service.setVectorClock({ localClient: 1 });

      // Create 100 remote ops
      const remoteOps = Array.from({ length: 100 }, (_, i) =>
        createTestOperation({
          id: `op-${i}`,
          vectorClock: { [`client${i}`]: i + 1 },
        }),
      );

      const startTime = Date.now();
      await service.mergeRemoteOpClocks(remoteOps);
      const endTime = Date.now();

      // Should complete quickly (less than 100ms even for 100 ops)
      expect(endTime - startTime).toBeLessThan(100);

      const clock = await service.getVectorClock();
      expect(clock).not.toBeNull();
      expect(Object.keys(clock!).length).toBe(101); // localClient + 100 remote clients
      expect(clock!['client99']).toBe(100);
    });

    it('should correctly merge clock from SYNC_IMPORT with complex existing clock', async () => {
      // Simulate a realistic scenario: client has been operating for a while
      // with knowledge of multiple clients
      await service.setVectorClock({
        clientA: 100,
        clientB: 50,
        clientC: 25,
        localClient: 200,
      });

      // Another client did a SYNC_IMPORT that only knew about some clients
      const syncImportOp = createTestOperation({
        opType: OpType.SyncImport,
        clientId: 'clientX',
        vectorClock: {
          clientX: 1,
          clientA: 80, // knows about A but with older clock
          clientD: 30, // knows about D (we don't know)
        },
      });

      await service.mergeRemoteOpClocks([syncImportOp]);

      const clock = await service.getVectorClock();
      expect(clock).toEqual({
        clientA: 100, // we had higher
        clientB: 50, // unchanged (import didn't know)
        clientC: 25, // unchanged (import didn't know)
        localClient: 200, // unchanged
        clientX: 1, // new from import
        clientD: 30, // new from import
      });
    });
  });

  describe('index fallback behavior', () => {
    // These tests verify that getPendingRemoteOps and getFailedRemoteOps
    // gracefully handle missing bySourceAndStatus index (for legacy DBs)

    it('getPendingRemoteOps should fall back to full scan when index throws', async () => {
      // Create some test data first
      const pendingOp = createTestOperation({ entityId: 'pending-task' });
      const appliedOp = createTestOperation({ entityId: 'applied-task' });

      await service.append(appliedOp, 'remote'); // applied by default
      await service.append(pendingOp, 'remote', { pendingApply: true });

      // Access the internal db and spy on getAllFromIndex
      const db = (service as any)._db;
      const originalGetAllFromIndex = db.getAllFromIndex.bind(db);

      spyOn(db, 'getAllFromIndex').and.callFake(
        (storeName: string, indexName: string, query: any) => {
          if (indexName === 'bySourceAndStatus') {
            // Simulate missing index error
            throw new DOMException(
              "Failed to execute 'index' on 'IDBObjectStore': The specified index was not found.",
              'NotFoundError',
            );
          }
          return originalGetAllFromIndex(storeName, indexName, query);
        },
      );

      // Should still work via fallback
      const pending = await service.getPendingRemoteOps();

      expect(pending.length).toBe(1);
      expect(pending[0].op.entityId).toBe('pending-task');
      expect(pending[0].source).toBe('remote');
      expect(pending[0].applicationStatus).toBe('pending');
    });

    it('getFailedRemoteOps should fall back to full scan when index throws', async () => {
      // Create test data
      const failedOp = createTestOperation({ entityId: 'failed-task' });
      const pendingOp = createTestOperation({ entityId: 'pending-task' });

      await service.append(failedOp, 'remote', { pendingApply: true });
      await service.append(pendingOp, 'remote', { pendingApply: true });
      await service.markFailed([failedOp.id]);

      // Access the internal db and spy on getAllFromIndex
      const db = (service as any)._db;
      const originalGetAllFromIndex = db.getAllFromIndex.bind(db);

      spyOn(db, 'getAllFromIndex').and.callFake(
        (storeName: string, indexName: string, query: any) => {
          if (indexName === 'bySourceAndStatus') {
            throw new DOMException(
              "Failed to execute 'index' on 'IDBObjectStore': The specified index was not found.",
              'NotFoundError',
            );
          }
          return originalGetAllFromIndex(storeName, indexName, query);
        },
      );

      // Should still work via fallback
      const failed = await service.getFailedRemoteOps();

      expect(failed.length).toBe(1);
      expect(failed[0].op.entityId).toBe('failed-task');
      expect(failed[0].source).toBe('remote');
      expect(failed[0].applicationStatus).toBe('failed');
    });

    it('getPendingRemoteOps fallback should filter correctly with mixed data', async () => {
      // Create a variety of ops to ensure filtering works correctly
      const localOp = createTestOperation({ entityId: 'local-task' });
      const remoteApplied = createTestOperation({ entityId: 'remote-applied' });
      const remotePending1 = createTestOperation({ entityId: 'remote-pending-1' });
      const remotePending2 = createTestOperation({ entityId: 'remote-pending-2' });

      await service.append(localOp, 'local');
      await service.append(remoteApplied, 'remote');
      await service.append(remotePending1, 'remote', { pendingApply: true });
      await service.append(remotePending2, 'remote', { pendingApply: true });

      // Force fallback path
      const db = (service as any)._db;
      spyOn(db, 'getAllFromIndex').and.throwError(
        new DOMException('Index not found', 'NotFoundError'),
      );

      const pending = await service.getPendingRemoteOps();

      expect(pending.length).toBe(2);
      const entityIds = pending.map((p) => p.op.entityId).sort();
      expect(entityIds).toEqual(['remote-pending-1', 'remote-pending-2']);
    });

    it('getFailedRemoteOps fallback should exclude rejected ops', async () => {
      const failedOp = createTestOperation({ entityId: 'failed' });
      const rejectedOp = createTestOperation({ entityId: 'rejected' });

      await service.append(failedOp, 'remote', { pendingApply: true });
      await service.append(rejectedOp, 'remote', { pendingApply: true });
      await service.markFailed([failedOp.id]);
      await service.markFailed([rejectedOp.id]);
      await service.markRejected([rejectedOp.id]);

      // Force fallback path
      const db = (service as any)._db;
      spyOn(db, 'getAllFromIndex').and.throwError(
        new DOMException('Index not found', 'NotFoundError'),
      );

      const failed = await service.getFailedRemoteOps();

      // Only the failed (not rejected) op should be returned
      expect(failed.length).toBe(1);
      expect(failed[0].op.entityId).toBe('failed');
    });
  });

  describe('hasSyncedOps', () => {
    it('should return false when no ops exist', async () => {
      const result = await service.hasSyncedOps();
      expect(result).toBe(false);
    });

    it('should return false when only unsynced ops exist', async () => {
      const op = createTestOperation();
      await service.append(op, 'local');

      const result = await service.hasSyncedOps();
      expect(result).toBe(false);
    });

    it('should return true when synced ops exist', async () => {
      const op = createTestOperation();
      const seq = await service.append(op, 'local');
      await service.markSynced([seq]);

      const result = await service.hasSyncedOps();
      expect(result).toBe(true);
    });

    it('should return false when only MIGRATION ops have syncedAt', async () => {
      const migrationOp = createTestOperation({
        entityType: 'MIGRATION' as EntityType,
        entityId: '*',
        opType: OpType.Batch,
      });
      const seq = await service.append(migrationOp, 'local');
      await service.markSynced([seq]);

      const result = await service.hasSyncedOps();
      expect(result).toBe(false);
    });

    it('should return false when only RECOVERY ops have syncedAt', async () => {
      const recoveryOp = createTestOperation({
        entityType: 'RECOVERY' as EntityType,
        entityId: '*',
        opType: OpType.Batch,
      });
      const seq = await service.append(recoveryOp, 'local');
      await service.markSynced([seq]);

      const result = await service.hasSyncedOps();
      expect(result).toBe(false);
    });

    it('should return true when mixed MIGRATION and regular synced ops exist', async () => {
      // Add MIGRATION op
      const migrationOp = createTestOperation({
        entityType: 'MIGRATION' as EntityType,
        entityId: '*',
        opType: OpType.Batch,
      });
      const seq1 = await service.append(migrationOp, 'local');
      await service.markSynced([seq1]);

      // Add regular op
      const regularOp = createTestOperation({
        entityType: 'TASK' as EntityType,
        entityId: 'task-1',
        opType: OpType.Create,
      });
      const seq2 = await service.append(regularOp, 'local');
      await service.markSynced([seq2]);

      const result = await service.hasSyncedOps();
      expect(result).toBe(true);
    });

    it('should handle multiple MIGRATION/RECOVERY ops correctly', async () => {
      // Add multiple MIGRATION ops
      for (let i = 0; i < 3; i++) {
        const migrationOp = createTestOperation({
          entityType: 'MIGRATION' as EntityType,
          entityId: '*',
          opType: OpType.Batch,
        });
        const seq = await service.append(migrationOp, 'local');
        await service.markSynced([seq]);
      }

      // All are MIGRATION, so should return false
      const result = await service.hasSyncedOps();
      expect(result).toBe(false);
    });
  });

  describe('clearUnsyncedOps', () => {
    it('should mark all unsynced ops as rejected', async () => {
      // Add some unsynced ops
      const op1 = createTestOperation({
        entityType: 'TASK' as EntityType,
        entityId: 'task-1',
        opType: OpType.Create,
      });
      const op2 = createTestOperation({
        entityType: 'TASK' as EntityType,
        entityId: 'task-2',
        opType: OpType.Update,
      });
      await service.append(op1, 'local');
      await service.append(op2, 'local');

      // Verify they are unsynced
      let unsynced = await service.getUnsynced();
      expect(unsynced.length).toBe(2);

      // Clear unsynced ops
      await service.clearUnsyncedOps();

      // Should have no unsynced ops now
      unsynced = await service.getUnsynced();
      expect(unsynced.length).toBe(0);
    });

    it('should not affect already synced ops', async () => {
      // Add a synced op
      const syncedOp = createTestOperation({
        entityType: 'TASK' as EntityType,
        entityId: 'task-synced',
        opType: OpType.Create,
      });
      const seq1 = await service.append(syncedOp, 'local');
      await service.markSynced([seq1]);

      // Add an unsynced op
      const unsyncedOp = createTestOperation({
        entityType: 'TASK' as EntityType,
        entityId: 'task-unsynced',
        opType: OpType.Create,
      });
      await service.append(unsyncedOp, 'local');

      // Clear unsynced ops
      await service.clearUnsyncedOps();

      // Synced op should still exist and be queryable by ID
      const entry = await service.getOpById(syncedOp.id);
      expect(entry).toBeTruthy();
      expect(entry!.syncedAt).toBeDefined();
      expect(entry!.rejectedAt).toBeUndefined();
    });

    it('should handle empty unsynced list gracefully', async () => {
      // No ops added - nothing to clear
      await expectAsync(service.clearUnsyncedOps()).toBeResolved();

      // Should still have no unsynced ops
      const unsynced = await service.getUnsynced();
      expect(unsynced.length).toBe(0);
    });

    it('should update rejectedAt timestamp for each cleared op', async () => {
      const beforeClear = Date.now();

      // Add unsynced op
      const op = createTestOperation({
        entityType: 'TASK' as EntityType,
        entityId: 'task-1',
        opType: OpType.Create,
      });
      await service.append(op, 'local');

      // Clear unsynced ops
      await service.clearUnsyncedOps();

      const afterClear = Date.now();

      // Get the stored entry directly to check rejectedAt
      const entry = await service.getOpById(op.id);
      expect(entry).toBeTruthy();
      expect(entry!.rejectedAt).toBeDefined();
      expect(entry!.rejectedAt).toBeGreaterThanOrEqual(beforeClear);
      expect(entry!.rejectedAt).toBeLessThanOrEqual(afterClear);
    });

    it('should invalidate unsynced cache', async () => {
      // Add unsynced ops
      const op = createTestOperation({
        entityType: 'TASK' as EntityType,
        entityId: 'task-1',
        opType: OpType.Create,
      });
      await service.append(op, 'local');

      // Read unsynced (populates cache)
      let unsynced = await service.getUnsynced();
      expect(unsynced.length).toBe(1);

      // Clear unsynced ops
      await service.clearUnsyncedOps();

      // Should read from DB (cache invalidated) and show no unsynced ops
      unsynced = await service.getUnsynced();
      expect(unsynced.length).toBe(0);
    });

    it('should clear multiple unsynced ops', async () => {
      // Add multiple unsynced ops
      for (let i = 0; i < 10; i++) {
        const op = createTestOperation({
          entityType: 'TASK' as EntityType,
          entityId: `task-${i}`,
          opType: OpType.Create,
        });
        await service.append(op, 'local');
      }

      // Verify they are all unsynced
      let unsynced = await service.getUnsynced();
      expect(unsynced.length).toBe(10);

      // Clear all
      await service.clearUnsyncedOps();

      // Should have none
      unsynced = await service.getUnsynced();
      expect(unsynced.length).toBe(0);
    });
  });
});
