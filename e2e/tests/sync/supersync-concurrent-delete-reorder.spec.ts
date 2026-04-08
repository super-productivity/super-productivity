import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  deleteTask,
  getTaskTitles,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * SuperSync Concurrent Delete + Reorder E2E Tests
 *
 * Validates that concurrent task deletion on one client and task reordering
 * on another client results in consistent, correct ordering after sync.
 *
 * These tests cover:
 * - Deferred action handling (actions buffered during sync are properly persisted)
 * - Task ordering preservation when concurrent modifications overlap
 * - No silent data loss (tasks not duplicated or dropped)
 */

test.describe('@supersync Concurrent Delete and Reorder', () => {
  /**
   * Scenario: Client A deletes a task while Client B reorders tasks concurrently
   *
   * Actions:
   * 1. Client A creates 4 tasks, syncs to server
   * 2. Client B syncs (downloads all tasks)
   * 3. Client A deletes Task2 (offline)
   * 4. Client B moves Task4 up (offline, keyboard shortcut)
   * 5. Client A syncs (uploads delete)
   * 6. Client B syncs (downloads delete, uploads reorder)
   * 7. Client A syncs (downloads reorder)
   * 8. Verify: both clients have 3 tasks in consistent order, no duplicates
   */
  test('Delete on one client + reorder on another converges correctly', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Client A Creates Tasks ============
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const task1 = `T1-${uniqueId}`;
      const task2 = `T2-${uniqueId}`;
      const task3 = `T3-${uniqueId}`;
      const task4 = `T4-${uniqueId}`;

      await clientA.workView.addTask(task1);
      await clientA.workView.addTask(task2);
      await clientA.workView.addTask(task3);
      await clientA.workView.addTask(task4);

      await clientA.sync.syncAndWait();
      console.log('[ConcurrentDeleteReorder] Client A created 4 tasks and synced');

      // ============ PHASE 2: Client B Downloads ============
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();

      await waitForTask(clientB.page, task1);
      await waitForTask(clientB.page, task4);
      console.log('[ConcurrentDeleteReorder] Client B synced, has all 4 tasks');

      // ============ PHASE 3: Concurrent Modifications (Offline) ============
      // Client A deletes Task2
      await deleteTask(clientA, task2);
      console.log('[ConcurrentDeleteReorder] Client A deleted Task2');

      // Client B moves Task4 up (concurrent, no sync)
      const task4B = clientB.page.locator(`task:has-text("${task4}")`);
      await task4B.click();
      await clientB.page.keyboard.press('Control+Shift+ArrowUp');
      await clientB.page.waitForTimeout(300);
      console.log('[ConcurrentDeleteReorder] Client B moved Task4 up');

      // ============ PHASE 4: Sync Convergence ============
      await clientA.sync.syncAndWait();
      console.log('[ConcurrentDeleteReorder] Client A synced delete');

      await clientB.sync.syncAndWait();
      console.log(
        '[ConcurrentDeleteReorder] Client B synced (download delete + upload reorder)',
      );

      await clientA.sync.syncAndWait();
      console.log('[ConcurrentDeleteReorder] Client A synced (download reorder)');

      // Allow UI to settle
      await clientA.page.waitForTimeout(500);
      await clientB.page.waitForTimeout(500);

      // ============ PHASE 5: Verify Convergence ============
      const titlesA = await getTaskTitles(clientA);
      const titlesB = await getTaskTitles(clientB);

      console.log('[ConcurrentDeleteReorder] Client A tasks:', titlesA);
      console.log('[ConcurrentDeleteReorder] Client B tasks:', titlesB);

      // Both clients should have exactly 3 tasks (Task2 was deleted)
      expect(titlesA.length).toBe(3);
      expect(titlesB.length).toBe(3);

      // Both clients should have the same tasks
      expect(titlesA.some((t) => t.includes('T1'))).toBe(true);
      expect(titlesA.some((t) => t.includes('T3'))).toBe(true);
      expect(titlesA.some((t) => t.includes('T4'))).toBe(true);
      expect(titlesA.some((t) => t.includes('T2'))).toBe(false);

      // Both clients should converge to the same order
      expect(titlesA).toEqual(titlesB);

      console.log('[ConcurrentDeleteReorder] Both clients converged correctly');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Multiple deletes on one client, reorders on the other
   *
   * Stress-tests the deferred action pipeline with more operations.
   *
   * Actions:
   * 1. Client A creates 6 tasks, syncs
   * 2. Client B syncs
   * 3. Client A deletes Task2 and Task4 (offline)
   * 4. Client B moves Task6 to top (multiple Ctrl+Shift+Up presses)
   * 5. Sync convergence
   * 6. Verify: both clients have 4 tasks, consistent order
   */
  test('Multiple deletes + reorder converges correctly', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Client A Creates Tasks ============
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const tasks = Array.from({ length: 6 }, (_, i) => `T${i + 1}-${uniqueId}`);
      for (const task of tasks) {
        await clientA.workView.addTask(task);
      }

      await clientA.sync.syncAndWait();
      console.log('[MultiDeleteReorder] Client A created 6 tasks and synced');

      // ============ PHASE 2: Client B Downloads ============
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();

      await waitForTask(clientB.page, tasks[0]);
      await waitForTask(clientB.page, tasks[5]);
      console.log('[MultiDeleteReorder] Client B synced, has all 6 tasks');

      // ============ PHASE 3: Concurrent Modifications ============
      // Client A deletes Task2 and Task4
      await deleteTask(clientA, tasks[1]); // T2
      await deleteTask(clientA, tasks[3]); // T4
      console.log('[MultiDeleteReorder] Client A deleted T2 and T4');

      // Client B moves Task6 towards top (3 presses)
      const task6B = clientB.page.locator(`task:has-text("${tasks[5]}")`);
      await task6B.click();
      for (let i = 0; i < 3; i++) {
        await clientB.page.keyboard.press('Control+Shift+ArrowUp');
        await clientB.page.waitForTimeout(200);
      }
      console.log('[MultiDeleteReorder] Client B moved T6 up');

      // ============ PHASE 4: Sync Convergence ============
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();

      await clientA.page.waitForTimeout(500);
      await clientB.page.waitForTimeout(500);

      // ============ PHASE 5: Verify ============
      const titlesA = await getTaskTitles(clientA);
      const titlesB = await getTaskTitles(clientB);

      console.log('[MultiDeleteReorder] Client A tasks:', titlesA);
      console.log('[MultiDeleteReorder] Client B tasks:', titlesB);

      // Both should have 4 tasks (T2 and T4 deleted)
      expect(titlesA.length).toBe(4);
      expect(titlesB.length).toBe(4);

      // Deleted tasks should be gone
      expect(titlesA.some((t) => t.includes('T2'))).toBe(false);
      expect(titlesA.some((t) => t.includes('T4'))).toBe(false);

      // Remaining tasks should be present
      expect(titlesA.some((t) => t.includes('T1'))).toBe(true);
      expect(titlesA.some((t) => t.includes('T3'))).toBe(true);
      expect(titlesA.some((t) => t.includes('T5'))).toBe(true);
      expect(titlesA.some((t) => t.includes('T6'))).toBe(true);

      // Both clients should converge to the same order
      expect(titlesA).toEqual(titlesB);

      console.log('[MultiDeleteReorder] Both clients converged correctly');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
