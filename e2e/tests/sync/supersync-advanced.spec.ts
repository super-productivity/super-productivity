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
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { expectTaskNotVisible } from '../../utils/supersync-assertions';
import { waitForMenuSettled } from '../../utils/waits';

/**
 * SuperSync Advanced E2E Tests
 *
 * Covers more complex scenarios like large datasets, advanced conflicts,
 * and error conditions.
 */

test.describe('@supersync SuperSync Advanced', () => {
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

      // The panel scales into place over 120ms; clicking before it settles parks
      // the cursor on the item that slides into that spot, whose submenu then
      // replaces the one we opened. Wait it out before every click in the menu.
      await waitForMenuSettled(clientB.page);

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
      await waitForMenuSettled(clientB.page);
      await tagItem.click();

      // Close menu by pressing Escape multiple times (submenu + main menu)
      // First escape closes the submenu, second closes the main context menu
      await clientB.page.keyboard.press('Escape');
      await clientB.page.waitForTimeout(200);
      await clientB.page.keyboard.press('Escape');
      await clientB.page.waitForTimeout(200);
      // If menus are still open, click on the page body to dismiss
      const menuCount = await clientB.page.locator('.mat-mdc-menu-panel').count();
      if (menuCount > 0) {
        // Click on the task list area to dismiss any remaining menus
        await clientB.page.locator('.work-view').click({ position: { x: 10, y: 10 } });
      }
      // Ensure all overlays are closed (backdrops, etc.)
      await clientB.sync.ensureOverlaysClosed();

      // Verify tag is gone on B
      await expect(
        clientB.page.locator(`task tag:has-text("${tagName}")`),
      ).not.toBeVisible();

      // Wait for the operation to be written to IndexedDB before syncing
      await clientB.page.waitForTimeout(1000);

      // Sync B (Upload removal)
      await clientB.sync.syncAndWait();
      console.log('[TagTest] Client B synced (uploaded tag removal)');

      // Sync A (Download removal) — use multiple rounds for convergence
      await clientA.sync.syncAndWait();
      console.log('[TagTest] Client A synced round 1');
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();
      console.log('[TagTest] Extra convergence sync rounds complete');

      // Debug: Check what tags are visible on Client A's task
      const tagCount = await clientA.page.locator('task tag').count();
      const tagTexts = await clientA.page.locator('task tag').allTextContents();
      console.log(
        `[TagTest] Client A has ${tagCount} tag(s) on task: [${tagTexts.join(', ')}]`,
      );

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
   * The LWW system is purely timestamp-based — the newer operation wins regardless
   * of type. Since Client B's update (mark done) happens after Client A's delete,
   * the update wins and the task is preserved.
   *
   * Actions:
   * 1. Client A creates Task, syncs
   * 2. Client B syncs (download task)
   * 3. Concurrent changes (no syncs):
   *    - Client A: Deletes the task
   *    - Client B: Marks the task as done (update, later timestamp)
   * 4. Client A syncs (delete goes to server)
   * 5. Client B syncs (update conflicts with deletion)
   * 6. Verify final state is consistent (update wins, task visible and done)
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

      // B syncs (downloads DELETE, has local UPDATE) -> conflict resolved by LWW
      await clientB.sync.syncAndWait();

      // Final sync roundtrips to ensure convergence
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();

      // LWW: Update wins (later timestamp) — task should be visible and done on both
      const taskOnA = clientA.page.locator(`task:has-text("${taskName}")`);
      const taskOnB = clientB.page.locator(`task:has-text("${taskName}")`);
      await expect(taskOnA).toBeVisible({ timeout: 5000 });
      await expect(taskOnA).toHaveClass(/isDone/, { timeout: 5000 });
      await expect(taskOnB).toBeVisible({ timeout: 5000 });
      await expect(taskOnB).toHaveClass(/isDone/, { timeout: 5000 });

      console.log(
        '[ConflictTest] ✓ Concurrent Delete/Update resolved: update wins (later timestamp)',
      );
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
