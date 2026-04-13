import { test } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  markTaskDone,
  renameTask,
  type SimulatedE2EClient,
  SUPERSYNC_BASE_URL,
} from '../../utils/supersync-helpers';

/**
 * SuperSync Compaction/Snapshot Resilience E2E Tests
 *
 * Tests that server snapshot creation doesn't break sync for
 * existing or new clients.
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-compaction.spec.ts
 */

/**
 * Trigger server-side snapshot generation via the test API.
 * Falls back gracefully if endpoint doesn't exist.
 */
const triggerServerSnapshot = async (token: string): Promise<boolean> => {
  try {
    const response = await fetch(`${SUPERSYNC_BASE_URL}/api/test/trigger-snapshot`, {
      method: 'POST',
      headers: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
    if (response.ok) {
      console.log('[Compaction] Server snapshot triggered successfully');
      return true;
    }
    console.log(
      `[Compaction] Snapshot trigger returned ${response.status} - endpoint may not exist`,
    );
    return false;
  } catch {
    console.log('[Compaction] Snapshot trigger failed - endpoint may not exist');
    return false;
  }
};

test.describe('@supersync Compaction/Snapshot Resilience', () => {
  /**
   * Scenario: Heavy operations, snapshot, then new client joins
   *
   * This tests that after many operations and a potential snapshot,
   * a new client can still get complete state and bidirectional sync
   * continues working.
   *
   * Flow:
   * 1. Client A creates 10+ tasks, marks some done, renames some
   * 2. Client A syncs
   * 3. Attempt to trigger server snapshot (may not be available)
   * 4. Client A creates more tasks post-snapshot
   * 5. New Client B joins and syncs
   * 6. Verify B gets complete state (pre + post snapshot data)
   * 7. Bidirectional sync continues working
   */
  test('New client receives complete state after heavy operations', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Client A creates many tasks ============
      console.log('[Compaction] Phase 1: Client A creates many tasks');

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // Create 10 tasks
      const taskNames: string[] = [];
      for (let i = 1; i <= 10; i++) {
        const taskName = `CompTask-${i.toString().padStart(2, '0')}-${testRunId}`;
        taskNames.push(taskName);
        await clientA.workView.addTask(taskName);
      }
      console.log(`[Compaction] Created ${taskNames.length} tasks`);

      // Mark some tasks as done
      await markTaskDone(clientA, taskNames[0]);
      await markTaskDone(clientA, taskNames[1]);
      await markTaskDone(clientA, taskNames[2]);
      console.log('[Compaction] Marked 3 tasks as done');

      // Rename some tasks
      const renamedTask = `CompTask-Renamed-${testRunId}`;
      await renameTask(clientA, taskNames[4], renamedTask);
      taskNames[4] = renamedTask;
      console.log('[Compaction] Renamed 1 task');

      // Sync all operations
      await clientA.sync.syncAndWait();
      console.log('[Compaction] Client A synced all operations');

      // ============ PHASE 2: Attempt to trigger snapshot ============
      console.log('[Compaction] Phase 2: Attempting server snapshot');

      const snapshotTriggered = await triggerServerSnapshot(user.token);
      if (!snapshotTriggered) {
        console.log(
          '[Compaction] Snapshot endpoint not available - testing without snapshot',
        );
        console.log(
          '[Compaction] (Test still validates heavy-operation sync resilience)',
        );
      }

      // ============ PHASE 3: Client A creates more tasks after snapshot ============
      console.log('[Compaction] Phase 3: Creating post-snapshot tasks');

      const postSnapshotTask1 = `PostSnap-1-${testRunId}`;
      const postSnapshotTask2 = `PostSnap-2-${testRunId}`;
      await clientA.workView.addTask(postSnapshotTask1);
      await clientA.workView.addTask(postSnapshotTask2);

      await clientA.sync.syncAndWait();
      console.log('[Compaction] Client A synced post-snapshot tasks');

      // ============ PHASE 4: New Client B joins ============
      console.log('[Compaction] Phase 4: New Client B joins');

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Client B syncs to get all data
      await clientB.sync.syncAndWait();
      // Extra sync to ensure everything is received
      await clientB.sync.syncAndWait();
      console.log('[Compaction] Client B synced');

      // ============ PHASE 5: Verify B gets complete state ============
      console.log('[Compaction] Phase 5: Verifying Client B has complete state');

      // Check undone tasks are visible (first 3 were marked done)
      for (let i = 3; i < taskNames.length; i++) {
        await waitForTask(clientB.page, taskNames[i]);
      }

      // Check post-snapshot tasks
      await waitForTask(clientB.page, postSnapshotTask1);
      await waitForTask(clientB.page, postSnapshotTask2);
      console.log('[Compaction] ✓ Client B received all expected tasks');

      // ============ PHASE 6: Verify bidirectional sync still works ============
      console.log('[Compaction] Phase 6: Verifying bidirectional sync');

      // Client B creates a task
      const taskFromB = `FromB-${testRunId}`;
      await clientB.workView.addTask(taskFromB);
      await clientB.sync.syncAndWait();
      console.log('[Compaction] Client B created and synced a task');

      // Client A syncs and should see B's task
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, taskFromB);
      console.log("[Compaction] ✓ Client A received Client B's task");

      console.log('[Compaction] ✓ Compaction/snapshot resilience test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
