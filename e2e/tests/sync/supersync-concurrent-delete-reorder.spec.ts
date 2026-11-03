import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  deleteTask,
  getTaskTitles,
  getTaskElement,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import {
  createdTitle,
  moveTaskWithKeyboard,
  taskTitleLocator,
} from '../../utils/audit-concurrency-helpers';

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
   * 3. Client A deletes Task2 (offline): A shows [T4, T3, T1]
   * 4. Client B moves Task1 (bottom) up (offline): B shows [T4, T3, T1, T2]
   * 5. Client A syncs (uploads delete)
   * 6. Client B syncs (downloads delete, uploads reorder)
   * 7. Client A syncs (downloads reorder)
   * 8. Verify: both clients show exactly the same three tasks in the same order
   */
  // test.fixme: the orders diverge permanently on the unchanged app
  // (E2E run 41735806038, 2026-11-03). Expected: both clients show the same
  // order. Observed: A [T4, T1, T3] vs B [T4, T3, T1]; with two deletes
  // A [T1, T6, T5, T3] vs B [T6, T5, T1, T3]. B's relative move
  // (moveTaskUpInTodayList, tag.reducer.ts) replays on A against a list
  // without the deleted neighbour, and no side's TAG:TODAY order wins.
  // Issue candidate for the coordinator; un-fixme once fixed.
  test.fixme('Delete on one client + reorder on another converges correctly', async ({
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

      const full = (name: string): string => createdTitle('A', testRunId, name);
      await expect(taskTitleLocator(clientA)).toHaveText([task4, task3, task1].map(full));

      // New tasks go on top, so B shows [T4, T3, T2, T1]. Moving the bottom
      // task up is a real reorder next to the task A deleted (concurrent, no sync).
      await expect(taskTitleLocator(clientB)).toHaveText(
        [task4, task3, task2, task1].map(full),
      );
      await moveTaskWithKeyboard(getTaskElement(clientB, task1), 'up', 1);
      await expect(taskTitleLocator(clientB)).toHaveText(
        [task4, task3, task1, task2].map(full),
      );
      console.log('[ConcurrentDeleteReorder] Client B moved Task1 up');

      // ============ PHASE 4: Sync Convergence ============
      await clientA.sync.syncAndWait();
      console.log('[ConcurrentDeleteReorder] Client A synced delete');

      await clientB.sync.syncAndWait();
      console.log(
        '[ConcurrentDeleteReorder] Client B synced (download delete + upload reorder)',
      );

      await clientA.sync.syncAndWait();
      console.log('[ConcurrentDeleteReorder] Client A synced (download reorder)');

      await clientB.sync.syncAndWait();

      // ============ PHASE 5: Verify Convergence ============
      await expect(taskTitleLocator(clientA)).toHaveCount(3);
      await expect(taskTitleLocator(clientB)).toHaveCount(3);
      const titlesA = await getTaskTitles(clientA);
      const titlesB = await getTaskTitles(clientB);

      console.log('[ConcurrentDeleteReorder] Client A tasks:', titlesA);
      console.log('[ConcurrentDeleteReorder] Client B tasks:', titlesB);

      // Exact membership: T2 deleted, nothing duplicated or lost.
      expect([...titlesA].sort()).toEqual([task1, task3, task4].map(full).sort());
      expect([...titlesB].sort()).toEqual([task1, task3, task4].map(full).sort());
      // Both clients must converge to the same order.
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
   * 4. Client B moves Task1 (bottom) up three times: [T6, T5, T1, T4, T3, T2]
   * 5. Sync convergence
   * 6. Verify: both clients show exactly the same four tasks in the same order
   */
  // test.fixme: same divergence as above (E2E run 41735806038).
  test.fixme('Multiple deletes + reorder converges correctly', async ({
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

      const [t1, t2, t3, t4, t5, t6] = tasks.map((name) =>
        createdTitle('A', testRunId, name),
      );
      await expect(taskTitleLocator(clientA)).toHaveText([t6, t5, t3, t1]);

      // New tasks go on top, so B shows [T6..T1]; move the bottom task up 3x.
      await expect(taskTitleLocator(clientB)).toHaveText([t6, t5, t4, t3, t2, t1]);
      await moveTaskWithKeyboard(getTaskElement(clientB, t1), 'up', 3);
      await expect(taskTitleLocator(clientB)).toHaveText([t6, t5, t1, t4, t3, t2]);
      console.log('[MultiDeleteReorder] Client B moved T1 up');

      // ============ PHASE 4: Sync Convergence ============
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();

      await clientB.sync.syncAndWait();

      // ============ PHASE 5: Verify ============
      await expect(taskTitleLocator(clientA)).toHaveCount(4);
      await expect(taskTitleLocator(clientB)).toHaveCount(4);
      const titlesA = await getTaskTitles(clientA);
      const titlesB = await getTaskTitles(clientB);

      console.log('[MultiDeleteReorder] Client A tasks:', titlesA);
      console.log('[MultiDeleteReorder] Client B tasks:', titlesB);

      // Exact membership: T2 and T4 deleted, nothing duplicated or lost.
      expect([...titlesA].sort()).toEqual([t1, t3, t5, t6].sort());
      expect([...titlesB].sort()).toEqual([t1, t3, t5, t6].sort());
      // Both clients must converge to the same order.
      expect(titlesA).toEqual(titlesB);

      console.log('[MultiDeleteReorder] Both clients converged correctly');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
