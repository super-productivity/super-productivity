import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * SuperSync Snapshot Vector Clock E2E Tests
 *
 * Tests the snapshot optimization scenario where the server skips returning
 * old operations when a SYNC_IMPORT/BACKUP_IMPORT/REPAIR exists.
 *
 * The fix being tested: When using snapshot optimization, the server returns
 * a `snapshotVectorClock` which is an aggregate of all vector clocks from
 * skipped operations. This allows fresh clients to create merged updates
 * that properly dominate all known clocks.
 *
 * Without this fix, fresh clients would get stuck in infinite loops because
 * their merged updates would never dominate (missing clock entries from
 * other clients whose ops were skipped).
 */

test.describe('@supersync SuperSync Snapshot Vector Clock', () => {
  /**
   * Scenario 1: Fresh client joins after snapshot optimization
   *
   * This tests the core fix: a fresh client (Client C) joining after Client A
   * has done a full-state sync (SYNC_IMPORT) and Client B has made changes.
   * Client C's local changes should sync correctly without infinite loops.
   *
   * The scenario that caused the bug:
   * 1. Client A syncs full state (SYNC_IMPORT at seq 316)
   * 2. Client B makes changes (ops 317-319)
   * 3. Client C joins fresh (sinceSeq=0)
   * 4. Server uses snapshot optimization: skips ops 0-315, returns 316-319
   * 5. Client C makes a change that conflicts with something from before seq 316
   * 6. Without snapshotVectorClock, Client C's merged update can never dominate
   *    (missing clock entries from skipped ops) -> infinite loop
   *
   * With the fix, Client C receives snapshotVectorClock and can create
   * dominating updates.
   */
  test('Fresh client syncs correctly after snapshot optimization (no infinite loop)', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(120000);
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let clientC: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // === Phase 1: Client A creates initial data and syncs ===
      console.log('[SnapshotClock] Phase 1: Client A creates initial data');
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // Create several tasks to build up operation history
      const taskA1 = `A1-${testRunId}`;
      const taskA2 = `A2-${testRunId}`;
      const taskA3 = `A3-${testRunId}`;
      await clientA.workView.addTask(taskA1);
      await waitForTask(clientA.page, taskA1);
      await clientA.workView.addTask(taskA2);
      await waitForTask(clientA.page, taskA2);
      await clientA.workView.addTask(taskA3);
      await waitForTask(clientA.page, taskA3);

      // Sync to server
      await clientA.sync.syncAndWait();
      console.log('[SnapshotClock] Client A synced initial tasks');

      // === Phase 2: Client B joins and makes changes ===
      console.log('[SnapshotClock] Phase 2: Client B joins and makes changes');
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();

      // Verify B has all tasks
      await waitForTask(clientB.page, taskA1);
      await waitForTask(clientB.page, taskA2);
      await waitForTask(clientB.page, taskA3);

      // Client B creates more tasks (these will be after any potential snapshot)
      const taskB1 = `B1-${testRunId}`;
      const taskB2 = `B2-${testRunId}`;
      await clientB.workView.addTask(taskB1);
      await waitForTask(clientB.page, taskB1);
      await clientB.workView.addTask(taskB2);
      await waitForTask(clientB.page, taskB2);

      // Client B syncs
      await clientB.sync.syncAndWait();
      console.log('[SnapshotClock] Client B created and synced tasks');

      // Client A syncs to get B's changes
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, taskB1);
      await waitForTask(clientA.page, taskB2);

      // === Phase 3: Client C joins fresh (simulates snapshot optimization) ===
      console.log('[SnapshotClock] Phase 3: Client C joins fresh');
      clientC = await createSimulatedClient(browser, baseURL!, 'C', testRunId);
      await clientC.sync.setupSuperSync(syncConfig);

      // Initial sync - Client C downloads all data
      // Server may use snapshot optimization here depending on server state
      await clientC.sync.syncAndWait();

      // Verify C has all existing tasks
      await waitForTask(clientC.page, taskA1);
      await waitForTask(clientC.page, taskA2);
      await waitForTask(clientC.page, taskA3);
      await waitForTask(clientC.page, taskB1);
      await waitForTask(clientC.page, taskB2);
      console.log('[SnapshotClock] Client C downloaded all tasks');

      // === Phase 4: Client C makes changes ===
      // This is the critical part - C's changes need to sync without getting stuck
      console.log('[SnapshotClock] Phase 4: Client C makes changes');
      const taskC1 = `C1-${testRunId}`;
      const taskC2 = `C2-${testRunId}`;
      await clientC.workView.addTask(taskC1);
      await waitForTask(clientC.page, taskC1);
      await clientC.workView.addTask(taskC2);
      await waitForTask(clientC.page, taskC2);

      // Client C syncs - without the fix, this could get stuck in infinite loop
      // Set a shorter timeout to catch infinite loops quickly
      const syncPromise = clientC.sync.syncAndWait();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('Sync timed out - possible infinite loop')),
          30000,
        ),
      );

      await Promise.race([syncPromise, timeoutPromise]);
      console.log('[SnapshotClock] Client C synced successfully (no infinite loop)');

      // === Phase 5: Verify all clients converge ===
      console.log('[SnapshotClock] Phase 5: Verifying convergence');

      // Sync all clients to converge
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientC.sync.syncAndWait();

      // Wait for UI to settle
      await clientA.page.waitForTimeout(1000);
      await clientB.page.waitForTimeout(1000);
      await clientC.page.waitForTimeout(1000);

      // All tasks should be present on all clients
      const allTasks = [taskA1, taskA2, taskA3, taskB1, taskB2, taskC1, taskC2];

      for (const task of allTasks) {
        await waitForTask(clientA.page, task);
        await waitForTask(clientB.page, task);
        await waitForTask(clientC.page, task);
      }

      // Count tasks to ensure consistency
      const countA = await clientA.page.locator(`task:has-text("${testRunId}")`).count();
      const countB = await clientB.page.locator(`task:has-text("${testRunId}")`).count();
      const countC = await clientC.page.locator(`task:has-text("${testRunId}")`).count();

      expect(countA).toBe(7);
      expect(countB).toBe(7);
      expect(countC).toBe(7);

      console.log('[SnapshotClock] ✓ All clients converged with 7 tasks each');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
      if (clientC) await closeClient(clientC);
    }
  });

  /**
   * Scenario 2: Multiple fresh clients joining sequentially
   *
   * Tests that multiple clients can join fresh and sync correctly,
   * each receiving proper snapshotVectorClock values.
   */
  test('Multiple fresh clients join and sync correctly after snapshot', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let clientC: SimulatedE2EClient | null = null;
    let clientD: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Client A: Creates initial data
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const taskA1 = `A1-${testRunId}`;
      await clientA.workView.addTask(taskA1);
      await waitForTask(clientA.page, taskA1);
      await clientA.sync.syncAndWait();
      console.log('[MultiClient] Client A created initial task');

      // Client B: Joins, adds data
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskA1);

      const taskB1 = `B1-${testRunId}`;
      await clientB.workView.addTask(taskB1);
      await waitForTask(clientB.page, taskB1);
      await clientB.sync.syncAndWait();
      console.log('[MultiClient] Client B joined and added task');

      // Close Client B to simulate it going offline
      await closeClient(clientB);
      clientB = null;

      // Client A continues working
      const taskA2 = `A2-${testRunId}`;
      await clientA.workView.addTask(taskA2);
      await waitForTask(clientA.page, taskA2);
      await clientA.sync.syncAndWait();

      // Client C: Joins fresh (never saw Client B's changes locally)
      clientC = await createSimulatedClient(browser, baseURL!, 'C', testRunId);
      await clientC.sync.setupSuperSync(syncConfig);
      await clientC.sync.syncAndWait();

      // C should have all tasks from A and B
      await waitForTask(clientC.page, taskA1);
      await waitForTask(clientC.page, taskA2);
      await waitForTask(clientC.page, taskB1);

      // C adds its own task
      const taskC1 = `C1-${testRunId}`;
      await clientC.workView.addTask(taskC1);
      await waitForTask(clientC.page, taskC1);
      await clientC.sync.syncAndWait();
      console.log('[MultiClient] Client C joined and added task');

      // Client D: Another fresh client joins
      clientD = await createSimulatedClient(browser, baseURL!, 'D', testRunId);
      await clientD.sync.setupSuperSync(syncConfig);
      await clientD.sync.syncAndWait();

      // D should have all tasks
      await waitForTask(clientD.page, taskA1);
      await waitForTask(clientD.page, taskA2);
      await waitForTask(clientD.page, taskB1);
      await waitForTask(clientD.page, taskC1);

      // D adds its own task
      const taskD1 = `D1-${testRunId}`;
      await clientD.workView.addTask(taskD1);
      await waitForTask(clientD.page, taskD1);
      await clientD.sync.syncAndWait();
      console.log('[MultiClient] Client D joined and added task');

      // Final sync for all active clients
      await clientA.sync.syncAndWait();
      await clientC.sync.syncAndWait();
      await clientD.sync.syncAndWait();

      // Verify all active clients have all 5 tasks
      const allTasks = [taskA1, taskA2, taskB1, taskC1, taskD1];

      for (const task of allTasks) {
        await waitForTask(clientA.page, task);
        await waitForTask(clientC.page, task);
        await waitForTask(clientD.page, task);
      }

      const countA = await clientA.page.locator(`task:has-text("${testRunId}")`).count();
      const countC = await clientC.page.locator(`task:has-text("${testRunId}")`).count();
      const countD = await clientD.page.locator(`task:has-text("${testRunId}")`).count();

      expect(countA).toBe(5);
      expect(countC).toBe(5);
      expect(countD).toBe(5);

      console.log('[MultiClient] ✓ All clients converged with 5 tasks each');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
      if (clientC) await closeClient(clientC);
      if (clientD) await closeClient(clientD);
    }
  });

  /**
   * Scenario 3: Fresh client with concurrent modifications
   *
   * Tests the scenario where a fresh client joins and immediately
   * has concurrent modifications with an existing client. This is
   * the most likely scenario to trigger the infinite loop bug.
   */
  test('Fresh client handles concurrent modifications after snapshot', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(120000);
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Client A: Establishes baseline
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // Create initial tasks
      const sharedTask = `Shared-${testRunId}`;
      await clientA.workView.addTask(sharedTask);
      await waitForTask(clientA.page, sharedTask);
      await clientA.sync.syncAndWait();
      console.log('[ConcurrentFresh] Client A created shared task');

      // Add more operations to build up history
      for (let i = 0; i < 5; i++) {
        await clientA.workView.addTask(`Filler-${i}-${testRunId}`);
      }
      await clientA.sync.syncAndWait();
      console.log('[ConcurrentFresh] Client A added filler tasks');

      // Client B: Joins fresh
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();

      // Verify B has all tasks
      await waitForTask(clientB.page, sharedTask);
      console.log('[ConcurrentFresh] Client B joined and synced');

      // Now create concurrent modifications
      // Client A: Marks shared task as done
      const taskLocatorA = clientA.page
        .locator(`task:not(.ng-animating):has-text("${sharedTask}")`)
        .first();
      await taskLocatorA.hover();
      await taskLocatorA.locator('.task-done-btn').click();
      await expect(taskLocatorA).toHaveClass(/isDone/, { timeout: 5000 });
      console.log('[ConcurrentFresh] Client A marked shared task done');

      // Client B: Also marks shared task as done (concurrent change)
      const taskLocatorB = clientB.page
        .locator(`task:not(.ng-animating):has-text("${sharedTask}")`)
        .first();
      await taskLocatorB.hover();
      await taskLocatorB.locator('.task-done-btn').click();
      await expect(taskLocatorB).toHaveClass(/isDone/, { timeout: 5000 });
      console.log('[ConcurrentFresh] Client B marked shared task done (concurrent)');

      // Client A syncs first
      await clientA.sync.syncAndWait();

      // Client B syncs - this is where the infinite loop could occur
      // without the snapshotVectorClock fix
      const syncPromise = clientB.sync.syncAndWait();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('Sync timed out - possible infinite loop')),
          30000,
        ),
      );

      await Promise.race([syncPromise, timeoutPromise]);
      console.log('[ConcurrentFresh] Client B synced without infinite loop');

      // Final sync to ensure convergence
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // Wait for UI to settle
      await clientA.page.waitForTimeout(500);
      await clientB.page.waitForTimeout(500);

      // Verify both clients show the shared task as done
      await waitForTask(clientA.page, sharedTask);
      await waitForTask(clientB.page, sharedTask);

      const finalTaskA = clientA.page
        .locator(`task:not(.ng-animating):has-text("${sharedTask}")`)
        .first();
      const finalTaskB = clientB.page
        .locator(`task:not(.ng-animating):has-text("${sharedTask}")`)
        .first();

      await expect(finalTaskA).toHaveClass(/isDone/, { timeout: 5000 });
      await expect(finalTaskB).toHaveClass(/isDone/, { timeout: 5000 });

      // Verify task counts match
      const countA = await clientA.page.locator(`task:has-text("${testRunId}")`).count();
      const countB = await clientB.page.locator(`task:has-text("${testRunId}")`).count();
      expect(countA).toBe(countB);

      console.log('[ConcurrentFresh] ✓ Concurrent modifications resolved correctly');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
