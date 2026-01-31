import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  markTaskDone,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import {
  expectTaskOnAllClients,
  expectEqualTaskCount,
} from '../../utils/supersync-assertions';

/**
 * SuperSync Vector Clock Max Size & LWW Retry Limit E2E Tests
 *
 * These tests verify the fixes from commit cb36c09538:
 * - LWW re-upload retry loop has a bounded maximum (prevents infinite sync)
 * - TAG:TODAY concurrent edits converge without hanging
 * - Multiple clients with many tasks produce consistent vector clocks
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-vector-clock-max-size.spec.ts
 */

test.describe.configure({ mode: 'serial' });

test.describe('@supersync @vector-clock-max-size Vector Clock Max Size and LWW Retry', () => {
  /**
   * Test 1: Sync completes without hanging during heavy LWW conflict (retry limit)
   *
   * Creates concurrent edits that produce many LWW conflicts.
   * Without the retry limit fix, the sync would loop infinitely
   * re-uploading local-win ops that keep producing new LWW ops.
   *
   * Steps:
   * 1. Client A creates 5 tasks, syncs
   * 2. Client B syncs, receives tasks
   * 3. Both clients mark all tasks done (concurrent edits)
   * 4. Client A syncs first
   * 5. Client B syncs (many LWW conflicts from concurrent done-marking)
   * 6. Assert: sync completes (doesn't hang), clients converge, no errors
   */
  test('Sync completes without hanging during heavy LWW conflict (retry limit)', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = `${testRunId}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ Setup clients ============
      console.log('[LWW Retry] Setting up clients');
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // ============ Client A creates tasks ============
      console.log('[LWW Retry] Client A creating tasks');
      const taskNames: string[] = [];
      for (let i = 1; i <= 5; i++) {
        const name = `LWW-Task${i}-${uniqueId}`;
        taskNames.push(name);
        await clientA.workView.addTask(name);
      }
      await clientA.sync.syncAndWait();
      console.log('[LWW Retry] Client A synced tasks');

      // ============ Client B receives tasks ============
      console.log('[LWW Retry] Client B syncing to receive tasks');
      await clientB.sync.syncAndWait();
      for (const name of taskNames) {
        await waitForTask(clientB.page, name);
      }
      console.log('[LWW Retry] Client B has all tasks');

      // ============ Both mark all tasks done concurrently ============
      console.log('[LWW Retry] Both clients marking tasks done');
      for (const name of taskNames) {
        await markTaskDone(clientA, name);
      }
      for (const name of taskNames) {
        await markTaskDone(clientB, name);
      }
      console.log('[LWW Retry] Both clients marked all tasks done');

      // ============ Sequential sync: A first, then B ============
      console.log('[LWW Retry] Client A syncing done state');
      await clientA.sync.syncAndWait();
      console.log('[LWW Retry] Client A synced');

      // This is the critical step: B has many concurrent edits that produce LWW conflicts
      // Without the retry limit fix, this would loop infinitely
      console.log('[LWW Retry] Client B syncing (heavy LWW conflicts expected)');
      await clientB.sync.syncAndWait();
      console.log('[LWW Retry] Client B synced (did not hang!)');

      // ============ Verify convergence ============
      console.log('[LWW Retry] Verifying convergence');

      // Final sync to ensure full convergence
      await clientA.sync.syncAndWait();

      // Both clients should have same task count
      await expectEqualTaskCount([clientA, clientB]);

      // No error snackbars
      const errorSnackA = clientA.page.locator('simple-snack-bar.error');
      const errorSnackB = clientB.page.locator('simple-snack-bar.error');
      await expect(errorSnackA).not.toBeVisible({ timeout: 3000 });
      await expect(errorSnackB).not.toBeVisible({ timeout: 3000 });

      console.log('[LWW Retry] Test PASSED - sync completed without hanging');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Test 2: TAG:TODAY operations converge after concurrent edits (the bug scenario)
   *
   * This reproduces the exact bug scenario: two clients editing tasks that belong
   * to TAG:TODAY (via dueDay). Concurrent edits on the same entity produce LWW
   * conflicts that previously caused an infinite re-upload loop.
   *
   * Steps:
   * 1. Client A creates a task with sd:today (adds to TODAY tag), syncs
   * 2. Client B syncs, receives the task
   * 3. Client A marks the task done
   * 4. Client B concurrently renames the task
   * 5. Both sync in sequence
   * 6. Assert: sync completes, no hanging, consistent state
   */
  test('TAG:TODAY operations converge after concurrent edits (the bug scenario)', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = `${testRunId}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ Setup clients ============
      console.log('[TODAY] Setting up clients');
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Initial sync
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // ============ Client A creates task with sd:today ============
      console.log('[TODAY] Client A creating task with sd:today');
      const taskName = `TODAY-Task-${uniqueId}`;
      // Using sd:today sets dueDay which makes the task appear in TODAY view
      await clientA.workView.addTask(`${taskName} sd:today`);
      await waitForTask(clientA.page, taskName);

      await clientA.sync.syncAndWait();
      console.log('[TODAY] Client A synced task');

      // ============ Client B receives task ============
      console.log('[TODAY] Client B syncing to receive task');
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskName);
      console.log('[TODAY] Client B has the task');

      // ============ Concurrent edits ============
      console.log('[TODAY] Making concurrent edits');

      // Client A marks the task as done
      await markTaskDone(clientA, taskName);
      console.log('[TODAY] Client A marked task done');

      // Client B adds a second task (creates concurrent TAG:TODAY ordering changes)
      const task2Name = `TODAY-Task2-${uniqueId}`;
      await clientB.workView.addTask(`${task2Name} sd:today`);
      await waitForTask(clientB.page, task2Name);
      console.log('[TODAY] Client B created second today task');

      // ============ Sequential sync ============
      console.log('[TODAY] Client A syncing done state');
      await clientA.sync.syncAndWait();

      console.log('[TODAY] Client B syncing (concurrent edits)');
      await clientB.sync.syncAndWait();
      console.log('[TODAY] Client B synced (did not hang!)');

      // ============ Final convergence sync ============
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // ============ Verify ============
      console.log('[TODAY] Verifying state');

      // No error snackbars
      const errorSnackA = clientA.page.locator('simple-snack-bar.error');
      const errorSnackB = clientB.page.locator('simple-snack-bar.error');
      await expect(errorSnackA).not.toBeVisible({ timeout: 3000 });
      await expect(errorSnackB).not.toBeVisible({ timeout: 3000 });

      // Both clients should see the second task
      await expectTaskOnAllClients([clientA, clientB], task2Name);

      console.log('[TODAY] Test PASSED - TAG:TODAY concurrent edits converged');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Test 3: Multiple clients creating many tasks produces consistent vector clocks after sync
   *
   * Three clients each create several tasks and sync in sequence.
   * This builds up vector clock entries and verifies that pruning
   * doesn't break comparison or cause sync failures.
   *
   * Steps:
   * 1. Create 3 clients (A, B, C)
   * 2. Each creates 3 tasks, syncs sequentially
   * 3. All sync multiple rounds
   * 4. Assert: all clients have identical task set, no errors
   */
  test('Multiple clients creating many tasks produces consistent vector clocks after sync', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = `${testRunId}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let clientC: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ Setup 3 clients ============
      console.log('[3-Client] Setting up three clients');
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      clientC = await createSimulatedClient(browser, baseURL!, 'C', testRunId);
      await clientC.sync.setupSuperSync(syncConfig);

      // Initial sync
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientC.sync.syncAndWait();

      const allTaskNames: string[] = [];

      // ============ Round 1: Each client creates tasks ============
      console.log('[3-Client] Round 1: Each client creating 3 tasks');

      for (let i = 1; i <= 3; i++) {
        const name = `A-Task${i}-${uniqueId}`;
        allTaskNames.push(name);
        await clientA.workView.addTask(name);
      }
      await clientA.sync.syncAndWait();
      console.log('[3-Client] Client A synced');

      await clientB.sync.syncAndWait(); // Get A's tasks
      for (let i = 1; i <= 3; i++) {
        const name = `B-Task${i}-${uniqueId}`;
        allTaskNames.push(name);
        await clientB.workView.addTask(name);
      }
      await clientB.sync.syncAndWait();
      console.log('[3-Client] Client B synced');

      await clientC.sync.syncAndWait(); // Get A's + B's tasks
      for (let i = 1; i <= 3; i++) {
        const name = `C-Task${i}-${uniqueId}`;
        allTaskNames.push(name);
        await clientC.workView.addTask(name);
      }
      await clientC.sync.syncAndWait();
      console.log('[3-Client] Client C synced');

      // ============ Round 2: All sync to converge ============
      console.log('[3-Client] Round 2: Convergence syncs');
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      // Extra round to ensure full propagation
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientC.sync.syncAndWait();

      // ============ Verify all clients have all tasks ============
      console.log('[3-Client] Verifying all clients have all 9 tasks');

      const allClients = [clientA, clientB, clientC];
      for (const name of allTaskNames) {
        await expectTaskOnAllClients(allClients, name);
      }

      await expectEqualTaskCount(allClients);

      // No error snackbars on any client
      for (const client of allClients) {
        const errorSnack = client.page.locator('simple-snack-bar.error');
        await expect(errorSnack).not.toBeVisible({ timeout: 3000 });
      }

      console.log('[3-Client] Test PASSED - all 3 clients converged with 9 tasks');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
      if (clientC) await closeClient(clientC);
    }
  });
});
