/* eslint-disable @typescript-eslint/naming-convention */
import { TestBed } from '@angular/core/testing';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { Operation, OpType } from '../../core/operation.types';
import { resetTestUuidCounter } from './helpers/test-client.helper';
import { MockSyncServer } from './helpers/mock-sync-server.helper';
import { SimulatedClient } from './helpers/simulated-client.helper';
import { createMinimalTaskPayload } from './helpers/operation-factory.helper';
import {
  compareVectorClocks,
  VectorClockComparison,
} from '../../../core/util/vector-clock';
import { MAX_VECTOR_CLOCK_SIZE } from '../../core/operation-log.const';
import { limitVectorClockSize } from '@sp/shared-schema';
import { uuidv7 } from '../../../util/uuid-v7';
import { SyncImportFilterService } from '../../sync/sync-import-filter.service';

/**
 * Local copy of isLikelyPruningArtifact logic for testing.
 * Cannot import the function directly from the service file because Angular's
 * webpack build only exposes class exports from .service.ts files.
 */
const isLikelyPruningArtifact = (
  opClock: Record<string, number>,
  opClientId: string,
  importClock: Record<string, number>,
): boolean => {
  if (opClientId in importClock) return false;
  if (Object.keys(importClock).length < MAX_VECTOR_CLOCK_SIZE) return false;
  const sharedKeys = Object.keys(opClock).filter((k) => k in importClock);
  if (sharedKeys.length === 0) return false;
  return sharedKeys.every((k) => opClock[k] >= importClock[k]);
};

/**
 * Integration tests for vector clock behavior after SYNC_IMPORT.
 *
 * Tests the scenario where:
 * 1. Multiple clients have been syncing, pushing vector clocks to MAX_VECTOR_CLOCK_SIZE
 * 2. One client performs a SYNC_IMPORT (import file)
 * 3. All clients re-sync and then create new tasks
 * 4. New tasks from all clients should be accepted (not filtered as pre-import)
 *
 * This validates that:
 * - The import's vector clock carries forward the importing client's causal knowledge
 * - Post-import operations from all clients are recognized as post-import (GREATER_THAN)
 * - The SyncImportFilterService correctly keeps post-import ops even when clocks grow back to MAX
 * - Pruning artifacts are handled correctly for new clients joining after import
 */
