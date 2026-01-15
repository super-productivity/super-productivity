import { expect, test } from '../../fixtures/test.fixture';

/**
 * Complete Finish Day Workflow E2E Tests
 *
 * Tests the full daily workflow including:
 * - Creating tasks
 * - Working on tasks (time tracking)
 * - Marking tasks as done
 * - Finishing the day
 * - Viewing the daily summary
 */

const FINISH_DAY_BTN = '.e2e-finish-day';
const SAVE_AND_GO_HOME_BTN =
  'daily-summary button[mat-flat-button][color="primary"]:last-of-type';

test.describe('Complete Daily Workflow', () => {
  test('should complete full daily workflow with multiple tasks', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // Create multiple tasks
    await workViewPage.addTask(`${testPrefix}-Morning Task`);
    await workViewPage.addTask(`${testPrefix}-Afternoon Task`);
    await workViewPage.addTask(`${testPrefix}-Evening Task`);

    // Verify all tasks are visible
    const allTasks = taskPage.getAllTasks();
    await expect(allTasks).toHaveCount(3);

    // Mark all tasks as done
    const task1 = taskPage.getTaskByText(`${testPrefix}-Morning Task`);
    const task2 = taskPage.getTaskByText(`${testPrefix}-Afternoon Task`);
    const task3 = taskPage.getTaskByText(`${testPrefix}-Evening Task`);

    await taskPage.markTaskAsDone(task1);
    await taskPage.markTaskAsDone(task2);
    await taskPage.markTaskAsDone(task3);

    // Verify all tasks are done
    const doneCount = await taskPage.getDoneTaskCount();
    expect(doneCount).toBe(3);

    // Click Finish Day button
    const finishDayBtn = page.locator(FINISH_DAY_BTN);
    await finishDayBtn.waitFor({ state: 'visible' });
    await finishDayBtn.click();

    // Wait for daily summary page
    await page.waitForURL(/daily-summary/);
    await expect(page.locator('daily-summary')).toBeVisible();

    // Click Save and go home
    const saveBtn = page.locator(SAVE_AND_GO_HOME_BTN);
    await saveBtn.waitFor({ state: 'visible' });
    await saveBtn.click();

    // Wait for navigation back to work view
    await page.waitForURL(/tag\/TODAY/);

    // Verify the work view is responsive
    await expect(page.locator('task-list').first()).toBeVisible();
  });

  test('should show tasks in daily summary', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // Create and complete a task
    const taskName = `${testPrefix}-Summary Task`;
    await workViewPage.addTask(taskName);

    const task = taskPage.getTaskByText(taskName);
    await taskPage.markTaskAsDone(task);

    // Click Finish Day
    const finishDayBtn = page.locator(FINISH_DAY_BTN);
    await finishDayBtn.waitFor({ state: 'visible' });
    await finishDayBtn.click();

    // Wait for daily summary
    await page.waitForURL(/daily-summary/);
    await expect(page.locator('daily-summary')).toBeVisible();

    // Verify the task is shown in the summary
    await expect(page.locator('daily-summary')).toContainText(taskName);
  });

  test('should handle undone tasks in finish day', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // Create tasks - one done, one undone
    await workViewPage.addTask(`${testPrefix}-Done Task`);
    await workViewPage.addTask(`${testPrefix}-Undone Task`);

    // Mark only one as done
    const doneTask = taskPage.getTaskByText(`${testPrefix}-Done Task`);
    await taskPage.markTaskAsDone(doneTask);

    // Click Finish Day
    const finishDayBtn = page.locator(FINISH_DAY_BTN);
    await finishDayBtn.waitFor({ state: 'visible' });
    await finishDayBtn.click();

    // Should navigate to daily summary or before-finish-day
    // The app may prompt about undone tasks
    await page.waitForTimeout(1000);

    // Verify we navigated away from work view
    const url = page.url();
    expect(url).toMatch(/daily-summary|before-finish-day/);
  });

  test('should navigate back from daily summary', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // Create and complete a task
    await workViewPage.addTask(`${testPrefix}-Nav Task`);
    const task = taskPage.getTaskByText(`${testPrefix}-Nav Task`);
    await taskPage.markTaskAsDone(task);

    // Finish day
    const finishDayBtn = page.locator(FINISH_DAY_BTN);
    await finishDayBtn.waitFor({ state: 'visible' });
    await finishDayBtn.click();

    // Wait for daily summary
    await page.waitForURL(/daily-summary/);

    // Click Save and go home
    const saveBtn = page.locator(SAVE_AND_GO_HOME_BTN);
    await saveBtn.waitFor({ state: 'visible' });
    await saveBtn.click();

    // Verify we're back at work view
    await page.waitForURL(/tag\/TODAY/);
    await expect(page.locator('task-list').first()).toBeVisible();
  });
});
