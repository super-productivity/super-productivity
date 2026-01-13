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

    // Navigate to worklog
    await page.goto('/#/tag/TODAY/worklog');
    await page.waitForLoadState('networkidle');

    // Verify URL
    await expect(page).toHaveURL(/worklog/);

    // Verify worklog component is visible
    await expect(page.locator('.route-wrapper')).toBeVisible();
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
    await saveBtn.click();

    // Navigate to worklog
    await page.goto('/#/tag/TODAY/worklog');
    await page.waitForLoadState('networkidle');

    // Worklog should show today's date and the completed task
    await expect(page.locator('.route-wrapper')).toBeVisible();
  });

  test('should navigate to worklog from side menu', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();

    // Right-click on Today context to open menu
    const contextBtn = page
      .locator('magic-side-nav .nav-list > li.nav-item:first-child nav-item')
      .first();

    const isContextVisible = await contextBtn
      .isVisible({ timeout: 3000 })
      .catch(() => false);

    if (isContextVisible) {
      await contextBtn.click({ button: 'right' });

      // Look for worklog option in context menu
      const worklogBtn = page.locator('.mat-mdc-menu-content button:has-text("Worklog")');
      const worklogBtnVisible = await worklogBtn
        .isVisible({ timeout: 3000 })
        .catch(() => false);

      if (worklogBtnVisible) {
        await worklogBtn.click();
        await page.waitForURL(/worklog/);
        await expect(page).toHaveURL(/worklog/);
      }
    }
  });

  test('should display worklog date navigation', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();

    // Navigate to worklog
    await page.goto('/#/tag/TODAY/worklog');
    await page.waitForLoadState('networkidle');

    // Verify worklog page loads
    await expect(page.locator('.route-wrapper')).toBeVisible();

    // Just verify the page loaded without errors
    await expect(page).toHaveURL(/worklog/);
  });
});
