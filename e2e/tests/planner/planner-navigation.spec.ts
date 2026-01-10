import { test, expect } from '../../fixtures/test.fixture';
import { PlannerPage } from '../../pages/planner.page';

test.describe('Planner Navigation', () => {
  let plannerPage: PlannerPage;

  test.beforeEach(async ({ page, workViewPage }) => {
    plannerPage = new PlannerPage(page);
    await workViewPage.waitForTaskList();
  });

  test('should navigate between work view and planner', async ({
    page,
    workViewPage,
  }) => {
    // Start at work view
    await page.goto('/#/tag/TODAY');
    await workViewPage.waitForTaskList();
    await expect(page).toHaveURL(/\/tag\/TODAY/);

    // Navigate to planner
    await plannerPage.navigateToPlanner();
    await plannerPage.waitForPlannerView();
    await expect(page).toHaveURL(/\/(planner|tasks)/);

    // Go back to work view
    await page.goto('/#/tag/TODAY');
    await workViewPage.waitForTaskList();
    await expect(page).toHaveURL(/\/tag\/TODAY/);
  });

  test('should maintain tasks when navigating', async ({ page, workViewPage }) => {
    // Add tasks in work view
    await workViewPage.addTask('Navigation test task');
    // Wait for task to appear in DOM
    await expect(page.locator('task')).toHaveCount(1);

    // Navigate to planner
    await plannerPage.navigateToPlanner();
    await plannerPage.waitForPlannerView();

    // Go back to work view
    await page.goto('/#/tag/TODAY');
    await workViewPage.waitForTaskList();

    // Task should still be there
    await expect(page.locator('task')).toHaveCount(1);
    await expect(page.locator('task').first()).toContainText('Navigation test task');
  });

  test('should persist planner state after refresh', async ({ page }) => {
    // Navigate to planner
    await plannerPage.navigateToPlanner();
    await plannerPage.waitForPlannerView();

    // Refresh page
    await page.reload();
    await page.waitForLoadState('networkidle');
    await plannerPage.waitForPlannerView();

    // Should still be on planner or tasks
    await expect(page).toHaveURL(/\/(planner|tasks)/);

    // URL should be similar (might redirect from planner to tasks if no scheduled items)
    const urlAfterRefresh = page.url();
    expect(urlAfterRefresh).toMatch(/\/(planner|tasks)/);
  });

  test('should handle deep linking to planner', async ({ page }) => {
    // Direct navigation to planner URL
    await page.goto('/#/tag/TODAY/planner');
    await page.waitForLoadState('networkidle');
    await plannerPage.waitForPlannerView();

    // Should be on planner or tasks view
    await expect(page).toHaveURL(/\/(planner|tasks)/);
    await expect(plannerPage.routerWrapper).toBeVisible();
  });
});
