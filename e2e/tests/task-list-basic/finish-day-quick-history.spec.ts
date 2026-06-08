import { expect, test } from '../../fixtures/test.fixture';

const TASK_SEL = 'task';
const TASK_TITLE = 'task task-title';
const FINISH_DAY_BTN = '.e2e-finish-day';
const SAVE_AND_GO_HOME_BTN =
  'daily-summary button[mat-flat-button][color="primary"]:last-of-type';
const HISTORY_DAY_TOGGLE = 'history .week-row .day-toggle';

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
    await Promise.all([
      page.waitForURL(/#\/tag\/TODAY\/tasks/, { timeout: 15000 }),
      saveBtn.click(),
    ]);

    // Wait for the archive/save flow to settle on Today before navigating away.
    await expect(page.locator('task-list').first()).toBeVisible();

    // Navigate directly to the canonical History route. Legacy route coverage lives
    // in the navigation specs; this flow only needs archived task visibility.
    await page.goto('/#/tag/TODAY/history');
    await expect(page).toHaveURL(/#\/tag\/TODAY\/history/);
    await expect(page.locator('history')).toBeVisible();

    // Expand the day row to reveal its tasks
    const dayToggle = page.locator(HISTORY_DAY_TOGGLE).first();
    await expect(dayToggle).toBeVisible();
    await dayToggle.click();
    await expect(dayToggle).toHaveAttribute('aria-expanded', 'true');

    // Confirm the task appears in the expanded day's task table
    const tableTaskTitle = page
      .locator('.task-summary-table td.title button')
      .filter({ hasText: taskName })
      .first();
    await tableTaskTitle.waitFor({ state: 'visible' });
    await expect(tableTaskTitle).toContainText(taskName);
  });
});
