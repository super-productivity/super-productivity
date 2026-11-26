import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  archiveDoneTasks,
  markTaskDone,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * SuperSync Daily Summary E2E Tests
 */

test.describe('@supersync Daily Summary Sync', () => {
  /**
   * Scenario: Archived tasks and time tracking appear on Daily Summary
   *
   * Actions:
   * 1. Client A creates "Task A" and tracks time (e.g. 5s).
   * 2. Client A creates "Task B" (no time).
   * 3. Client A marks both as done.
   * 4. Client A finishes day (archives tasks).
   * 5. Client A syncs.
   * 6. Client B syncs.
   * 7. Client B navigates to Daily Summary.
   * 8. Verify Client B sees both tasks and correct time.
   */
  test('Archived tasks and time tracking appear on Daily Summary', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(120000);
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Client A Setup & Work ============
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // Create Task A and track time
      const taskAName = `TaskA-${uniqueId}`;
      await clientA.workView.addTask(taskAName);
      const taskALocator = clientA.page.locator(`task:has-text("${taskAName}")`);

      // Manually set time via Detail Panel -> Time Estimate Dialog
      // 1. Open detail panel
      await taskALocator.hover();
      const detailBtn = taskALocator.locator('.show-additional-info-btn');
      await detailBtn.click();

      const panel = clientA.page.locator('task-detail-panel');
      await expect(panel).toBeVisible();

      // 2. Open the time-estimate dialog, set "Time Spent", and submit.
      // Retry the whole open→fill→submit cycle: a fill() on a freshly-opened
      // dialog can fire its `input` event before the duration input's
      // value-accessor (an `input` HostListener) is wired, so the typed value
      // never reaches the model and an empty time is saved (panel stays "-/-").
      // Reopening on retry re-fills once the control is bound.
      const timeItem = panel.locator(
        'task-detail-item:has(mat-icon:text("hourglass_empty"))',
      );
      const pageA = clientA.page;
      const dialog = pageA.locator('dialog-time-estimate');
      await expect(async () => {
        if (!(await dialog.isVisible())) {
          await timeItem.click();
          await expect(dialog).toBeVisible();
        }
        // First input is "Time Spent"; the panel item shows timeSpent / estimate.
        await dialog.locator('input').first().fill('10m');
        await pageA.keyboard.press('Enter');
        await expect(dialog).toBeHidden({ timeout: 2000 });
        await expect(timeItem).toContainText('10m', { timeout: 2000 });
      }).toPass({ timeout: 30000 });
      console.log('Client A manually set time to: 10m');

      // Create Task B (no time)
      const taskBName = `TaskB-${uniqueId}`;
      await clientA.workView.addTask(taskBName);

      // Mark both done. markTaskDone waits for the done state: setDone is
      // dispatched 200 ms after the click and cancelled if the work view is
      // destroyed first, so Finish Day right after the click could archive
      // nothing and the summary checks below would still pass.
      await markTaskDone(clientA, taskAName);
      await markTaskDone(clientA, taskBName);

      // Archive Tasks (Finish Day). The helper retries the click: Finish Day
      // shifts down while the last done task animates into "Completed Tasks",
      // so a single click can land on empty space.
      await archiveDoneTasks(clientA);
      // Archived tasks leave the work view; this fails if a done was lost
      await expect(clientA.page.locator('task', { hasText: taskAName })).toHaveCount(0);
      await expect(clientA.page.locator('task', { hasText: taskBName })).toHaveCount(0);
      console.log('Client A archived tasks.');

      // Sync A (upload archive)
      await clientA.sync.syncAndWait();
      console.log('Client A synced.');

      // ============ PHASE 2: Client B Sync & Verify ============
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Sync B (download archive)
      await clientB.sync.syncAndWait();
      console.log('Client B synced.');

      // Navigate B to Daily Summary
      // We manually go there because there might be no active tasks to trigger "Finish Day" button
      await clientB.page.goto('/#/tag/TODAY/daily-summary');

      // Wait for table
      await clientB.page.waitForSelector('task-summary-tables', { state: 'visible' });
      console.log('Client B on Daily Summary.');

      // Verify Content
      // Check Task A Name
      // Use specific selector for summary table cells
      const rowA = clientB.page.locator('tr', { hasText: taskAName });
      await expect(rowA).toBeVisible({ timeout: 10000 });

      // Check Task A Time
      const rowAText = await rowA.textContent();
      console.log(`Row A Content: ${rowAText}`);
      // Expect "10m" or "00:10" or "0:10"
      expect(rowAText).toMatch(/10m|00:10|0:10/);

      // Check Task B Name
      const rowB = clientB.page.locator('tr', { hasText: taskBName });
      await expect(rowB).toBeVisible({ timeout: 10000 });

      // Check Task B Time (should be 0 or empty)
      // It likely shows "-" or "0s"
      const rowBText = await rowB.textContent();
      console.log(`Row B Content: ${rowBText}`);

      console.log('Daily Summary verification passed!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
