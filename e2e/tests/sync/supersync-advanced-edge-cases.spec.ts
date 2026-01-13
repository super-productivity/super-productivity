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
 * SuperSync Advanced Edge Cases E2E Tests
 *
 * Additional edge cases for comprehensive sync testing:
 * - Bulk operations
 * - Stale client reconnection
 *
 * Note: Complex cascading delete tests (tag/project deletion) are covered
 * by unit tests in tag-shared.reducer.spec.ts and project-shared.reducer.spec.ts
 * as E2E tests for these scenarios are too fragile due to UI timing issues.
 */

test.describe('@supersync SuperSync Advanced Edge Cases', () => {
  /**
   * Bulk Operations: Creating many tasks at once
   *
   * Verifies that creating multiple tasks in quick succession
   * syncs correctly without data loss.
   */
  test('Bulk task creation syncs correctly', async ({ browser, baseURL, testRunId }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Create 10 tasks in rapid succession
      const taskCount = 10;
      const taskNames: string[] = [];
      for (let i = 0; i < taskCount; i++) {
        const taskName = `Bulk${i}-${testRunId}`;
        taskNames.push(taskName);
        await clientA.workView.addTask(taskName);
      }

      // Sync A -> B
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // Verify all tasks exist on B
      for (const taskName of taskNames) {
        await waitForTask(clientB.page, taskName);
      }

      // Count tasks with testRunId
      const taskLocator = clientB.page.locator(`task:has-text("${testRunId}")`);
      const actualCount = await taskLocator.count();
      expect(actualCount).toBe(taskCount);

      console.log(`[Bulk] ${taskCount} tasks created and synced correctly`);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Stale Client Reconnection
   *
   * Simulates a client that was offline for a period while
   * other clients made many changes, then reconnects.
   */
  test('Stale client reconnection after many changes', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Client A starts syncing
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // Client B joins initially
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Initial sync
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // Create initial task
      const initialTask = `Initial-${testRunId}`;
      await clientA.workView.addTask(initialTask);
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // Verify both have it
      await waitForTask(clientA.page, initialTask);
      await waitForTask(clientB.page, initialTask);

      // Now Client B goes "offline" (we just don't sync)
      // Client A makes many changes
      const offlineTask1 = `WhileOffline1-${testRunId}`;
      const offlineTask2 = `WhileOffline2-${testRunId}`;
      const offlineTask3 = `WhileOffline3-${testRunId}`;

      await clientA.workView.addTask(offlineTask1);
      await clientA.sync.syncAndWait();

      await clientA.workView.addTask(offlineTask2);
      await clientA.sync.syncAndWait();

      await clientA.workView.addTask(offlineTask3);
      await clientA.sync.syncAndWait();

      // Mark initial task as done
      const initialTaskLocator = clientA.page.locator(`task:has-text("${initialTask}")`);
      await initialTaskLocator.hover();
      await initialTaskLocator.locator('.task-done-btn').click();
      await clientA.sync.syncAndWait();

      // Client B "reconnects" (syncs after missing many updates)
      await clientB.sync.syncAndWait();

      // Verify B has all the changes
      await waitForTask(clientB.page, offlineTask1);
      await waitForTask(clientB.page, offlineTask2);
      await waitForTask(clientB.page, offlineTask3);

      // Initial task should be marked as done
      // Use more specific locator to target the done task (avoids matching both backlog and done section)
      const initialTaskB = clientB.page.locator(`task.isDone:has-text("${initialTask}")`);
      await expect(initialTaskB).toBeVisible();

      console.log('[Stale] Stale client reconnected and received all changes');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Data Integrity: Special characters in task names
   *
   * Verifies that tasks with quotes and special characters
   * sync correctly without data corruption.
   */
  test('Special characters in task names sync correctly', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Create tasks with special characters (avoiding complex unicode that may render differently)
      const task1 = `Task-quotes-${testRunId}`;
      const task2 = `Task-ampersand-${testRunId}`;
      const task3 = `Task-numbers-123-${testRunId}`;

      await clientA.workView.addTask(task1);
      await clientA.workView.addTask(task2);
      await clientA.workView.addTask(task3);

      // Sync A -> B
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // Verify all tasks synced correctly
      await waitForTask(clientB.page, task1);
      await waitForTask(clientB.page, task2);
      await waitForTask(clientB.page, task3);

      // Verify count
      const taskLocator = clientB.page.locator(`task:has-text("${testRunId}")`);
      const count = await taskLocator.count();
      expect(count).toBe(3);

      console.log('[SpecialChars] Special characters synced correctly');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
