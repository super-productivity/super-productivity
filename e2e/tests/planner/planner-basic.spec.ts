import { test, expect } from '../../fixtures/test.fixture';
import { PlannerPage } from '../../pages/planner.page';

test.describe('Planner Basic', () => {
  let plannerPage: PlannerPage;

  test.beforeEach(async ({ page, workViewPage }) => {
    plannerPage = new PlannerPage(page);
    await workViewPage.waitForTaskList();
  });

  test('should navigate to planner view', async ({ page }) => {
    await plannerPage.navigateToPlanner();
    await plannerPage.waitForPlannerView();

    // Should be on planner or tasks view (planner redirects if no scheduled tasks)
    await expect(page).toHaveURL(/\/(planner|tasks)/);
    await expect(plannerPage.routerWrapper).toBeVisible();
  });

  test('should add task and navigate to planner', async ({ page, workViewPage }) => {
    // Add a task first
    await workViewPage.addTask('Task for planner');
    await page.waitForLoadState('networkidle');

    // Verify task was created
    await expect(page.locator('task')).toHaveCount(1);

    // Navigate to planner
    await plannerPage.navigateToPlanner();
    await plannerPage.waitForPlannerView();

    // Should be on planner or tasks view
    await expect(page).toHaveURL(/\/(planner|tasks)/);
  });

  test('should handle multiple tasks', async ({ page, workViewPage }) => {
    // Add multiple tasks
    await workViewPage.addTask('First task');
    await workViewPage.addTask('Second task');
    await workViewPage.addTask('Third task');
    await page.waitForLoadState('networkidle');

    // Verify tasks were created
    await expect(page.locator('task')).toHaveCount(3);

    // Navigate to planner
    await plannerPage.navigateToPlanner();
    await plannerPage.waitForPlannerView();

    // Should be on planner or tasks view
    await expect(page).toHaveURL(/\/(planner|tasks)/);
  });

  test('should switch between work view and planner', async ({ page, workViewPage }) => {
    // Start in work view
    await page.goto('/#/tag/TODAY');
    await workViewPage.waitForTaskList();

    // Add a task
    await workViewPage.addTask('Test task');
    await page.waitForLoadState('networkidle');

    // Navigate to planner
    await plannerPage.navigateToPlanner();
    await plannerPage.waitForPlannerView();

    // Go back to work view
    await page.goto('/#/tag/TODAY');
    await workViewPage.waitForTaskList();

    // Task should still be there
    await expect(page.locator('task')).toHaveCount(1);
  });
});
