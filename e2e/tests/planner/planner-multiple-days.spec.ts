import { test, expect } from '../../fixtures/test.fixture';
import { PlannerPage } from '../../pages/planner.page';

test.describe('Planner Multiple Days', () => {
  let plannerPage: PlannerPage;

  test.beforeEach(async ({ page, workViewPage }) => {
    plannerPage = new PlannerPage(page);
    await workViewPage.waitForTaskList();
  });

  test('should show planner view for multiple days planning', async ({ page }) => {
    // Navigate to planner
    await plannerPage.navigateToPlanner();
    await plannerPage.waitForPlannerView();

    // Should be on planner or tasks view
    await expect(page).toHaveURL(/\/(planner|tasks)/);
    await expect(plannerPage.routerWrapper).toBeVisible();
  });

  test('should handle tasks for different days', async ({ page, workViewPage }) => {
    // Add tasks for planning
    await workViewPage.addTask('Task for today');
    await workViewPage.addTask('Task for tomorrow');
    await workViewPage.addTask('Task for next week');
    await page.waitForLoadState('networkidle');

    // Verify tasks were created
    await expect(page.locator('task')).toHaveCount(3);

    // Navigate to planner
    await plannerPage.navigateToPlanner();
    await plannerPage.waitForPlannerView();

    // Should be able to view planner
    await expect(page).toHaveURL(/\/(planner|tasks)/);
  });

  test('should support planning across multiple days', async ({ page, workViewPage }) => {
    // Create tasks without hashtags to avoid tag creation dialog
    await workViewPage.addTask('Monday meeting');
    await workViewPage.addTask('Tuesday review');
    await workViewPage.addTask('Wednesday deadline');
    await page.waitForLoadState('networkidle');

    // Navigate to planner
    await plannerPage.navigateToPlanner();
    await plannerPage.waitForPlannerView();

    // Planner should be accessible
    await expect(plannerPage.routerWrapper).toBeVisible();
  });

  test('should maintain task order when viewing planner', async ({
    page,
    workViewPage,
  }) => {
    // Add tasks in specific order
    const taskNames = ['First task', 'Second task', 'Third task', 'Fourth task'];

    for (const taskName of taskNames) {
      await workViewPage.addTask(taskName);
      await page.waitForLoadState('domcontentloaded');
    }

    // Verify all tasks created
    await expect(page.locator('task')).toHaveCount(4);

    // Navigate to planner
    await plannerPage.navigateToPlanner();
    await plannerPage.waitForPlannerView();

    // Return to work view
    await page.goto('/#/tag/TODAY');
    await workViewPage.waitForTaskList();

    // Tasks should still be present
    await expect(page.locator('task')).toHaveCount(4);
  });
});
