/* eslint-disable @typescript-eslint/naming-convention, no-mixed-operators */
import { TestBed } from '@angular/core/testing';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { ActionType, OpType, Operation } from '../../core/operation.types';
import { resetTestUuidCounter, TestClient } from './helpers/test-client.helper';
import { MockSyncServer } from './helpers/mock-sync-server.helper';
import { uuidv7 } from '../../../util/uuid-v7';
import { TimeTrackingState } from '../../../features/time-tracking/time-tracking.model';

/**
 * Integration tests for Time Tracking Sync scenarios.
 *
 * These tests verify that:
 * 1. TimeTracking operations are created and synced correctly
 * 2. SYNC_IMPORT includes timeTracking data from all sources
 * 3. Multi-client time tracking updates work with LWW
 * 4. Archive flush operations sync timeTracking correctly
 */
describe('Time Tracking Sync Integration', () => {
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

  describe('TimeTracking Operation Creation', () => {
    it('should create syncTimeTracking operation with correct structure', async () => {
      const testClient = new TestClient('tt-client-1');

      const syncTimeTrackingOp = testClient.createOperation({
        actionType: '[Time Tracking] Sync Time Tracking' as ActionType,
        opType: OpType.Update,
        entityType: 'TIME_TRACKING',
        entityId: 'PROJECT:proj-1:2024-01-15',
        payload: {
          contextType: 'PROJECT',
          contextId: 'proj-1',
          date: '2024-01-15',
          data: { s: 1000, e: 2000, b: 1, bt: 100 },
        },
      });

      await storeService.append(syncTimeTrackingOp, 'local');

      const allOps = await storeService.getOpsAfterSeq(0);
      expect(allOps.length).toBe(1);

      const storedOp = allOps[0];
      expect(storedOp.op.opType).toBe(OpType.Update);
      expect(storedOp.op.entityType).toBe('TIME_TRACKING');
      expect(storedOp.op.entityId).toBe('PROJECT:proj-1:2024-01-15');

      const payload = storedOp.op.payload as {
        contextType: string;
        contextId: string;
        date: string;
        data: { s: number; e: number; b: number; bt: number };
      };
      expect(payload.contextType).toBe('PROJECT');
      expect(payload.contextId).toBe('proj-1');
      expect(payload.date).toBe('2024-01-15');
      expect(payload.data.s).toBe(1000);
      expect(payload.data.e).toBe(2000);
    });

    it('should create TAG time tracking operation', async () => {
      const testClient = new TestClient('tt-client-2');

      const syncTimeTrackingOp = testClient.createOperation({
        actionType: '[Time Tracking] Sync Time Tracking' as ActionType,
        opType: OpType.Update,
        entityType: 'TIME_TRACKING',
        entityId: 'TAG:tag-1:2024-01-15',
        payload: {
          contextType: 'TAG',
          contextId: 'tag-1',
          date: '2024-01-15',
          data: { s: 500, e: 600 },
        },
      });

      await storeService.append(syncTimeTrackingOp, 'local');

      const allOps = await storeService.getOpsAfterSeq(0);
      expect(allOps.length).toBe(1);
      expect(allOps[0].op.entityId).toBe('TAG:tag-1:2024-01-15');
    });
  });

  describe('SYNC_IMPORT with TimeTracking', () => {
    it('should include timeTracking from all three sources in SYNC_IMPORT', async () => {
      const testClient = new TestClient('import-client');

      const importedAppData = {
        timeTracking: {
          project: {
            'proj-1': {
              '2024-01-15': { s: 1000, e: 2000 },
            },
          },
          tag: {
            'tag-1': {
              '2024-01-15': { s: 500, e: 600 },
            },
          },
        } as TimeTrackingState,
        archiveYoung: {
          task: { ids: [], entities: {} },
          timeTracking: {
            project: {
              'proj-1': {
                '2024-01-10': { s: 100, e: 200 },
              },
            },
            tag: {},
          },
          lastTimeTrackingFlush: Date.now(),
        },
        archiveOld: {
          task: { ids: [], entities: {} },
          timeTracking: {
            project: {
              'proj-2': {
                '2024-01-01': { s: 50, e: 100 },
              },
            },
            tag: {},
          },
          lastTimeTrackingFlush: Date.now() - 14 * 86400000,
        },
      };

      const importOp: Operation = testClient.createOperation({
        actionType: '[SP_ALL] Load(import) all data' as ActionType,
        opType: OpType.SyncImport,
        entityType: 'ALL',
        entityId: uuidv7(),
        payload: { appDataComplete: importedAppData },
      });

      await storeService.append(importOp, 'local');

      const allOps = await storeService.getOpsAfterSeq(0);
      expect(allOps.length).toBe(1);

      const payload = allOps[0].op.payload as { appDataComplete: typeof importedAppData };

      // Active timeTracking
      expect(
        payload.appDataComplete.timeTracking.project['proj-1']['2024-01-15'],
      ).toEqual({
        s: 1000,
        e: 2000,
      });

      // archiveYoung timeTracking
      expect(
        payload.appDataComplete.archiveYoung.timeTracking.project['proj-1']['2024-01-10'],
      ).toEqual({ s: 100, e: 200 });

      // archiveOld timeTracking
      expect(
        payload.appDataComplete.archiveOld.timeTracking.project['proj-2']['2024-01-01'],
      ).toEqual({ s: 50, e: 100 });
    });
  });

  describe('Multi-Client Time Tracking Sync', () => {
    it('should sync time tracking updates between clients', async () => {
      const clientA = new TestClient('client-A-test');
      const clientB = new TestClient('client-B-test');

      // Client A creates a time tracking entry
      const opA = clientA.createOperation({
        actionType: '[Time Tracking] Sync Time Tracking' as ActionType,
        opType: OpType.Update,
        entityType: 'TIME_TRACKING',
        entityId: 'PROJECT:proj-1:2024-01-15',
        payload: {
          contextType: 'PROJECT',
          contextId: 'proj-1',
          date: '2024-01-15',
          data: { s: 1000 },
        },
      });

      await storeService.append(opA, 'local');
      server.uploadOps([opA], clientA.clientId);

      // Client B downloads and merges
      clientB.mergeRemoteClock(opA.vectorClock);

      // Client B creates a different time tracking entry
      const opB = clientB.createOperation({
        actionType: '[Time Tracking] Sync Time Tracking' as ActionType,
        opType: OpType.Update,
        entityType: 'TIME_TRACKING',
        entityId: 'PROJECT:proj-1:2024-01-16', // Different date
        payload: {
          contextType: 'PROJECT',
          contextId: 'proj-1',
          date: '2024-01-16',
          data: { s: 2000 },
        },
      });

      await storeService.append(opB, 'local');

      const allOps = await storeService.getOpsAfterSeq(0);
      expect(allOps.length).toBe(2);

      // Both operations should be stored
      const entityIds = allOps.map((o) => o.op.entityId);
      expect(entityIds).toContain('PROJECT:proj-1:2024-01-15');
      expect(entityIds).toContain('PROJECT:proj-1:2024-01-16');
    });

    it('should handle concurrent updates to same context/date (LWW)', async () => {
      const clientA = new TestClient('client-A-lww');
      const clientB = new TestClient('client-B-lww');

      const baseTimestamp = Date.now();

      // Both clients update the same time tracking entry concurrently
      // Client A's operation is earlier
      const opA = clientA.createOperation({
        actionType: '[Time Tracking] Sync Time Tracking' as ActionType,
        opType: OpType.Update,
        entityType: 'TIME_TRACKING',
        entityId: 'PROJECT:proj-1:2024-01-15',
        payload: {
          contextType: 'PROJECT',
          contextId: 'proj-1',
          date: '2024-01-15',
          data: { s: 1000, e: 2000 }, // Client A's values (loser)
        },
      });
      opA.timestamp = baseTimestamp; // Earlier timestamp

      // Client B's operation is later (should win in LWW)
      const opB = clientB.createOperation({
        actionType: '[Time Tracking] Sync Time Tracking' as ActionType,
        opType: OpType.Update,
        entityType: 'TIME_TRACKING',
        entityId: 'PROJECT:proj-1:2024-01-15', // Same entityId!
        payload: {
          contextType: 'PROJECT',
          contextId: 'proj-1',
          date: '2024-01-15',
          data: { s: 3000, e: 4000 }, // Client B's values (winner)
        },
      });
      opB.timestamp = baseTimestamp + 1000; // Later timestamp - LWW winner

      // Both operations are valid and stored
      await storeService.append(opA, 'local');
      await storeService.append(opB, 'local');

      const allOps = await storeService.getOpsAfterSeq(0);
      expect(allOps.length).toBe(2);

      // Both operations stored
      const sameEntityOps = allOps.filter(
        (o) => o.op.entityId === 'PROJECT:proj-1:2024-01-15',
      );
      expect(sameEntityOps.length).toBe(2);

      // Verify LWW resolution: when sorted by timestamp, later operation wins
      const sortedByTimestamp = sameEntityOps.sort(
        (a, b) => a.op.timestamp - b.op.timestamp,
      );
      const lwwWinner = sortedByTimestamp[sortedByTimestamp.length - 1];

      // The winner should be opB with the later timestamp
      expect(lwwWinner.op.timestamp).toBe(baseTimestamp + 1000);
      const winnerPayload = lwwWinner.op.payload as {
        data: { s: number; e: number };
      };
      expect(winnerPayload.data.s).toBe(3000);
      expect(winnerPayload.data.e).toBe(4000);
    });
  });

  describe('Archive Flush with TimeTracking', () => {
    it('should create flushYoungToOld operation with timestamp', async () => {
      const testClient = new TestClient('flush-client');
      const now = Date.now();

      const flushOp = testClient.createOperation({
        actionType: '[Archive] Flush Young to Old' as ActionType,
        opType: OpType.Batch,
        entityType: 'ALL',
        entityId: uuidv7(),
        payload: { timestamp: now },
      });

      await storeService.append(flushOp, 'local');

      const allOps = await storeService.getOpsAfterSeq(0);
      expect(allOps.length).toBe(1);

      const storedOp = allOps[0];
      expect(storedOp.op.opType).toBe(OpType.Batch);
      expect(storedOp.op.entityType).toBe('ALL');
      expect(storedOp.op.actionType).toBe('[Archive] Flush Young to Old');

      const payload = storedOp.op.payload as { timestamp: number };
      expect(payload.timestamp).toBe(now);
    });

    it('should sync flushYoungToOld between clients deterministically', async () => {
      const clientA = new TestClient('flush-A-test');
      const clientB = new TestClient('flush-B-test');

      const flushTimestamp = Date.now();

      // Client A initiates flush
      const flushOp = clientA.createOperation({
        actionType: '[Archive] Flush Young to Old' as ActionType,
        opType: OpType.Batch,
        entityType: 'ALL',
        entityId: uuidv7(),
        payload: { timestamp: flushTimestamp },
      });

      await storeService.append(flushOp, 'local');
      server.uploadOps([flushOp], clientA.clientId);

      // Client B downloads the flush operation
      const downloadResponse = server.downloadOps(0);
      expect(downloadResponse.ops.length).toBe(1);

      // Client B would execute the same deterministic flush logic
      // (in real system, ArchiveOperationHandler does this)
      const receivedFlushOp = downloadResponse.ops[0].op;
      const receivedPayload = receivedFlushOp.payload as { timestamp: number };

      // Timestamp should be identical - ensures deterministic execution
      expect(receivedPayload.timestamp).toBe(flushTimestamp);

      // Merge clocks
      clientB.mergeRemoteClock(flushOp.vectorClock);

      // Client B's clock should now include Client A's knowledge
      const bClock = clientB.getCurrentClock();
      expect(bClock['flush-A-test']).toBe(1);
    });
  });

  describe('Fresh Client Hydration', () => {
    it('should receive complete timeTracking via SYNC_IMPORT', async () => {
      const existingClient = new TestClient('existing-cl');

      // Existing client has comprehensive time tracking data
      const fullStateImport = existingClient.createOperation({
        actionType: '[SP_ALL] Load(import) all data' as ActionType,
        opType: OpType.SyncImport,
        entityType: 'ALL',
        entityId: uuidv7(),
        payload: {
          appDataComplete: {
            timeTracking: {
              project: {
                'proj-1': { '2024-01-15': { s: 100, e: 200 } },
                'proj-2': { '2024-01-14': { s: 300, e: 400 } },
              },
              tag: {
                'tag-1': { '2024-01-15': { s: 50, e: 60 } },
              },
            },
            archiveYoung: {
              task: { ids: [], entities: {} },
              timeTracking: {
                project: { 'proj-1': { '2024-01-10': { s: 10, e: 20 } } },
                tag: {},
              },
              lastTimeTrackingFlush: Date.now(),
            },
            archiveOld: {
              task: { ids: [], entities: {} },
              timeTracking: {
                project: { 'proj-3': { '2024-01-01': { s: 1, e: 2 } } },
                tag: {},
              },
              lastTimeTrackingFlush: Date.now() - 30 * 86400000,
            },
          },
        },
      });

      server.uploadOps([fullStateImport], existingClient.clientId);

      // Fresh client downloads
      const freshClient = new TestClient('fresh-client');
      const downloadResponse = server.downloadOps(0);

      expect(downloadResponse.ops.length).toBe(1);
      expect(downloadResponse.ops[0].op.opType).toBe(OpType.SyncImport);

      // Verify all timeTracking data is present
      const payload = downloadResponse.ops[0].op.payload as {
        appDataComplete: {
          timeTracking: TimeTrackingState;
          archiveYoung: { timeTracking: TimeTrackingState };
          archiveOld: { timeTracking: TimeTrackingState };
        };
      };

      // Active state
      expect(Object.keys(payload.appDataComplete.timeTracking.project).length).toBe(2);
      expect(Object.keys(payload.appDataComplete.timeTracking.tag).length).toBe(1);

      // Archive young
      expect(
        Object.keys(payload.appDataComplete.archiveYoung.timeTracking.project).length,
      ).toBe(1);

      // Archive old
      expect(
        Object.keys(payload.appDataComplete.archiveOld.timeTracking.project).length,
      ).toBe(1);

      // Fresh client merges clock
      freshClient.mergeRemoteClock(fullStateImport.vectorClock);
      expect(freshClient.getCurrentClock()['existing-cl']).toBe(1);
    });
  });
});
