import { expect, test } from '../../fixtures/test.fixture';
import { addTaskWithReminder } from '../../utils/schedule-task-helper';

const DIALOG = 'dialog-view-task-reminder';
const DIALOG_TASKS_WRAPPER = `${DIALOG} .tasks`;
const DIALOG_TASK = `${DIALOG} .task`;
const DIALOG_TASK1 = `${DIALOG_TASK}:first-of-type`;
const DIALOG_TASK2 = `${DIALOG_TASK}:nth-of-type(2)`;
const SCHEDULE_MAX_WAIT_TIME = 60000;

test.describe.serial('Reminders View Task 2', () => {
  test('should display a modal with 2 scheduled task if due', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    test.setTimeout(SCHEDULE_MAX_WAIT_TIME + 30000);

    await workViewPage.waitForTaskList();

    // Add two tasks with reminders using test prefix
    const task1Name = `${testPrefix}-0 B task`;
    const task2Name = `${testPrefix}-1 B task`;

    await addTaskWithReminder(page, workViewPage, task1Name);
    await addTaskWithReminder(page, workViewPage, task2Name, Date.now() + 5000);

    // Wait for reminder dialog
    await page.waitForSelector(DIALOG, {
      state: 'visible',
      timeout: SCHEDULE_MAX_WAIT_TIME,
    });

    // Verify both tasks are shown
    await expect(page.locator(DIALOG_TASK1)).toBeVisible();
    await expect(page.locator(DIALOG_TASK2)).toBeVisible();
    await expect(page.locator(DIALOG_TASKS_WRAPPER)).toContainText(task1Name);
    await expect(page.locator(DIALOG_TASKS_WRAPPER)).toContainText(task2Name);
  });
});
