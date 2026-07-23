import { expect, test } from '../../fixtures/test.fixture';
import { waitForStatePersistence } from '../../utils/waits';
import { readFile } from 'node:fs/promises';

/**
 * Worklog E2E Tests
 *
 * Tests the worklog/history feature:
 * - Navigate to worklog view
 * - View completed tasks
 * - Verify time tracking data
 */

test.describe('Worklog', () => {
  test('should navigate to worklog view', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();

    // Navigate to the legacy worklog route
    await page.goto('/#/tag/TODAY/worklog');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/worklog/);
    await expect(page.locator('history .total-time')).toBeVisible();
  });

  test('should show worklog after completing tasks', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // Create and complete a task with deterministic tracked time
    const taskName = `${testPrefix}-Worklog Task`;
    await workViewPage.addTask(`${taskName} 10m/1h`);

    const task = taskPage.getTaskByText(taskName);
    await expect(task).toBeVisible({ timeout: 10000 });
    await taskPage.markTaskAsDone(task);

    // Finish the day to move tasks to worklog
    const finishDayBtn = page.locator('.e2e-finish-day');
    await finishDayBtn.waitFor({ state: 'visible', timeout: 5000 });
    await finishDayBtn.click();

    // Wait for daily summary
    await page.waitForURL(/daily-summary/);

    // Save and go home
    const saveBtn = page.locator(
      'daily-summary button[mat-flat-button][color="primary"]:last-of-type',
    );
    await saveBtn.waitFor({ state: 'visible' });
    // The finish-day flow archives, flushes, then navigates back to Today
    // asynchronously. Wait for that redirect to settle before navigating away;
    // otherwise the deferred navigation clobbers the History route mid-render.
    await Promise.all([
      page.waitForURL(/#\/tag\/TODAY\/tasks/, { timeout: 15000 }),
      saveBtn.click(),
    ]);
    await expect(page.locator('task-list').first()).toBeVisible();

    // Navigate to full history
    await page.goto('/#/tag/TODAY/history');
    await expect(page).toHaveURL(/#\/tag\/TODAY\/history/);

    // Worklog should show today's completed task
    await expect(page.locator('history')).toBeVisible();
    const dayToggle = page.locator('history .week-row .day-toggle').first();
    await expect(dayToggle).toBeVisible();
    await dayToggle.click();
    await expect(dayToggle).toHaveAttribute('aria-expanded', 'true');

    const worklogRow = page
      .locator('.task-summary-table tr')
      .filter({ hasText: taskName });
    await expect(worklogRow.locator('td.title button')).toBeVisible();
    await expect(worklogRow.locator('td.worked .value-wrapper')).toHaveText('0:10');

    // Correct the archived duration through the real inline editor
    const durationEditor = worklogRow.locator('td.worked inline-input');
    await durationEditor.click();
    const durationInput = durationEditor.locator('input.duration-input');
    await durationInput.fill('20m');
    await durationInput.press('Enter');
    await expect(worklogRow.locator('td.worked .value-wrapper')).toHaveText('0:20');

    // The corrected archive value survives hydration
    await waitForStatePersistence(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('history')).toBeVisible();
    const reloadedDayToggle = page.locator('history .week-row .day-toggle').first();
    await expect(reloadedDayToggle).toBeVisible();
    await reloadedDayToggle.click();
    await expect(reloadedDayToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(
      page
        .locator('.task-summary-table tr')
        .filter({ hasText: taskName })
        .locator('td.worked .value-wrapper'),
    ).toHaveText('0:20');

    // The persisted correction is also the value exported to CSV
    await page
      .locator('history .month-title button[aria-label="Export data"]')
      .first()
      .click();
    const exportDialog = page.locator('dialog-worklog-export');
    const previewRow = exportDialog.locator('table tr').filter({ hasText: taskName });
    await expect(previewRow).toContainText('0:20');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      exportDialog.locator('a').filter({ hasText: 'Save to file' }).click(),
    ]);
    expect(await download.failure()).toBeNull();
    expect(download.suggestedFilename()).toMatch(
      /^tasks\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/,
    );

    const downloadPath = await download.path();
    if (!downloadPath) {
      throw new Error('Worklog CSV download path is unavailable');
    }
    const csv = await readFile(downloadPath, 'utf8');
    const rows = csv.replace(/^\uFEFF/, '').split(/\r?\n/);
    expect(rows[0]).toBe('Date;Start;End;Worked;Titles');
    expect(rows.find((row) => row.endsWith(`;${taskName}`))).toMatch(
      /^\d{4}-\d{2}-\d{2}; - ; - ;0:20;/,
    );
  });

  test('should navigate to worklog from side menu', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();

    // Right-click on Today context to open menu
    const contextBtn = page
      .locator('magic-side-nav .nav-list > li.nav-item:first-child nav-item')
      .first();

    await contextBtn.waitFor({ state: 'visible', timeout: 5000 });
    await contextBtn.click({ button: 'right' });

    const historyBtn = page
      .locator('work-context-menu button, .mat-mdc-menu-content button')
      .filter({ hasText: 'History' })
      .first();
    await expect(historyBtn).toBeVisible();
    await historyBtn.click();

    await page.waitForURL(/history/);
    await expect(page).toHaveURL(/history/);
  });

  test('should display worklog date navigation', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();

    // Navigate to worklog
    await page.goto('/#/tag/TODAY/history');
    await page.waitForLoadState('networkidle');

    // Verify worklog page loads
    await expect(page.locator('.route-wrapper')).toBeVisible();

    // Just verify the page loaded without errors
    await expect(page).toHaveURL(/history/);
  });
});
