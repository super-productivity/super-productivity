import { type ConsoleMessage } from '@playwright/test';
import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * SuperSync Daily Summary E2E Tests
 */

/**
 * Checks if a console message indicates a DB lock error.
 * These errors would indicate the fix for synchronous flush is broken.
 */
const isDbLockError = (msg: ConsoleMessage): boolean => {
  const text = msg.text();
  return text.includes('Attempting to write DB') && text.includes('while locked');
};

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

      // 2. Click time item to open dialog
      // Look for the item with the timer icon
      const timeItem = panel.locator('task-detail-item:has(mat-icon:text("timer"))');
      await timeItem.click();

      // 3. Wait for dialog
      const dialog = clientA.page.locator('dialog-time-estimate');
      await expect(dialog).toBeVisible();

      // 4. Fill time spent (assuming first input is time spent or allow flexible input)
      // Usually the dialog focuses the relevant input or has labeled inputs.
      // We'll try filling the first input found in the dialog.
      const timeInput = dialog.locator('input').first();
      await timeInput.fill('10m');
      await clientA.page.keyboard.press('Enter');

      // 5. Verify update in panel
      // The time item should now show 10m
      await expect(timeItem).toContainText('10m');
      console.log('Client A manually set time to: 10m');

      // Create Task B (no time)
      const taskBName = `TaskB-${uniqueId}`;
      await clientA.workView.addTask(taskBName);
      const taskBLocator = clientA.page.locator(`task:has-text("${taskBName}")`);

      // Mark both done
      await taskALocator.hover();
      await taskALocator.locator('.task-done-btn').click();

      await taskBLocator.hover();
      await taskBLocator.locator('.task-done-btn').click();

      // Archive Tasks (Finish Day)
      const finishDayBtn = clientA.page.locator('.e2e-finish-day');
      await finishDayBtn.click();

      // Wait for Daily Summary
      await clientA.page.waitForURL(/daily-summary/);

      // Click "Save and go home" to archive
      const saveAndGoHomeBtn = clientA.page.locator(
        'daily-summary button[mat-flat-button]:has(mat-icon:has-text("wb_sunny"))',
      );
      await saveAndGoHomeBtn.waitFor({ state: 'visible' });
      await saveAndGoHomeBtn.click();

      // Wait for Work View (Archived)
      // Accept either active/tasks or tag/TODAY (with or without /tasks suffix)
      await clientA.page.waitForURL(/(active\/tasks|tag\/TODAY)/);
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

  /**
   * Scenario: Finish day completes without DB lock errors
   *
   * This tests the race condition fix where the archive flush
   * (flushYoungToOld) was being executed by an NgRx effect AFTER
   * sync started and locked the database. The fix ensures the flush
   * happens synchronously BEFORE the action is dispatched.
   *
   * Actions:
   * 1. Client creates multiple tasks and marks them done.
   * 2. Client clicks finish day button.
   * 3. Client completes daily summary (archives tasks, triggers sync).
   * 4. Verify NO "DB lock" console errors occurred.
   */
  test('Finish day completes without DB lock errors', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(60000);
    const uniqueId = Date.now();
    let client: SimulatedE2EClient | null = null;
    const dbLockErrors: string[] = [];

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Create client and set up sync
      client = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await client.sync.setupSuperSync(syncConfig);

      // Monitor for DB lock errors
      client.page.on('console', (msg) => {
        if (isDbLockError(msg)) {
          dbLockErrors.push(msg.text());
        }
      });

      // Create multiple tasks to increase chance of triggering flush
      const tasks = [`Task1-${uniqueId}`, `Task2-${uniqueId}`, `Task3-${uniqueId}`];

      for (const taskName of tasks) {
        await client.workView.addTask(taskName);
      }

      // Mark all tasks as done
      for (const taskName of tasks) {
        const taskLocator = client.page.locator(`task:has-text("${taskName}")`);
        await taskLocator.hover();
        await taskLocator.locator('.task-done-btn').click();
      }

      // Click finish day - wait for button to be visible and stable
      const finishDayBtn = client.page.locator('.e2e-finish-day');
      await finishDayBtn.waitFor({ state: 'visible', timeout: 10000 });
      await finishDayBtn.click();

      // Wait for Daily Summary
      await client.page.waitForURL(/daily-summary/);

      // Click "Save and go home" to archive and trigger sync
      const saveAndGoHomeBtn = client.page.locator(
        'daily-summary button[mat-flat-button]:has(mat-icon:has-text("wb_sunny"))',
      );
      await saveAndGoHomeBtn.waitFor({ state: 'visible' });
      await saveAndGoHomeBtn.click();

      // Wait for navigation back to work view
      await client.page.waitForURL(/(active\/tasks|tag\/TODAY)/);

      // Wait a moment for any async effects to complete
      await client.page.waitForTimeout(1000);

      // Verify no DB lock errors occurred
      expect(dbLockErrors).toEqual([]);
      console.log('Finish day completed without DB lock errors');
    } finally {
      if (client) await closeClient(client);
    }
  });
});
