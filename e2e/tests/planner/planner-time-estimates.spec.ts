import { test, expect } from '../../fixtures/test.fixture';
import { PlannerPage } from '../../pages/planner.page';

test.describe('Planner Time Estimates', () => {
  let plannerPage: PlannerPage;

  test.beforeEach(async ({ page, workViewPage }) => {
    plannerPage = new PlannerPage(page);
    await workViewPage.waitForTaskList();
  });

  test('should handle tasks with time estimate syntax', async ({
    page,
    workViewPage,
  }) => {
    // Add task with time estimate using short syntax
    await workViewPage.addTask('Important task /2h/');

    // Verify task was created (auto-retries until count matches)
    await expect(page.locator('task')).toHaveCount(1);

    // Task should contain the time estimate in title
    await expect(page.locator('task').first()).toContainText('Important task');
  });

  test('should navigate to planner with time estimated tasks', async ({
    page,
    workViewPage,
  }) => {
    // Add multiple tasks with time references
    await workViewPage.addTask('First task /1h/');
    await workViewPage.addTask('Second task /30m/');
    await workViewPage.addTask('Third task /2h/');

    // Verify all tasks created (auto-retries until count matches)
    await expect(page.locator('task')).toHaveCount(3);

    // Navigate to planner
    await plannerPage.navigateToPlanner();
    await plannerPage.waitForPlannerView();

    // Should be on planner or tasks view
    await expect(page).toHaveURL(/\/(planner|tasks)/);
  });

  test('should handle navigation with time estimated tasks', async ({
    page,
    workViewPage,
  }) => {
    // Add task with time estimate syntax
    await workViewPage.addTask('Development work /4h/');

    // Navigate to planner
    await plannerPage.navigateToPlanner();
    await plannerPage.waitForPlannerView();

    // Verify navigation successful
    await expect(page).toHaveURL(/\/(planner|tasks)/);
    await expect(plannerPage.routerWrapper).toBeVisible();
  });

  test('should preserve tasks with time info when navigating', async ({
    page,
    workViewPage,
  }) => {
    // Add tasks with various time formats
    await workViewPage.addTask('Quick fix /15m/');
    await workViewPage.addTask('Feature development /3h30m/');

    // Navigate to planner
    await plannerPage.navigateToPlanner();
    await plannerPage.waitForPlannerView();

    // Go back to work view
    await page.goto('/#/tag/TODAY');
    await workViewPage.waitForTaskList();

    // Tasks should still be there
    await expect(page.locator('task')).toHaveCount(2);
    await expect(page.locator('task').first()).toContainText('Feature development');
    await expect(page.locator('task').last()).toContainText('Quick fix');
  });
});
