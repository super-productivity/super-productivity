import { test, expect } from '../../fixtures/test.fixture';
import { PlannerPage } from '../../pages/planner.page';

test.describe('Planner Task Visibility', () => {
  let plannerPage: PlannerPage;

  test.beforeEach(async ({ page, workViewPage }) => {
    plannerPage = new PlannerPage(page);
    await workViewPage.waitForTaskList();
  });

  test('should show newly created task in planner today column', async ({
    page,
    workViewPage,
  }) => {
    // Create a task in work view (goes to TODAY tag)
    await workViewPage.addTask('Planner visibility test');
    await expect(page.locator('task')).toHaveCount(1);

    // Navigate to planner
    await plannerPage.navigateToPlanner();
    await plannerPage.waitForPlannerView();

    // Wait for the task to render in the planner (may take time after route change)
    const task = page.locator('task').filter({ hasText: 'Planner visibility test' });
    await task.waitFor({ state: 'visible', timeout: 10000 });

    // The task should be visible in the planner's today section
    await expect(task).toBeVisible();
  });

  test('should show multiple newly created tasks in planner', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.addTask('First planner task');
    await workViewPage.addTask('Second planner task');
    await expect(page.locator('task')).toHaveCount(2);

    await plannerPage.navigateToPlanner();
    await plannerPage.waitForPlannerView();

    // Wait for the first task to render before asserting (route change rendering delay)
    const firstTask = page.locator('task').filter({ hasText: 'First planner task' });
    await firstTask.waitFor({ state: 'visible', timeout: 10000 });

    await expect(firstTask).toBeVisible();
    await expect(
      page.locator('task').filter({ hasText: 'Second planner task' }),
    ).toBeVisible();
  });
});
