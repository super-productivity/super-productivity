import { test, expect } from '../../fixtures/test.fixture';

test.describe('Basic Navigation', () => {
  test('should navigate between main views', async ({ page, workViewPage }) => {
    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    // Verify we're on work view
    await expect(page).toHaveURL(/\/#\/tag\/TODAY/);
    await expect(page.locator('task-list').first()).toBeVisible();

    // Navigate to schedule view
    await page.goto('/#/schedule');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/#\/schedule/);
    await expect(page.locator('.route-wrapper')).toBeVisible();

    // Navigate to quick history
    await page.goto('/#/tag/TODAY/quick-history');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/#\/tag\/TODAY\/quick-history/);
    await expect(page.locator('quick-history')).toBeVisible();

    // Navigate to worklog
    await page.goto('/#/tag/TODAY/worklog');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/#\/tag\/TODAY\/worklog/);
    await expect(page.locator('.route-wrapper')).toBeVisible();

    // Navigate to metrics
    await page.goto('/#/tag/TODAY/metrics');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/#\/tag\/TODAY\/metrics/);
    await expect(page.locator('.route-wrapper')).toBeVisible();

    // Navigate to planner
    await page.goto('/#/planner');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/#\/planner/);
    await expect(page.locator('.route-wrapper')).toBeVisible();

    // Navigate to daily summary
    await page.goto('/#/tag/TODAY/daily-summary');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/#\/tag\/TODAY\/daily-summary/);
    await expect(page.locator('daily-summary')).toBeVisible();

    // Navigate to settings
    await page.goto('/#/config');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/#\/config/);
    await expect(page.locator('.page-settings')).toBeVisible();

    // Navigate back to work view
    await page.goto('/#/tag/TODAY');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/#\/tag\/TODAY/);
    await expect(page.locator('task-list').first()).toBeVisible();
  });

  test('should navigate using side nav buttons', async ({ page, workViewPage }) => {
    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    // Based on screenshot, look for Settings text in the nav - simpler approach
    await page.click('text=Settings');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/#\/config/);
    await expect(page.locator('.page-settings')).toBeVisible();

    // Navigate back to work view by clicking the Today tag
    await page.click('text=Today');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/#\/tag\/TODAY/);
    await expect(page.locator('task-list').first()).toBeVisible();
  });
});
