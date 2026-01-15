import { TestBed } from '@angular/core/testing';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { VectorClockService } from '../../sync/vector-clock.service';
import {
  ActionType,
  Operation,
  OpType,
  EntityType,
  VectorClock,
} from '../../core/operation.types';
import { uuidv7 } from '../../../util/uuid-v7';
import { resetTestUuidCounter } from './helpers/test-client.helper';

/**
 * Integration tests for Vector Clock Sync (Performance Optimization)
 *
 * These tests verify the vector clock synchronization between:
 * - SUP_OPS.vector_clock (single source of truth, fast path)
 * - pf.META_MODEL.vectorClock (legacy sync compatibility)
 *
 * Key scenarios tested:
 * 1. Atomic writes - operation + vector clock in single transaction
 * 2. VectorClockService fast path - reads from SUP_OPS first
 * 3. VectorClockService fallback - computes from snapshot+ops if store empty
 * 4. Migration path - vector clock migrated from pf.META_MODEL on upgrade
 * 5. Multi-client scenarios - multiple clients incrementing their clocks
 */
describe('Vector Clock Sync Integration', () => {
  let opLogStore: OperationLogStoreService;
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

    opLogStore = TestBed.inject(OperationLogStoreService);
    vectorClockService = TestBed.inject(VectorClockService);

    await opLogStore.init();
    await opLogStore._clearAllDataForTesting();
    resetTestUuidCounter();
  });

  afterEach(async () => {
    await opLogStore._clearAllDataForTesting();
  });

  describe('Atomic Operation + Vector Clock Writes', () => {
    it('should write operation and vector clock in single transaction', async () => {
      const op = createTestOperation({
        vectorClock: { clientA: 1 },
      });

      await opLogStore.appendWithVectorClockUpdate(op, 'local');

      // Both should be written
      const ops = await opLogStore.getOpsAfterSeq(0);
      expect(ops.length).toBe(1);

      const clock = await opLogStore.getVectorClock();
      expect(clock).toEqual({ clientA: 1 });
    });

    it('should maintain consistency across multiple sequential writes', async () => {
      // Simulate a typical workflow: multiple operations from same client
      for (let i = 1; i <= 5; i++) {
        const op = createTestOperation({
          entityId: `task-${i}`,
          vectorClock: { clientA: i },
        });
        await opLogStore.appendWithVectorClockUpdate(op, 'local');
      }

      const ops = await opLogStore.getOpsAfterSeq(0);
      expect(ops.length).toBe(5);

      const clock = await opLogStore.getVectorClock();
      expect(clock).toEqual({ clientA: 5 });
    });

    it('should handle multi-client vector clocks', async () => {
      // Client A creates operation
      const opA = createTestOperation({
        clientId: 'clientA',
        entityId: 'task-1',
        vectorClock: { clientA: 1 },
      });
      await opLogStore.appendWithVectorClockUpdate(opA, 'local');

      // Client A receives remote from B and creates new operation
      const opA2 = createTestOperation({
        clientId: 'clientA',
        entityId: 'task-2',
        vectorClock: { clientA: 2, clientB: 3 },
      });
      await opLogStore.appendWithVectorClockUpdate(opA2, 'local');

      const clock = await opLogStore.getVectorClock();
      expect(clock).toEqual({ clientA: 2, clientB: 3 });
    });
  });

  describe('VectorClockService Fast Path', () => {
    it('should read from vector_clock store as primary source', async () => {
      // Set vector clock directly
      await opLogStore.setVectorClock({ directClient: 100 });

      // VectorClockService should use fast path
      const clock = await vectorClockService.getCurrentVectorClock();
      expect(clock).toEqual({ directClient: 100 });
    });

    it('should return stored clock even when snapshot exists', async () => {
      // Set up both: vector_clock store and snapshot
      await opLogStore.setVectorClock({ storeClient: 50 });

      await opLogStore.saveStateCache({
        state: {},
        lastAppliedOpSeq: 0,
        vectorClock: { snapshotClient: 100 },
        compactedAt: Date.now(),
      });

      // Should return from vector_clock store, not snapshot
      const clock = await vectorClockService.getCurrentVectorClock();
      expect(clock).toEqual({ storeClient: 50 });
    });
  });

  describe('VectorClockService Fallback Path', () => {
    it('should compute from snapshot when vector_clock store is empty', async () => {
      // Only snapshot exists (simulates pre-upgrade state)
      await opLogStore.saveStateCache({
        state: {},
        lastAppliedOpSeq: 0,
        vectorClock: { snapshotClient: 25 },
        compactedAt: Date.now(),
      });

      const clock = await vectorClockService.getCurrentVectorClock();
      expect(clock).toEqual({ snapshotClient: 25 });
    });

    it('should merge snapshot + ops when vector_clock store is empty', async () => {
      // Snapshot with initial clock
      await opLogStore.saveStateCache({
        state: {},
        lastAppliedOpSeq: 0,
        vectorClock: { clientA: 10, clientB: 5 },
        compactedAt: Date.now(),
      });

      // Ops after snapshot (using regular append, not appendWithVectorClockUpdate)
      const op1 = createTestOperation({
        vectorClock: { clientA: 11, clientB: 5 },
      });
      const op2 = createTestOperation({
        vectorClock: { clientA: 11, clientB: 6 },
      });
      await opLogStore.append(op1);
      await opLogStore.append(op2);

      // Should merge to get max values
      const clock = await vectorClockService.getCurrentVectorClock();
      expect(clock.clientA).toBe(11);
      expect(clock.clientB).toBe(6);
    });

    it('should return empty clock when no data exists', async () => {
      const clock = await vectorClockService.getCurrentVectorClock();
      expect(clock).toEqual({});
    });
  });

  describe('Remote Operation Handling', () => {
    it('should NOT update vector_clock store for remote operations', async () => {
      // Set initial local clock
      await opLogStore.setVectorClock({ localClient: 10 });

      // Receive remote operation
      const remoteOp = createTestOperation({
        clientId: 'remoteClient',
        vectorClock: { remoteClient: 50 },
      });
      await opLogStore.appendWithVectorClockUpdate(remoteOp, 'remote');

      // Local clock should be unchanged
      const clock = await opLogStore.getVectorClock();
      expect(clock).toEqual({ localClient: 10 });
    });

    it('should store remote operations but not affect local vector clock', async () => {
      // Local op first
      const localOp = createTestOperation({
        clientId: 'localClient',
        entityId: 'task-local',
        vectorClock: { localClient: 1 },
      });
      await opLogStore.appendWithVectorClockUpdate(localOp, 'local');

      // Remote ops should be stored but not affect clock
      for (let i = 1; i <= 3; i++) {
        const remoteOp = createTestOperation({
          clientId: 'remoteClient',
          entityId: `task-remote-${i}`,
          vectorClock: { remoteClient: i, localClient: 1 },
        });
        await opLogStore.appendWithVectorClockUpdate(remoteOp, 'remote');
      }

      // All ops should be stored
      const ops = await opLogStore.getOpsAfterSeq(0);
      expect(ops.length).toBe(4);

      // But local clock should only reflect local operations
      const clock = await opLogStore.getVectorClock();
      expect(clock).toEqual({ localClient: 1 });
    });
  });

  describe('Vector Clock Entry (with lastUpdate)', () => {
    it('should track lastUpdate timestamp with vector clock', async () => {
      const beforeTime = Date.now();
      await opLogStore.setVectorClock({ clientA: 5 });
      const afterTime = Date.now();

      const entry = await opLogStore.getVectorClockEntry();

      expect(entry).not.toBeNull();
      expect(entry!.clock).toEqual({ clientA: 5 });
      expect(entry!.lastUpdate).toBeGreaterThanOrEqual(beforeTime);
      expect(entry!.lastUpdate).toBeLessThanOrEqual(afterTime);
    });

    it('should update lastUpdate on each vector clock change', async () => {
      await opLogStore.setVectorClock({ clientA: 1 });
      const entry1 = await opLogStore.getVectorClockEntry();

      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 5));

      await opLogStore.setVectorClock({ clientA: 2 });
      const entry2 = await opLogStore.getVectorClockEntry();

      expect(entry2!.lastUpdate).toBeGreaterThanOrEqual(entry1!.lastUpdate);
    });
  });

  describe('Sync Simulation: Legacy Provider Flow', () => {
    /**
     * Simulates the full sync flow for legacy providers (WebDAV/Dropbox):
     * 1. Local operations update SUP_OPS.vector_clock
     * 2. Before sync: _syncVectorClockToPfapi() copies to pf.META_MODEL
     * 3. Sync compares vector clocks
     * 4. After download: _syncVectorClockFromPfapi() copies back to SUP_OPS
     */

    it('should maintain clock through simulated sync upload cycle', async () => {
      // 1. Local operations
      for (let i = 1; i <= 3; i++) {
        const op = createTestOperation({
          entityId: `task-${i}`,
          vectorClock: { localClient: i },
        });
        await opLogStore.appendWithVectorClockUpdate(op, 'local');
      }

      // 2. Read clock for sync (simulates _syncVectorClockToPfapi reading)
      const clockForSync = await opLogStore.getVectorClockEntry();
      expect(clockForSync!.clock).toEqual({ localClient: 3 });

      // 3. After sync upload, clock should be unchanged
      const clockAfterSync = await opLogStore.getVectorClock();
      expect(clockAfterSync).toEqual({ localClient: 3 });
    });

    it('should restore clock after simulated sync download', async () => {
      // Simulate: Client downloads data from remote
      // After download, pf.META_MODEL has the remote vector clock
      // _syncVectorClockFromPfapi should copy it to SUP_OPS

      // Simulate the copy from pf.META_MODEL to SUP_OPS
      const remoteVectorClock: VectorClock = {
        remoteClient: 50,
        anotherClient: 25,
      };
      await opLogStore.setVectorClock(remoteVectorClock);

      // Verify it's stored
      const clock = await opLogStore.getVectorClock();
      expect(clock).toEqual(remoteVectorClock);

      // VectorClockService should now return the remote clock
      const serviceClock = await vectorClockService.getCurrentVectorClock();
      expect(serviceClock).toEqual(remoteVectorClock);
    });

    it('should allow new local operations after downloading remote data', async () => {
      // 1. Download remote clock
      const remoteClock: VectorClock = { remoteClient: 10 };
      await opLogStore.setVectorClock(remoteClock);

      // 2. Local client creates new operation, incrementing their own counter
      const localOp = createTestOperation({
        clientId: 'localClient',
        vectorClock: { remoteClient: 10, localClient: 1 },
      });
      await opLogStore.appendWithVectorClockUpdate(localOp, 'local');

      // 3. Clock should now include both clients
      const clock = await opLogStore.getVectorClock();
      expect(clock).toEqual({ remoteClient: 10, localClient: 1 });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty vector clock', async () => {
      await opLogStore.setVectorClock({});

      const clock = await opLogStore.getVectorClock();
      expect(clock).toEqual({});

      const entry = await opLogStore.getVectorClockEntry();
      expect(entry!.clock).toEqual({});
    });

    it('should handle very large counter values', async () => {
      const largeClock: VectorClock = {
        client1: Number.MAX_SAFE_INTEGER - 1,
        client2: 999999999,
      };
      await opLogStore.setVectorClock(largeClock);

      const clock = await opLogStore.getVectorClock();
      expect(clock).toEqual(largeClock);
    });

    it('should handle many clients in vector clock', async () => {
      const manyClock: VectorClock = {};
      for (let i = 0; i < 8; i++) {
        manyClock[`client-${i}`] = i + 1;
      }
      await opLogStore.setVectorClock(manyClock);

      const clock = await opLogStore.getVectorClock();
      expect(clock).not.toBeNull();
      expect(Object.keys(clock!).length).toBe(8);
      expect(clock!['client-7']).toBe(8);
    });
  });
});
