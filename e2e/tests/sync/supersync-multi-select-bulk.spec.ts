import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  getDoneTaskElement,
  getTaskElement,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { waitForMenuSettled } from '../../utils/waits';

/**
 * SuperSync Multi-Select Bulk Actions E2E Tests
 *
 * A bulk action is a loop of ordinary per-task actions (one op each), so it
 * must replicate to another client exactly like the single-task actions do.
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-multi-select-bulk.spec.ts
 */

const BAR = 'task-multi-select-bar .bar';

const selectTasks = async (
  client: SimulatedE2EClient,
  taskNames: string[],
): Promise<void> => {
  for (const name of taskNames) {
    await getTaskElement(client, name).click({ modifiers: ['Control'] });
  }
  await expect(client.page.locator(BAR)).toContainText(`${taskNames.length} selected`);
};

test.describe('@supersync SuperSync Multi-Select Bulk Actions', () => {
  /**
   * Scenario: bulk done and bulk delete replicate to a second client
   *
   * Flow:
   * 1. Client A creates three tasks and syncs; Client B syncs and sees them
   * 2. Client A selects two tasks and marks them done with the bulk shortcut
   * 3. Client A syncs; Client B syncs and shows exactly those two as done
   * 4. Client A selects one done and one undone task and bulk-deletes them
   * 5. Client A syncs; Client B syncs: both are gone, the third stays done
   */
  test('Bulk done and bulk delete propagate to another client', async ({
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

      // ============ PHASE 1: Client A creates tasks, both clients sync ============
      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const task1 = `Bulk1-${testRunId}`;
      const task2 = `Bulk2-${testRunId}`;
      const task3 = `Bulk3-${testRunId}`;
      for (const name of [task1, task2, task3]) {
        await clientA.workView.addTask(name);
        await waitForTask(clientA.page, name);
      }
      await clientA.sync.syncAndWait();
      console.log('[MultiSelectBulk] Client A created 3 tasks and synced');

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      for (const name of [task1, task2, task3]) {
        await waitForTask(clientB.page, name);
      }
      console.log('[MultiSelectBulk] Client B has all 3 tasks');

      // ============ PHASE 2: Client A bulk-completes two tasks ============
      await selectTasks(clientA, [task1, task2]);
      await clientA.page.keyboard.press('d');
      await expect(getDoneTaskElement(clientA, task1)).toBeVisible({ timeout: 10000 });
      await expect(getDoneTaskElement(clientA, task2)).toBeVisible({ timeout: 10000 });
      await clientA.page.keyboard.press('Escape');
      await clientA.sync.syncAndWait();
      console.log('[MultiSelectBulk] Client A bulk-completed 2 tasks and synced');

      // ============ PHASE 3: Client B receives the two completions ============
      await clientB.sync.syncAndWait();
      await expect(getDoneTaskElement(clientB, task1)).toBeVisible({ timeout: 10000 });
      await expect(getDoneTaskElement(clientB, task2)).toBeVisible({ timeout: 10000 });
      await expect(getDoneTaskElement(clientB, task3)).toHaveCount(0);
      await expect(getTaskElement(clientB, task3)).toBeVisible();
      console.log(
        '[MultiSelectBulk] Client B shows exactly the two bulk-completed tasks as done',
      );

      // ============ PHASE 4: Client A bulk-deletes a done and an undone task ============
      await selectTasks(clientA, [task1, task3]);
      await clientA.page.locator(BAR).getByRole('button', { name: 'Actions' }).click();
      await waitForMenuSettled(clientA.page);
      await clientA.page
        .locator('.mat-mdc-menu-content button', { hasText: 'Delete task' })
        .click();
      const confirmBtn = clientA.page.locator('dialog-confirm button[e2e="confirmBtn"]');
      await confirmBtn.waitFor({ state: 'visible', timeout: 5000 });
      await confirmBtn.click();
      await expect(getTaskElement(clientA, task1)).toHaveCount(0);
      await expect(getTaskElement(clientA, task3)).toHaveCount(0);
      await clientA.sync.syncAndWait();
      console.log('[MultiSelectBulk] Client A bulk-deleted 2 tasks and synced');

      // ============ PHASE 5: Client B receives the deletions ============
      await clientB.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await expect(getTaskElement(clientB, task1)).toHaveCount(0, { timeout: 10000 });
      await expect(getTaskElement(clientB, task3)).toHaveCount(0, { timeout: 10000 });
      await expect(getDoneTaskElement(clientB, task2)).toBeVisible();
      console.log('[MultiSelectBulk] Client B converged: 2 deleted, 1 still done');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
