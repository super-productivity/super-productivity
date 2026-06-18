import { expect, test } from '../../fixtures/test.fixture';

const SUMMARY_TABLE_TASK_EL = '.task-title .value-wrapper';

test.describe('Daily Summary', () => {
  test('Daily summary message', async ({ page }) => {
    // Navigate directly to daily summary page
    await page.goto('/#/tag/TODAY/daily-summary');

    // Wait for done headline to be visible
    await page.waitForSelector('.done-headline', { state: 'visible' });

    // Assert the text content
    const doneHeadline = page.locator('.done-headline');
    await expect(doneHeadline).toContainText('Take a moment to celebrate');
  });

  // Regression guard for #8449: the before-close "Finish Day" dialog navigates
  // via the context-resolved `/active/daily-summary` route. A bare
  // `/daily-summary` has no matching route and silently redirects to the start
  // page, so the summary never opens. Assert the `/active/...` route actually
  // resolves to the daily summary instead of falling through to the wildcard.
  test('the /active/daily-summary route resolves to the daily summary', async ({
    page,
  }) => {
    await page.goto('/#/active/daily-summary');

    // ActiveWorkContextGuard rewrites it to the active context (TODAY tag).
    await page.waitForURL(/daily-summary/);
    await expect(page.locator('daily-summary')).toBeVisible();
    await page.waitForSelector('.done-headline', { state: 'visible' });
  });

  test('show any added task in table', async ({ page, workViewPage }) => {
    // First navigate to work view to add task
    await page.goto('/');
    await workViewPage.waitForTaskList();

    // Add task
    const taskName = 'test task hohoho 1h/1h';
    await workViewPage.addTask(taskName);

    // Wait for task to appear
    await expect(page.locator('task')).toHaveCount(1, { timeout: 5000 });

    // Navigate to daily summary
    await page.goto('/#/tag/TODAY/daily-summary');

    // Wait for task element in summary table
    await page.waitForSelector(SUMMARY_TABLE_TASK_EL, {
      state: 'visible',
      timeout: 10000, // Reduced from 15s to 10s
    });

    // Assert task appears in summary (look for partial match of the task name)
    const taskElement = page.locator(SUMMARY_TABLE_TASK_EL);
    // Just check for a key part of the task name that would be present regardless of prefix
    await expect(taskElement).toContainText('hohoho', { timeout: 3000 }); // Reduced from 5s to 3s
  });
});
