import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  getTaskElement,
  markTaskDone,
  deleteTask,
  countTasks,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { expectTaskNotVisible } from '../../utils/supersync-assertions';
import { waitForAppReady } from '../../utils/waits';

/**
 * SuperSync Advanced E2E Tests
 *
 * Covers more complex scenarios like large datasets, advanced conflicts,
 * and error conditions.
 */

test.describe('@supersync SuperSync Advanced', () => {
  /**
   * Scenario: Large Dataset Sync
   *
   * Tests performance and reliability when syncing a larger number of items.
   *
   * Actions:
   * 1. Client A creates 50 tasks
   * 2. Client A syncs (upload)
   * 3. Client B syncs (download)
   * 4. Verify all 50 tasks exist on Client B
   */
  test('Large dataset sync (50 tasks)', async ({
    browser,
    baseURL,
    testRunId,
  }, testInfo) => {
    // Increase timeout for this test as creating/syncing 50 tasks takes time
    testInfo.setTimeout(120000);
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    const TASK_COUNT = 50;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Setup Client A
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // Create tasks in batch
      console.log(`[LargeData] Creating ${TASK_COUNT} tasks on Client A...`);

      // We can optimize creation by not waiting for every single task to appear
      // if the UI allows rapid entry, but the helper might need adjustment.
      // For now, let's just loop.
      for (let i = 1; i <= TASK_COUNT; i++) {
        await clientA.workView.addTask(`Task-${testRunId}-${i}`);
        // Small pause every 10 tasks to let UI breathe/save
        if (i % 10 === 0) await clientA.page.waitForTimeout(200);
      }

      console.log(`[LargeData] Creation complete. Verifying local count...`);
      const countA = await countTasks(clientA.page);
      // Expect at least TASK_COUNT (there might be default tasks? usually not in fresh profile)
      expect(countA).toBeGreaterThanOrEqual(TASK_COUNT);

      // Sync A
      console.log(`[LargeData] Syncing Client A...`);
      await clientA.sync.syncAndWait();

      // Setup Client B
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Sync B
      console.log(`[LargeData] Syncing Client B...`);
      await clientB.sync.syncAndWait();

      // Verify B has all tasks
      console.log(`[LargeData] Verifying Client B count...`);

      // Wait for first task to appear (ensures sync operations have rendered)
      await waitForTask(clientB.page, `Task-${testRunId}-1`);

      // If the page needs a refresh to show all synced tasks, reload and wait
      // This handles bulk dispatch UI update timing issues
      await clientB.page.reload();
      await waitForAppReady(clientB.page);
      await waitForTask(clientB.page, `Task-${testRunId}-1`);

      const countB = await countTasks(clientB.page);
      expect(countB).toBe(countA);

      // Spot check first and last
      await waitForTask(clientB.page, `Task-${testRunId}-1`);
      await waitForTask(clientB.page, `Task-${testRunId}-${TASK_COUNT}`);

      console.log(`[LargeData] ✓ Success: Synced ${countB} tasks.`);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Tag Management
   *
   * Verify that adding or removing tags on a task syncs across clients.
   * This tests the relational data sync (Task-Tag relationships).
   *
   * Actions:
   * 1. Client A creates "Task with Tag" and adds "Tag A"
   * 2. Client A syncs (upload)
   * 3. Client B syncs (download)
   * 4. Verify Client B sees "Tag A" on the task
   * 5. Client B removes "Tag A" from the task
   * 6. Client B syncs (upload)
   * 7. Client A syncs (download)
   * 8. Verify Client A sees "Tag A" removed
   */
  test('Tag Management: Add/Remove tags syncs correctly', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    const taskName = `Task-Tag-${testRunId}`;
    const tagName = `TagA-${testRunId}`;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Setup Client A
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // Client A creates task with tag
      // We type "#TagName" to trigger tag creation
      // skipClose=true because we expect a dialog (create tag) which blocks closing
      await clientA.workView.addTask(`${taskName} #${tagName}`, true);

      // Handle tag creation confirmation dialog if it appears
      const confirmBtn = clientA.page.locator('button[e2e="confirmBtn"]');
      if (await confirmBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await confirmBtn.click();
      }

      // Close the add task bar manually if it's still open
      if (await clientA.workView.backdrop.isVisible().catch(() => false)) {
        await clientA.workView.backdrop.click();
      }

      // Wait for task
      await waitForTask(clientA.page, taskName);

      // Verify tag is present on Client A
      await expect(clientA.page.locator(`task tag:has-text("${tagName}")`)).toBeVisible();

      // Sync A
      await clientA.sync.syncAndWait();

      // Setup Client B
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Sync B (Download)
      await clientB.sync.syncAndWait();

      // Verify B has task and tag
      await waitForTask(clientB.page, taskName);
      await expect(clientB.page.locator(`task tag:has-text("${tagName}")`)).toBeVisible();

      // Client B removes tag
      // Right click task -> Toggle Tags -> Click Tag
      const taskB = getTaskElement(clientB, taskName);
      await taskB.click({ button: 'right' });

      // Click "Toggle Tags" in context menu (using text match or class if available)
      // Based on i18n: T.F.TASK.CMP.TOGGLE_TAGS -> 'Toggle Tags' (en)
      const toggleTagsItem = clientB.page
        .locator('.mat-mdc-menu-item')
        .filter({ hasText: 'Toggle Tags' });
      await toggleTagsItem.click();

      // Wait for tag list submenu
      // Exclude nav-link items (which might be "Go to Project" links) to avoid strict mode violation
      const tagItem = clientB.page.locator(
        `.mat-mdc-menu-item:not(.nav-link):has-text("${tagName}")`,
      );
      await tagItem.waitFor({ state: 'visible' });
      await tagItem.click();

      // Close menu (press Escape)
      await clientB.page.keyboard.press('Escape');

      // Verify tag is gone on B
      await expect(
        clientB.page.locator(`task tag:has-text("${tagName}")`),
      ).not.toBeVisible();

      // Sync B (Upload removal)
      await clientB.sync.syncAndWait();

      // Sync A (Download removal)
      await clientA.sync.syncAndWait();

      // Verify tag is gone on A
      await expect(
        clientA.page.locator(`task tag:has-text("${tagName}")`),
      ).not.toBeVisible();

      console.log('[TagTest] ✓ Tag added and removed successfully across clients');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Concurrent Delete vs. Update
   *
   * Simulate a conflict where Client A deletes a task while Client B updates it.
   * This tests the conflict resolution strategy. The operation log sync uses
   * vector clocks to order operations and achieve eventual consistency.
   *
   * Actions:
   * 1. Client A creates Task, syncs
   * 2. Client B syncs (download task)
   * 3. Concurrent changes (no syncs):
   *    - Client A: Deletes the task
   *    - Client B: Marks the task as done (update)
   * 4. Client A syncs (delete goes to server)
   * 5. Client B syncs (update conflicts with deletion)
   * 6. Verify final state is consistent (both clients agree)
   */
  test('Concurrent Delete vs. Update (Conflict Handling)', async ({
    browser,
    baseURL,
    testRunId,
  }, testInfo) => {
    testInfo.setTimeout(90000);
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    const taskName = `Task-Conflict-${testRunId}`;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Setup clients
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Create initial task on A and sync to B
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();

      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskName);

      // Client A deletes the task
      await deleteTask(clientA, taskName);
      await expectTaskNotVisible(clientA, taskName);

      // Client B updates the task (marks as done - reliable operation)
      await markTaskDone(clientB, taskName);

      // A syncs first (uploads DELETE)
      await clientA.sync.syncAndWait();

      // B syncs (downloads DELETE, has local UPDATE) -> potential conflict
      // The conflict resolution may show a dialog or auto-resolve
      await clientB.sync.syncAndWait();

      // Final sync to converge
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // Verify consistent state
      // Both clients should have the same view (either both have task or neither)
      const hasTaskA =
        (await clientA.page.locator(`task:has-text("${taskName}")`).count()) > 0;
      const hasTaskB =
        (await clientB.page.locator(`task:has-text("${taskName}")`).count()) > 0;

      // State should be consistent (doesn't matter which wins, just that they agree)
      expect(hasTaskA).toBe(hasTaskB);

      console.log(
        `[ConflictTest] ✓ Concurrent Delete/Update resolved consistently (task ${hasTaskA ? 'restored' : 'deleted'})`,
      );
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
