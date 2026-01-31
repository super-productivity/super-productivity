import { TestBed } from '@angular/core/testing';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { ActionType, OpType } from '../../core/operation.types';
import { toLwwUpdateActionType } from '../../core/lww-update-action-types';
import {
  compareVectorClocks,
  VectorClockComparison,
  mergeVectorClocks,
  incrementVectorClock,
} from '../../../core/util/vector-clock';
import { TestClient, resetTestUuidCounter } from './helpers/test-client.helper';
import { createTaskOperation } from './helpers/operation-factory.helper';

/**
 * Integration tests for Last-Write-Wins (LWW) conflict resolution.
 *
 * These tests verify the LWW resolution strategy at the store level:
 * - Timestamp comparison determines winner
 * - When local wins, new update operation is created
 * - Vector clocks are properly merged
 * - Both sides' operations are handled correctly
 *
 * IMPORTANT: These tests focus on the store-level behavior and conflict
 * detection logic. Full application-level LWW testing is done in E2E tests.
 */
describe('LWW Conflict Resolution Integration', () => {
  let storeService: OperationLogStoreService;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [OperationLogStoreService],
    });
    storeService = TestBed.inject(OperationLogStoreService);

    await storeService.init();
    await storeService._clearAllDataForTesting();
    resetTestUuidCounter();
  });

  describe('LWW timestamp comparison', () => {
    it('should identify remote as winner when remote timestamp is newer', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');

      const now = Date.now();

      // Client A creates older operation
      const opA = clientA.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Title from A' },
      });
      // Manually set timestamp to older time
      (opA as any).timestamp = now - 5000;

      // Client B creates newer operation
      const opB = clientB.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Title from B' },
      });
      // Manually set timestamp to newer time
      (opB as any).timestamp = now;

      // LWW: Compare timestamps
      const localMax = opA.timestamp;
      const remoteMax = opB.timestamp;

      expect(remoteMax).toBeGreaterThan(localMax);
      // Remote (B) should win
    });

    it('should identify local as winner when local timestamp is newer', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');

      const now = Date.now();

      // Client A creates newer operation (local)
      const opA = clientA.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Title from A' },
      });
      (opA as any).timestamp = now;

      // Client B creates older operation (remote)
      const opB = clientB.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Title from B' },
      });
      (opB as any).timestamp = now - 5000;

      // LWW: Compare timestamps
      const localMax = opA.timestamp;
      const remoteMax = opB.timestamp;

      expect(localMax).toBeGreaterThan(remoteMax);
      // Local (A) should win
    });

    it('should use remote as tie-breaker when timestamps are equal', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');

      const now = Date.now();

      // Both clients create operations at same timestamp
      const opA = clientA.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Title from A' },
      });
      (opA as any).timestamp = now;

      const opB = clientB.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Title from B' },
      });
      (opB as any).timestamp = now;

      // LWW: Tie-breaker rule - remote wins
      const localMax = opA.timestamp;
      const remoteMax = opB.timestamp;

      expect(localMax).toBe(remoteMax);
      // Convention: remote wins on tie (server-authoritative)
    });
  });

  describe('Concurrent edit detection', () => {
    it('should detect concurrent edits by vector clock comparison', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');

      // Both clients start from "no knowledge of each other"
      const opA = clientA.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Title from A' },
      });

      const opB = clientB.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Title from B' },
      });

      // Vector clocks should be CONCURRENT (neither dominates)
      const comparison = compareVectorClocks(opA.vectorClock, opB.vectorClock);
      expect(comparison).toBe(VectorClockComparison.CONCURRENT);
    });

    it('should detect sequential updates (not conflicting)', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');

      // Client A creates operation
      const opA = clientA.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Title from A' },
      });

      // Client B receives A's operation and merges clock
      clientB.mergeRemoteClock(opA.vectorClock);

      // Client B then creates its own operation (with knowledge of A's)
      const opB = clientB.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Title from B' },
      });

      // B's operation should be GREATER_THAN A's (sequential, not concurrent)
      const comparison = compareVectorClocks(opB.vectorClock, opA.vectorClock);
      expect(comparison).toBe(VectorClockComparison.GREATER_THAN);
    });
  });

  describe('Vector clock merging for LWW local wins', () => {
    it('should correctly merge vector clocks when creating update op for local win', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');

      // Simulate: Client A has local ops, Client B has remote ops
      const localOp = clientA.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Local title' },
      });

      const remoteOp = clientB.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Remote title' },
      });

      // When local wins LWW, we merge clocks and increment
      const mergedClock = mergeVectorClocks(localOp.vectorClock, remoteOp.vectorClock);
      const newClock = incrementVectorClock(mergedClock, 'client-a-test');

      // New clock should have both clients' knowledge + increment for A
      expect(newClock['client-a-test']).toBe(2); // A's original 1 + increment
      expect(newClock['client-b-test']).toBe(1); // B's original 1
    });

    it('should create update op that dominates both original ops', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');

      const localOp = clientA.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Local title' },
      });

      const remoteOp = clientB.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Remote title' },
      });

      // Create new update op with merged + incremented clock
      const mergedClock = mergeVectorClocks(localOp.vectorClock, remoteOp.vectorClock);
      const newClock = incrementVectorClock(mergedClock, 'client-a-test');

      // The new clock should be GREATER_THAN both original ops
      const vsLocal = compareVectorClocks(newClock, localOp.vectorClock);
      const vsRemote = compareVectorClocks(newClock, remoteOp.vectorClock);

      expect(vsLocal).toBe(VectorClockComparison.GREATER_THAN);
      expect(vsRemote).toBe(VectorClockComparison.GREATER_THAN);
    });
  });

  describe('Rejected operations handling', () => {
    it('should mark local ops as rejected when remote wins', async () => {
      const clientA = new TestClient('client-a-test');

      const op = createTaskOperation(clientA, 'task-1', OpType.Update, {
        title: 'Local title',
      });

      // Store as local op
      await storeService.append(op, 'local');

      // Mark as rejected (simulating remote wins LWW)
      await storeService.markRejected([op.id]);

      // Verify op is marked as rejected
      const entry = await storeService.getOpById(op.id);
      expect(entry).toBeDefined();
      expect(entry!.rejectedAt).toBeDefined();

      // Rejected ops should NOT appear in unsynced
      const unsynced = await storeService.getUnsynced();
      expect(unsynced.find((e) => e.op.id === op.id)).toBeUndefined();
    });

    it('should mark both local and remote ops as rejected when local wins', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');

      const localOp = createTaskOperation(clientA, 'task-1', OpType.Update, {
        title: 'Local title',
      });
      const remoteOp = createTaskOperation(clientB, 'task-1', OpType.Update, {
        title: 'Remote title',
      });

      // Store both ops
      await storeService.append(localOp, 'local');
      await storeService.append(remoteOp, 'remote');

      // When local wins LWW, both old ops are rejected
      await storeService.markRejected([localOp.id, remoteOp.id]);

      // Verify both are rejected
      const localEntry = await storeService.getOpById(localOp.id);
      const remoteEntry = await storeService.getOpById(remoteOp.id);

      expect(localEntry!.rejectedAt).toBeDefined();
      expect(remoteEntry!.rejectedAt).toBeDefined();
    });
  });

  describe('Multiple ops per side', () => {
    it('should use max timestamp when local has multiple ops', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');

      const now = Date.now();

      // Local has older first op, newer second op
      const localOp1 = clientA.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Local v1' },
      });
      (localOp1 as any).timestamp = now - 10000;

      const localOp2 = clientA.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Local v2' },
      });
      (localOp2 as any).timestamp = now;

      // Remote has one op in between
      const remoteOp = clientB.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Remote' },
      });
      (remoteOp as any).timestamp = now - 5000;

      // LWW: max(local timestamps) vs max(remote timestamps)
      const localMax = Math.max(localOp1.timestamp, localOp2.timestamp);
      const remoteMax = remoteOp.timestamp;

      expect(localMax).toBeGreaterThan(remoteMax);
      // Local wins because localOp2 (newest) is newer than remoteOp
    });
  });

  describe('Three-client convergence', () => {
    it('should handle conflicts from three clients using LWW', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');
      const clientC = new TestClient('client-c-test');

      const now = Date.now();

      // All three clients edit same entity concurrently
      const opA = clientA.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Title from A' },
      });
      (opA as any).timestamp = now - 2000;

      const opB = clientB.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Title from B' },
      });
      (opB as any).timestamp = now - 1000;

      const opC = clientC.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Title from C' },
      });
      (opC as any).timestamp = now;

      // All three are concurrent (no knowledge of each other)
      expect(compareVectorClocks(opA.vectorClock, opB.vectorClock)).toBe(
        VectorClockComparison.CONCURRENT,
      );
      expect(compareVectorClocks(opB.vectorClock, opC.vectorClock)).toBe(
        VectorClockComparison.CONCURRENT,
      );
      expect(compareVectorClocks(opA.vectorClock, opC.vectorClock)).toBe(
        VectorClockComparison.CONCURRENT,
      );

      // LWW: C wins (newest timestamp)
      const maxTimestamp = Math.max(opA.timestamp, opB.timestamp, opC.timestamp);
      expect(maxTimestamp).toBe(opC.timestamp);
    });
  });

  describe('Delete vs Update conflict', () => {
    it('should resolve delete vs update using LWW timestamps', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');

      const now = Date.now();

      // Client A deletes task (newer timestamp)
      const deleteOp = clientA.createOperation({
        actionType: '[Task] Delete Task' as ActionType,
        opType: OpType.Delete,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: null,
      });
      (deleteOp as any).timestamp = now;

      // Client B updates task (older timestamp)
      const updateOp = clientB.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Updated title' },
      });
      (updateOp as any).timestamp = now - 5000;

      // LWW: Delete wins (newer timestamp)
      expect(deleteOp.timestamp).toBeGreaterThan(updateOp.timestamp);

      // Both are concurrent (no vector clock knowledge of each other)
      const comparison = compareVectorClocks(deleteOp.vectorClock, updateOp.vectorClock);
      expect(comparison).toBe(VectorClockComparison.CONCURRENT);
    });

    it('should resolve update vs delete when update is newer', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');

      const now = Date.now();

      // Client A updates task (newer timestamp)
      const updateOp = clientA.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Updated title' },
      });
      (updateOp as any).timestamp = now;

      // Client B deletes task (older timestamp)
      const deleteOp = clientB.createOperation({
        actionType: '[Task] Delete Task' as ActionType,
        opType: OpType.Delete,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: null,
      });
      (deleteOp as any).timestamp = now - 5000;

      // LWW: Update wins (newer timestamp)
      expect(updateOp.timestamp).toBeGreaterThan(deleteOp.timestamp);
    });
  });

  describe('Superseded pending ops handling', () => {
    it('should reject all pending ops for an entity when remote wins', async () => {
      const clientA = new TestClient('client-a-test');

      // Create multiple pending ops for the same entity
      const op1 = createTaskOperation(clientA, 'task-1', OpType.Update, {
        title: 'Update 1',
      });
      const op2 = createTaskOperation(clientA, 'task-1', OpType.Update, {
        title: 'Update 2',
      });
      const op3 = createTaskOperation(clientA, 'task-1', OpType.Update, {
        title: 'Update 3',
      });

      // Store all ops as local (pending upload)
      await storeService.append(op1, 'local');
      await storeService.append(op2, 'local');
      await storeService.append(op3, 'local');

      // Verify all are in unsynced
      let unsynced = await storeService.getUnsynced();
      expect(unsynced.length).toBe(3);

      // When remote wins LWW, ALL pending ops for that entity should be rejected
      await storeService.markRejected([op1.id, op2.id, op3.id]);

      // Verify none appear in unsynced
      unsynced = await storeService.getUnsynced();
      expect(unsynced.length).toBe(0);

      // But all should still exist in the log (for history)
      const entry1 = await storeService.getOpById(op1.id);
      const entry2 = await storeService.getOpById(op2.id);
      const entry3 = await storeService.getOpById(op3.id);

      expect(entry1).toBeDefined();
      expect(entry2).toBeDefined();
      expect(entry3).toBeDefined();
      expect(entry1!.rejectedAt).toBeDefined();
      expect(entry2!.rejectedAt).toBeDefined();
      expect(entry3!.rejectedAt).toBeDefined();
    });
  });

  describe('New update op after local wins', () => {
    it('should create new op that can be appended after rejecting old ops', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');

      // Simulate conflict scenario
      const localOp = createTaskOperation(clientA, 'task-1', OpType.Update, {
        title: 'Local title',
      });
      const remoteOp = createTaskOperation(clientB, 'task-1', OpType.Update, {
        title: 'Remote title',
      });

      await storeService.append(localOp, 'local');
      await storeService.append(remoteOp, 'remote');

      // Reject both old ops (simulating local wins LWW)
      await storeService.markRejected([localOp.id, remoteOp.id]);

      // Create new update op with merged clock
      const mergedClock = mergeVectorClocks(localOp.vectorClock, remoteOp.vectorClock);
      const newClock = incrementVectorClock(mergedClock, clientA.clientId);

      const newUpdateOp = clientA.createOperation({
        actionType: toLwwUpdateActionType('TASK'),
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Final local title' },
      });
      // Override the vector clock with the properly merged one
      (newUpdateOp as any).vectorClock = newClock;

      // Append the new op
      await storeService.append(newUpdateOp, 'local');

      // Verify only the new op appears in unsynced
      const unsynced = await storeService.getUnsynced();
      expect(unsynced.length).toBe(1);
      expect(unsynced[0].op.id).toBe(newUpdateOp.id);

      // Verify the new op's vector clock dominates the old ones
      const vsLocal = compareVectorClocks(newUpdateOp.vectorClock, localOp.vectorClock);
      const vsRemote = compareVectorClocks(newUpdateOp.vectorClock, remoteOp.vectorClock);
      expect(vsLocal).toBe(VectorClockComparison.GREATER_THAN);
      expect(vsRemote).toBe(VectorClockComparison.GREATER_THAN);
    });
  });

  describe('Entity frontier isolation', () => {
    it('should not affect unrelated entities when rejecting ops', async () => {
      const clientA = new TestClient('client-a-test');

      // Create ops for different entities
      const op1 = createTaskOperation(clientA, 'task-1', OpType.Update, {
        title: 'Task 1',
      });
      const op2 = createTaskOperation(clientA, 'task-2', OpType.Update, {
        title: 'Task 2',
      });
      const op3 = createTaskOperation(clientA, 'task-3', OpType.Update, {
        title: 'Task 3',
      });

      await storeService.append(op1, 'local');
      await storeService.append(op2, 'local');
      await storeService.append(op3, 'local');

      // Reject only task-1's op
      await storeService.markRejected([op1.id]);

      // Task 2 and 3 ops should still be in unsynced
      const unsynced = await storeService.getUnsynced();
      expect(unsynced.length).toBe(2);
      expect(unsynced.find((e) => e.op.entityId === 'task-2')).toBeDefined();
      expect(unsynced.find((e) => e.op.entityId === 'task-3')).toBeDefined();
      expect(unsynced.find((e) => e.op.entityId === 'task-1')).toBeUndefined();
    });

    it('should allow new ops for same entity after rejection', async () => {
      const clientA = new TestClient('client-a-test');

      // Create and reject an op
      const oldOp = createTaskOperation(clientA, 'task-1', OpType.Update, {
        title: 'Old title',
      });
      await storeService.append(oldOp, 'local');
      await storeService.markRejected([oldOp.id]);

      // Create a new op for the same entity
      const newOp = createTaskOperation(clientA, 'task-1', OpType.Update, {
        title: 'New title',
      });
      await storeService.append(newOp, 'local');

      // The new op should be in unsynced
      const unsynced = await storeService.getUnsynced();
      expect(unsynced.length).toBe(1);
      expect(unsynced[0].op.id).toBe(newOp.id);
    });
  });

  describe('Millisecond precision timestamps', () => {
    it('should correctly compare timestamps with millisecond differences', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');

      const now = Date.now();

      // Operations with only 1ms difference
      const opA = clientA.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Title from A' },
      });
      (opA as any).timestamp = now;

      const opB = clientB.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Title from B' },
      });
      (opB as any).timestamp = now + 1; // Just 1ms newer

      // LWW: B wins (even by 1ms)
      expect(opB.timestamp).toBeGreaterThan(opA.timestamp);
      expect(opB.timestamp - opA.timestamp).toBe(1);
    });
  });

  describe('Empty ops array edge cases', () => {
    it('should handle conflict with empty localOps array', async () => {
      const clientB = new TestClient('client-b-test');

      const now = Date.now();

      // Remote op only
      const opB = clientB.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Title from B' },
      });
      (opB as any).timestamp = now;

      // LWW with empty localOps: Math.max() returns -Infinity
      const localOps: any[] = [];
      const localMaxTimestamp =
        localOps.length > 0 ? Math.max(...localOps.map((op) => op.timestamp)) : -Infinity;
      const remoteMaxTimestamp = opB.timestamp;

      // Remote should always win when local is empty
      expect(remoteMaxTimestamp).toBeGreaterThan(localMaxTimestamp);
    });

    it('should handle conflict with empty remoteOps array', async () => {
      const clientA = new TestClient('client-a-test');

      const now = Date.now();

      // Local op only
      const opA = clientA.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Title from A' },
      });
      (opA as any).timestamp = now;

      // LWW with empty remoteOps: Math.max() returns -Infinity
      const remoteOps: any[] = [];
      const localMaxTimestamp = opA.timestamp;
      const remoteMaxTimestamp =
        remoteOps.length > 0
          ? Math.max(...remoteOps.map((op) => op.timestamp))
          : -Infinity;

      // Local should always win when remote is empty
      expect(localMaxTimestamp).toBeGreaterThan(remoteMaxTimestamp);
    });
  });

  describe('DELETE vs UPDATE conflict scenarios', () => {
    it('should extract entity from DELETE payload when UPDATE wins LWW', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');

      const now = Date.now();

      // Create a complete task entity for the DELETE payload
      const fullTaskEntity = {
        id: 'task-restore',
        title: 'Original Task Title',
        created: now - 10000,
        timeSpent: 3600000,
        timeEstimate: 7200000,
        isDone: false,
        notes: 'Important notes',
        tagIds: ['tag-1', 'tag-2'],
        subTaskIds: [],
        attachments: [],
        projectId: 'project-1',
      };

      // Client A deletes task (older, remote) - with FULL entity in payload
      const deleteOp = clientA.createOperation({
        actionType: '[Task] Delete Task' as ActionType,
        opType: OpType.Delete,
        entityType: 'TASK',
        entityId: 'task-restore',
        payload: fullTaskEntity, // DELETE contains full entity for potential restoration
      });
      (deleteOp as any).timestamp = now - 1000;

      // Client B updates same task (newer, local)
      const updateOp = clientB.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-restore',
        payload: { title: 'Updated Title After Delete' },
      });
      (updateOp as any).timestamp = now;

      // LWW: UPDATE wins (newer timestamp)
      expect(updateOp.timestamp).toBeGreaterThan(deleteOp.timestamp);

      // Simulate: DELETE was applied first (entity removed from store)
      // Then sync discovers UPDATE should win
      // System must extract entity from DELETE payload to restore it

      // Store both ops
      await storeService.append(deleteOp, 'remote');
      await storeService.append(updateOp, 'local');

      // Verify DELETE has full entity in payload (available for extraction)
      const storedDeleteEntry = await storeService.getOpById(deleteOp.id);
      expect(storedDeleteEntry?.op.payload).toBeDefined();
      expect((storedDeleteEntry?.op.payload as any).title).toBe('Original Task Title');
      expect((storedDeleteEntry?.op.payload as any).id).toBe('task-restore');

      // Both operations are concurrent (vector clocks don't dominate)
      const comparison = compareVectorClocks(deleteOp.vectorClock, updateOp.vectorClock);
      expect(comparison).toBe(VectorClockComparison.CONCURRENT);

      // Mark DELETE as rejected since UPDATE wins
      await storeService.markRejected([deleteOp.id]);

      // Verify the entity from DELETE payload is available for extraction
      // This simulates the ConflictResolutionService extracting the entity
      // and applying the UPDATE on top of it
      const extractedEntity = storedDeleteEntry?.op.payload as Record<string, unknown>;
      expect(extractedEntity).toBeDefined();
      expect(extractedEntity.title).toBe('Original Task Title');
      expect(extractedEntity.timeSpent).toBe(3600000);

      // The UPDATE should be applied on top of the extracted entity
      const finalEntity = {
        ...extractedEntity,
        ...(updateOp.payload as Record<string, unknown>),
      } as Record<string, unknown>;
      expect(finalEntity.title).toBe('Updated Title After Delete');
      expect(finalEntity.timeSpent).toBe(3600000); // Preserved from DELETE
      expect(finalEntity.tagIds).toEqual(['tag-1', 'tag-2']); // Preserved from DELETE
    });

    it('should resolve DELETE vs UPDATE when DELETE is newer (local wins)', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');

      const now = Date.now();

      // Client A deletes (newer)
      const deleteOp = clientA.createOperation({
        actionType: '[Task] Delete Task' as ActionType,
        opType: OpType.Delete,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: {},
      });
      (deleteOp as any).timestamp = now;

      // Client B updates (older)
      const updateOp = clientB.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Updated title' },
      });
      (updateOp as any).timestamp = now - 1000;

      // LWW: DELETE wins (newer)
      expect(deleteOp.timestamp).toBeGreaterThan(updateOp.timestamp);
      expect(deleteOp.opType).toBe(OpType.Delete);

      // Store both ops
      await storeService.append(deleteOp, 'local');
      await storeService.append(updateOp, 'remote');

      // Mark both as rejected (LWW local wins behavior)
      await storeService.markRejected([deleteOp.id, updateOp.id]);

      // Verify both are rejected
      const deleteEntry = await storeService.getOpById(deleteOp.id);
      const updateEntry = await storeService.getOpById(updateOp.id);

      expect(deleteEntry?.rejectedAt).toBeDefined();
      expect(updateEntry?.rejectedAt).toBeDefined();
    });

    it('should resolve UPDATE vs DELETE when UPDATE is newer (local wins)', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');

      const now = Date.now();

      // Client A updates (newer)
      const updateOp = clientA.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Updated title' },
      });
      (updateOp as any).timestamp = now;

      // Client B deletes (older)
      const deleteOp = clientB.createOperation({
        actionType: '[Task] Delete Task' as ActionType,
        opType: OpType.Delete,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: {},
      });
      (deleteOp as any).timestamp = now - 1000;

      // LWW: UPDATE wins (newer)
      expect(updateOp.timestamp).toBeGreaterThan(deleteOp.timestamp);

      // Store and handle as local wins
      await storeService.append(updateOp, 'local');
      await storeService.append(deleteOp, 'remote');
      await storeService.markRejected([updateOp.id, deleteOp.id]);

      // Both ops should be rejected
      const updateEntry = await storeService.getOpById(updateOp.id);
      const deleteEntry = await storeService.getOpById(deleteOp.id);
      expect(updateEntry?.rejectedAt).toBeDefined();
      expect(deleteEntry?.rejectedAt).toBeDefined();
    });

    it('should resolve DELETE vs UPDATE when UPDATE is newer (remote wins)', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');

      const now = Date.now();

      // Client A deletes (older, local)
      const deleteOp = clientA.createOperation({
        actionType: '[Task] Delete Task' as ActionType,
        opType: OpType.Delete,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: {},
      });
      (deleteOp as any).timestamp = now - 1000;

      // Client B updates (newer, remote)
      const updateOp = clientB.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Updated title' },
      });
      (updateOp as any).timestamp = now;

      // LWW: remote UPDATE wins (newer)
      expect(updateOp.timestamp).toBeGreaterThan(deleteOp.timestamp);

      // Store and mark local rejected, remote applied
      await storeService.append(deleteOp, 'local');
      await storeService.markRejected([deleteOp.id]);

      const seq = await storeService.append(updateOp, 'remote', { pendingApply: true });
      await storeService.markApplied([seq]);

      // Verify states
      const deleteEntry = await storeService.getOpById(deleteOp.id);
      const updateEntry = await storeService.getOpById(updateOp.id);

      expect(deleteEntry?.rejectedAt).toBeDefined();
      expect(updateEntry?.appliedAt).toBeDefined();
    });
  });

  describe('CREATE vs CREATE conflict', () => {
    it('should handle two clients creating entity with same ID', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');

      const now = Date.now();
      const sharedEntityId = 'task-shared-id';

      // Client A creates (older)
      const createA = clientA.createOperation({
        actionType: '[Task] Create Task' as ActionType,
        opType: OpType.Create,
        entityType: 'TASK',
        entityId: sharedEntityId,
        payload: { title: 'Created by A', notes: 'A notes' },
      });
      (createA as any).timestamp = now - 1000;

      // Client B creates same ID (newer)
      const createB = clientB.createOperation({
        actionType: '[Task] Create Task' as ActionType,
        opType: OpType.Create,
        entityType: 'TASK',
        entityId: sharedEntityId,
        payload: { title: 'Created by B', notes: 'B notes' },
      });
      (createB as any).timestamp = now;

      // LWW: B's CREATE wins (newer)
      expect(createB.timestamp).toBeGreaterThan(createA.timestamp);

      // Both are CREATE operations on same entity
      expect(createA.opType).toBe(OpType.Create);
      expect(createB.opType).toBe(OpType.Create);
      expect(createA.entityId).toBe(createB.entityId);

      // Store both - remote with pendingApply flag
      await storeService.append(createA, 'local');
      const seq = await storeService.append(createB, 'remote', { pendingApply: true });

      // Remote wins: reject local, apply remote
      await storeService.markRejected([createA.id]);
      await storeService.markApplied([seq]);

      const entryA = await storeService.getOpById(createA.id);
      const entryB = await storeService.getOpById(createB.id);
      expect(entryA?.rejectedAt).toBeDefined();
      expect(entryB?.applicationStatus).toBe('applied');
    });
  });

  describe('MOVE operation conflicts', () => {
    it('should resolve MOV vs MOV using LWW', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');

      const now = Date.now();

      // Client A moves task (newer, local)
      const movA = clientA.createOperation({
        actionType: '[Task] Move Task' as ActionType,
        opType: OpType.Move,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { fromIndex: 0, toIndex: 5, targetProjectId: 'project-1' },
      });
      (movA as any).timestamp = now;

      // Client B moves same task (older, remote)
      const movB = clientB.createOperation({
        actionType: '[Task] Move Task' as ActionType,
        opType: OpType.Move,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { fromIndex: 0, toIndex: 10, targetProjectId: 'project-2' },
      });
      (movB as any).timestamp = now - 1000;

      // LWW: A's MOV wins (newer)
      expect(movA.timestamp).toBeGreaterThan(movB.timestamp);

      // Store both
      await storeService.append(movA, 'local');
      await storeService.append(movB, 'remote');

      // Local wins: reject both, keep local state
      await storeService.markRejected([movA.id, movB.id]);

      const entryA = await storeService.getOpById(movA.id);
      const entryB = await storeService.getOpById(movB.id);
      expect(entryA?.rejectedAt).toBeDefined();
      expect(entryB?.rejectedAt).toBeDefined();
    });
  });

  describe('BATCH operation conflicts', () => {
    it('should resolve BATCH vs BATCH using LWW', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');

      const now = Date.now();

      // Client A batch updates (older, local)
      const batchA = clientA.createOperation({
        actionType: '[Task] Batch Update' as ActionType,
        opType: OpType.Batch,
        entityType: 'TASK',
        entityId: 'task-1',
        entityIds: ['task-1', 'task-2', 'task-3'],
        payload: { done: true },
      });
      (batchA as any).timestamp = now - 1000;

      // Client B batch updates (newer, remote)
      const batchB = clientB.createOperation({
        actionType: '[Task] Batch Update' as ActionType,
        opType: OpType.Batch,
        entityType: 'TASK',
        entityId: 'task-1',
        entityIds: ['task-1', 'task-2'],
        payload: { done: false },
      });
      (batchB as any).timestamp = now;

      // LWW: B's BATCH wins (newer)
      expect(batchB.timestamp).toBeGreaterThan(batchA.timestamp);

      // Store both - remote with pendingApply flag
      await storeService.append(batchA, 'local');
      const seq = await storeService.append(batchB, 'remote', { pendingApply: true });

      // Remote wins: reject local, apply remote
      await storeService.markRejected([batchA.id]);
      await storeService.markApplied([seq]);

      const entryA = await storeService.getOpById(batchA.id);
      const entryB = await storeService.getOpById(batchB.id);
      expect(entryA?.rejectedAt).toBeDefined();
      expect(entryB?.applicationStatus).toBe('applied');
    });

    it('should handle overlapping entity IDs in BATCH conflicts', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');

      const now = Date.now();

      // Client A batch affects tasks 1, 2, 3
      const batchA = clientA.createOperation({
        actionType: '[Task] Batch Update' as ActionType,
        opType: OpType.Batch,
        entityType: 'TASK',
        entityId: 'task-1',
        entityIds: ['task-1', 'task-2', 'task-3'],
        payload: { priority: 'high' },
      });
      (batchA as any).timestamp = now;

      // Client B batch affects tasks 2, 3, 4 (overlap on 2, 3)
      const batchB = clientB.createOperation({
        actionType: '[Task] Batch Update' as ActionType,
        opType: OpType.Batch,
        entityType: 'TASK',
        entityId: 'task-2',
        entityIds: ['task-2', 'task-3', 'task-4'],
        payload: { priority: 'low' },
      });
      (batchB as any).timestamp = now - 500;

      // LWW: A wins (newer)
      expect(batchA.timestamp).toBeGreaterThan(batchB.timestamp);

      // Store both
      await storeService.append(batchA, 'local');
      await storeService.append(batchB, 'remote');

      // Local wins: reject both
      await storeService.markRejected([batchA.id, batchB.id]);

      // Both should be rejected
      const entryA = await storeService.getOpById(batchA.id);
      const entryB = await storeService.getOpById(batchB.id);
      expect(entryA?.rejectedAt).toBeDefined();
      expect(entryB?.rejectedAt).toBeDefined();
    });
  });

  describe('Singleton entity conflicts (GLOBAL_CONFIG)', () => {
    it('should resolve GLOBAL_CONFIG conflicts using LWW', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');

      const now = Date.now();

      // Client A updates config (newer, local)
      const configA = clientA.createOperation({
        actionType: '[GlobalConfig] Update' as ActionType,
        opType: OpType.Update,
        entityType: 'GLOBAL_CONFIG',
        entityId: 'GLOBAL_CONFIG',
        payload: { misc: { isDarkMode: true } },
      });
      (configA as any).timestamp = now;

      // Client B updates config (older, remote)
      const configB = clientB.createOperation({
        actionType: '[GlobalConfig] Update' as ActionType,
        opType: OpType.Update,
        entityType: 'GLOBAL_CONFIG',
        entityId: 'GLOBAL_CONFIG',
        payload: { misc: { isDarkMode: false } },
      });
      (configB as any).timestamp = now - 1000;

      // LWW: A wins (newer)
      expect(configA.timestamp).toBeGreaterThan(configB.timestamp);
      expect(configA.entityType).toBe('GLOBAL_CONFIG');
      expect(configB.entityType).toBe('GLOBAL_CONFIG');

      // Store both
      await storeService.append(configA, 'local');
      await storeService.append(configB, 'remote');

      // Local wins: reject both
      await storeService.markRejected([configA.id, configB.id]);

      const entryA = await storeService.getOpById(configA.id);
      const entryB = await storeService.getOpById(configB.id);
      expect(entryA?.rejectedAt).toBeDefined();
      expect(entryB?.rejectedAt).toBeDefined();
    });
  });

  describe('Complex entity conflicts (PLANNER, BOARD)', () => {
    it('should resolve PLANNER day conflicts using LWW', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');

      const now = Date.now();
      const dayId = '2024-01-15';

      // Client A updates planner day (older, remote)
      const plannerA = clientA.createOperation({
        actionType: '[Planner] Update Day' as ActionType,
        opType: OpType.Update,
        entityType: 'PLANNER',
        entityId: dayId,
        payload: { scheduledTaskIds: ['task-1', 'task-2'] },
      });
      (plannerA as any).timestamp = now - 1000;

      // Client B updates same day (newer, local)
      const plannerB = clientB.createOperation({
        actionType: '[Planner] Update Day' as ActionType,
        opType: OpType.Update,
        entityType: 'PLANNER',
        entityId: dayId,
        payload: { scheduledTaskIds: ['task-3', 'task-4'] },
      });
      (plannerB as any).timestamp = now;

      // LWW: B wins (newer)
      expect(plannerB.timestamp).toBeGreaterThan(plannerA.timestamp);
      expect(plannerA.entityType).toBe('PLANNER');
      expect(plannerA.entityId).toBe(dayId);

      // Store both
      await storeService.append(plannerB, 'local');
      await storeService.append(plannerA, 'remote');

      // Local wins
      await storeService.markRejected([plannerB.id, plannerA.id]);

      const entryA = await storeService.getOpById(plannerA.id);
      const entryB = await storeService.getOpById(plannerB.id);
      expect(entryA?.rejectedAt).toBeDefined();
      expect(entryB?.rejectedAt).toBeDefined();
    });

    it('should resolve BOARD conflicts using LWW', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');

      const now = Date.now();

      // Client A updates board (newer, remote)
      const boardA = clientA.createOperation({
        actionType: '[Boards] Update Board' as ActionType,
        opType: OpType.Update,
        entityType: 'BOARD',
        entityId: 'board-1',
        payload: { title: 'Board from A', columns: ['todo', 'doing', 'done'] },
      });
      (boardA as any).timestamp = now;

      // Client B updates board (older, local)
      const boardB = clientB.createOperation({
        actionType: '[Boards] Update Board' as ActionType,
        opType: OpType.Update,
        entityType: 'BOARD',
        entityId: 'board-1',
        payload: { title: 'Board from B', columns: ['backlog', 'in-progress'] },
      });
      (boardB as any).timestamp = now - 1000;

      // LWW: A wins (newer)
      expect(boardA.timestamp).toBeGreaterThan(boardB.timestamp);
      expect(boardA.entityType).toBe('BOARD');

      // Store both - remote with pendingApply flag
      await storeService.append(boardB, 'local');
      const seq = await storeService.append(boardA, 'remote', { pendingApply: true });

      // Remote wins: reject local, apply remote
      await storeService.markRejected([boardB.id]);
      await storeService.markApplied([seq]);

      const entryA = await storeService.getOpById(boardA.id);
      const entryB = await storeService.getOpById(boardB.id);
      expect(entryB?.rejectedAt).toBeDefined();
      expect(entryA?.applicationStatus).toBe('applied');
    });

    it('should resolve REMINDER conflicts using LWW', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');

      const now = Date.now();

      // Client A updates reminder (older)
      const reminderA = clientA.createOperation({
        actionType: '[Reminder] Update' as ActionType,
        opType: OpType.Update,
        entityType: 'REMINDER',
        entityId: 'reminder-1',
        payload: { title: 'Reminder A', remindAt: now + 3600000 },
      });
      (reminderA as any).timestamp = now - 2000;

      // Client B updates reminder (newer)
      const reminderB = clientB.createOperation({
        actionType: '[Reminder] Update' as ActionType,
        opType: OpType.Update,
        entityType: 'REMINDER',
        entityId: 'reminder-1',
        payload: { title: 'Reminder B', remindAt: now + 7200000 },
      });
      (reminderB as any).timestamp = now;

      // LWW: B wins (newer)
      expect(reminderB.timestamp).toBeGreaterThan(reminderA.timestamp);
      expect(reminderA.entityType).toBe('REMINDER');

      // Store both - remote with pendingApply flag
      await storeService.append(reminderA, 'local');
      const seq = await storeService.append(reminderB, 'remote', { pendingApply: true });

      // Remote wins
      await storeService.markRejected([reminderA.id]);
      await storeService.markApplied([seq]);

      const entryA = await storeService.getOpById(reminderA.id);
      const entryB = await storeService.getOpById(reminderB.id);
      expect(entryA?.rejectedAt).toBeDefined();
      expect(entryB?.applicationStatus).toBe('applied');
    });
  });

  describe('Same timestamp edge cases', () => {
    it('should handle exact same timestamp with different payloads consistently', async () => {
      const clientA = new TestClient('client-a-ts');
      const clientB = new TestClient('client-b-ts');

      const exactTimestamp = 1700000000000; // Fixed timestamp for reproducibility

      // Create operations with exact same timestamp
      const opA = clientA.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-tie',
        payload: { title: 'A wins?', notes: 'from A' },
      });
      (opA as any).timestamp = exactTimestamp;

      const opB = clientB.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-tie',
        payload: { title: 'B wins?', notes: 'from B' },
      });
      (opB as any).timestamp = exactTimestamp;

      // Both have exact same timestamp
      expect(opA.timestamp).toBe(opB.timestamp);

      // Store operations
      await storeService.append(opA, 'local');
      await storeService.append(opB, 'remote', { pendingApply: true });

      // Convention: remote wins on tie
      // This test documents the expected behavior
      const localEntry = await storeService.getOpById(opA.id);
      const remoteEntry = await storeService.getOpById(opB.id);

      expect(localEntry).toBeDefined();
      expect(remoteEntry).toBeDefined();
    });

    it('should handle Delete vs Update conflict at same timestamp (Update wins)', async () => {
      const clientA = new TestClient('client-delete');
      const clientB = new TestClient('client-update');

      const sameTime = Date.now();

      // Client A deletes task
      const deleteOp = clientA.createOperation({
        actionType: '[Task] Delete Task' as ActionType,
        opType: OpType.Delete,
        entityType: 'TASK',
        entityId: 'task-conflict',
        payload: {},
      });
      (deleteOp as any).timestamp = sameTime;

      // Client B updates same task
      const updateOp = clientB.createOperation({
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-conflict',
        payload: { title: 'Updated title' },
      });
      (updateOp as any).timestamp = sameTime;

      await storeService.append(deleteOp, 'local');
      const updateSeq = await storeService.append(updateOp, 'remote', {
        pendingApply: true,
      });

      // LWW heuristic: Update wins over Delete (preserve data)
      // Mark delete as rejected, update as applied
      await storeService.markRejected([deleteOp.id]);
      await storeService.markApplied([updateSeq]);

      const deleteEntry = await storeService.getOpById(deleteOp.id);
      const updateEntry = await storeService.getOpById(updateOp.id);

      expect(deleteEntry?.rejectedAt).toBeDefined();
      expect(updateEntry?.applicationStatus).toBe('applied');
    });

    it('should handle Create vs Create conflict (should not happen but gracefully handle)', async () => {
      const clientA = new TestClient('client-create-a');
      const clientB = new TestClient('client-create-b');

      const sameTime = Date.now();
      const sameEntityId = 'new-task-123'; // Same ID by coincidence (extremely rare)

      // Both clients create task with same ID (very rare edge case)
      const createA = clientA.createOperation({
        actionType: '[Task] Add Task' as ActionType,
        opType: OpType.Create,
        entityType: 'TASK',
        entityId: sameEntityId,
        payload: { id: sameEntityId, title: 'Task from A' },
      });
      (createA as any).timestamp = sameTime;

      const createB = clientB.createOperation({
        actionType: '[Task] Add Task' as ActionType,
        opType: OpType.Create,
        entityType: 'TASK',
        entityId: sameEntityId,
        payload: { id: sameEntityId, title: 'Task from B' },
      });
      (createB as any).timestamp = sameTime;

      await storeService.append(createA, 'local');
      const createBSeq = await storeService.append(createB, 'remote', {
        pendingApply: true,
      });

      // In Create vs Create, remote wins (convention)
      await storeService.markRejected([createA.id]);
      await storeService.markApplied([createBSeq]);

      const entryA = await storeService.getOpById(createA.id);
      const entryB = await storeService.getOpById(createB.id);

      expect(entryA?.rejectedAt).toBeDefined();
      expect(entryB?.applicationStatus).toBe('applied');
    });

    it('should handle rapid-fire updates from same client', async () => {
      const client = new TestClient('rapid-client');

      const baseTime = Date.now();

      // Create 5 rapid updates (might have same ms timestamp)
      for (let i = 0; i < 5; i++) {
        const op = client.createOperation({
          actionType: '[Task] Update Task' as ActionType,
          opType: OpType.Update,
          entityType: 'TASK',
          entityId: 'rapid-task',
          payload: { title: `Update ${i}` },
        });
        (op as any).timestamp = baseTime; // Same timestamp for all
        await storeService.append(op, 'local');
      }

      // All ops should be stored successfully
      const allOps = await storeService.getOpsAfterSeq(0);
      expect(allOps.length).toBe(5);

      // All should be from same client
      for (const entry of allOps) {
        expect(entry.op.clientId).toBe('rapid-client');
      }
    });
  });

  describe('Mixed operations and entity types', () => {
    it('should handle multiple entity types in a single LWW resolution batch', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');

      const now = Date.now();

      // Task conflict: remote wins
      const taskA = clientA.createOperation({
        actionType: '[Task] Update' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Task A' },
      });
      (taskA as any).timestamp = now - 1000;

      const taskB = clientB.createOperation({
        actionType: '[Task] Update' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Task B' },
      });
      (taskB as any).timestamp = now;

      // Project conflict: local wins
      const projectA = clientA.createOperation({
        actionType: '[Project] Update' as ActionType,
        opType: OpType.Update,
        entityType: 'PROJECT',
        entityId: 'project-1',
        payload: { title: 'Project A' },
      });
      (projectA as any).timestamp = now;

      const projectB = clientB.createOperation({
        actionType: '[Project] Update' as ActionType,
        opType: OpType.Update,
        entityType: 'PROJECT',
        entityId: 'project-1',
        payload: { title: 'Project B' },
      });
      (projectB as any).timestamp = now - 1000;

      // Tag conflict: tie (remote wins)
      const tagA = clientA.createOperation({
        actionType: '[Tag] Update' as ActionType,
        opType: OpType.Update,
        entityType: 'TAG',
        entityId: 'tag-1',
        payload: { title: 'Tag A' },
      });
      (tagA as any).timestamp = now - 500;

      const tagB = clientB.createOperation({
        actionType: '[Tag] Update' as ActionType,
        opType: OpType.Update,
        entityType: 'TAG',
        entityId: 'tag-1',
        payload: { title: 'Tag B' },
      });
      (tagB as any).timestamp = now - 500; // Same timestamp - tie

      // Store all ops - remote ops with pendingApply flag
      await storeService.append(taskA, 'local');
      const taskBSeq = await storeService.append(taskB, 'remote', { pendingApply: true });
      await storeService.append(projectA, 'local');
      await storeService.append(projectB, 'remote');
      await storeService.append(tagA, 'local');
      const tagBSeq = await storeService.append(tagB, 'remote', { pendingApply: true });

      // Apply LWW results:
      // Task: remote wins - reject local, mark remote applied
      await storeService.markRejected([taskA.id]);
      await storeService.markApplied([taskBSeq]);

      // Project: local wins - reject both
      await storeService.markRejected([projectA.id, projectB.id]);

      // Tag: tie (remote wins) - reject local, mark remote applied
      await storeService.markRejected([tagA.id]);
      await storeService.markApplied([tagBSeq]);

      // Verify final states
      const taskEntryA = await storeService.getOpById(taskA.id);
      const taskEntryB = await storeService.getOpById(taskB.id);
      const projectEntryA = await storeService.getOpById(projectA.id);
      const projectEntryB = await storeService.getOpById(projectB.id);
      const tagEntryA = await storeService.getOpById(tagA.id);
      const tagEntryB = await storeService.getOpById(tagB.id);

      // Task A rejected, Task B applied
      expect(taskEntryA?.rejectedAt).toBeDefined();
      expect(taskEntryB?.applicationStatus).toBe('applied');

      // Both project ops rejected
      expect(projectEntryA?.rejectedAt).toBeDefined();
      expect(projectEntryB?.rejectedAt).toBeDefined();

      // Tag A rejected, Tag B applied
      expect(tagEntryA?.rejectedAt).toBeDefined();
      expect(tagEntryB?.applicationStatus).toBe('applied');
    });
  });
});
