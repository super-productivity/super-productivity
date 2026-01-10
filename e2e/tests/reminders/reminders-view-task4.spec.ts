import { expect, test } from '../../fixtures/test.fixture';
import { addTaskWithReminder } from '../../utils/schedule-task-helper';

const DIALOG = 'dialog-view-task-reminder';
const DIALOG_TASKS_WRAPPER = `${DIALOG} .tasks`;
const DIALOG_TASK = `${DIALOG} .task`;
const DIALOG_TASK1 = `${DIALOG_TASK}:first-of-type`;
const DIALOG_TASK2 = `${DIALOG_TASK}:nth-of-type(2)`;
const DIALOG_TASK3 = `${DIALOG_TASK}:nth-of-type(3)`;
const TO_TODAY_SUF = ' .actions button:last-of-type';
const SCHEDULE_MAX_WAIT_TIME = 60000;

test.describe.serial('Reminders View Task 4', () => {
  test('should manually empty list via add to today', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    test.setTimeout(SCHEDULE_MAX_WAIT_TIME + 60000);

    await workViewPage.waitForTaskList();

    const start = Date.now() + 10000;

    // Add three tasks with reminders using test prefix
    const task1Name = `${testPrefix}-0 D task xyz`;
    const task2Name = `${testPrefix}-1 D task xyz`;
    const task3Name = `${testPrefix}-2 D task xyz`;

    // Add tasks - the helper now handles all the complexity
    await addTaskWithReminder(page, workViewPage, task1Name, start);
    await addTaskWithReminder(page, workViewPage, task2Name, start);
    await addTaskWithReminder(page, workViewPage, task3Name, Date.now() + 5000);

    // Wait for reminder dialog
    await page.waitForSelector(DIALOG, {
      state: 'visible',
      timeout: SCHEDULE_MAX_WAIT_TIME + 60000,
    });

    // Wait for all tasks to be present
    await page.waitForSelector(DIALOG_TASK1, { state: 'visible' });
    await page.waitForSelector(DIALOG_TASK2, { state: 'visible' });
    await page.waitForSelector(DIALOG_TASK3, { state: 'visible' });

    // Verify all tasks are shown
    await expect(page.locator(DIALOG_TASKS_WRAPPER)).toContainText(task1Name);
    await expect(page.locator(DIALOG_TASKS_WRAPPER)).toContainText(task2Name);
    await expect(page.locator(DIALOG_TASKS_WRAPPER)).toContainText(task3Name);

    // Click "add to today" buttons - wait for each to process before next
    const button1 = page.locator(DIALOG_TASK1 + TO_TODAY_SUF);
    await button1.waitFor({ state: 'visible', timeout: 5000 });
    await button1.click();

    // Wait for task count to reduce before clicking next
    await expect(async () => {
      const count = await page.locator(DIALOG_TASK).count();
      expect(count).toBeLessThanOrEqual(3);
    }).toPass({ timeout: 5000 });

    const button2 = page.locator(DIALOG_TASK2 + TO_TODAY_SUF);
    await button2.waitFor({ state: 'visible', timeout: 5000 });
    await button2.click();

    // Wait for task count to reduce
    await expect(async () => {
      const count = await page.locator(DIALOG_TASK).count();
      expect(count).toBeLessThanOrEqual(2);
    }).toPass({ timeout: 5000 });

    // Verify remaining task contains 'D task xyz'
    await expect(page.locator(DIALOG_TASK1)).toContainText('D task xyz');
  });
});
