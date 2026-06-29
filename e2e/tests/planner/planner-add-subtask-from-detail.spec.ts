import { test, expect } from '../../fixtures/test.fixture';
import { PlannerPage } from '../../pages/planner.page';
import { cssSelectors } from '../../constants/selectors';

const { DETAIL_PANEL } = cssSelectors;

/**
 * Repro for #8617: "Add subtask is not working in the task detail panel" when
 * the panel is opened from the Planner.
 *
 * The Planner renders tasks as <planner-task>, not <task>. The detail panel's
 * "Add subtask" used to delegate (via a shared signal) to the <task> row that
 * renders the parent, which does not exist in the Planner — so nothing happened.
 */
test.describe('Planner: add subtask from detail panel', () => {
  test('adds a subtask via the detail panel opened from a planner task', async ({
    page,
    workViewPage,
  }) => {
    const plannerPage = new PlannerPage(page);
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Planner Parent Task');

    await plannerPage.navigateToPlanner();
    await plannerPage.waitForPlannerView();

    const plannerTask = page
      .locator('planner-task')
      .filter({ hasText: 'Planner Parent Task' });
    await expect(plannerTask).toBeVisible({ timeout: 15000 });

    // Clicking the planner task selects it -> the detail panel opens.
    await plannerTask.click();
    const panel = page.locator(DETAIL_PANEL);
    await expect(panel).toBeVisible({ timeout: 5000 });

    // The sub-task section starts collapsed; expand it to reveal the button.
    await panel
      .locator('mat-expansion-panel-header')
      .filter({ hasText: 'Subtasks' })
      .click();

    await panel.getByRole('button', { name: 'Add subtask' }).click();

    // The inline draft input must open inside the panel (the bug: it never did)
    // and be focused so the user can type straight away.
    const input = page.locator('.e2e-add-subtask-input');
    await expect(input).toBeVisible({ timeout: 3000 });
    await expect(input).toBeFocused();
    await input.fill('Sub from planner');
    await page.keyboard.press('Enter');

    await expect(panel.locator('.sub-tasks task task-title')).toContainText(
      'Sub from planner',
    );
  });
});
