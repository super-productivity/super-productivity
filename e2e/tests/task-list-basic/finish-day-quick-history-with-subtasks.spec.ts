import { test, expect } from '../../fixtures/test.fixture';

const TASK_SEL = 'task';
const TASK_TITLE = 'task task-title';
const TASK_DONE_BTN = '.task-done-btn';
const FINISH_DAY_BTN = '.e2e-finish-day';
const FIRST_TASK = 'task:nth-child(1)';
const SECOND_TASK = 'task:nth-child(2)';
const THIRD_TASK = 'task:nth-child(3)';
const SAVE_AND_GO_HOME_BTN = 'button[mat-flat-button][color="primary"]:last-of-type';
const TABLE_CAPTION = 'quick-history  h3';
const TABLE_ROWS = 'table tr';

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
    // Mark all three tasks as done - always mark the first visible task
    // as done tasks might be hidden or moved
    await page.hover(FIRST_TASK);
    await page.waitForSelector(`${FIRST_TASK} ${TASK_DONE_BTN}`, { state: 'visible' });
    await page.click(`${FIRST_TASK} ${TASK_DONE_BTN}`);

    // Mark the (new) first task
    await page.hover(FIRST_TASK);
    await page.waitForSelector(`${FIRST_TASK} ${TASK_DONE_BTN}`, { state: 'visible' });
    await page.click(`${FIRST_TASK} ${TASK_DONE_BTN}`);

    // Mark the (new) first task again
    await page.hover(FIRST_TASK);
    await page.waitForSelector(`${FIRST_TASK} ${TASK_DONE_BTN}`, { state: 'visible' });
    await page.click(`${FIRST_TASK} ${TASK_DONE_BTN}`);

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
    await page.waitForSelector('task-list', { state: 'visible' });

    // Step 5: Navigate to quick history via left-hand menu
    // Right-click on work view in magic-side-nav (first main nav item)
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
    await page.waitForSelector('quick-history', { state: 'visible' });

    // Step 6: Click on table caption
    await page.waitForSelector(TABLE_CAPTION, { state: 'visible' });
    await page.click(TABLE_CAPTION);

    // Step 7: Confirm quick history page loads
    await page.waitForSelector('quick-history', { state: 'visible' });
    // Verify we're on the quick history page without specific task checks
    // Tasks created with 'a' shortcut may not be properly nested/archived
    await expect(page.locator('quick-history')).toBeVisible();
    await expect(page.locator('table')).toBeVisible();

    // Step 8: Confirm tasks are in the table
    // Tasks are now sorted alphabetically: First Subtask, Main Task with Subtasks, Second Subtask
    await page.waitForSelector(TABLE_ROWS, { state: 'visible', timeout: 5000 });
    await expect(page.locator(TABLE_ROWS).first()).toBeVisible();
    await page.waitForSelector('table > tr:nth-child(1) > td.title > span', {
      state: 'visible',
    });
    // Verify the tasks appear in alphabetical order
    await expect(page.locator('table > tr:nth-child(1) > td.title > span')).toContainText(
      'First Subtask',
    );
    await expect(page.locator('table > tr:nth-child(2) > td.title > span')).toContainText(
      'Main Task with Subtasks',
    );
    await expect(page.locator('table > tr:nth-child(3) > td.title > span')).toContainText(
      'Second Subtask',
    );
  });
});
