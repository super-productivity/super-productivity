import { expect, test } from '../../fixtures/test.fixture';
import {
  openRecurDialog,
  openRecurScheduleDialog,
  saveRecurDialog,
} from '../../utils/recurring-task-helpers';

/**
 * Bug: https://github.com/super-productivity/super-productivity/issues/6856
 *
 * When a recurring task is created with a future start date, an active task
 * instance is immediately generated and placed in the Inbox on the same day
 * of creation, ignoring the configured start date entirely.
 *
 * Expected: No active task instance should appear until the configured start
 * date arrives. The task should be scheduled for the start date.
 */
test.describe('Recurring Task - Future Start Date (#6856)', () => {
  test('should not show task in today view when made recurring with future start date', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // 1. Create a task in the today view
    const taskTitle = `${testPrefix}-FutureRecur`;
    await workViewPage.addTask(taskTitle);

    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });

    // 2. Open task detail and click on recur to open the repeat dialog
    await task.hover();
    const detailBtn = page.getByRole('button', {
      name: 'Show/hide task panel',
    });
    await expect(detailBtn).toBeVisible({ timeout: 5000 });
    await detailBtn.click();

    // 3. Wait for the repeat dialog and set a future start date via calendar
    await openRecurDialog(page);
    const scheduleDialog = await openRecurScheduleDialog(page);

    const calendar = scheduleDialog.locator('mat-calendar');
    await expect(calendar).toBeVisible({ timeout: 5000 });

    // Navigate to next month to ensure the date is in the future
    const nextMonthBtn = scheduleDialog.getByRole('button', { name: /next month/i });
    await nextMonthBtn.click();

    // Select the first available day in next month
    const firstDay = scheduleDialog
      .locator('.mat-calendar-body-cell:not(.mat-calendar-body-disabled)')
      .first();
    await expect(firstDay).toBeVisible({ timeout: 5000 });
    await firstDay.click();

    // Click Schedule button
    const scheduleSubmitBtn = scheduleDialog.locator(
      '[data-test-id="schedule-submit-btn"]',
    );
    await scheduleSubmitBtn.click();
    await scheduleDialog.waitFor({ state: 'hidden', timeout: 5000 });

    // Save the repeat config — wait for the button to be enabled first
    await saveRecurDialog(page);

    // 4. Assert in-session first: the task should disappear from Today as soon
    // as the side-effect actions (updateTask + planTaskForDay) settle. This is
    // the bug behavior from #6856 ("immediately generated and placed in the
    // Inbox") and asserting it here also gives the op-log persistence queue
    // time to drain before the page.reload() below — otherwise pending writes
    // can be lost and the post-reload assertion races with hydration.
    await expect(taskPage.getTaskByText(taskTitle)).not.toBeVisible({ timeout: 10000 });

    // 5. Reload and navigate to today view to verify the same state persists.
    await page.reload();
    await workViewPage.waitForTaskList();
    await page.goto('/#/tag/TODAY/tasks');
    await workViewPage.waitForTaskList();

    // 6. Assert: task should still NOT be visible in today's task list.
    await expect(taskPage.getTaskByText(taskTitle)).not.toBeVisible({ timeout: 5000 });
  });
});
