import { test, expect } from '../../fixtures/test.fixture';
import { PlannerPage } from '../../pages/planner.page';

test.describe('Planner Scheduled Tasks', () => {
  let plannerPage: PlannerPage;

  test.beforeEach(async ({ page, workViewPage }) => {
    plannerPage = new PlannerPage(page);
    await workViewPage.waitForTaskList();
  });

  test('should navigate to planner with tasks', async ({ page, workViewPage }) => {
    // Add a task that looks like it has a schedule
    await workViewPage.addTask('Meeting at 2pm');
    await page.waitForSelector('task', { state: 'visible', timeout: 10000 });

    // Navigate to planner
    await plannerPage.navigateToPlanner();
    await plannerPage.waitForPlannerView();

    // Should be on planner or tasks view
    await expect(page).toHaveURL(/\/(planner|tasks)/);
  });

  test('should handle multiple tasks in planner view', async ({ page, workViewPage }) => {
    // Add multiple tasks
    await workViewPage.addTask('Morning standup at 9am');
    await workViewPage.addTask('Lunch meeting at 12pm');
    await workViewPage.addTask('Review session at 3pm');
    await page.waitForSelector('task', { state: 'visible', timeout: 10000 });

    // Verify tasks were created
    await expect(page.locator('task')).toHaveCount(3);

    // Navigate to planner
    await plannerPage.navigateToPlanner();
    await plannerPage.waitForPlannerView();

    // Verify we can access planner
    await expect(page).toHaveURL(/\/(planner|tasks)/);
  });

  test('should handle navigation with time-related tasks', async ({
    page,
    workViewPage,
  }) => {
    // Add a task with time reference
    await workViewPage.addTask('Call client at 10:30am');
    await page.waitForSelector('task', { state: 'visible', timeout: 10000 });

    // Navigate to planner
    await plannerPage.navigateToPlanner();
    await plannerPage.waitForPlannerView();

    // Go back to work view
    await page.goto('/#/tag/TODAY');
    await workViewPage.waitForTaskList();

    // Task should still exist
    await expect(page.locator('task')).toHaveCount(1);

    // Navigate to planner again
    await plannerPage.navigateToPlanner();
    await expect(page).toHaveURL(/\/(planner|tasks)/);
  });
});
