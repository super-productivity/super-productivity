import { TestBed } from '@angular/core/testing';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { OpType } from '../../core/operation.types';
import { resetTestUuidCounter } from './helpers/test-client.helper';
import { MockSyncServer } from './helpers/mock-sync-server.helper';
import { SimulatedClient } from './helpers/simulated-client.helper';
import {
  createMinimalTaskPayload,
  createMinimalProjectPayload,
} from './helpers/operation-factory.helper';

/**
 * Integration tests for Sync Provider Switch scenarios.
 *
 * These tests verify that switching sync providers preserves:
 * 1. Local operation log data
 * 2. Vector clocks
 * 3. Client ID
 * 4. Pending (unsynced) operations
 *
 * The key insight is that the operation log is provider-agnostic.
 * Switching providers just changes where operations are uploaded/downloaded from.
 *
 * LIMITATIONS:
 * - Tests simulate provider switching at the operation log level
 * - Actual provider authentication/configuration is not tested here
 * - Full provider switch with UI is tested in E2E tests
 */
describe('Provider Switch Integration', () => {
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

  describe('Operation Log Preservation During Provider Switch', () => {
    /**
     * Test: Local operations are NOT cleared when switching providers
     *
     * The operation log is provider-agnostic. When switching from Provider A
     * to Provider B, all local operations should remain intact.
     */
    it('should preserve local operations when switching providers', async () => {
      const client = new SimulatedClient('client-a', storeService);
      const serverA = new MockSyncServer();

      // Create some operations and sync to "Provider A"
      await client.createLocalOp(
        'TASK',
        'task-1',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('task-1', { title: 'Task 1' }),
      );

      await client.createLocalOp(
        'TASK',
        'task-2',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('task-2', { title: 'Task 2' }),
      );

      await client.createLocalOp(
        'PROJECT',
        'project-1',
        OpType.Create,
        '[Project] Add Project',
        createMinimalProjectPayload('project-1'),
      );

      // Sync to Provider A
      await client.sync(serverA);

      // Verify operations exist
      let allOps = await storeService.getOpsAfterSeq(0);
      expect(allOps.length).toBe(3);

      // === SIMULATE PROVIDER SWITCH ===
      // In a real app, this would be: pfapi.setActiveSyncProvider('ProviderB')
      // The operation log itself is not cleared - only the sync endpoint changes
      // (No new server variable needed - we're just verifying local state persists)

      // Verify local operations are still intact after "switch"
      allOps = await storeService.getOpsAfterSeq(0);
      expect(allOps.length).toBe(3);

      // Operations should still have their original data
      const task1Op = allOps.find((e) => e.op.entityId === 'task-1');
      expect(task1Op).toBeDefined();
      expect(task1Op!.op.opType).toBe(OpType.Create);
    });

    /**
     * Test: Vector clocks are preserved when switching providers
     *
     * Vector clocks track causality independent of the sync provider.
     * They should persist across provider changes.
     */
    it('should preserve vector clocks when switching providers', async () => {
      const client = new SimulatedClient('client-a', storeService);
      const serverA = new MockSyncServer();

      // Create operations
      await client.createLocalOp(
        'TASK',
        'task-1',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('task-1'),
      );

      await client.createLocalOp('TASK', 'task-1', OpType.Update, '[Task] Update Task', {
        title: 'Updated Task 1',
      });

      // Sync to Provider A
      await client.sync(serverA);

      // Get current vector clock state
      const opsBeforeSwitch = await storeService.getOpsAfterSeq(0);
      const lastOpBeforeSwitch = opsBeforeSwitch[opsBeforeSwitch.length - 1];
      const vectorClockBeforeSwitch = { ...lastOpBeforeSwitch.op.vectorClock };

      // === SWITCH PROVIDER ===
      // (No new server needed - we're verifying vector clocks persist locally)

      // Create new operation after switch
      await client.createLocalOp(
        'TASK',
        'task-2',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('task-2'),
      );

      // The new operation should continue the vector clock sequence
      const opsAfterSwitch = await storeService.getOpsAfterSeq(0);
      const newOp = opsAfterSwitch[opsAfterSwitch.length - 1];

      // Vector clock should have been incremented from the pre-switch state
      expect(newOp.op.vectorClock['client-a']).toBeGreaterThan(
        vectorClockBeforeSwitch['client-a'] || 0,
      );
    });

    /**
     * Test: Client ID is preserved when switching providers
     *
     * The client ID is a device identifier, not a provider identifier.
     * It should remain the same across provider switches.
     */
    it('should preserve client ID when switching providers', async () => {
      const clientId = 'persistent-client-id';
      const client = new SimulatedClient(clientId, storeService);
      const serverA = new MockSyncServer();

      // Create operation with Provider A
      await client.createLocalOp(
        'TASK',
        'task-1',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('task-1'),
      );
      await client.sync(serverA);

      // Get client ID from operations
      const opsBeforeSwitch = await storeService.getOpsAfterSeq(0);
      const clientIdBeforeSwitch = opsBeforeSwitch[0].op.clientId;
      expect(clientIdBeforeSwitch).toBe(clientId);

      // === SWITCH PROVIDER ===
      // (No new server needed - we're verifying client ID persists locally)

      // Create operation with "Provider B"
      await client.createLocalOp(
        'TASK',
        'task-2',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('task-2'),
      );

      // Client ID should be the same
      const opsAfterSwitch = await storeService.getOpsAfterSeq(0);
      const newOp = opsAfterSwitch.find((e) => e.op.entityId === 'task-2');
      expect(newOp!.op.clientId).toBe(clientId);
    });
  });

  describe('Pending Operations After Provider Switch', () => {
    /**
     * Test: Unsynced operations sync to new provider
     *
     * If you have pending (unsynced) operations when you switch providers,
     * those operations should be uploaded to the new provider on next sync.
     */
    it('should sync pending operations to new provider', async () => {
      const client = new SimulatedClient('client-a', storeService);
      // Note: serverA would be the original provider, but we never synced to it

      // Create operations but DON'T sync
      await client.createLocalOp(
        'TASK',
        'pending-task-1',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('pending-task-1'),
      );

      await client.createLocalOp(
        'TASK',
        'pending-task-2',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('pending-task-2'),
      );

      await client.createLocalOp(
        'TASK',
        'pending-task-3',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('pending-task-3'),
      );

      // Verify they're unsynced
      const unsyncedBefore = await storeService.getUnsynced();
      expect(unsyncedBefore.length).toBe(3);

      // === SWITCH TO NEW PROVIDER ===
      const serverB = new MockSyncServer();

      // Sync to the new provider
      const syncResult = await client.sync(serverB);
      expect(syncResult.uploaded).toBe(3);

      // Verify new provider received all operations
      const serverBOps = serverB.getAllOps();
      expect(serverBOps.length).toBe(3);

      // All operations should now be marked as synced
      const unsyncedAfter = await storeService.getUnsynced();
      expect(unsyncedAfter.length).toBe(0);
    });

    /**
     * Test: Mixed synced/unsynced operations handle provider switch correctly
     */
    it('should handle mix of synced and unsynced operations', async () => {
      const client = new SimulatedClient('client-a', storeService);
      const serverA = new MockSyncServer();

      // Create and sync some operations to Provider A
      await client.createLocalOp(
        'TASK',
        'synced-task-1',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('synced-task-1'),
      );
      await client.sync(serverA);

      await client.createLocalOp(
        'TASK',
        'synced-task-2',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('synced-task-2'),
      );
      await client.sync(serverA);

      // Create more operations but DON'T sync
      await client.createLocalOp(
        'TASK',
        'pending-task-1',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('pending-task-1'),
      );

      await client.createLocalOp(
        'TASK',
        'pending-task-2',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('pending-task-2'),
      );

      // State: 2 synced to A, 2 pending
      const unsyncedBefore = await storeService.getUnsynced();
      expect(unsyncedBefore.length).toBe(2);

      // === SWITCH TO NEW PROVIDER ===
      const serverB = new MockSyncServer();

      // Sync to new provider - ALL operations should be uploaded
      // because Provider B hasn't seen any of them
      const syncResult = await client.sync(serverB);

      // Only the unsynced ones should be uploaded (they weren't synced to B)
      expect(syncResult.uploaded).toBe(2);

      // Server B should have the pending operations
      const serverBOps = serverB.getAllOps();
      expect(serverBOps.length).toBe(2);

      // The pending operations should now be synced
      const unsyncedAfter = await storeService.getUnsynced();
      expect(unsyncedAfter.length).toBe(0);
    });
  });

  describe('Provider Switch with Existing Remote Data', () => {
    /**
     * Test: Switch to provider with existing data from another device
     *
     * When switching to a provider that already has data from another device,
     * the client should download and merge that data.
     */
    it('should download existing data from new provider', async () => {
      const clientA = new SimulatedClient('device-a', storeService);
      const clientB = new SimulatedClient('device-b', storeService);
      const sharedServer = new MockSyncServer();

      // Device A creates and syncs data to the shared server
      await clientA.createLocalOp(
        'TASK',
        'remote-task-1',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('remote-task-1', { title: 'Task from Device A' }),
      );

      await clientA.createLocalOp(
        'PROJECT',
        'remote-project-1',
        OpType.Create,
        '[Project] Add Project',
        createMinimalProjectPayload('remote-project-1'),
      );

      await clientA.sync(sharedServer);

      // Server now has Device A's data
      expect(sharedServer.getAllOps().length).toBe(2);

      // Device B has its own local data (not synced anywhere yet)
      await clientB.createLocalOp(
        'TASK',
        'local-task-1',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('local-task-1', { title: 'Task from Device B' }),
      );

      // Device B now "switches" to use the shared server
      // (In reality, this is configuring a new provider)
      const syncResult = await clientB.sync(sharedServer);

      // Device B should upload its local op AND download Device A's ops
      expect(syncResult.uploaded).toBe(1); // local-task-1
      expect(syncResult.downloaded).toBe(2); // remote-task-1, remote-project-1

      // Verify Device B now has all operations
      const deviceBOps = await storeService.getOpsAfterSeq(0);
      expect(deviceBOps.length).toBe(3);

      // Should have both its own and Device A's operations
      const hasLocalTask = deviceBOps.some((e) => e.op.entityId === 'local-task-1');
      const hasRemoteTask = deviceBOps.some((e) => e.op.entityId === 'remote-task-1');
      const hasRemoteProject = deviceBOps.some(
        (e) => e.op.entityId === 'remote-project-1',
      );

      expect(hasLocalTask).toBeTrue();
      expect(hasRemoteTask).toBeTrue();
      expect(hasRemoteProject).toBeTrue();
    });
  });

  describe('Provider Switch Does Not Reset Sequence Numbers', () => {
    /**
     * Test: Local sequence numbers continue incrementing after switch
     */
    it('should continue incrementing sequence numbers after provider switch', async () => {
      const client = new SimulatedClient('client-a', storeService);
      const serverA = new MockSyncServer();

      // Create operations
      await client.createLocalOp(
        'TASK',
        'task-1',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('task-1'),
      );
      await client.createLocalOp(
        'TASK',
        'task-2',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('task-2'),
      );
      await client.sync(serverA);

      // Get ops and use first op's seq as baseline
      // (IndexedDB auto-increment continues across tests even after clearing)
      const opsBeforeSwitch = await storeService.getOpsAfterSeq(0);
      expect(opsBeforeSwitch.length).toBe(2);
      const baselineSeq = opsBeforeSwitch[0].seq;

      // Second operation should be baseline + 1
      expect(opsBeforeSwitch[1].seq - baselineSeq).toBe(1);

      // === SWITCH PROVIDER ===
      // (No new server needed - we're verifying sequence numbers persist locally)

      // Create more operations
      await client.createLocalOp(
        'TASK',
        'task-3',
        OpType.Create,
        '[Task] Add Task',
        createMinimalTaskPayload('task-3'),
      );

      // Verify the new operation has the incremented seq
      const allOps = await storeService.getOpsAfterSeq(0);
      expect(allOps.length).toBe(3);
      const task3Op = allOps.find((e) => e.op.entityId === 'task-3');
      expect(task3Op).toBeDefined();
      // Third op should be baseline + 2
      expect(task3Op!.seq - baselineSeq).toBe(2);
    });
  });
});
