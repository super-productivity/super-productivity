import { TestBed } from '@angular/core/testing';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { ActionType, OpType } from '../../core/operation.types';
import { resetTestUuidCounter } from './helpers/test-client.helper';
import { MockSyncServer } from './helpers/mock-sync-server.helper';
import { SimulatedClient } from './helpers/simulated-client.helper';

/**
 * Integration tests for sync scenarios from sync-scenarios.md.
 *
 * These tests simulate sync workflows at the protocol level, verifying:
 * - Operations are uploaded/downloaded correctly
 * - Server receives and stores operations
 * - Basic conflict scenarios work at the store level
 *
 * LIMITATIONS (documented for transparency):
 * 1. SHARED DATABASE: All SimulatedClient instances share the same IndexedDB.
 *    This means local ops from client B are immediately visible to client A
 *    without sync. True client isolation would require separate databases.
 *    This approach tests the sync protocol but not data isolation bugs.
 *
 * 2. NO STATE APPLICATION: These tests verify the operation log, not the
 *    final application state (tasks/projects). OperationApplierService
 *    integration is tested separately.
 *
 * 3. NO UI CONFLICT RESOLUTION: Conflict detection works, but user-driven
 *    resolution via dialogs is tested in E2E tests.
 *
 * For true end-to-end sync validation with isolated clients, see:
 * - E2E tests in /e2e/
 * - Server integration tests in packages/super-sync-server/tests/
 */
