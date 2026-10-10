import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  markTaskDone,
  getDoneTaskElement,
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
      await markTaskDone(clientA, initialTask);
      // Wait for the 200ms done animation delay + NgRx store update + IndexedDB persist
      await clientA.page.waitForTimeout(500);
      await clientA.sync.syncAndWait();

      // Client B "reconnects" (syncs after missing many updates)
      await clientB.sync.syncAndWait();
      // Extra settle time for state propagation after receiving many operations
      await clientB.page.waitForTimeout(500);

      // Verify B has all the changes
      await waitForTask(clientB.page, offlineTask1);
      await waitForTask(clientB.page, offlineTask2);
      await waitForTask(clientB.page, offlineTask3);

      // Initial task should be marked as done (may be in the collapsed "Done tasks" section)
      // Use toPass() to handle Angular change detection lag for CSS class update
      await expect(async () => {
        const initialTaskB = getDoneTaskElement(clientB!, initialTask);
        await expect(initialTaskB).toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 15000, intervals: [500, 1000, 2000, 3000] });

      console.log('[Stale] Stale client reconnected and received all changes');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
