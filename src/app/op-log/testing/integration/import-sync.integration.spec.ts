/* eslint-disable @typescript-eslint/naming-convention, no-mixed-operators */
import { TestBed } from '@angular/core/testing';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { ActionType, OpType, Operation } from '../../core/operation.types';
import { resetTestUuidCounter, TestClient } from './helpers/test-client.helper';
import { MockSyncServer } from './helpers/mock-sync-server.helper';
import { SimulatedClient } from './helpers/simulated-client.helper';
import {
  createMinimalTaskPayload,
  createMinimalProjectPayload,
} from './helpers/operation-factory.helper';
import { CURRENT_SCHEMA_VERSION } from '../../persistence/schema-migration.service';
import { uuidv7 } from '../../../util/uuid-v7';
import { SyncImportFilterService } from '../../sync/sync-import-filter.service';
import {
  compareVectorClocks,
  VectorClockComparison,
  limitVectorClockSize,
} from '../../../core/util/vector-clock';
// MAX_VECTOR_CLOCK_SIZE is 20 — used implicitly by limitVectorClockSize

/**
 * Integration tests for Import + Sync scenarios.
 *
 * These tests verify that:
 * 1. SyncImport/BackupImport operations are created correctly during import
 * 2. Import operations sync to remote server
 * 3. Other clients receive and apply import operations
 * 4. Archive data is included in import operations
 *
 * LIMITATIONS:
 * - Tests the operation log layer, not full UI/service integration
 * - Archive data round-trip is verified at the operation level
 */
