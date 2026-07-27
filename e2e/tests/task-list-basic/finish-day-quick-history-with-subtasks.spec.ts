import { test, expect } from '../../fixtures/test.fixture';
import type { Locator } from '@playwright/test';
import { waitForStatePersistence } from '../../utils/waits';

const TASK_SEL = 'task';
const TASK_TITLE = 'task task-title';
const FINISH_DAY_BTN = '.e2e-finish-day';
const SAVE_AND_GO_HOME_BTN =
  'daily-summary button[mat-flat-button][color="primary"]:last-of-type';
const HISTORY_DAY_TOGGLE = 'history .week-row .day-toggle';

const markTaskAsDone = async (task: Locator): Promise<void> => {
  await task.hover();
  const doneBtn = task.locator('done-toggle').first();
  await doneBtn.waitFor({ state: 'visible', timeout: 5000 });
  await doneBtn.click();
};

test.describe('Finish Day Quick History With Subtasks', () => {
  test('should complete full finish day flow with subtasks', async ({
    page,
    dialogPage,
    taskPage,
    workViewPage,
    testPrefix,
  }) => {
    test.setTimeout(90000); // Increase timeout for this long flow
    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    const parentTitle = `${testPrefix}-Main Task with Subtasks`;
    const firstSubtaskTitle = `${testPrefix}-First Subtask`;
    const secondSubtaskTitle = `${testPrefix}-Second Subtask`;

    await workViewPage.addTask(parentTitle);
    await page.waitForSelector(TASK_SEL, { state: 'visible' });
    await expect(page.locator(TASK_TITLE).first()).toContainText(parentTitle);

    const parentTask = page.locator(`task:has-text("${parentTitle}")`).first();

    await workViewPage.addSubTask(parentTask, firstSubtaskTitle);
    await workViewPage.addSubTask(parentTask, secondSubtaskTitle);

    const subTasks = parentTask.locator('.sub-tasks task');
    await expect(subTasks).toHaveCount(2);
    await expect(
      subTasks.locator('task-title').filter({ hasText: firstSubtaskTitle }),
    ).toBeVisible();
    await expect(
      subTasks.locator('task-title').filter({ hasText: secondSubtaskTitle }),
    ).toBeVisible();

    // Step 2: Mark the real subtasks and their parent as done
    await markTaskAsDone(subTasks.nth(0));
    await markTaskAsDone(subTasks.nth(1));
    await markTaskAsDone(parentTask);

    // Verify no undone tasks remain
    await expect(page.locator('task:not(.isDone)')).toHaveCount(0);

    // Step 3: Click Finish Day button
    await page.waitForSelector(FINISH_DAY_BTN, { state: 'visible' });
    await page.click(FINISH_DAY_BTN);

    // Step 4: Wait for route change and click Save and go home
    await page.waitForSelector('daily-summary', { state: 'visible' });
    await page.waitForSelector(SAVE_AND_GO_HOME_BTN, { state: 'visible' });
    await Promise.all([
      page.waitForURL(/#\/tag\/TODAY\/tasks/, { timeout: 15000 }),
      page.click(SAVE_AND_GO_HOME_BTN),
    ]);

    // Wait for the archive/save flow to settle on Today before navigating away.
    await expect(page.locator('task-list').first()).toBeVisible();

    // Step 5: Navigate directly to the canonical History route. Legacy route
    // coverage lives in the navigation specs; this flow only needs archived task visibility.
    await page.goto('/#/tag/TODAY/history');
    await expect(page).toHaveURL(/#\/tag\/TODAY\/history/);
    await expect(page.locator('history')).toBeVisible();

    // Step 6: Expand the day row to reveal its tasks
    const dayToggle = page.locator(HISTORY_DAY_TOGGLE).first();
    await expect(dayToggle).toBeVisible();
    await dayToggle.click();
    await expect(dayToggle).toHaveAttribute('aria-expanded', 'true');

    // Step 7: Confirm the history page + task table render
    await expect(page.locator('history')).toBeVisible();
    await page.waitForSelector('.task-summary-table tr', {
      state: 'visible',
      timeout: 5000,
    });

    // Step 8: Parent task appears with its real subtasks grouped below it
    const rows = page.locator('.task-summary-table tr td.title button');
    await expect(rows.nth(0)).toContainText(parentTitle);
    await expect(rows.nth(1)).toContainText(firstSubtaskTitle);
    await expect(rows.nth(2)).toContainText(secondSubtaskTitle);

    // Step 9: Restore the parent through the real History action
    await page.getByRole('button', { name: 'Restore task from archive' }).first().click();
    await dialogPage.waitForDialog();
    await Promise.all([
      page.waitForURL(/#\/tag\/TODAY\/tasks/, { timeout: 15000 }),
      dialogPage.clickDialogButton('Do it!'),
    ]);

    const expectRestoredHierarchy = async (): Promise<void> => {
      const restoredParent = taskPage.getTaskByText(parentTitle).first();
      await expect(restoredParent).toBeVisible();
      const restoredSubTasks = taskPage.getSubTasks(restoredParent);
      await expect(restoredSubTasks).toHaveCount(2);
      await expect(
        restoredSubTasks.locator('task-title').filter({ hasText: firstSubtaskTitle }),
      ).toBeVisible();
      await expect(
        restoredSubTasks.locator('task-title').filter({ hasText: secondSubtaskTitle }),
      ).toBeVisible();
    };

    // Step 10: Today placement and hierarchy survive persistence + reload
    await expectRestoredHierarchy();
    await waitForStatePersistence(page);
    await page.reload();
    await workViewPage.waitForTaskList();
    await expectRestoredHierarchy();
  });
});
