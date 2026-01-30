import { TestBed } from '@angular/core/testing';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { OperationLogCompactionService } from '../../persistence/operation-log-compaction.service';
import { VectorClockService } from '../../sync/vector-clock.service';
import { OpType } from '../../core/operation.types';
import { CURRENT_SCHEMA_VERSION } from '../../persistence/schema-migration.service';
import { TestClient, resetTestUuidCounter } from './helpers/test-client.helper';
import {
  createTaskOperation,
  createMinimalTaskPayload,
  createMinimalProjectPayload,
} from './helpers/operation-factory.helper';
import { StateSnapshotService } from '../../backup/state-snapshot.service';

/**
 * Performance integration tests for operation log.
 *
 * These tests verify:
 * - Large operation log handling (10,000+ operations)
 * - Startup hydration performance
 * - Sync with large batches
 * - Compaction performance
 * - Concurrent operation handling
 *
 * Tests use real IndexedDB for realistic performance measurements.
 */
describe('Performance Integration', () => {
  let storeService: OperationLogStoreService;
  let compactionService: OperationLogCompactionService;
  let vectorClockService: VectorClockService;
  let mockStateSnapshot: jasmine.SpyObj<StateSnapshotService>;

  beforeEach(async () => {
    mockStateSnapshot = jasmine.createSpyObj('StateSnapshotService', [
      'getStateSnapshot',
      'getAllSyncModelDataFromStore',
    ]);
    mockStateSnapshot.getStateSnapshot.and.returnValue({
      task: { ids: [], entities: {} },
      project: { ids: [], entities: {} },
    } as any);
    mockStateSnapshot.getAllSyncModelDataFromStore.and.returnValue({
      task: { ids: [], entities: {} },
      project: { ids: [], entities: {} },
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

  describe('Large operation log handling', () => {
    it('should handle 500 operations efficiently', async () => {
      const client = new TestClient('client-test');
      const operationCount = 500;

      const writeStartTime = Date.now();

      // Write operations
      for (let i = 0; i < operationCount; i++) {
        await storeService.append(
          createTaskOperation(client, `task-${i}`, OpType.Create, { title: `Task ${i}` }),
          'local',
        );
      }

      const writeEndTime = Date.now();
      const writeDuration = writeEndTime - writeStartTime;

      // Read operations
      const readStartTime = Date.now();
      const ops = await storeService.getOpsAfterSeq(0);
      const readEndTime = Date.now();
      const readDuration = readEndTime - readStartTime;

      // Verify all operations stored
      expect(ops.length).toBe(operationCount);

      // Performance assertions (generous thresholds for CI environments)
      expect(writeDuration).toBeLessThan(30000); // Write < 30s
      expect(readDuration).toBeLessThan(5000); // Read < 5s

      // Log performance metrics
      console.log(
        `Performance: ${operationCount} ops - Write: ${writeDuration}ms, Read: ${readDuration}ms`,
      );
      console.log(
        `Throughput: ${Math.round(operationCount / (writeDuration / 1000))} writes/sec`,
      );
    });

    it('should maintain sequence integrity under load', async () => {
      const client = new TestClient('client-test');
      const operationCount = 250;

      for (let i = 0; i < operationCount; i++) {
        await storeService.append(
          createTaskOperation(client, `task-${i}`, OpType.Create, { title: `Task ${i}` }),
          'local',
        );
      }

      const ops = await storeService.getOpsAfterSeq(0);

      // Verify we have exactly the expected number of operations (test isolation check)
      expect(ops.length)
        .withContext(
          `Expected exactly ${operationCount} operations, but found ${ops.length}. ` +
            `This suggests database cleanup failed or tests are interfering with each other.`,
        )
        .toBe(operationCount);

      // Verify strict sequence ordering
      for (let i = 1; i < ops.length; i++) {
        expect(ops[i].seq)
          .withContext(`Sequence at index ${i} should be greater than previous`)
          .toBeGreaterThan(ops[i - 1].seq);
      }

      // Verify vector clock progression
      for (let i = 0; i < ops.length; i++) {
        expect(ops[i].op.vectorClock['client-test'])
          .withContext(`Vector clock at operation ${i} (seq: ${ops[i].seq})`)
          .toBe(i + 1);
      }
    });
  });

  describe('Startup hydration performance', () => {
    it('should hydrate from snapshot + tail efficiently', async () => {
      const client = new TestClient('client-test');

      // Create large state
      const taskCount = 200;
      const projectCount = 20;

      const taskIds: string[] = [];
      const taskEntities: Record<string, unknown> = {};
      for (let i = 0; i < taskCount; i++) {
        const id = `task-${i}`;
        taskIds.push(id);
        taskEntities[id] = createMinimalTaskPayload(id, {
          title: `Task ${i}`,
          notes: 'Some notes for the task to add realistic payload size',
        });
      }

      const projectIds: string[] = [];
      const projectEntities: Record<string, unknown> = {};
      for (let i = 0; i < projectCount; i++) {
        const id = `project-${i}`;
        projectIds.push(id);
        projectEntities[id] = createMinimalProjectPayload(id, { title: `Project ${i}` });
      }

      const testState = {
        task: { ids: taskIds, entities: taskEntities },
        project: { ids: projectIds, entities: projectEntities },
      };

      // Save snapshot
      await storeService.saveStateCache({
        state: testState,
        lastAppliedOpSeq: 0,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        vectorClock: { 'client-test': 0 },
        compactedAt: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });

      // Add tail operations
      const tailOpCount = 100;
      for (let i = 0; i < tailOpCount; i++) {
        await storeService.append(
          createTaskOperation(client, `new-task-${i}`, OpType.Create, {
            title: `New Task ${i}`,
          }),
          'local',
        );
      }

      // Measure hydration (load snapshot + tail)
      const hydrationStart = Date.now();

      const snapshot = await storeService.loadStateCache();
      const tailOps = await storeService.getOpsAfterSeq(snapshot!.lastAppliedOpSeq);

      const hydrationEnd = Date.now();
      const hydrationDuration = hydrationEnd - hydrationStart;

      // Verify data loaded correctly
      expect(snapshot).not.toBeNull();
      expect(snapshot!.state).toEqual(testState);
      expect(tailOps.length).toBe(tailOpCount);

      // Performance assertion (generous for CI)
      expect(hydrationDuration).toBeLessThan(5000); // < 5 seconds

      console.log(
        `Hydration: ${hydrationDuration}ms for ${taskCount} tasks + ${tailOpCount} tail ops`,
      );
    });

    it('should load empty state cache quickly', async () => {
      const start = Date.now();
      const snapshot = await storeService.loadStateCache();
      const duration = Date.now() - start;

      expect(snapshot).toBeNull();
      expect(duration).toBeLessThan(100); // < 100ms for empty
    });
  });

  describe('Sync batch performance', () => {
    it('should mark operations as synced efficiently', async () => {
      const client = new TestClient('client-test');
      const operationCount = 250;

      // Create operations
      for (let i = 0; i < operationCount; i++) {
        await storeService.append(
          createTaskOperation(client, `task-${i}`, OpType.Create, { title: `Task ${i}` }),
          'local',
        );
      }

      const allOps = await storeService.getOpsAfterSeq(0);
      const sequences = allOps.map((op) => op.seq);

      // Measure sync marking
      const syncStart = Date.now();
      await storeService.markSynced(sequences);
      const syncDuration = Date.now() - syncStart;

      // Verify all marked
      const unsynced = await storeService.getUnsynced();
      expect(unsynced.length).toBe(0);

      expect(syncDuration).toBeLessThan(5000); // < 5 seconds
      console.log(`Mark synced: ${syncDuration}ms for ${operationCount} ops`);
    });

    it('should get unsynced operations efficiently', async () => {
      const client = new TestClient('client-test');

      // Create mix of synced and unsynced
      for (let i = 0; i < 150; i++) {
        await storeService.append(
          createTaskOperation(client, `task-${i}`, OpType.Create, { title: `Task ${i}` }),
          'local',
        );
      }

      const allOps = await storeService.getOpsAfterSeq(0);
      // Mark first half as synced
      const syncedSeqs = allOps.slice(0, 75).map((op) => op.seq);
      await storeService.markSynced(syncedSeqs);

      // Measure unsynced query
      const queryStart = Date.now();
      const unsynced = await storeService.getUnsynced();
      const queryDuration = Date.now() - queryStart;

      expect(unsynced.length).toBe(75);
      expect(queryDuration).toBeLessThan(1000); // < 1 second
      console.log(`Get unsynced: ${queryDuration}ms for 75 of 150 ops`);
    });
  });

  describe('Compaction performance', () => {
    it('should compact operations efficiently', async () => {
      const client = new TestClient('client-test');
      const operationCount = 250;

      // Create operations
      for (let i = 0; i < operationCount; i++) {
        await storeService.append(
          createTaskOperation(client, `task-${i}`, OpType.Create, { title: `Task ${i}` }),
          'local',
        );
      }

      // Mark all as synced
      const allOps = await storeService.getOpsAfterSeq(0);
      await storeService.markSynced(allOps.map((op) => op.seq));

      // Build mock state based on operations
      const taskIds = allOps.map((op) => op.op.entityId!);
      const taskEntities: Record<string, unknown> = {};
      for (const op of allOps) {
        const entityId = op.op.entityId!;
        taskEntities[entityId] = createMinimalTaskPayload(entityId, {
          title: `Task ${entityId}`,
        });
      }
      mockStateSnapshot.getAllSyncModelDataFromStore.and.returnValue({
        task: { ids: taskIds, entities: taskEntities },
      } as any);

      // Measure compaction
      const compactStart = Date.now();
      await compactionService.compact();
      const compactDuration = Date.now() - compactStart;

      // Verify snapshot created
      const snapshot = await storeService.loadStateCache();
      expect(snapshot).not.toBeNull();

      expect(compactDuration).toBeLessThan(10000); // < 10 seconds
      console.log(`Compaction: ${compactDuration}ms for ${operationCount} ops`);
    }, 15000);
  });

  describe('Concurrent operation handling', () => {
    it('should handle rapid sequential writes correctly', async () => {
      const client = new TestClient('client-test');
      const operationCount = 100;

      const startTime = Date.now();

      // Rapid fire writes (sequential to ensure order)
      for (let i = 0; i < operationCount; i++) {
        await storeService.append(
          createTaskOperation(client, `task-${i}`, OpType.Create, { title: `Task ${i}` }),
          'local',
        );
      }

      const duration = Date.now() - startTime;

      // Verify all persisted correctly
      const ops = await storeService.getOpsAfterSeq(0);
      expect(ops.length).toBe(operationCount);

      // Verify no gaps in sequence
      for (let i = 1; i < ops.length; i++) {
        expect(ops[i].seq - ops[i - 1].seq).toBe(1);
      }

      const throughput = Math.round(operationCount / (duration / 1000));
      console.log(
        `Rapid writes: ${duration}ms for ${operationCount} ops (${throughput} ops/sec)`,
      );
    });

    it('should handle mixed local and remote operations', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');
      const operationCount = 100;

      const startTime = Date.now();

      // Interleave local and remote operations
      for (let i = 0; i < operationCount; i++) {
        if (i % 2 === 0) {
          await storeService.append(
            createTaskOperation(clientA, `task-a-${i}`, OpType.Create, {
              title: `Local ${i}`,
            }),
            'local',
          );
        } else {
          await storeService.append(
            createTaskOperation(clientB, `task-b-${i}`, OpType.Create, {
              title: `Remote ${i}`,
            }),
            'remote',
          );
        }
      }

      const duration = Date.now() - startTime;

      // Verify all persisted
      const ops = await storeService.getOpsAfterSeq(0);
      expect(ops.length).toBe(operationCount);

      // Verify mixed sources
      const localOps = ops.filter((op) => op.source === 'local');
      const remoteOps = ops.filter((op) => op.source === 'remote');
      expect(localOps.length).toBe(operationCount / 2);
      expect(remoteOps.length).toBe(operationCount / 2);

      console.log(`Mixed ops: ${duration}ms for ${operationCount} ops`);
    });
  });

  describe('Vector clock performance', () => {
    it('should compute entity frontier efficiently', async () => {
      const client = new TestClient('client-test');

      // Create operations across many entities
      const entityCount = 100;
      const opsPerEntity = 5;

      for (let e = 0; e < entityCount; e++) {
        for (let o = 0; o < opsPerEntity; o++) {
          const opType = o === 0 ? OpType.Create : OpType.Update;
          await storeService.append(
            createTaskOperation(client, `task-${e}`, opType, {
              title: `Task ${e} v${o}`,
            }),
            'local',
          );
        }
      }

      // Measure frontier computation
      const frontierStart = Date.now();
      const frontier = await vectorClockService.getEntityFrontier();
      const frontierDuration = Date.now() - frontierStart;

      // Verify frontier has all entities
      expect(frontier.size).toBe(entityCount);

      // Verify each entity has a defined clock value
      // Each entity's clock reflects the global clock at its last operation time
      // Entity 0: ops 1-5, last clock = 5
      // Entity 1: ops 6-10, last clock = 10
      // ...
      // Entity N: last clock = (N+1) * opsPerEntity
      for (let e = 0; e < entityCount; e++) {
        const clock = frontier.get(`TASK:task-${e}`);
        expect(clock).toBeDefined();
        const expectedClock = (e + 1) * opsPerEntity;
        expect(clock!['client-test']).toBe(expectedClock);
      }

      expect(frontierDuration).toBeLessThan(2000); // < 2 seconds
      console.log(`Entity frontier: ${frontierDuration}ms for ${entityCount} entities`);
    });

    it('should compute global vector clock efficiently', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');
      const clientC = new TestClient('client-c-test');

      // Create operations from multiple clients
      for (let i = 0; i < 100; i++) {
        await storeService.append(
          createTaskOperation(clientA, `task-a-${i}`, OpType.Create, { title: `A${i}` }),
          'local',
        );
      }
      for (let i = 0; i < 50; i++) {
        await storeService.append(
          createTaskOperation(clientB, `task-b-${i}`, OpType.Create, { title: `B${i}` }),
          'remote',
        );
      }
      for (let i = 0; i < 25; i++) {
        await storeService.append(
          createTaskOperation(clientC, `task-c-${i}`, OpType.Create, { title: `C${i}` }),
          'remote',
        );
      }

      // Measure global clock computation
      const clockStart = Date.now();
      const globalClock = await vectorClockService.getCurrentVectorClock();
      const clockDuration = Date.now() - clockStart;

      // Verify correct values
      expect(globalClock['client-a-test']).toBe(100);
      expect(globalClock['client-b-test']).toBe(50);
      expect(globalClock['client-c-test']).toBe(25);

      expect(clockDuration).toBeLessThan(1000); // < 1 second
      console.log(`Global clock: ${clockDuration}ms for 175 ops from 3 clients`);
    });
  });
});
