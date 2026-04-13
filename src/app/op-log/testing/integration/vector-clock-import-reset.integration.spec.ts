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
 * Timeout for tests with MAX_VECTOR_CLOCK_SIZE (20) clients doing multiple rounds.
 * These are heavy tests that exceed Jasmine's default 2000ms in the full suite.
 */
const HEAVY_TEST_TIMEOUT = 10000;

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
 * KEY BEHAVIOR: After a SYNC_IMPORT, working clocks are reset to minimal
 * (only import client + own client entries). Post-import ops are recognized
 * by the import-client-counter exception in SyncImportFilterService, not by
 * carrying forward the full accumulated clock.
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

  describe('Vector clock resets to minimal after import', () => {
    /**
     * Test: After a SYNC_IMPORT, client working clocks are reset to minimal.
     *
     * Previously, clocks would carry forward ALL accumulated client IDs from the
     * import (including dead/stale ones). Now, working clocks are reset to only
     * contain the import client's entry + the receiving client's entry.
     *
     * Note: If all original clients remain active (creating ops and syncing),
     * clocks will naturally regrow to include all active clients. The key improvement
     * is that DEAD client IDs (from reinstalls, etc.) are dropped.
     */
    it('should reset working clocks to minimal immediately after receiving import', async () => {
      const numClients = 5; // Use a small number for clarity
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

      // Verify clocks have grown: client-000 should know about all clients
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

      // The import's op clock should carry the importing client's knowledge of all clients
      const importClockSize = Object.keys(importOp.vectorClock).length;
      expect(importClockSize).toBeGreaterThanOrEqual(numClients);

      // The importing client's working clock should be reset to minimal (just own entry)
      const importerClock = clients[0].getCurrentClock();
      expect(Object.keys(importerClock).length)
        .withContext('Importing client clock should be minimal (1 entry: own)')
        .toBe(1);

      // Phase 3: All other clients sync to receive the import
      for (let i = 1; i < numClients; i++) {
        await clients[i].sync(server);
      }

      // After receiving the import, working clocks should be MINIMAL (reset)
      for (let i = 1; i < numClients; i++) {
        const postImportClock = clients[i].getCurrentClock();
        const clockSize = Object.keys(postImportClock).length;
        expect(clockSize)
          .withContext(
            `Client ${i} clock should be minimal (2 entries: import client + own), ` +
              `got ${clockSize}: ${JSON.stringify(postImportClock)}`,
          )
          .toBeLessThanOrEqual(2);
      }
    });

    /**
     * Test: Dead client IDs are dropped after SYNC_IMPORT.
     *
     * Scenario: Several clients sync, then some go offline permanently (dead).
     * After SYNC_IMPORT, the dead clients' IDs should NOT appear in working clocks.
     */
    it('should drop dead client IDs after import', async () => {
      // Create 5 clients: 2 "alive" + 3 "dead"
      const aliveClients = [
        new SimulatedClient('client-alive-a', storeService),
        new SimulatedClient('client-alive-b', storeService),
      ];
      const deadClients = [
        new SimulatedClient('client-dead-1', storeService),
        new SimulatedClient('client-dead-2', storeService),
        new SimulatedClient('client-dead-3', storeService),
      ];
      const allClients = [...aliveClients, ...deadClients];

      // All clients create tasks and sync
      for (const client of allClients) {
        await client.createLocalOp(
          'TASK',
          `task-${client.clientId}`,
          OpType.Create,
          '[Task] Add Task',
          createMinimalTaskPayload(`task-${client.clientId}`),
        );
        await client.sync(server);
      }
      // Convergence
      for (const client of allClients) {
        await client.sync(server);
      }

      // Verify all clocks have entries for all clients
      const preImportClock = aliveClients[0].getCurrentClock();
      expect(Object.keys(preImportClock).length).toBe(5);

      // Client alive-a performs import
      await aliveClients[0].createLocalOp(
        'ALL',
        uuidv7(),
        OpType.SyncImport,
        '[SP_ALL] Load(import) all data',
        {
          appDataComplete: {
            task: {
              ids: ['import-task'],
              entities: { 'import-task': createMinimalTaskPayload('import-task') },
            },
          },
        },
      );
      await aliveClients[0].sync(server);

      // Only alive clients resync (dead clients are gone)
      await aliveClients[1].sync(server);

      // Alive clients create new ops and sync
      await aliveClients[0].createLocalOp(
        'TASK',
        'post-a',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('post-a'),
      );
      await aliveClients[0].sync(server);

      await aliveClients[1].createLocalOp(
        'TASK',
        'post-b',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('post-b'),
      );
      await aliveClients[1].sync(server);

      // Converge
      await aliveClients[0].sync(server);
      await aliveClients[1].sync(server);

      // Working clocks should only contain alive client IDs (dead ones are dropped)
      const finalClockA = aliveClients[0].getCurrentClock();
      const finalClockB = aliveClients[1].getCurrentClock();

      expect(Object.keys(finalClockA).length)
        .withContext(
          `Alive client A should have 2 entries (alive clients only), ` +
            `got: ${JSON.stringify(finalClockA)}`,
        )
        .toBe(2);
      expect(finalClockA['client-dead-1']).toBeUndefined();
      expect(finalClockA['client-dead-2']).toBeUndefined();
      expect(finalClockA['client-dead-3']).toBeUndefined();

      expect(Object.keys(finalClockB).length)
        .withContext(
          `Alive client B should have 2 entries (alive clients only), ` +
            `got: ${JSON.stringify(finalClockB)}`,
        )
        .toBe(2);
      expect(finalClockB['client-dead-1']).toBeUndefined();
      expect(finalClockB['client-dead-2']).toBeUndefined();
      expect(finalClockB['client-dead-3']).toBeUndefined();
    });
  });

  describe('SyncImportFilterService keeps post-import ops with minimal clocks', () => {
    /**
     * Core test: Multiple clients at MAX vector clock → import on one client → resync →
     * new tasks from all clients should pass the SyncImportFilterService filter.
     *
     * After the clock reset fix, post-import ops have minimal clocks and appear
     * CONCURRENT with the import (missing entries for old clients). The
     * import-client-counter exception recognizes them as post-import.
     */
    it(
      'should keep new tasks from all clients after import and resync',
      async () => {
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
        const filterService = TestBed.inject(SyncImportFilterService);
        const result =
          await filterService.filterOpsInvalidatedBySyncImport(postImportOps);

        expect(result.invalidatedOps.length)
          .withContext(
            `Expected 0 invalidated ops but got ${result.invalidatedOps.length}: ` +
              result.invalidatedOps
                .map((op) => `${op.clientId}:${op.entityId}`)
                .join(', '),
          )
          .toBe(0);
        expect(result.validOps.length).toBe(numClients);
      },
      HEAVY_TEST_TIMEOUT,
    );

    /**
     * Verify that pre-import ops from unknown clients (never communicated with import
     * client) are KEPT. The import has no knowledge of these clients, so it can't
     * claim to supersede their ops (independent timelines).
     */
    it('should keep pre-import ops from clients unknown to the import', async () => {
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

      // Verify: post-import op from B should be CONCURRENT with the import
      // (B's clock was reset to minimal after receiving import, so it's missing
      // entries that the import has — but it has the import client's counter)
      const comparisonB = compareVectorClocks(
        postImportOpB.vectorClock,
        importOp.vectorClock,
      );
      // With minimal clocks, B's op is CONCURRENT (missing old entries)
      // but should still be kept by the import-client-counter exception
      expect([VectorClockComparison.GREATER_THAN, VectorClockComparison.CONCURRENT])
        .withContext(
          `Post-import op from B should be GREATER_THAN or CONCURRENT, got ${comparisonB}`,
        )
        .toContain(comparisonB);

      // Use SyncImportFilterService
      const filterService = TestBed.inject(SyncImportFilterService);
      const result = await filterService.filterOpsInvalidatedBySyncImport([
        preImportOp,
        postImportOpB,
      ]);

      // Pre-import op from C should be KEPT (unknown client - import has no entry for C)
      // Post-import op from B should also be kept (import-client-counter exception)
      expect(result.invalidatedOps.length).toBe(0);
      expect(result.validOps.length).toBe(2);
      expect(result.validOps.find((op) => op.entityId === 'taskC-pre')).toBeDefined();
      expect(result.validOps.find((op) => op.entityId === 'taskB-post')).toBeDefined();
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
     * After the clock reset fix, post-import ops have minimal clocks but are
     * correctly recognized as post-import by SyncImportFilterService via the
     * import-client-counter exception.
     */
    it(
      'should handle full lifecycle: MAX clock → import → resync → new tasks sync correctly',
      async () => {
        const numClients = MAX_VECTOR_CLOCK_SIZE;
        const clients = createClients(numClients, storeService);

        // === Phase 1: Build up clocks to MAX ===
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
        expect(preImportServerOpCount).toBe(numClients * 3);

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

        // === Phase 7: Verify post-import ops have the import client's counter ===
        // Post-import ops should have the import client's counter value, which
        // allows SyncImportFilterService to recognize them as post-import.
        const newTaskOpsOnServer = allServerOps.filter((sop) =>
          sop.op.entityId?.startsWith('new-task-from-client-'),
        );
        expect(newTaskOpsOnServer.length).toBe(numClients);

        const importClientId = importOp.clientId;
        const importClientCounter = importOp.vectorClock[importClientId];
        for (const serverOp of newTaskOpsOnServer) {
          const opImportCounter = serverOp.op.vectorClock[importClientId] ?? 0;
          expect(opImportCounter)
            .withContext(
              `Op for ${serverOp.op.entityId} from ${serverOp.op.clientId} should have ` +
                `import client counter >= ${importClientCounter}, got ${opImportCounter}`,
            )
            .toBeGreaterThanOrEqual(importClientCounter);
        }

        // === Phase 8: Verify clocks are bounded ===
        // With all MAX clients still active, clocks will naturally regrow to include
        // all active client IDs. The key improvement is that DEAD client IDs
        // (from reinstalls, etc.) are dropped. With all clients active, the clock
        // size equals the number of active clients (bounded by MAX_VECTOR_CLOCK_SIZE).
        const finalClock = clients[numClients - 1].getCurrentClock();
        const finalClockSize = Object.keys(finalClock).length;
        expect(finalClockSize)
          .withContext(
            `Final clock should be bounded at MAX (${MAX_VECTOR_CLOCK_SIZE}), ` +
              `got ${finalClockSize}`,
          )
          .toBeLessThanOrEqual(MAX_VECTOR_CLOCK_SIZE);
      },
      HEAVY_TEST_TIMEOUT,
    );

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

      // Verify round 2 tasks are on the server and have the import client's counter
      const round2Ops = server
        .getAllOps()
        .filter((o) => o.op.entityId?.startsWith('round2-'));
      expect(round2Ops.length).toBe(2);

      const importClientId = importOp.clientId;
      const importClientCounter = importOp.vectorClock[importClientId];
      for (const op of round2Ops) {
        const opImportCounter = op.op.vectorClock[importClientId] ?? 0;
        expect(opImportCounter)
          .withContext(
            `Round 2 op from ${op.op.clientId} should have import client counter >= ${importClientCounter}`,
          )
          .toBeGreaterThanOrEqual(importClientCounter);
      }

      // Verify clocks only contain active client IDs (3 clients)
      const finalClockA = clientA.getCurrentClock();
      expect(Object.keys(finalClockA).length)
        .withContext(
          'Client A clock should only have active clients after import + convergence',
        )
        .toBeLessThanOrEqual(3); // A + B + C
    });
  });
});