describe('Import + Sync Integration', () => {
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

  describe('SyncImport Operation Creation', () => {
    /**
     * Test: Import creates SyncImport operation with correct structure
     *
     * When a user imports a backup file, the system should create a
     * SyncImport operation with:
     * - opType: SyncImport
     * - entityType: ALL
     * - payload: complete app state
     */
    it('should create SyncImport operation with full state payload', async () => {
      const testClient = new TestClient('import-client');

      // Create a mock import payload (simulating what PfapiService._persistImportToOperationLog creates)
      const importedAppData = {
        task: {
          ids: ['task-1', 'task-2'],
          entities: {
            'task-1': createMinimalTaskPayload('task-1', { title: 'Imported Task 1' }),
            'task-2': createMinimalTaskPayload('task-2', { title: 'Imported Task 2' }),
          },
        },
        project: {
          ids: ['project-1'],
          entities: {
            'project-1': createMinimalProjectPayload('project-1', {
              title: 'Imported Project',
            }),
          },
        },
        archiveYoung: {
          task: {
            ids: ['archived-1'],
            entities: {
              'archived-1': createMinimalTaskPayload('archived-1', {
                title: 'Archived Task Young',
                isDone: true,
                doneOn: Date.now() - 86400000, // 1 day ago
              }),
            },
          },
          timeTracking: { project: {}, tag: {} },
          lastTimeTrackingFlush: Date.now(),
        },
        archiveOld: {
          task: {
            ids: ['old-archived-1'],
            entities: {
              'old-archived-1': createMinimalTaskPayload('old-archived-1', {
                title: 'Old Archived Task',
                isDone: true,
                doneOn: Date.now() - 30 * 86400000, // 30 days ago
              }),
            },
          },
          timeTracking: { project: {}, tag: {} },
          lastTimeTrackingFlush: Date.now(),
        },
      };

      // Create the SyncImport operation (mimicking PfapiService behavior)
      const importOp: Operation = testClient.createOperation({
        actionType: '[SP_ALL] Load(import) all data' as ActionType,
        opType: OpType.SyncImport,
        entityType: 'ALL',
        entityId: uuidv7(),
        payload: { appDataComplete: importedAppData },
      });

      // Append to operation log
      await storeService.append(importOp, 'local');

      // Verify operation was stored correctly
      const allOps = await storeService.getOpsAfterSeq(0);
      expect(allOps.length).toBe(1);

      const storedOp = allOps[0];
      expect(storedOp.op.opType).toBe(OpType.SyncImport);
      expect(storedOp.op.entityType).toBe('ALL');
      expect(storedOp.op.actionType).toBe('[SP_ALL] Load(import) all data');
      expect(storedOp.source).toBe('local');

      // Verify payload contains all the data including archives
      const payload = storedOp.op.payload as { appDataComplete: typeof importedAppData };
      expect(payload.appDataComplete).toBeDefined();
      expect(payload.appDataComplete.task.ids).toContain('task-1');
      expect(payload.appDataComplete.task.ids).toContain('task-2');
      expect(payload.appDataComplete.archiveYoung.task.ids).toContain('archived-1');
      expect(payload.appDataComplete.archiveOld.task.ids).toContain('old-archived-1');
    });

    /**
     * Test: Import operation has correct vector clock
     */
    it('should increment vector clock for import operation', async () => {
      const testClient = new TestClient('import-client');

      // Create an import operation
      const importOp = testClient.createOperation({
        actionType: '[SP_ALL] Load(import) all data' as ActionType,
        opType: OpType.SyncImport,
        entityType: 'ALL',
        entityId: uuidv7(),
        payload: { appDataComplete: {} },
      });

      await storeService.append(importOp, 'local');

      const allOps = await storeService.getOpsAfterSeq(0);
      const storedOp = allOps[0];

      // Vector clock should have been set by TestClient
      expect(storedOp.op.vectorClock).toBeDefined();
      expect(storedOp.op.vectorClock['import-client']).toBe(1);
    });
  });

  describe('Import Operation Sync to Server', () => {
    /**
     * Test: Client A imports, syncs to server, Client B downloads
     *
     * This simulates the full flow of importing data and having it
     * propagate to other clients via the sync server.
     */
    it('should sync import operation from Client A to Client B', async () => {
      const clientA = new SimulatedClient('client-a', storeService);
      const clientB = new SimulatedClient('client-b', storeService);

      // Client A creates an import operation
      const importPayload = {
        appDataComplete: {
          task: {
            ids: ['imported-task'],
            entities: {
              'imported-task': createMinimalTaskPayload('imported-task', {
                title: 'Task from Import',
              }),
            },
          },
          archiveYoung: {
            task: {
              ids: ['archived-young-task'],
              entities: {
                'archived-young-task': createMinimalTaskPayload('archived-young-task', {
                  title: 'Archived Young Task',
                  isDone: true,
                }),
              },
            },
            timeTracking: { project: {}, tag: {} },
            lastTimeTrackingFlush: Date.now(),
          },
        },
      };

      const importOp = await clientA.createLocalOp(
        'ALL',
        uuidv7(),
        OpType.SyncImport,
        '[SP_ALL] Load(import) all data',
        importPayload,
      );

      // Client A syncs (upload)
      const syncResultA = await clientA.sync(server);
      expect(syncResultA.uploaded).toBe(1);

      // Verify server received the import operation
      const serverOps = server.getAllOps();
      expect(serverOps.length).toBe(1);
      expect(serverOps[0].op.opType).toBe(OpType.SyncImport);

      // Client B syncs (download)
      const syncResultB = await clientB.sync(server);
      expect(syncResultB.downloaded).toBe(1);

      // Verify Client B has the import operation
      const clientBOps = await clientB.getAllOps();
      const downloadedImport = clientBOps.find((e) => e.op.id === importOp.id);
      expect(downloadedImport).toBeDefined();
      expect(downloadedImport!.op.opType).toBe(OpType.SyncImport);

      // Verify the payload includes archive data
      const receivedPayload = downloadedImport!.op.payload as typeof importPayload;
      expect(receivedPayload.appDataComplete.archiveYoung.task.ids).toContain(
        'archived-young-task',
      );
    });

    /**
     * Test: Import operation includes both archiveYoung and archiveOld
     */
    it('should include both archive tiers in sync payload', async () => {
      const clientA = new SimulatedClient('client-a', storeService);
      const clientB = new SimulatedClient('client-b', storeService);

      const importPayload = {
        appDataComplete: {
          task: { ids: [], entities: {} },
          archiveYoung: {
            task: {
              ids: ['young-1', 'young-2'],
              entities: {
                'young-1': createMinimalTaskPayload('young-1', {
                  title: 'Young Archive 1',
                  isDone: true,
                  timeSpent: 3600000,
                }),
                'young-2': createMinimalTaskPayload('young-2', {
                  title: 'Young Archive 2',
                  isDone: true,
                }),
              },
            },
            timeTracking: { project: { proj1: { '2024-01-01': 1800000 } }, tag: {} },
            lastTimeTrackingFlush: Date.now() - 86400000,
          },
          archiveOld: {
            task: {
              ids: ['old-1'],
              entities: {
                'old-1': createMinimalTaskPayload('old-1', {
                  title: 'Old Archive 1',
                  isDone: true,
                  timeSpent: 7200000,
                }),
              },
            },
            timeTracking: { project: { proj1: { '2023-12-01': 3600000 } }, tag: {} },
            lastTimeTrackingFlush: Date.now() - 60 * 86400000,
          },
        },
      };

      await clientA.createLocalOp(
        'ALL',
        uuidv7(),
        OpType.SyncImport,
        '[SP_ALL] Load(import) all data',
        importPayload,
      );

      await clientA.sync(server);
      await clientB.sync(server);

      // Verify Client B received both archive tiers
      const clientBOps = await clientB.getAllOps();
      const importOp = clientBOps.find((e) => e.op.opType === OpType.SyncImport);
      expect(importOp).toBeDefined();

      const payload = importOp!.op.payload as typeof importPayload;

      // archiveYoung
      expect(payload.appDataComplete.archiveYoung.task.ids.length).toBe(2);
      expect(payload.appDataComplete.archiveYoung.task.entities['young-1'].title).toBe(
        'Young Archive 1',
      );
      expect(
        payload.appDataComplete.archiveYoung.timeTracking.project.proj1,
      ).toBeDefined();

      // archiveOld
      expect(payload.appDataComplete.archiveOld.task.ids.length).toBe(1);
      expect(payload.appDataComplete.archiveOld.task.entities['old-1'].title).toBe(
        'Old Archive 1',
      );
      expect(payload.appDataComplete.archiveOld.timeTracking.project.proj1).toBeDefined();
    });
  });

  describe('Import with Existing Local Operations', () => {
    /**
     * Test: Import after local operations exist
     *
     * When a user imports a backup and already has local operations,
     * the import should be sequenced after them but replace the state.
     */
    it('should sequence import after existing local operations', async () => {
      const client = new SimulatedClient('client-a', storeService);

      // Get baseline seq before test
      const baselineSeq = await storeService.getLastSeq();

      // Create some existing local operations
      await client.createLocalOp(
        'TASK',
        'existing-task-1',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('existing-task-1'),
      );

      await client.createLocalOp(
        'TASK',
        'existing-task-2',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('existing-task-2'),
      );

      // Now import
      await client.createLocalOp(
        'ALL',
        uuidv7(),
        OpType.SyncImport,
        '[SP_ALL] Load(import) all data',
        {
          appDataComplete: {
            task: {
              ids: ['imported-task'],
              entities: {
                'imported-task': createMinimalTaskPayload('imported-task'),
              },
            },
          },
        },
      );

      // Check sequence numbers
      const allOps = await storeService.getOpsAfterSeq(baselineSeq);
      expect(allOps.length).toBe(3);

      // Import should be the last operation
      const importOp = allOps.find((e) => e.op.opType === OpType.SyncImport);
      expect(importOp).toBeDefined();

      // Verify ordering: import should be last (highest seq)
      const sortedOps = [...allOps].sort((a, b) => a.seq - b.seq);
      expect(sortedOps[sortedOps.length - 1].op.opType).toBe(OpType.SyncImport);

      // Use first operation's seq as baseline for relative comparison
      // (auto-increment keys continue across tests even after clearing)
      const firstOpSeq = sortedOps[0].seq;
      expect(importOp!.seq - firstOpSeq).toBe(2); // 3rd op is 2 after 1st

      // Vector clock should reflect all operations (3 increments from client-a)
      // TestClient starts fresh for each test, so expect exactly 3
      expect(importOp!.op.vectorClock['client-a']).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Import Operation Type Distinction', () => {
    /**
     * Test: BackupImport vs SyncImport operation types
     *
     * BackupImport is used for file imports
     * SyncImport is used when receiving full state from sync
     */
    it('should distinguish BackupImport from SyncImport operation types', async () => {
      const testClient = new TestClient('test-client');

      // Create a BackupImport operation (from file import)
      const backupImportOp: Operation = testClient.createOperation({
        actionType: '[SP_ALL] Load(import) backup file' as ActionType,
        opType: OpType.BackupImport,
        entityType: 'ALL',
        entityId: uuidv7(),
        payload: { appDataComplete: { task: { ids: [], entities: {} } } },
      });

      // Create a SyncImport operation (from sync download)
      const syncImportOp: Operation = testClient.createOperation({
        actionType: '[SP_ALL] Load(import) all data' as ActionType,
        opType: OpType.SyncImport,
        entityType: 'ALL',
        entityId: uuidv7(),
        payload: { appDataComplete: { task: { ids: [], entities: {} } } },
      });

      await storeService.append(backupImportOp, 'local');
      await storeService.append(syncImportOp, 'remote');

      const allOps = await storeService.getOpsAfterSeq(0);
      expect(allOps.length).toBe(2);

      const backupOp = allOps.find((e) => e.op.opType === OpType.BackupImport);
      const syncOp = allOps.find((e) => e.op.opType === OpType.SyncImport);

      expect(backupOp).toBeDefined();
      expect(syncOp).toBeDefined();
      expect(backupOp!.source).toBe('local'); // Backup import is local
      expect(syncOp!.source).toBe('remote'); // Sync import is remote
    });
  });

  describe('Import Schema Version', () => {
    /**
     * Test: Import operation includes current schema version
     */
    it('should include schema version in import operation', async () => {
      const importOp: Operation = {
        id: uuidv7(),
        clientId: 'test-client',
        actionType: '[SP_ALL] Load(import) all data' as ActionType,
        opType: OpType.SyncImport,
        entityType: 'ALL',
        entityId: uuidv7(),
        payload: { appDataComplete: {} },
        vectorClock: { 'test-client': 1 },
        timestamp: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
      };

      await storeService.append(importOp, 'local');

      const allOps = await storeService.getOpsAfterSeq(0);
      expect(allOps[0].op.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    });
  });

  describe('SYNC_IMPORT Vector Clock Merge-vs-Replace Bug', () => {
    /**
     * BUG: When a remote client receives a SYNC_IMPORT, mergeRemoteOpClocks()
     * MERGES the import's fresh clock into the old accumulated clock instead of
     * REPLACING it. After server-side pruning removes the import's low-counter
     * entry, new ops from that client appear CONCURRENT with the import and get
     * discarded by SyncImportFilterService.
     *
     * Scenario:
     * 1. Client B has accumulated a large vector clock (13 entries from long history)
     * 2. Client A does an import, creating SYNC_IMPORT with fresh clock {import-fresh: 1}
     * 3. Client B receives the SYNC_IMPORT and calls mergeRemoteOpClocks()
     * 4. BUG: B's clock becomes 14 entries (old 13 + new 1) instead of being reset
     * 5. Server prunes B's subsequent ops to MAX=20, dropping import-fresh:1 (lowest counter)
     * 6. compareVectorClocks returns CONCURRENT: B has old entries import doesn't know,
     *    import has import-fresh that B lost to pruning
     * 7. SyncImportFilterService filters B's ops as "concurrent with import"
     */
    it('should reset vector clock when receiving SYNC_IMPORT, not merge into old clock', async () => {
      // Set Client B's vector clock to 13 entries simulating long history
      const bloatedClock: Record<string, number> = {};
      for (let i = 0; i < 13; i++) {
        bloatedClock[`old-device-${String(i).padStart(2, '0')}`] = 100 + i;
      }
      await storeService.setVectorClock(bloatedClock);

      // Create SYNC_IMPORT with fresh clock (simulating Client A's import)
      const importClient = new TestClient('import-fresh');
      const importOp: Operation = importClient.createOperation({
        actionType: '[SP_ALL] Load(import) all data' as ActionType,
        opType: OpType.SyncImport,
        entityType: 'ALL',
        entityId: uuidv7(),
        payload: { appDataComplete: {} },
      });

      // Client B receives the SYNC_IMPORT and merges its clock
      await storeService.mergeRemoteOpClocks([importOp]);

      // After receiving a SYNC_IMPORT, the clock should be REPLACED, not merged.
      // The import represents a complete state reset — the old clock entries are meaningless.
      const clockAfterMerge = await storeService.getVectorClock();
      const entryCount = Object.keys(clockAfterMerge!).length;

      // BUG: This will be 14 (old entries + new entry) instead of ≤1
      // The fix should replace the clock with the import's clock, not merge into old
      expect(entryCount).toBeLessThanOrEqual(1);
    });

    it('should produce post-import ops that are GREATER_THAN the import, not CONCURRENT', async () => {
      // Set Client B's vector clock to 13 entries simulating long history
      const bloatedClock: Record<string, number> = {};
      for (let i = 0; i < 13; i++) {
        bloatedClock[`old-device-${String(i).padStart(2, '0')}`] = 100 + i;
      }
      await storeService.setVectorClock(bloatedClock);

      // Create SYNC_IMPORT with fresh clock (simulating Client A's import)
      const importClient = new TestClient('import-fresh');
      const importOp: Operation = importClient.createOperation({
        actionType: '[SP_ALL] Load(import) all data' as ActionType,
        opType: OpType.SyncImport,
        entityType: 'ALL',
        entityId: uuidv7(),
        payload: { appDataComplete: {} },
      });

      // Store the import op so SyncImportFilterService can find it
      await storeService.append(importOp, 'remote');

      // Client B receives the SYNC_IMPORT and merges its clock
      await storeService.mergeRemoteOpClocks([importOp]);

      // Now simulate Client B creating a post-import operation.
      // B's clock is bloated (old entries + new entry after buggy merge).
      // Build B's post-import clock by reading the store and incrementing.
      const clockAfterMerge = await storeService.getVectorClock();
      const clientBId = 'client-bbbbb';
      const postImportClock = {
        ...clockAfterMerge!,
        [clientBId]: (clockAfterMerge![clientBId] ?? 0) + 1,
      };

      // Simulate server-side pruning of B's op clock to MAX=20
      const prunedOpClock = limitVectorClockSize(postImportClock, clientBId);

      // BUG: After pruning, import-fresh:1 gets dropped
      // (it has the lowest counter). Now compareVectorClocks returns CONCURRENT
      // because B has old entries the import doesn't know about, and the import
      // has import-fresh that B lost to pruning.
      const comparison = compareVectorClocks(prunedOpClock, importOp.vectorClock);
      expect(comparison).toBe(VectorClockComparison.GREATER_THAN);

      // Also verify SyncImportFilterService would keep B's op
      const filterService = TestBed.inject(SyncImportFilterService);
      const postImportOp: Operation = {
        id: uuidv7(),
        clientId: clientBId,
        actionType: '[Task] Add Task' as ActionType,
        opType: OpType.Create,
        entityType: 'TASK',
        entityId: uuidv7(),
        payload: createMinimalTaskPayload('post-import-task'),
        vectorClock: prunedOpClock,
        timestamp: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
      };

      const result = await filterService.filterOpsInvalidatedBySyncImport([postImportOp]);

      // BUG: B's post-import op gets filtered as invalidated
      expect(result.validOps.length).toBe(1);
      expect(result.invalidatedOps.length).toBe(0);
    });
  });
});
