import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  deleteTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { expectTaskVisible } from '../../utils/supersync-assertions';

/**
 * SuperSync Repeatable Task E2E Tests
 *
 * Verifies that repeatable task instances sync correctly between clients,
 * especially after import operations.
 *
 * Note: These tests use "scheduled tasks" (tasks with dueDay) rather than
 * full repeat configs. Testing actual TaskRepeatCfg creation via UI would
 * require navigating the task detail panel and filling the repeat dialog.
 *
 * For repeat config sync logic testing, see the integration tests:
 * src/app/core/persistence/operation-log/integration/repeat-task-sync.integration.spec.ts
 */

// Helper to create a scheduled task using a SimulatedE2EClient
// Note: Setting up actual repeat config requires navigating the detail panel
// which is complex. This simplified version just schedules the task for today.
const createScheduledTask = async (
  client: SimulatedE2EClient,
  taskName: string,
): Promise<void> => {
  const page = client.page;

  // Use the robust workView.addTask helper
  await client.workView.addTask(taskName);

  // Wait for task to appear
  const task = page.locator(`task:not(.ng-animating):has-text("${taskName}")`).first();
  await task.waitFor({ state: 'visible', timeout: 10000 });

  // Open context menu
  await task.click({ button: 'right' });
  await page.waitForTimeout(300);

  // Click the "today" quick access button to schedule for today
  // This ensures the task has schedule data that will sync
  const todayBtn = page.locator('.quick-access button:has(mat-icon:text("wb_sunny"))');
  await todayBtn.waitFor({ state: 'visible', timeout: 5000 });
  await todayBtn.click();

  // Wait for menu to close
  await page.waitForTimeout(500);
};

test.describe('@supersync SuperSync Repeatable Task Sync', () => {
  /**
   * Scenario: Scheduled Task Syncs to Second Client
   *
   * This test verifies that when Client A creates a scheduled task,
   * it syncs correctly to Client B.
   *
   * Actions:
   * 1. Client A creates a task and schedules it for today
   * 2. Client A syncs
   * 3. Client B syncs
   * 4. Verify Client B has the task
   */
  test('Scheduled task syncs to second client', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Setup Client A
      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // Setup Client B
      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // 1. Client A creates a scheduled task
      const taskName = `ScheduledTask-${testRunId}`;
      await createScheduledTask(clientA, taskName);

      // Verify task exists on Client A
      await waitForTask(clientA.page, taskName);

      // 2. Client A syncs
      await clientA.sync.syncAndWait();

      // 3. Client B syncs
      await clientB.sync.syncAndWait();

      // 4. Verify Client B has the task
      // Wait for UI to update
      await clientB.page.waitForTimeout(1000);

      // The task should appear on Client B's today list
      await expectTaskVisible(clientB, taskName, 10000);

      console.log(
        '[ScheduledTaskSync] ✓ Scheduled task synced successfully to second client',
      );
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Scheduled Task After Full Sync Import
   *
   * This test verifies the specific edge case where a scheduled task
   * is created shortly after a full sync import, ensuring the task
   * is not filtered out due to UUIDv7 timing issues.
   *
   * Actions:
   * 1. Client A sets up sync (triggers initial SYNC_IMPORT)
   * 2. Client A immediately creates a scheduled task
   * 3. Client A syncs
   * 4. Client B (fresh) sets up sync
   * 5. Verify Client B receives the task
   */
  test('Scheduled task created after import syncs correctly', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // 1. Client A sets up sync (triggers initial sync)
      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // 2. Immediately create a scheduled task (simulates the edge case)
      const taskName = `ScheduledAfterImport-${testRunId}`;
      await createScheduledTask(clientA, taskName);

      // Verify task on Client A
      await waitForTask(clientA.page, taskName);

      // 3. Client A syncs to upload the task
      await clientA.sync.syncAndWait();

      // 4. Client B (fresh setup) joins
      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Wait for sync to complete
      await clientB.sync.syncAndWait();

      // 5. Verify Client B has the task instance
      await clientB.page.waitForTimeout(1000);

      await expectTaskVisible(clientB, taskName, 15000);

      // Verify it's the same task (not a duplicate created by Client B)
      const taskCount = await clientB.page
        .locator(`task:has-text("${taskName}")`)
        .count();
      expect(taskCount).toBe(1);

      console.log('[ScheduledAfterImport] ✓ Task created after import synced correctly');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Task Deletion Syncs to Other Client
   *
   * This test verifies that when Client A deletes a task,
   * the deletion syncs correctly to Client B.
   *
   * Actions:
   * 1. Client A creates a task and syncs
   * 2. Client B syncs and sees the task
   * 3. Client A deletes the task and syncs
   * 4. Client B syncs
   * 5. Verify Client B no longer has the task
   */
  test('Task deletion syncs to other client', async ({ browser, baseURL, testRunId }) => {
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Setup both clients
      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // 1. Client A creates a task
      const taskName = `TaskToDelete-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await waitForTask(clientA.page, taskName);

      // Client A syncs
      await clientA.sync.syncAndWait();

      // 2. Client B syncs and verifies task exists
      await clientB.sync.syncAndWait();
      await clientB.page.waitForTimeout(1000);
      await expectTaskVisible(clientB, taskName, 10000);

      // 3. Client A deletes the task using reliable keyboard shortcut
      await deleteTask(clientA, taskName);

      // Verify task is gone from Client A
      const taskOnA = clientA.page.locator(`task:has-text("${taskName}")`).first();
      await expect(taskOnA).not.toBeVisible({ timeout: 5000 });

      // Client A syncs the deletion
      await clientA.sync.syncAndWait();

      // 4. Client B syncs
      await clientB.sync.syncAndWait();
      await clientB.page.waitForTimeout(1000);

      // 5. Verify Client B no longer has the task
      const taskCountOnB = await clientB.page
        .locator(`task:has-text("${taskName}")`)
        .count();
      expect(taskCountOnB).toBe(0);

      console.log('[TaskDeletionSync] ✓ Task deletion synced correctly to other client');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
