import { expect, test } from '../../fixtures/test.fixture';
import { addTaskWithReminder } from '../../utils/schedule-task-helper';

const DIALOG = 'dialog-view-task-reminder';
const DIALOG_TASK = `${DIALOG} .task`;
const DIALOG_TASK1 = `${DIALOG_TASK}:first-of-type`;
const SCHEDULE_MAX_WAIT_TIME = 60000;

test.describe('Reminders View Task', () => {
  test('should display a modal with a scheduled task if due', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    test.setTimeout(SCHEDULE_MAX_WAIT_TIME + 20000);

    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    const taskTitle = `${testPrefix}-0 A task`;
    const scheduleTime = Date.now() + 10000; // Add 10 seconds buffer

    // Add task with reminder using shared helper
    await addTaskWithReminder(page, workViewPage, taskTitle, scheduleTime);

    // Wait for reminder dialog to appear
    await page.waitForSelector(DIALOG, {
      state: 'visible',
      timeout: SCHEDULE_MAX_WAIT_TIME,
    });

    // Assert dialog and task are present
    await expect(page.locator(DIALOG)).toBeVisible();
    await page.waitForSelector(DIALOG_TASK1, { state: 'visible' });
    await expect(page.locator(DIALOG_TASK1)).toBeVisible();
    await expect(page.locator(DIALOG_TASK1)).toContainText(taskTitle);
  });
});
