import { expect, test } from '../../fixtures/test.fixture';

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

    // Create and complete a task
    const taskName = `${testPrefix}-Worklog Task`;
    await workViewPage.addTask(taskName);

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
    await expect(
      page.locator('.task-summary-table td.title button').filter({ hasText: taskName }),
    ).toBeVisible();
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
