import { test, expect } from '../../fixtures/test.fixture';
import type { Locator } from '@playwright/test';

const TASK_SEL = 'task';
const TASK_TITLE = 'task task-title';
const FINISH_DAY_BTN = '.e2e-finish-day';
const SAVE_AND_GO_HOME_BTN =
  'daily-summary button[mat-flat-button][color="primary"]:last-of-type';
const QUICK_HISTORY_DAY_ROW = 'history .week-row';

const markTaskAsDone = async (task: Locator): Promise<void> => {
  await task.hover();
  const doneBtn = task.locator('done-toggle').first();
  await doneBtn.waitFor({ state: 'visible', timeout: 5000 });
  await doneBtn.click();
};

test.describe('Finish Day Quick History With Subtasks', () => {
  test('should complete full finish day flow with subtasks', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    test.setTimeout(60000); // Increase timeout for this long flow
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
    await page.click(SAVE_AND_GO_HOME_BTN);

    // Wait for navigation back to work view
    await page.waitForSelector('task-list', { state: 'visible', timeout: 15000 });

    // Step 5: Navigate directly to the legacy Quick History route
    await page.goto('/#/tag/TODAY/quick-history');
    await page.waitForURL(/#\/tag\/TODAY\/quick-history/);
    await page.waitForSelector('history', { state: 'visible' });

    // Step 6: Expand the day row to reveal its tasks
    const dayRow = page.locator(QUICK_HISTORY_DAY_ROW).first();
    await dayRow.waitFor({ state: 'visible' });
    await dayRow.click();

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
  });
});
