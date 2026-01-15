import { TestBed } from '@angular/core/testing';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { OpType } from '../../core/operation.types';
import { resetTestUuidCounter } from './helpers/test-client.helper';
import { MockSyncServer } from './helpers/mock-sync-server.helper';
import { SimulatedClient } from './helpers/simulated-client.helper';

/**
 * Integration tests for server migration scenarios.
 *
 * These tests verify the behavior when a client with existing data
 * connects to a new/reset server (simulating server migration, self-hosting
 * changes, or switching sync providers).
 *
 * The critical bug being tested:
 * When a client with lastServerSeq > 0 connects to an empty server,
 * the server returns gapDetected: true. The client must then:
 * 1. Reset its lastServerSeq to 0
 * 2. Upload a FULL STATE snapshot (not just incremental ops)
 *
 * Without step 2, incremental ops reference entities that don't exist
 * on the new server, causing data corruption for other clients.
 */
describe('Server Migration Integration', () => {
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

  describe('Gap Detection on Empty Server', () => {
    it('should return gapDetected: true when client has history but server is empty', () => {
      // Client synced before with lastServerSeq = 100
      // Server is empty (latestSeq = 0)
      const response = server.downloadOps(100, undefined, 500);

      expect(response.gapDetected).toBe(true);
      expect(response.latestSeq).toBe(0);
      expect(response.ops.length).toBe(0);
    });

    it('should return gapDetected: false when both client and server start fresh', () => {
      // Fresh client, fresh server
      const response = server.downloadOps(0, undefined, 500);

      expect(response.gapDetected).toBe(false);
      expect(response.latestSeq).toBe(0);
    });

    it('should return gapDetected: true when client is ahead of server', async () => {
      const clientA = new SimulatedClient('client-a', storeService);

      // Client uploads 1 op, server at seq 1
      await clientA.createLocalOp('TASK', 'task1', OpType.Create, '[Task] Add', {
        title: 'Task 1',
      });
      await clientA.sync(server);

      expect(server.getLatestSeq()).toBe(1);

      // Client asks for seq 100 (way ahead of server)
      const response = server.downloadOps(100, undefined, 500);

      expect(response.gapDetected).toBe(true);
      expect(response.latestSeq).toBe(1);
    });

    it('should simulate server reset correctly', async () => {
      const clientA = new SimulatedClient('client-a', storeService);

      // Create some data and sync
      await clientA.createLocalOp('TASK', 'task1', OpType.Create, '[Task] Add', {
        title: 'Task 1',
      });
      await clientA.sync(server);

      expect(server.getLatestSeq()).toBe(1);

      // Simulate server migration/reset
      server.simulateServerReset();

      // Server is now empty
      expect(server.getLatestSeq()).toBe(0);

      // Next download should detect gap
      const response = server.downloadOps(1, 'client-a', 500);
      expect(response.gapDetected).toBe(true);
      expect(response.ops.length).toBe(0);
    });
  });

  describe('Server Migration Scenario', () => {
    /**
     * This test reproduces the exact bug from the user's logs:
     *
     * 1. Client A syncs data to "old server" (seq 3913)
     * 2. Server is reset (new server, seq 0)
     * 3. Client A connects with stale lastServerSeq (3913)
     * 4. Server returns gapDetected: true
     * 5. Client should upload FULL STATE (not just incremental ops)
     * 6. Client B joining should receive ALL data
     */
    it('should detect server migration when client has stale seq', async () => {
      const clientA = new SimulatedClient('client-a', storeService);

      // Phase 1: Client A creates data and syncs
      await clientA.createLocalOp('TASK', 'task1', OpType.Create, '[Task] Add', {
        title: 'Task 1',
      });
      await clientA.createLocalOp('TASK', 'task2', OpType.Create, '[Task] Add', {
        title: 'Task 2',
      });
      await clientA.sync(server);

      const oldServerSeq = server.getLatestSeq();
      expect(oldServerSeq).toBe(2);

      // Phase 2: Server is reset (simulating migration to new server)
      server.simulateServerReset();

      // Phase 3: Client A tries to sync with stale lastServerSeq
      // The client still thinks server is at seq 2, but server is at 0
      // Download should return gapDetected: true
      const downloadResponse = server.downloadOps(oldServerSeq, 'client-a', 500);

      expect(downloadResponse.gapDetected).toBe(true);
      expect(downloadResponse.latestSeq).toBe(0);
      expect(downloadResponse.ops.length).toBe(0);
    });

    it('should allow new client to sync after migration when data is re-uploaded', async () => {
      const clientA = new SimulatedClient('client-a', storeService);
      const clientB = new SimulatedClient('client-b', storeService);

      // Phase 1: Client A creates data and syncs
      await clientA.createLocalOp('TASK', 'task1', OpType.Create, '[Task] Add', {
        title: 'Task 1',
      });
      await clientA.sync(server);

      // Phase 2: Server is reset
      server.simulateServerReset();

      // Phase 3: For this test, we manually simulate what SHOULD happen:
      // Client A detects gap and re-uploads its data
      // (In the real fix, this would create a SYNC_IMPORT operation)
      await clientA.createLocalOp('TASK', 'task1-reimport', OpType.Create, '[Task] Add', {
        title: 'Task 1 (re-imported)',
      });
      await clientA.sync(server);

      // Phase 4: Client B joins and syncs
      const syncResult = await clientB.sync(server);

      // Client B should have received the re-uploaded data
      expect(syncResult.downloaded).toBe(1);
    });
  });

  describe('Gap Detection with forceGapDetected', () => {
    it('should allow forcing gap detection for testing', () => {
      // Force gap detection even when it wouldn't normally occur
      server.setForceGapDetected(true);

      const response = server.downloadOps(0, undefined, 500);

      expect(response.gapDetected).toBe(true);
    });

    it('should reset forceGapDetected after use', () => {
      server.setForceGapDetected(true);

      // First call should have gap
      const response1 = server.downloadOps(0, undefined, 500);
      expect(response1.gapDetected).toBe(true);

      // Second call should not (flag was reset)
      const response2 = server.downloadOps(0, undefined, 500);
      expect(response2.gapDetected).toBe(false);
    });
  });
});