describe('Sync Scenarios Integration', () => {
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

  describe('2. Two Client Scenarios (No Conflict)', () => {
    /**
     * Scenario 2.2: Both Clients Create Different Tasks
     *
     * Setup: A and B connected, empty server
     *
     * Actions:
     * 1. Client A creates "Task A", syncs
     * 2. Client B creates "Task B", syncs
     * 3. Client A syncs (download)
     * 4. Client B syncs (download)
     *
     * Expected: Both clients have both tasks, server has both ops
     */
    it('2.2 Both clients create different tasks', async () => {
      // Setup: Two clients sharing the same store (simulating shared DB)
      const clientA = new SimulatedClient('client-a-test', storeService);
      const clientB = new SimulatedClient('client-b-test', storeService);

      // Step 1: Client A creates "Task A" and syncs
      const opA = await clientA.createLocalOp(
        'TASK',
        'taskA',
        OpType.Create,
        '[Task] Add Task',
        { title: 'Task A' },
      );
      const syncResultA1 = await clientA.sync(server);
      expect(syncResultA1.uploaded).toBe(1);
      expect(syncResultA1.downloaded).toBe(0);

      // Verify server state after step 1
      expect(server.getAllOps().length).toBe(1);
      expect(server.getAllOps()[0].op.id).toBe(opA.id);

      // Step 2: Client B creates "Task B" and syncs
      const opB = await clientB.createLocalOp(
        'TASK',
        'taskB',
        OpType.Create,
        '[Task] Add Task',
        { title: 'Task B' },
      );
      const syncResultB1 = await clientB.sync(server);
      expect(syncResultB1.uploaded).toBe(1);
      // Client B should also download Client A's op
      expect(syncResultB1.downloaded).toBe(1);

      // Verify server state after step 2
      expect(server.getAllOps().length).toBe(2);

      // Step 3: Client A syncs (download)
      const syncResultA2 = await clientA.sync(server);
      expect(syncResultA2.uploaded).toBe(0); // Nothing new to upload
      expect(syncResultA2.downloaded).toBe(1); // Should get opB

      // Step 4: Client B syncs (download) - should be no-op
      const syncResultB2 = await clientB.sync(server);
      expect(syncResultB2.uploaded).toBe(0);
      expect(syncResultB2.downloaded).toBe(0); // Already has everything

      // === Verify Final State ===

      // Server should have both ops
      const serverOps = server.getAllOps();
      expect(serverOps.length).toBe(2);
      expect(serverOps.map((o) => o.op.entityId).sort()).toEqual(['taskA', 'taskB']);

      // Get all ops from the shared store
      const allOps = await storeService.getOpsAfterSeq(0);

      // Should have both ops
      expect(allOps.length).toBe(2);

      // Verify opA (created by A)
      const storedOpA = allOps.find((e) => e.op.id === opA.id);
      expect(storedOpA).toBeDefined();
      expect(storedOpA!.op.entityId).toBe('taskA');
      expect(storedOpA!.source).toBe('local');
      expect(storedOpA!.syncedAt).toBeDefined(); // Marked synced after upload

      // Verify opB (created by B, received as remote by A)
      const storedOpB = allOps.find((e) => e.op.id === opB.id);
      expect(storedOpB).toBeDefined();
      expect(storedOpB!.op.entityId).toBe('taskB');
      // Note: In shared store, opB was created locally by B,
      // but we're verifying the final state contains both
    });

    /**
     * Scenario 2.1: Client A Creates, Client B Downloads
     *
     * Setup: Client A and B, empty server
     *
     * Actions:
     * 1. Client A creates "Task 1", syncs
     * 2. Client B syncs (download)
     *
     * Expected:
     * - Client A Log: op1 with source=local, syncedAt=set
     * - Client B Log: op1 with source=remote, syncedAt=set
     * - Server: op1 present
     */
    it('2.1 Client A creates, Client B downloads', async () => {
      const clientA = new SimulatedClient('client-a-test', storeService);
      const clientB = new SimulatedClient('client-b-test', storeService);

      // Step 1: Client A creates and syncs
      const op1 = await clientA.createLocalOp(
        'TASK',
        'task1',
        OpType.Create,
        '[Task] Add Task',
        { title: 'Task 1' },
      );
      await clientA.sync(server);

      // Step 2: Client B syncs (download)
      const syncResult = await clientB.sync(server);
      expect(syncResult.uploaded).toBe(0);
      expect(syncResult.downloaded).toBe(1);

      // Verify server has op1
      expect(server.getAllOps().length).toBe(1);
      expect(server.getAllOps()[0].op.id).toBe(op1.id);

      // In our shared store model, we verify the op exists
      const hasOp = await storeService.hasOp(op1.id);
      expect(hasOp).toBe(true);

      // Verify the stored op
      const allOps = await storeService.getOpsAfterSeq(0);
      const storedOp = allOps.find((e) => e.op.id === op1.id);
      expect(storedOp).toBeDefined();
      expect(storedOp!.op.entityId).toBe('task1');
      expect(storedOp!.syncedAt).toBeDefined();
    });

    /**
     * Scenario 2.3: Client A Creates Parent, Client B Creates Subtask
     */
    it('2.3 Client A creates parent, Client B creates subtask', async () => {
      const clientA = new SimulatedClient('client-a-test', storeService);
      const clientB = new SimulatedClient('client-b-test', storeService);

      // Step 1: Client A creates parent task and syncs
      const parentOp = await clientA.createLocalOp(
        'TASK',
        'parent1',
        OpType.Create,
        '[Task] Add Task',
        { title: 'Parent 1', subTaskIds: [] },
      );
      await clientA.sync(server);

      // Step 2: Client B syncs (downloads parent)
      await clientB.sync(server);

      // Verify B has the parent
      expect(await clientB.hasOp(parentOp.id)).toBe(true);

      // Step 3: Client B creates subtask and syncs
      const subtaskOp = await clientB.createLocalOp(
        'TASK',
        'sub1',
        OpType.Create,
        '[Task] Add Task',
        { title: 'Subtask 1', parentId: 'parent1' },
      );
      await clientB.sync(server);

      // Verify server has both ops
      expect(server.getAllOps().length).toBe(2);

      // Verify subtask references parent
      const serverSubtaskOp = server.getAllOps().find((o) => o.op.entityId === 'sub1');
      expect(serverSubtaskOp).toBeDefined();
      expect((serverSubtaskOp!.op.payload as any).parentId).toBe('parent1');

      // Step 4: Client A syncs to get the subtask
      const syncResultA = await clientA.sync(server);
      expect(syncResultA.downloaded).toBe(1);
      expect(await clientA.hasOp(subtaskOp.id)).toBe(true);
    });
  });

  describe('1. Single Client Scenarios', () => {
    /**
     * Scenario 1.1: Create Task → Sync → Verify Server
     */
    it('1.1 Create task and sync to server', async () => {
      const clientA = new SimulatedClient('client-a-test', storeService);

      // Create task
      const op1 = await clientA.createLocalOp(
        'TASK',
        'task1',
        OpType.Create,
        '[Task] Add Task',
        { title: 'Task 1' },
      );

      // Sync
      const syncResult = await clientA.sync(server);
      expect(syncResult.uploaded).toBe(1);

      // Verify server
      const serverOps = server.getAllOps();
      expect(serverOps.length).toBe(1);
      expect(serverOps[0].op.id).toBe(op1.id);
      expect(serverOps[0].op.entityType).toBe('TASK');
      expect(serverOps[0].op.opType).toBe(OpType.Create);

      // Verify client log
      const allOps = await storeService.getOpsAfterSeq(0);
      const storedOp = allOps.find((e) => e.op.id === op1.id);
      expect(storedOp!.syncedAt).toBeDefined();
    });

    /**
     * Scenario 1.2: Create Task with Subtasks → Sync
     */
    it('1.2 Create task with subtasks and sync', async () => {
      const clientA = new SimulatedClient('client-a-test', storeService);

      // Create parent
      await clientA.createLocalOp('TASK', 'parent1', OpType.Create, '[Task] Add Task', {
        title: 'Parent',
        subTaskIds: ['sub1', 'sub2'],
      });

      // Create subtasks
      await clientA.createLocalOp('TASK', 'sub1', OpType.Create, '[Task] Add Task', {
        title: 'Subtask 1',
        parentId: 'parent1',
      });

      await clientA.createLocalOp('TASK', 'sub2', OpType.Create, '[Task] Add Task', {
        title: 'Subtask 2',
        parentId: 'parent1',
      });

      // Sync all
      const syncResult = await clientA.sync(server);
      expect(syncResult.uploaded).toBe(3);

      // Verify server has all 3 ops
      const serverOps = server.getAllOps();
      expect(serverOps.length).toBe(3);

      const entityIds = serverOps.map((o) => o.op.entityId).sort();
      expect(entityIds).toEqual(['parent1', 'sub1', 'sub2']);
    });

    /**
     * Scenario 1.3: Update Task → Sync
     */
    it('1.3 Update task and sync', async () => {
      const clientA = new SimulatedClient('client-a-test', storeService);

      // Create
      await clientA.createLocalOp('TASK', 'task1', OpType.Create, '[Task] Add Task', {
        title: 'Task 1',
      });

      // Sync create
      await clientA.sync(server);

      // Update
      await clientA.createLocalOp('TASK', 'task1', OpType.Update, '[Task] Update Task', {
        title: 'Task 1 Updated',
      });

      // Sync update
      const syncResult = await clientA.sync(server);
      expect(syncResult.uploaded).toBe(1);

      // Verify server has both ops
      const serverOps = server.getAllOps();
      expect(serverOps.length).toBe(2);

      // Verify order (CREATE before UPDATE)
      expect(serverOps[0].op.opType).toBe(OpType.Create);
      expect(serverOps[1].op.opType).toBe(OpType.Update);
    });

    /**
     * Scenario 1.4: Delete Task → Sync
     */
    it('1.4 Delete task and sync', async () => {
      const clientA = new SimulatedClient('client-a-test', storeService);

      // Create
      await clientA.createLocalOp('TASK', 'task1', OpType.Create, '[Task] Add Task', {
        title: 'Task 1',
      });
      await clientA.sync(server);

      // Delete
      await clientA.createLocalOp(
        'TASK',
        'task1',
        OpType.Delete,
        '[Task] Delete Task',
        {},
      );
      await clientA.sync(server);

      // Verify server has both ops with DELETE having higher seq
      const serverOps = server.getAllOps();
      expect(serverOps.length).toBe(2);

      const createOp = serverOps.find((o) => o.op.opType === OpType.Create)!;
      const deleteOp = serverOps.find((o) => o.op.opType === OpType.Delete)!;
      expect(deleteOp.serverSeq).toBeGreaterThan(createOp.serverSeq);
    });
  });

  describe('4. Dependency Ordering Scenarios', () => {
    /**
     * Scenario 4.1: Remote Ops Arrive Out of Order
     *
     * Setup: Client B receives ops where subtask comes before parent
     *
     * Note: Ops are stored in arrival order (seq reflects arrival, not dependency order).
     * The OperationApplierService reorders ops for application based on dependencies.
     * This test verifies both ops are stored; actual application order is tested
     * in operation-applier.service.spec.ts.
     */
    it('4.1 Remote ops arrive out of order - both stored for application', async () => {
      const clientA = new SimulatedClient('client-a-test', storeService);
      const clientB = new SimulatedClient('client-b-test', storeService);

      // Client A creates parent and subtask, syncs
      await clientA.createLocalOp('TASK', 'parent1', OpType.Create, '[Task] Add Task', {
        title: 'Parent 1',
        subTaskIds: ['sub1'],
      });
      await clientA.createLocalOp('TASK', 'sub1', OpType.Create, '[Task] Add Task', {
        title: 'Subtask 1',
        parentId: 'parent1',
      });
      await clientA.sync(server);

      // Verify server has both ops
      expect(server.getAllOps().length).toBe(2);

      // Client B downloads - should get both ops
      const syncResult = await clientB.sync(server);
      expect(syncResult.downloaded).toBe(2);

      // Verify both ops are in the store
      const allOps = await storeService.getOpsAfterSeq(0);
      expect(allOps.length).toBe(2);

      // Both should be stored (applier handles dependency ordering at apply time)
      const parentOp = allOps.find((e) => e.op.entityId === 'parent1');
      const subtaskOp = allOps.find((e) => e.op.entityId === 'sub1');
      expect(parentOp).toBeDefined();
      expect(subtaskOp).toBeDefined();

      // Verify subtask references parent in payload
      expect((subtaskOp!.op.payload as any).parentId).toBe('parent1');
    });

    /**
     * Scenario 4.2: Project and Tasks in Same Batch
     *
     * Verifies that project and dependent tasks are all stored.
     * Note: Application order (project before tasks) is handled by
     * OperationApplierService, not the storage layer.
     */
    it('4.2 Project and tasks in same batch - all stored', async () => {
      const clientA = new SimulatedClient('client-a-test', storeService);
      const clientB = new SimulatedClient('client-b-test', storeService);

      // Client A creates project with tasks
      await clientA.createLocalOp(
        'PROJECT',
        'proj1',
        OpType.Create,
        '[Project] Add Project',
        {
          title: 'Work',
          taskIds: ['task1', 'task2'],
        },
      );
      await clientA.createLocalOp('TASK', 'task1', OpType.Create, '[Task] Add Task', {
        title: 'Task 1',
        projectId: 'proj1',
      });
      await clientA.createLocalOp('TASK', 'task2', OpType.Create, '[Task] Add Task', {
        title: 'Task 2',
        projectId: 'proj1',
      });
      await clientA.sync(server);

      // Verify server has all 3 ops
      expect(server.getAllOps().length).toBe(3);

      // Client B downloads all
      const syncResult = await clientB.sync(server);
      expect(syncResult.downloaded).toBe(3);

      // Verify all ops stored
      const allOps = await storeService.getOpsAfterSeq(0);
      expect(allOps.length).toBe(3);

      const entityIds = allOps.map((e) => e.op.entityId).sort();
      expect(entityIds).toEqual(['proj1', 'task1', 'task2']);
    });
  });

  describe('5. Edge Cases', () => {
    /**
     * Scenario 5.1: Duplicate Op Received
     */
    it('5.1 Duplicate op is not stored twice', async () => {
      const clientA = new SimulatedClient('client-a-test', storeService);
      const clientB = new SimulatedClient('client-b-test', storeService);

      // Client A creates and syncs
      const op1 = await clientA.createLocalOp(
        'TASK',
        'task1',
        OpType.Create,
        '[Task] Add Task',
        { title: 'Task 1' },
      );
      await clientA.sync(server);

      // Client B syncs twice - should only store once
      await clientB.sync(server);
      await clientB.sync(server);

      // Verify only one entry in store
      const allOps = await storeService.getOpsAfterSeq(0);
      const matchingOps = allOps.filter((e) => e.op.id === op1.id);
      expect(matchingOps.length).toBe(1);
    });

    /**
     * Scenario 5.2: Concurrent Updates Both Reach Server
     *
     * Note: This tests that concurrent edits are both uploaded to the server.
     * Stale op detection (via vector clock comparison) happens in
     * OperationLogSyncService.processRemoteOps(), which is tested separately.
     *
     * This test verifies the protocol: both concurrent ops reach the server
     * and can be downloaded by other clients.
     */
    it('5.2 Concurrent updates both reach server', async () => {
      const clientA = new SimulatedClient('client-a-test', storeService);
      const clientB = new SimulatedClient('client-b-test', storeService);

      // Client A creates task and syncs
      await clientA.createLocalOp('TASK', 'task1', OpType.Create, '[Task] Add Task', {
        title: 'Task 1',
      });
      await clientA.sync(server);

      // Client B syncs to get the task
      await clientB.sync(server);

      // Client A updates first
      const opAUpdate = await clientA.createLocalOp(
        'TASK',
        'task1',
        OpType.Update,
        '[Task] Update Task',
        { title: 'Task 1 - A Update' },
      );
      await clientA.sync(server);

      // Client B updates locally (while offline, before syncing A's update)
      const opBUpdate = await clientB.createLocalOp(
        'TASK',
        'task1',
        OpType.Update,
        '[Task] Update Task',
        { title: 'Task 1 - B Update' },
      );

      // Now B syncs - uploads B's update, downloads A's update
      const syncResult = await clientB.sync(server);
      expect(syncResult.uploaded).toBe(1);
      expect(syncResult.downloaded).toBe(1);

      // Server should have: create + A's update + B's update = 3 ops
      const serverOps = server.getAllOps();
      expect(serverOps.length).toBe(3);

      // Verify both updates are on server
      const serverUpdateOps = serverOps.filter((o) => o.op.opType === OpType.Update);
      expect(serverUpdateOps.length).toBe(2);

      // Verify the updates have different client IDs
      const updateClientIds = serverUpdateOps.map((o) => o.op.clientId);
      expect(updateClientIds).toContain(opAUpdate.clientId);
      expect(updateClientIds).toContain(opBUpdate.clientId);
    });

    /**
     * Scenario 5.3: Empty Sync
     */
    it('5.3 Empty sync has no effect', async () => {
      const clientA = new SimulatedClient('client-a-test', storeService);

      // Sync with nothing to sync
      const syncResult = await clientA.sync(server);
      expect(syncResult.uploaded).toBe(0);
      expect(syncResult.downloaded).toBe(0);

      // Verify no ops
      expect(server.getAllOps().length).toBe(0);
      expect((await storeService.getOpsAfterSeq(0)).length).toBe(0);
    });
  });

  describe('3. Conflict Scenarios (Store-Level)', () => {
    /**
     * Note: Full conflict resolution with UI dialogs is tested in E2E tests.
     * These tests verify the store-level conflict tracking mechanisms:
     * - Concurrent operations on the same entity
     * - Marking ops as rejected
     * - Delete vs Update conflicts
     */

    /**
     * Scenario 3.1: Same Task Edited by Two Clients
     *
     * Setup: Both clients edit same task concurrently
     * Expected: Both ops exist in server (conflict detection happens at sync service level)
     */
    it('3.1 Concurrent edits on same task - both ops stored', async () => {
      const clientA = new SimulatedClient('client-a-test', storeService);
      const clientB = new SimulatedClient('client-b-test', storeService);

      // Create task via A, sync to server
      await clientA.createLocalOp('TASK', 'task1', OpType.Create, '[Task] Add Task', {
        title: 'Task 1',
      });
      await clientA.sync(server);

      // B downloads
      await clientB.sync(server);

      // Both clients edit offline (concurrent changes)
      await clientA.createLocalOp('TASK', 'task1', OpType.Update, '[Task] Update Task', {
        title: "A's Version",
      });
      await clientB.createLocalOp('TASK', 'task1', OpType.Update, '[Task] Update Task', {
        title: "B's Version",
      });

      // A syncs first
      await clientA.sync(server);

      // B syncs - has concurrent edit
      await clientB.sync(server);

      // Server has: CREATE + A's UPDATE + B's UPDATE
      const serverOps = server.getAllOps();
      expect(serverOps.length).toBe(3);

      // Both updates are on server
      const updates = serverOps.filter((o) => o.op.opType === OpType.Update);
      expect(updates.length).toBe(2);

      // Verify both versions exist
      const titles = updates.map((o) => (o.op.payload as any).title);
      expect(titles).toContain("A's Version");
      expect(titles).toContain("B's Version");
    });

    /**
     * Scenario 3.2: Rejecting local ops (simulating "choose remote" resolution)
     *
     * When user chooses remote version, local ops should be marked rejected
     */
    it('3.2 Local ops can be marked rejected after conflict resolution', async () => {
      const clientA = new SimulatedClient('client-a-test', storeService);

      // Create a local op
      const op = await clientA.createLocalOp(
        'TASK',
        'task1',
        OpType.Update,
        '[Task] Update Task',
        { title: 'Local Version' },
      );

      // Mark it as rejected (simulating user chose remote)
      await storeService.markRejected([op.id]);

      // Verify the op is marked rejected
      const allOps = await storeService.getOpsAfterSeq(0);
      const rejectedOp = allOps.find((e) => e.op.id === op.id);
      expect(rejectedOp).toBeDefined();
      expect(rejectedOp!.rejectedAt).toBeDefined();

      // Rejected ops should not appear in unsynced (they won't be uploaded)
      const unsynced = await storeService.getUnsynced();
      expect(unsynced.find((e) => e.op.id === op.id)).toBeUndefined();
    });

    /**
     * Scenario 3.3: Delete vs Update Conflict
     *
     * One client deletes, another updates - both ops stored
     */
    it('3.3 Delete vs Update - both ops stored', async () => {
      const clientA = new SimulatedClient('client-a-test', storeService);
      const clientB = new SimulatedClient('client-b-test', storeService);

      // Create task, sync to both clients
      await clientA.createLocalOp('TASK', 'task1', OpType.Create, '[Task] Add Task', {
        title: 'Task 1',
      });
      await clientA.sync(server);
      await clientB.sync(server);

      // A deletes (offline)
      await clientA.createLocalOp(
        'TASK',
        'task1',
        OpType.Delete,
        '[Task] Delete Task',
        {},
      );

      // B updates (offline)
      await clientB.createLocalOp('TASK', 'task1', OpType.Update, '[Task] Update Task', {
        title: 'Task 1 - Important',
      });

      // A syncs first
      await clientA.sync(server);

      // B syncs - has concurrent update vs A's delete
      await clientB.sync(server);

      // Server has: CREATE + DELETE + UPDATE
      const serverOps = server.getAllOps();
      expect(serverOps.length).toBe(3);

      // Verify op types on server
      expect(serverOps.some((o) => o.op.opType === OpType.Create)).toBe(true);
      expect(serverOps.some((o) => o.op.opType === OpType.Delete)).toBe(true);
      expect(serverOps.some((o) => o.op.opType === OpType.Update)).toBe(true);
    });
  });

  describe('6. Crash Recovery Scenarios', () => {
    /**
     * Scenario 6.1: Crash After Store, Before Apply
     *
     * Setup: Remote ops stored with applicationStatus: 'pending'
     * Simulate: App restart (getPendingRemoteOps should return them)
     *
     * Expected: Pending ops are retrievable for retry on restart
     */
    it('6.1 Pending remote ops are retrievable after simulated crash', async () => {
      const testOp = {
        id: 'crash-test-op',
        clientId: 'otherClient',
        actionType: '[Task] Add Task' as ActionType,
        opType: OpType.Create,
        entityType: 'TASK' as const,
        entityId: 'crash-task',
        payload: { title: 'Crash Test Task' },
        vectorClock: { otherClient: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      // Store with pendingApply flag (simulates crash before apply completed)
      await storeService.append(testOp, 'remote', { pendingApply: true });

      // Verify getPendingRemoteOps returns this op
      const pendingOps = await storeService.getPendingRemoteOps();
      expect(pendingOps.length).toBe(1);
      expect(pendingOps[0].op.id).toBe('crash-test-op');
      expect(pendingOps[0].applicationStatus).toBe('pending');

      // After marking applied, it should no longer be pending
      await storeService.markApplied([pendingOps[0].seq]);
      const pendingAfter = await storeService.getPendingRemoteOps();
      expect(pendingAfter.length).toBe(0);
    });

    /**
     * Scenario 6.2: Repeated Failures → Rejection
     *
     * Setup: Op fails to apply multiple times
     * Expected: After max retries, op is marked as failed/rejected
     */
    it('6.2 Failed ops are tracked with retry count', async () => {
      const testOp = {
        id: 'fail-test-op',
        clientId: 'otherClient',
        actionType: '[Task] Add Task' as ActionType,
        opType: OpType.Create,
        entityType: 'TASK' as const,
        entityId: 'fail-task',
        payload: { title: 'Fail Test Task' },
        vectorClock: { otherClient: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      // Store op
      await storeService.append(testOp, 'remote', { pendingApply: true });

      // Simulate failure - mark as failed with retry count
      await storeService.markFailed(['fail-test-op']);

      // Get all ops and verify the failed status
      const allOps = await storeService.getOpsAfterSeq(0);
      const failedOp = allOps.find((e) => e.op.id === 'fail-test-op');
      expect(failedOp).toBeDefined();
      expect(failedOp!.applicationStatus).toBe('failed');
      expect(failedOp!.retryCount).toBe(1);

      // Mark failed again - retry count should increment
      await storeService.markFailed(['fail-test-op']);
      const allOps2 = await storeService.getOpsAfterSeq(0);
      const failedOp2 = allOps2.find((e) => e.op.id === 'fail-test-op');
      expect(failedOp2!.retryCount).toBe(2);
    });
  });

  describe('8. Server Protocol Edge Cases', () => {
    /**
     * Scenario 8.1: Pagination - hasMore flag
     *
     * When server has more ops than the limit, hasMore is true
     */
    it('8.1 Server pagination returns hasMore when ops exceed limit', async () => {
      const clientA = new SimulatedClient('client-a-test', storeService);

      // Create 5 ops
      for (let i = 0; i < 5; i++) {
        await clientA.createLocalOp(
          'TASK',
          `task${i}`,
          OpType.Create,
          '[Task] Add Task',
          { title: `Task ${i}` },
        );
      }
      await clientA.sync(server);

      // Download with limit of 2
      const response = server.downloadOps(0, undefined, 2);
      expect(response.ops.length).toBe(2);
      expect(response.hasMore).toBe(true);

      // Download remaining with offset
      const response2 = server.downloadOps(response.ops[1].serverSeq, undefined, 10);
      expect(response2.ops.length).toBe(3);
      expect(response2.hasMore).toBe(false);
    });

    /**
     * Scenario 8.2: Upload rejection for duplicates
     *
     * Server rejects duplicate ops gracefully
     */
    it('8.2 Server rejects duplicate uploads', async () => {
      const clientA = new SimulatedClient('client-a-test', storeService);

      // Create and sync an op
      const op = await clientA.createLocalOp(
        'TASK',
        'task1',
        OpType.Create,
        '[Task] Add Task',
        { title: 'Task 1' },
      );
      await clientA.sync(server);

      // Try to upload the same op again directly
      const response = server.uploadOps(
        [
          {
            id: op.id,
            clientId: op.clientId,
            actionType: op.actionType,
            opType: op.opType,
            entityType: op.entityType,
            entityId: op.entityId,
            payload: op.payload,
            vectorClock: op.vectorClock,
            timestamp: op.timestamp,
            schemaVersion: op.schemaVersion,
          },
        ],
        'client-a-test',
        0,
      );

      expect(response.results.length).toBe(1);
      expect(response.results[0].accepted).toBe(false);
      expect(response.results[0].error).toContain('Duplicate');

      // Server should still have only 1 op
      expect(server.getAllOps().length).toBe(1);
    });

    // NOTE: Scenario 8.3 (Client acknowledgment tracking) was removed.
    // ACK mechanism has been replaced with time-based cleanup (50 days).
    // See sync-server-architecture-diagrams.md for details.

    /**
     * Scenario 8.4: lastKnownServerSeq persistence simulation
     *
     * Client remembers its position across sync cycles
     */
    it('8.4 Client maintains lastKnownServerSeq across syncs', async () => {
      const clientA = new SimulatedClient('client-a-test', storeService);
      const clientB = new SimulatedClient('client-b-test', storeService);

      // A creates 3 ops over multiple syncs
      await clientA.createLocalOp('TASK', 'task1', OpType.Create, '[Task] Add Task', {
        title: 'Task 1',
      });
      await clientA.sync(server);

      await clientA.createLocalOp('TASK', 'task2', OpType.Create, '[Task] Add Task', {
        title: 'Task 2',
      });
      await clientA.sync(server);

      await clientA.createLocalOp('TASK', 'task3', OpType.Create, '[Task] Add Task', {
        title: 'Task 3',
      });
      await clientA.sync(server);

      // B syncs for first time - gets all 3
      const sync1 = await clientB.sync(server);
      expect(sync1.downloaded).toBe(3);

      // B syncs again - gets nothing (already up to date)
      const sync2 = await clientB.sync(server);
      expect(sync2.downloaded).toBe(0);

      // A creates another op
      await clientA.createLocalOp('TASK', 'task4', OpType.Create, '[Task] Add Task', {
        title: 'Task 4',
      });
      await clientA.sync(server);

      // B syncs - only gets the new one
      const sync3 = await clientB.sync(server);
      expect(sync3.downloaded).toBe(1);
    });
  });

  describe('7. Complex Multi-Step Scenario', () => {
    /**
     * Scenario 7.1: Full Workflow - Two Clients, Mixed Operations
     *
     * Simulates a realistic workflow:
     * 1. Client A (desktop) creates project with tasks
     * 2. Client B (mobile) syncs and receives everything
     * 3. Both clients go offline and make changes
     * 4. Client A syncs first
     * 5. Client B syncs (concurrent ops detected)
     * 6. Both clients sync to converge
     *
     * This tests the full sync lifecycle without UI conflict resolution.
     */
    it('7.1 Full workflow - project creation, multi-client edits, convergence', async () => {
      const clientA = new SimulatedClient('client-a-desktop', storeService);
      const clientB = new SimulatedClient('client-b-mobile', storeService);

      // === Step 1: Client A creates project with tasks ===
      await clientA.createLocalOp(
        'PROJECT',
        'proj1',
        OpType.Create,
        '[Project] Add Project',
        { title: 'Work', taskIds: ['task1', 'task2'] },
      );
      await clientA.createLocalOp('TASK', 'task1', OpType.Create, '[Task] Add Task', {
        title: 'Task 1',
        projectId: 'proj1',
        subTaskIds: ['task1.1'],
      });
      await clientA.createLocalOp('TASK', 'task2', OpType.Create, '[Task] Add Task', {
        title: 'Task 2',
        projectId: 'proj1',
      });
      await clientA.createLocalOp('TASK', 'task1.1', OpType.Create, '[Task] Add Task', {
        title: 'Task 1.1',
        parentId: 'task1',
      });

      const syncA1 = await clientA.sync(server);
      expect(syncA1.uploaded).toBe(4);

      // Server should have 4 ops
      expect(server.getAllOps().length).toBe(4);

      // === Step 2: Client B syncs and receives everything ===
      const syncB1 = await clientB.sync(server);
      expect(syncB1.downloaded).toBe(4);

      // === Step 3: Both clients go offline and make changes ===
      // Client A: Update task1, delete task2, create task3
      await clientA.createLocalOp('TASK', 'task1', OpType.Update, '[Task] Update Task', {
        title: 'Task 1 - Desktop Edit',
      });
      await clientA.createLocalOp(
        'TASK',
        'task2',
        OpType.Delete,
        '[Task] Delete Task',
        {},
      );
      await clientA.createLocalOp('TASK', 'task3', OpType.Create, '[Task] Add Task', {
        title: 'Task 3',
        projectId: 'proj1',
      });

      // Client B: Update task1 (different edit), update task2, complete task1.1
      await clientB.createLocalOp('TASK', 'task1', OpType.Update, '[Task] Update Task', {
        title: 'Task 1 - Mobile Edit',
      });
      await clientB.createLocalOp('TASK', 'task2', OpType.Update, '[Task] Update Task', {
        title: 'Task 2 - Important',
      });
      await clientB.createLocalOp(
        'TASK',
        'task1.1',
        OpType.Update,
        '[Task] Update Task',
        {
          isDone: true,
        },
      );

      // === Step 4: Client A syncs first ===
      const syncA2 = await clientA.sync(server);
      expect(syncA2.uploaded).toBe(3); // 3 new ops from A

      // Server should now have 7 ops
      expect(server.getAllOps().length).toBe(7);

      // === Step 5: Client B syncs (has concurrent ops) ===
      const syncB2 = await clientB.sync(server);
      expect(syncB2.uploaded).toBe(3); // 3 ops from B
      expect(syncB2.downloaded).toBe(3); // A's 3 ops

      // Server should now have 10 ops total
      expect(server.getAllOps().length).toBe(10);

      // === Step 6: Client A syncs to get B's changes ===
      const syncA3 = await clientA.sync(server);
      expect(syncA3.uploaded).toBe(0); // Nothing new to upload
      expect(syncA3.downloaded).toBe(3); // B's 3 ops

      // === Verify Final State ===
      const serverOps = server.getAllOps();
      expect(serverOps.length).toBe(10);

      // Count by entity type
      const projectOps = serverOps.filter((o) => o.op.entityType === 'PROJECT');
      const taskOps = serverOps.filter((o) => o.op.entityType === 'TASK');
      expect(projectOps.length).toBe(1);
      expect(taskOps.length).toBe(9);

      // Count by op type
      const creates = serverOps.filter((o) => o.op.opType === OpType.Create);
      const updates = serverOps.filter((o) => o.op.opType === OpType.Update);
      const deletes = serverOps.filter((o) => o.op.opType === OpType.Delete);
      expect(creates.length).toBe(5); // proj1, task1, task2, task1.1, task3
      expect(updates.length).toBe(4); // task1 x2, task2, task1.1
      expect(deletes.length).toBe(1); // task2

      // Verify task1 has both updates (concurrent edits)
      const task1Updates = serverOps.filter(
        (o) => o.op.entityId === 'task1' && o.op.opType === OpType.Update,
      );
      expect(task1Updates.length).toBe(2);

      // Verify task2 has delete AND update (conflict case)
      const task2Ops = serverOps.filter((o) => o.op.entityId === 'task2');
      expect(task2Ops.length).toBe(3); // CREATE + DELETE + UPDATE

      // All ops should be synced (have syncedAt in client store)
      const allClientOps = await storeService.getOpsAfterSeq(0);
      expect(allClientOps.length).toBe(10);
      const syncedOps = allClientOps.filter((e) => e.syncedAt !== null);
      expect(syncedOps.length).toBe(10);
    });
  });
});
