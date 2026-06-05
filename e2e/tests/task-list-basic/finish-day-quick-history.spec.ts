import { expect, test } from '../../fixtures/test.fixture';

const TASK_SEL = 'task';
const TASK_TITLE = 'task task-title';
const FINISH_DAY_BTN = '.e2e-finish-day';
const SAVE_AND_GO_HOME_BTN =
  'daily-summary button[mat-flat-button][color="primary"]:last-of-type';
const DAY_ROW = 'history .week-row';

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

    // Navigate to history via left-hand menu
    const contextBtn = page
      .locator('magic-side-nav .nav-list > li.nav-item:first-child nav-item')
      .first();
    await contextBtn.waitFor({ state: 'visible' });
    await contextBtn.click({ button: 'right' });

    const historyBtn = page.locator('work-context-menu > button:nth-child(1)');
    await historyBtn.waitFor({ state: 'visible' });
    await historyBtn.click();

    // Wait for the history page (the current month auto-expands)
    await page.waitForURL(/#\/tag\/TODAY\/history/);
    await page.waitForSelector('history', { state: 'visible' });

    // Expand the day row to reveal its tasks
    const dayRow = page.locator(DAY_ROW).first();
    await dayRow.waitFor({ state: 'visible' });
    await dayRow.click();

    // Confirm the task appears in the expanded day's task table
    const tableTaskTitle = page
      .locator('.task-summary-table td.title span')
      .filter({ hasText: taskName })
      .first();
    await tableTaskTitle.waitFor({ state: 'visible' });
    await expect(tableTaskTitle).toContainText(taskName);
  });
});
