import { test, expect } from '../../fixtures/test.fixture';

const TASK_SEL = 'task';
const TASK_TITLE = 'task task-title';
const TASK_DONE_BTN = 'done-toggle';
const FINISH_DAY_BTN = '.e2e-finish-day';
const FIRST_TASK = 'task:nth-child(1)';
const SECOND_TASK = 'task:nth-child(2)';
const THIRD_TASK = 'task:nth-child(3)';
const SAVE_AND_GO_HOME_BTN =
  'daily-summary button[mat-flat-button][color="primary"]:last-of-type';

test.describe('Finish Day Quick History With Subtasks', () => {
  test('should complete full finish day flow with subtasks', async ({
    page,
    workViewPage,
  }) => {
    test.setTimeout(60000); // Increase timeout for this long flow
    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    await workViewPage.addTask('Main Task with Subtasks');
    await page.waitForSelector(TASK_SEL, { state: 'visible' });
    await expect(page.locator(TASK_TITLE).first()).toContainText(
      /Main Task with Subtasks/,
    );

    // Add tasks that would be subtasks as top-level tasks
    await workViewPage.addTask('First Subtask');
    await workViewPage.addTask('Second Subtask');

    // Verify we have three tasks (newest first)
    await expect(page.locator(FIRST_TASK)).toBeVisible();
    await expect(page.locator(SECOND_TASK)).toBeVisible();
    await expect(page.locator(THIRD_TASK)).toBeVisible();
    await expect(page.locator(`${FIRST_TASK} task-title`)).toContainText(
      /Second Subtask/,
    );
    await expect(page.locator(`${SECOND_TASK} task-title`)).toContainText(
      /First Subtask/,
    );
    await expect(page.locator(`${THIRD_TASK} task-title`)).toContainText(
      /Main Task with Subtasks/,
    );

    // Step 2: Mark all tasks as done
    // Mark all three tasks as done - always mark the first undone task
    for (let i = 0; i < 3; i++) {
      const undoneTask = page.locator('task:not(.isDone)').first();
      await undoneTask.hover();
      const doneBtn = undoneTask.locator(TASK_DONE_BTN);
      await doneBtn.waitFor({ state: 'visible', timeout: 5000 });
      await doneBtn.click();
      // Wait for Angular to process the done state change
      await page.waitForTimeout(300);
    }

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

    // Step 5: Navigate to history via left-hand menu
    // Right-click on work view in magic-side-nav (first main nav item)
    const navItemBtn = page
      .locator('magic-side-nav .nav-list > li.nav-item:first-child nav-item button')
      .first();
    await navItemBtn.waitFor({ state: 'visible', timeout: 5000 });
    await page.click(
      'magic-side-nav .nav-list > li.nav-item:first-child nav-item button',
      {
        button: 'right',
      },
    );
    await page.waitForSelector('work-context-menu > button:nth-child(1)', {
      state: 'visible',
    });
    await page.click('work-context-menu > button:nth-child(1)');
    await page.waitForSelector('history', { state: 'visible' });

    // Step 6: Expand the day row to reveal its tasks (current month auto-expands)
    const dayRow = page.locator('history .week-row').first();
    await dayRow.waitFor({ state: 'visible' });
    await dayRow.click();

    // Step 7: Confirm the history page + task table render
    await expect(page.locator('history')).toBeVisible();
    await page.waitForSelector('.task-summary-table tr', {
      state: 'visible',
      timeout: 5000,
    });

    // Step 8: Tasks appear in alphabetical order
    // (First Subtask, Main Task with Subtasks, Second Subtask)
    const rows = page.locator('.task-summary-table tr td.title span');
    await expect(rows.nth(0)).toContainText('First Subtask');
    await expect(rows.nth(1)).toContainText('Main Task with Subtasks');
    await expect(rows.nth(2)).toContainText('Second Subtask');
  });
});
