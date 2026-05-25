import { expect, test } from '../../fixtures/test.fixture';

const TASK_SEL = 'task';
const TASK_TITLE = 'task task-title';
const FINISH_DAY_BTN = '.e2e-finish-day';
const SAVE_AND_GO_HOME_BTN =
  'daily-summary button[mat-flat-button][color="primary"]:last-of-type';
const TABLE_CAPTION = 'quick-history h3';
const TABLE_ROWS = 'table tr';

test.describe.serial('Finish Day Quick History', () => {
  test('should create task, mark as done, finish day and view in quick history', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    // Create a task with unique prefix
    const taskName = `${testPrefix}-Task for Quick History`;
    await workViewPage.addTask(taskName);
    await page.waitForSelector(TASK_SEL, { state: 'visible' });
    const taskTitle = page.locator(TASK_TITLE);
    await expect(taskTitle).toContainText(new RegExp(taskName));

    // Mark task as done
    await page.waitForSelector(TASK_SEL, { state: 'visible' });
    const task = page.locator(TASK_SEL).first();
    await task.hover();
    const doneBtn = page.locator(`${TASK_SEL} done-toggle`).first();
    await doneBtn.waitFor({ state: 'visible' });
    await doneBtn.click();

    // Wait for task to be marked as done
    await page.waitForFunction(() => {
      const tasks = document.querySelectorAll('task');
      return Array.from(tasks).some((t) => t.classList.contains('isDone'));
    });

    // Click Finish Day button
    const finishDayBtn = page.locator(FINISH_DAY_BTN);
    await finishDayBtn.waitFor({ state: 'visible' });
    await finishDayBtn.click();

    // Wait for route change to daily summary
    await page.waitForURL(/#\/tag\/TODAY\/daily-summary/);
    await page.waitForSelector('daily-summary', { state: 'visible' });

    // Click Save and go home
    const saveBtn = page.locator(SAVE_AND_GO_HOME_BTN);
    await saveBtn.waitFor({ state: 'visible' });
    await saveBtn.click();

    // Wait for navigation back to work view
    await page.waitForURL(/#\/tag\/TODAY/);

    // Navigate to quick history via left-hand menu
    const contextBtn = page
      .locator('magic-side-nav .nav-list > li.nav-item:first-child nav-item')
      .first();
    await contextBtn.waitFor({ state: 'visible' });
    await contextBtn.click({ button: 'right' });

    const quickHistoryBtn = page.locator('work-context-menu > button:nth-child(1)');
    await quickHistoryBtn.waitFor({ state: 'visible' });
    await quickHistoryBtn.click();

    // Wait for quick history page
    await page.waitForURL(/#\/tag\/TODAY\/quick-history/);
    await page.waitForSelector('quick-history', { state: 'visible' });

    // Click on table caption
    const tableCaption = page.locator(TABLE_CAPTION);
    await tableCaption.waitFor({ state: 'visible' });
    await tableCaption.click();

    // Confirm quick history page loads
    await expect(page.locator('quick-history')).toBeVisible();

    // Confirm task is in the table
    await page.waitForSelector(TABLE_ROWS, { state: 'visible' });
    const tableTaskTitle = page.locator('table > tr:nth-child(1) > td.title > span');
    await tableTaskTitle.waitFor({ state: 'visible' });

    // Verify the task title is present in the table
    await expect(tableTaskTitle).toContainText(taskName);
  });
});
