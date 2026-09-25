import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  getTaskTitles,
  waitForTask,
  markTaskDone,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { expectTaskOnAllClients } from '../../utils/supersync-assertions';

/**
 * SuperSync Concurrent Batch and Multi-Client Convergence E2E Tests
 *
 * These tests verify ordinary convergence behavior adjacent to commit cb36c09538:
 * - equivalent concurrent task batches sync without hanging
 * - TAG:TODAY concurrent operations sync without hanging
 * - Multiple clients with many tasks converge on the same task set
 *
 * They do not force the retry-limit or 20-entry vector-clock pruning boundaries.
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-vector-clock-max-size.spec.ts
 */

const ERROR_SNACK_TIMEOUT = { timeout: 3000 };

test.describe.configure({ mode: 'serial' });

test.describe('@supersync Concurrent Batch and Multi-Client Convergence', () => {
  /**
   * Test 1: Equivalent concurrent task batches sync without hanging
   *
   * Creates equivalent concurrent edits across several tasks and proves the
   * ordinary batch path completes and converges. Because both clients write
   * the same value, this does not prove an LWW winner or the retry bound.
   *
   * Steps:
   * 1. Client A creates 5 tasks, syncs
   * 2. Client B syncs, receives tasks
   * 3. Both clients mark all tasks done (concurrent edits)
   * 4. Client A syncs first
   * 5. Client B syncs the equivalent concurrent updates
   * 6. Assert: sync completes (doesn't hang), clients converge, no errors
   */
  test('Equivalent concurrent task batches sync without hanging', async ({
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

      console.log('[Concurrent Batch] Client B syncing equivalent updates');
      await clientB.sync.syncAndWait();
      console.log('[Concurrent Batch] Client B synced (did not hang!)');

      // ============ Verify convergence ============
      console.log('[LWW Retry] Verifying convergence');

      // Final sync to ensure full convergence
      await clientA.sync.syncAndWait();

      // A fresh client proves the done updates reached the server rather than
      // merely remaining identical in A and B's local stores.
      clientC = await createSimulatedClient(browser, baseURL!, 'C', testRunId);
      await clientC.sync.setupSuperSync(syncConfig);
      await clientC.sync.syncAndWait();

      const allClients = [clientA, clientB, clientC];
      const persistedTaskNames = taskNames.map((name) => `A-${testRunId}-${name}`);
      for (const client of allClients) {
        const titles = await getTaskTitles(client);
        expect([...titles].sort()).toEqual([...persistedTaskNames].sort());
        for (const name of taskNames) {
          const task = client.page.locator('task', { hasText: name });
          await expect(task).toHaveCount(1);
          await expect(task).toHaveClass(/isDone/);
        }
      }

      // No error snackbars
      const errorSnackA = clientA.page.locator('simple-snack-bar.error');
      const errorSnackB = clientB.page.locator('simple-snack-bar.error');
      await expect(errorSnackA).not.toBeVisible(ERROR_SNACK_TIMEOUT);
      await expect(errorSnackB).not.toBeVisible(ERROR_SNACK_TIMEOUT);

      console.log('[Concurrent Batch] Test PASSED - sync completed without hanging');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
      if (clientC) await closeClient(clientC);
    }
  });

  /**
   * Test 2: TAG:TODAY concurrent operations sync without hanging
   *
   * This reproduces the exact bug scenario: two clients editing tasks that belong
   * to TAG:TODAY (via dueDay). Concurrent edits on the same entity produce LWW
   * conflicts that previously caused an infinite re-upload loop.
   *
   * Steps:
   * 1. Client A creates a task with `@today` (adds to TODAY ordering), syncs
   * 2. Client B syncs, receives the task
   * 3. Client A marks the task done
   * 4. Client B concurrently creates another task in TODAY ordering
   * 5. Both sync in sequence
   * 6. Assert: sync completes, no hanging, consistent state
   */
  test('TAG:TODAY concurrent operations sync without hanging', async ({
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

      // ============ Client A creates task with @today ============
      console.log('[TODAY] Client A creating task with @today');
      const taskName = `TODAY-Task-${uniqueId}`;
      // Using @today sets dueDay which makes the task appear in TODAY view
      await clientA.workView.addTask(`${taskName} @today`, false, taskName);
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
      await clientB.workView.addTask(`${task2Name} @today`, false, task2Name);
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
      await expect(errorSnackA).not.toBeVisible(ERROR_SNACK_TIMEOUT);
      await expect(errorSnackB).not.toBeVisible(ERROR_SNACK_TIMEOUT);

      // Both directions must survive: A's completion reaches B and B's new
      // TODAY task reaches A. Also reject duplicates or stale extra titles.
      const persistedTaskNames = [
        `A-${testRunId}-${taskName}`,
        `B-${testRunId}-${task2Name}`,
      ];
      for (const client of [clientA, clientB]) {
        const titles = await getTaskTitles(client);
        expect([...titles].sort()).toEqual([...persistedTaskNames].sort());
        const completedTask = client.page.locator('task', { hasText: taskName });
        await expect(completedTask).toHaveCount(1);
        await expect(completedTask).toHaveClass(/isDone/);
      }

      console.log('[TODAY] Test PASSED - TAG:TODAY concurrent edits converged');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Test 3: Multiple clients creating many tasks converge after sync
   *
   * Three clients each create several tasks and sync in sequence. This builds
   * up several vector-clock entries and verifies ordinary multi-client
   * comparison/convergence; it does not reach the 20-entry pruning boundary.
   *
   * Steps:
   * 1. Create 3 clients (A, B, C)
   * 2. Each creates 3 tasks, syncs sequentially
   * 3. All sync multiple rounds
   * 4. Assert: all clients have identical task set, no errors
   */
  test('Multiple clients creating many tasks converge after sync', async ({
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
        allTaskNames.push(`A-${testRunId}-${name}`);
        await clientA.workView.addTask(name);
      }
      await clientA.sync.syncAndWait();
      console.log('[3-Client] Client A synced');

      await clientB.sync.syncAndWait(); // Get A's tasks
      for (let i = 1; i <= 3; i++) {
        const name = `B-Task${i}-${uniqueId}`;
        allTaskNames.push(`B-${testRunId}-${name}`);
        await clientB.workView.addTask(name);
      }
      await clientB.sync.syncAndWait();
      console.log('[3-Client] Client B synced');

      await clientC.sync.syncAndWait(); // Get A's + B's tasks
      for (let i = 1; i <= 3; i++) {
        const name = `C-Task${i}-${uniqueId}`;
        allTaskNames.push(`C-${testRunId}-${name}`);
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

      for (const client of allClients) {
        const titles = await getTaskTitles(client);
        expect([...titles].sort()).toEqual([...allTaskNames].sort());
      }

      // No error snackbars on any client
      for (const client of allClients) {
        const errorSnack = client.page.locator('simple-snack-bar.error');
        await expect(errorSnack).not.toBeVisible(ERROR_SNACK_TIMEOUT);
      }

      console.log('[3-Client] Test PASSED - all 3 clients converged with 9 tasks');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
      if (clientC) await closeClient(clientC);
    }
  });
});