describe('Vector Clock Import Reset Integration', () => {
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

  /**
   * Helper: Create N clients with unique IDs of at least 5 characters.
   */
  const createClients = (
    count: number,
    store: OperationLogStoreService,
  ): SimulatedClient[] => {
    return Array.from(
      { length: count },
      (_, i) => new SimulatedClient(`client-${String(i).padStart(3, '0')}`, store),
    );
  };

  describe('Vector clock grows back to MAX after import', () => {
    /**
     * Test: After a SYNC_IMPORT, the vector clock grows back to MAX as clients resume syncing.
     *
     * Demonstrates WHY the vector clock grows back:
     * 1. The import operation inherits the importing client's accumulated causal knowledge
     * 2. Each client that syncs after the import merges the import's clock and adds its own entry
     * 3. After MAX clients have synced, the clock is back at MAX_VECTOR_CLOCK_SIZE
     */
    it('should demonstrate vector clock growing back to MAX after import', async () => {
      // Use MAX_VECTOR_CLOCK_SIZE clients to fill the clock
      const numClients = MAX_VECTOR_CLOCK_SIZE;
      const clients = createClients(numClients, storeService);

      // Phase 1: Each client creates a task and syncs, building up the clock
      for (let i = 0; i < numClients; i++) {
        await clients[i].createLocalOp(
          'TASK',
          `task-pre-${i}`,
          OpType.Create,
          '[Task] Add Task',
          createMinimalTaskPayload(`task-pre-${i}`, { title: `Pre-import Task ${i}` }),
        );
        await clients[i].sync(server);
      }

      // All clients sync again to download all other clients' ops
      for (let i = 0; i < numClients; i++) {
        await clients[i].sync(server);
      }

      // Verify clocks have grown: client-000 should know about multiple clients
      const preImportClock = clients[0].getCurrentClock();
      const preImportClockSize = Object.keys(preImportClock).length;
      expect(preImportClockSize).toBeGreaterThanOrEqual(numClients);

      // Phase 2: Client 0 performs a SYNC_IMPORT
      const importOp = await clients[0].createLocalOp(
        'ALL',
        uuidv7(),
        OpType.SyncImport,
        '[SP_ALL] Load(import) all data',
        {
          appDataComplete: {
            task: {
              ids: ['imported-task-1'],
              entities: {
                'imported-task-1': createMinimalTaskPayload('imported-task-1', {
                  title: 'Imported Task',
                }),
              },
            },
          },
        },
      );
      await clients[0].sync(server);

      // The import's clock should carry the importing client's knowledge of all clients
      const importClockSize = Object.keys(importOp.vectorClock).length;
      expect(importClockSize).toBeGreaterThanOrEqual(numClients);

      // Phase 3: All other clients sync to receive the import
      for (let i = 1; i < numClients; i++) {
        await clients[i].sync(server);
      }

      // Phase 4: Each client creates a new task post-import and syncs
      for (let i = 0; i < numClients; i++) {
        await clients[i].createLocalOp(
          'TASK',
          `task-post-${i}`,
          OpType.Create,
          '[Task] Add Task',
          createMinimalTaskPayload(`task-post-${i}`, {
            title: `Post-import Task ${i}`,
          }),
        );
        await clients[i].sync(server);
      }

      // Verify: post-import ops should have clocks >= the import's clock
      const serverOps = server.getAllOps();
      const postImportOps = serverOps.filter((sop) =>
        sop.op.entityId?.startsWith('task-post-'),
      );
      expect(postImportOps.length).toBe(numClients);

      // Every post-import op should be GREATER_THAN or EQUAL to the import's clock
      for (const postOp of postImportOps) {
        const comparison = compareVectorClocks(
          postOp.op.vectorClock,
          importOp.vectorClock,
        );
        expect(comparison)
          .withContext(
            `Post-import op from ${postOp.op.clientId} should be GREATER_THAN import, got ${comparison}`,
          )
          .toBe(VectorClockComparison.GREATER_THAN);
      }

      // The last client's clock should be back near MAX size
      const lastClientClock = clients[numClients - 1].getCurrentClock();
      const lastClockSize = Object.keys(lastClientClock).length;
      expect(lastClockSize).toBeGreaterThanOrEqual(numClients);
    });
  });

  describe('SyncImportFilterService keeps post-import ops after clock regrowth', () => {
    /**
     * Core test: Multiple clients at MAX vector clock → import on one client → resync →
     * new tasks from all clients should pass the SyncImportFilterService filter.
     *
     * This is the primary scenario the user asked about:
     * - Start with MAX_VECTOR_CLOCK_SIZE clients all synced
     * - One client imports a file
     * - After resync, new tasks added on ALL clients must survive filtering
     */
    it('should keep new tasks from all clients after import and resync', async () => {
      const numClients = MAX_VECTOR_CLOCK_SIZE;
      const clients = createClients(numClients, storeService);

      // Phase 1: Build up vector clocks to MAX by having all clients create tasks and sync
      for (let round = 0; round < 2; round++) {
        for (let i = 0; i < numClients; i++) {
          await clients[i].createLocalOp(
            'TASK',
            `task-round${round}-${i}`,
            OpType.Create,
            '[Task] Add Task',
            createMinimalTaskPayload(`task-round${round}-${i}`),
          );
          await clients[i].sync(server);
        }
      }

      // Final sync pass to ensure all clients have downloaded everything
      for (let i = 0; i < numClients; i++) {
        await clients[i].sync(server);
      }

      // Verify clocks are at MAX
      const preClock = clients[0].getCurrentClock();
      expect(Object.keys(preClock).length).toBeGreaterThanOrEqual(numClients);

      // Phase 2: Client 0 imports
      await clients[0].createLocalOp(
        'ALL',
        uuidv7(),
        OpType.SyncImport,
        '[SP_ALL] Load(import) all data',
        {
          appDataComplete: {
            task: {
              ids: ['fresh-import-task'],
              entities: {
                'fresh-import-task': createMinimalTaskPayload('fresh-import-task', {
                  title: 'Fresh Import',
                }),
              },
            },
          },
        },
      );
      await clients[0].sync(server);

      // Phase 3: All other clients sync to receive the import
      for (let i = 1; i < numClients; i++) {
        await clients[i].sync(server);
      }

      // Phase 4: All clients create new post-import tasks and sync
      const postImportOps: Operation[] = [];
      for (let i = 0; i < numClients; i++) {
        const op = await clients[i].createLocalOp(
          'TASK',
          `task-new-${i}`,
          OpType.Create,
          '[Task] Add Task',
          createMinimalTaskPayload(`task-new-${i}`, {
            title: `New Task from client ${i}`,
          }),
        );
        postImportOps.push(op);
        await clients[i].sync(server);
      }

      // Phase 5: Verify using SyncImportFilterService
      // Set up the service with the import stored in the op log
      const filterService = TestBed.inject(SyncImportFilterService);

      // The filter should keep all post-import ops
      const result = await filterService.filterOpsInvalidatedBySyncImport(postImportOps);

      expect(result.invalidatedOps.length)
        .withContext(
          `Expected 0 invalidated ops but got ${result.invalidatedOps.length}: ` +
            result.invalidatedOps.map((op) => `${op.clientId}:${op.entityId}`).join(', '),
        )
        .toBe(0);
      expect(result.validOps.length).toBe(numClients);
    });

    /**
     * Verify that pre-import ops from other clients ARE correctly filtered.
     * This ensures the filter isn't just passing everything through.
     */
    it('should filter pre-import ops from clients that did not see the import', async () => {
      const clientA = new SimulatedClient('client-aaa', storeService);
      const clientB = new SimulatedClient('client-bbb', storeService);
      const clientC = new SimulatedClient('client-ccc', storeService);

      // Client A and B create tasks and sync
      await clientA.createLocalOp(
        'TASK',
        'taskA',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('taskA'),
      );
      await clientA.sync(server);

      await clientB.createLocalOp(
        'TASK',
        'taskB',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('taskB'),
      );
      await clientB.sync(server);

      // Sync both clients to converge
      await clientA.sync(server);
      await clientB.sync(server);

      // Client A performs import
      const importOp = await clientA.createLocalOp(
        'ALL',
        uuidv7(),
        OpType.SyncImport,
        '[SP_ALL] Load(import) all data',
        {
          appDataComplete: {
            task: {
              ids: ['import-only-task'],
              entities: {
                'import-only-task': createMinimalTaskPayload('import-only-task'),
              },
            },
          },
        },
      );
      await clientA.sync(server);

      // Client C creates a task WITHOUT having synced the import
      // (simulates a client that was offline during the import)
      const preImportOp = await clientC.createLocalOp(
        'TASK',
        'taskC-pre',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('taskC-pre', { title: 'Pre-import from C' }),
      );

      // Client B syncs (receives import), then creates post-import task
      await clientB.sync(server);
      const postImportOpB = await clientB.createLocalOp(
        'TASK',
        'taskB-post',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('taskB-post', { title: 'Post-import from B' }),
      );

      // Verify: pre-import op from C should be CONCURRENT with the import
      const comparisonC = compareVectorClocks(
        preImportOp.vectorClock,
        importOp.vectorClock,
      );
      expect(comparisonC).toBe(VectorClockComparison.CONCURRENT);

      // Verify: post-import op from B should be GREATER_THAN the import
      const comparisonB = compareVectorClocks(
        postImportOpB.vectorClock,
        importOp.vectorClock,
      );
      expect(comparisonB).toBe(VectorClockComparison.GREATER_THAN);

      // Use SyncImportFilterService
      const filterService = TestBed.inject(SyncImportFilterService);
      const result = await filterService.filterOpsInvalidatedBySyncImport([
        preImportOp,
        postImportOpB,
      ]);

      // Pre-import op from C should be filtered
      expect(result.invalidatedOps.length).toBe(1);
      expect(result.invalidatedOps[0].entityId).toBe('taskC-pre');

      // Post-import op from B should be kept
      expect(result.validOps.length).toBe(1);
      expect(result.validOps[0].entityId).toBe('taskB-post');
    });
  });

  describe('Post-import ops with pruned clocks', () => {
    /**
     * Test: When MORE than MAX clients exist, post-import clocks get pruned.
     * The isLikelyPruningArtifact heuristic should rescue these ops.
     *
     * Scenario:
     * 1. MAX clients sync, filling vector clocks to MAX
     * 2. Client 0 imports (import clock has MAX entries)
     * 3. A NEW client (client MAX+1) joins after the import
     * 4. New client syncs import, creates task → clock has MAX+1 entries
     * 5. Server prunes to MAX → drops one inherited entry
     * 6. Comparing pruned clock to import clock → CONCURRENT (pruning artifact)
     * 7. isLikelyPruningArtifact should detect this and keep the op
     */
    it('should recognize post-import ops from new clients as pruning artifacts', () => {
      // Build an import clock at MAX size
      const importClock: Record<string, number> = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
        importClock[`client-${String(i).padStart(3, '0')}`] = 10 + i;
      }

      // New client joins after import, inherits import's clock, adds own entry
      const newClientId = 'client-new-01';
      const newClientClock: Record<string, number> = { ...importClock };
      newClientClock[newClientId] = 1; // New client's first op
      // Now clock has MAX+1 entries

      // Server prunes using limitVectorClockSize, preserving the uploading
      // client's ID (this is what the real server does).
      const prunedClock = limitVectorClockSize(newClientClock, [newClientId]);

      // The pruned clock keeps the new client but drops the lowest import entry
      expect(Object.keys(prunedClock).length).toBe(MAX_VECTOR_CLOCK_SIZE);
      expect(prunedClock[newClientId]).toBe(1); // Preserved by server

      // Direct comparison should return CONCURRENT (both at MAX, different keys)
      const comparison = compareVectorClocks(prunedClock, importClock);
      expect(comparison).toBe(VectorClockComparison.CONCURRENT);

      // But isLikelyPruningArtifact should detect this as a pruning artifact
      const isPruningArtifact = isLikelyPruningArtifact(
        prunedClock,
        newClientId,
        importClock,
      );
      expect(isPruningArtifact)
        .withContext('New client post-import op should be recognized as pruning artifact')
        .toBe(true);
    });

    /**
     * Test: Genuine concurrent ops from unknown clients should NOT be
     * treated as pruning artifacts.
     */
    it('should NOT treat genuinely concurrent ops as pruning artifacts', () => {
      // Import clock at MAX size
      const importClock: Record<string, number> = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
        importClock[`client-${String(i).padStart(3, '0')}`] = 10 + i;
      }

      // Genuine concurrent client: doesn't know about the import at all
      // Has its own completely independent clock
      const concurrentClientId = 'client-concurrent';
      const concurrentClock: Record<string, number> = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
        concurrentClock[`other-client-${i}`] = 5 + i;
      }

      const comparison = compareVectorClocks(concurrentClock, importClock);
      expect(comparison).toBe(VectorClockComparison.CONCURRENT);

      // Should NOT be a pruning artifact: no shared keys with import
      const isPruningArtifact = isLikelyPruningArtifact(
        concurrentClock,
        concurrentClientId,
        importClock,
      );
      expect(isPruningArtifact).toBe(false);
    });

    /**
     * Test: A client that existed before the import and created ops concurrently
     * should NOT be treated as a pruning artifact.
     */
    it('should NOT treat pre-existing concurrent client ops as pruning artifacts', () => {
      // Import clock knows about client-xxx
      const importClock: Record<string, number> = {
        'client-000': 10,
        'client-001': 8,
        'client-002': 12,
        'client-003': 6,
        'client-004': 15,
      };

      // client-001 existed in import but created ops concurrently
      // (its counter went higher than import knew, but import has higher values for others)
      const concurrentClock: Record<string, number> = {
        'client-001': 20, // Higher than import's 8
        'client-005': 3, // Unknown to import
      };

      // client-001 IS in the import clock → cannot be a pruning artifact
      const isPruningArtifact = isLikelyPruningArtifact(
        concurrentClock,
        'client-001',
        importClock,
      );
      expect(isPruningArtifact).toBe(false);
    });
  });

  describe('Full multi-client lifecycle with MAX clock, import, and resync', () => {
    /**
     * End-to-end scenario: MAX clients → import → resync → new tasks from all clients.
     *
     * This is the complete integration test covering the full lifecycle:
     * 1. Create MAX_VECTOR_CLOCK_SIZE clients
     * 2. Each client creates multiple tasks and syncs (clocks grow to MAX)
     * 3. Client 0 imports a file (resets state)
     * 4. All clients resync to receive the import
     * 5. All clients create new tasks
     * 6. All clients sync new tasks
     * 7. Verify: all new tasks are on the server and their vector clocks
     *    correctly show GREATER_THAN relative to the import
     */
    it('should handle full lifecycle: MAX clock → import → resync → new tasks sync correctly', async () => {
      const numClients = MAX_VECTOR_CLOCK_SIZE;
      const clients = createClients(numClients, storeService);

      // === Phase 1: Build up clocks to MAX ===
      // Multiple rounds of create-and-sync to ensure clocks accumulate all client IDs
      for (let round = 0; round < 3; round++) {
        for (let i = 0; i < numClients; i++) {
          await clients[i].createLocalOp(
            'TASK',
            `task-r${round}-c${i}`,
            OpType.Create,
            '[Task] Add Task',
            createMinimalTaskPayload(`task-r${round}-c${i}`, {
              title: `Round ${round} Client ${i}`,
            }),
          );
          await clients[i].sync(server);
        }
      }
      // Final convergence sync
      for (let i = 0; i < numClients; i++) {
        await clients[i].sync(server);
      }

      // Snapshot: count server ops before import
      const preImportServerOpCount = server.getAllOps().length;
      expect(preImportServerOpCount).toBe(numClients * 3); // 3 rounds × numClients

      // === Phase 2: Client 0 imports ===
      const importOp = await clients[0].createLocalOp(
        'ALL',
        uuidv7(),
        OpType.SyncImport,
        '[SP_ALL] Load(import) all data',
        {
          appDataComplete: {
            task: {
              ids: ['imported-main-task'],
              entities: {
                'imported-main-task': createMinimalTaskPayload('imported-main-task', {
                  title: 'The Imported State',
                }),
              },
            },
          },
        },
      );
      await clients[0].sync(server);

      // Import clock should have entries for all clients (inherited from pre-import syncing)
      const importClockEntries = Object.keys(importOp.vectorClock).length;
      expect(importClockEntries).toBeGreaterThanOrEqual(numClients);

      // === Phase 3: All other clients resync (download the import) ===
      for (let i = 1; i < numClients; i++) {
        await clients[i].sync(server);
      }

      // === Phase 4: All clients create new tasks ===
      const newTaskIds: string[] = [];
      for (let i = 0; i < numClients; i++) {
        const taskId = `new-task-from-client-${i}`;
        newTaskIds.push(taskId);
        await clients[i].createLocalOp(
          'TASK',
          taskId,
          OpType.Create,
          '[Task] Add Task',
          createMinimalTaskPayload(taskId, {
            title: `New task from client ${i} after import`,
          }),
        );
      }

      // === Phase 5: All clients sync their new tasks ===
      for (let i = 0; i < numClients; i++) {
        await clients[i].sync(server);
      }

      // === Phase 6: Verify all new tasks are on the server ===
      const allServerOps = server.getAllOps();
      for (const taskId of newTaskIds) {
        const found = allServerOps.find((sop) => sop.op.entityId === taskId);
        expect(found)
          .withContext(`New task ${taskId} should be present on server`)
          .toBeDefined();
      }

      // === Phase 7: Verify vector clock relationships ===
      const newTaskOpsOnServer = allServerOps.filter((sop) =>
        sop.op.entityId?.startsWith('new-task-from-client-'),
      );
      expect(newTaskOpsOnServer.length).toBe(numClients);

      for (const serverOp of newTaskOpsOnServer) {
        const comparison = compareVectorClocks(
          serverOp.op.vectorClock,
          importOp.vectorClock,
        );
        expect(comparison)
          .withContext(
            `Op for ${serverOp.op.entityId} from ${serverOp.op.clientId} ` +
              `should be GREATER_THAN import. ` +
              `Op clock keys: ${Object.keys(serverOp.op.vectorClock).length}, ` +
              `Import clock keys: ${importClockEntries}`,
          )
          .toBe(VectorClockComparison.GREATER_THAN);
      }

      // === Phase 8: Verify clocks have grown back toward MAX ===
      // The last client to sync should have a clock with entries for all clients
      const finalClock = clients[numClients - 1].getCurrentClock();
      const finalClockSize = Object.keys(finalClock).length;
      expect(finalClockSize).toBeGreaterThanOrEqual(numClients);
    });

    /**
     * Variant: After import and resync, clients can also sync EACH OTHER's
     * new post-import tasks, creating a second round of convergence.
     */
    it('should allow second-round convergence after import resync', async () => {
      const clientA = new SimulatedClient('client-aaa', storeService);
      const clientB = new SimulatedClient('client-bbb', storeService);
      const clientC = new SimulatedClient('client-ccc', storeService);

      // Pre-import: each client creates and syncs
      await clientA.createLocalOp(
        'TASK',
        'pre-A',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('pre-A'),
      );
      await clientA.sync(server);

      await clientB.createLocalOp(
        'TASK',
        'pre-B',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('pre-B'),
      );
      await clientB.sync(server);

      await clientC.createLocalOp(
        'TASK',
        'pre-C',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('pre-C'),
      );
      await clientC.sync(server);

      // Convergence
      await clientA.sync(server);
      await clientB.sync(server);
      await clientC.sync(server);

      // Client A imports
      const importOp = await clientA.createLocalOp(
        'ALL',
        uuidv7(),
        OpType.SyncImport,
        '[SP_ALL] Load(import) all data',
        {
          appDataComplete: {
            task: {
              ids: ['import-task'],
              entities: {
                'import-task': createMinimalTaskPayload('import-task'),
              },
            },
          },
        },
      );
      await clientA.sync(server);

      // All clients resync to get import
      await clientB.sync(server);
      await clientC.sync(server);

      // Round 1: Each client creates a new task
      await clientA.createLocalOp(
        'TASK',
        'post-A',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('post-A', { title: 'Post-import from A' }),
      );
      await clientA.sync(server);

      await clientB.createLocalOp(
        'TASK',
        'post-B',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('post-B', { title: 'Post-import from B' }),
      );
      await clientB.sync(server);

      await clientC.createLocalOp(
        'TASK',
        'post-C',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('post-C', { title: 'Post-import from C' }),
      );
      await clientC.sync(server);

      // Round 2: Full convergence - all clients download all new tasks
      await clientA.sync(server);
      await clientB.sync(server);
      await clientC.sync(server);

      // Verify all post-import tasks are on the server
      const allOps = server.getAllOps();
      expect(allOps.find((o) => o.op.entityId === 'post-A')).toBeDefined();
      expect(allOps.find((o) => o.op.entityId === 'post-B')).toBeDefined();
      expect(allOps.find((o) => o.op.entityId === 'post-C')).toBeDefined();

      // Round 2 tasks: After second convergence, each client creates another task
      await clientA.createLocalOp(
        'TASK',
        'round2-A',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('round2-A', { title: 'Round 2 from A' }),
      );
      await clientA.sync(server);

      await clientB.createLocalOp(
        'TASK',
        'round2-B',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('round2-B', { title: 'Round 2 from B' }),
      );
      await clientB.sync(server);

      // Verify round 2 tasks are GREATER_THAN the import
      const round2Ops = server
        .getAllOps()
        .filter((o) => o.op.entityId?.startsWith('round2-'));
      expect(round2Ops.length).toBe(2);

      for (const op of round2Ops) {
        const cmp = compareVectorClocks(op.op.vectorClock, importOp.vectorClock);
        expect(cmp).toBe(VectorClockComparison.GREATER_THAN);
      }
    });
  });
});
