import { expect, test } from '../../fixtures/test.fixture';

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

    const recurItem = page
      .locator('task-detail-item')
      .filter({ has: page.locator('mat-icon[svgIcon="repeat"]') });
    await expect(recurItem).toBeVisible({ timeout: 5000 });
    await recurItem.click();

    // 3. Wait for the repeat dialog and set a future start date via calendar
    const repeatDialog = page.locator('mat-dialog-container');
    await repeatDialog.waitFor({ state: 'visible', timeout: 10000 });

    // Open the calendar popup
    const calendarToggle = repeatDialog.locator('mat-datepicker-toggle button');
    await calendarToggle.click();

    const calendar = page.locator('.mat-calendar');
    await expect(calendar).toBeVisible({ timeout: 5000 });

    // Navigate to next month to ensure the date is in the future
    const nextMonthBtn = page.getByRole('button', { name: /next month/i });
    await nextMonthBtn.click();

    // Select the first available day in next month
    const firstDay = page
      .locator('.mat-calendar-body-cell:not(.mat-calendar-body-disabled)')
      .first();
    await expect(firstDay).toBeVisible({ timeout: 5000 });
    await firstDay.click();

    // Wait for calendar to close
    await expect(calendar).not.toBeVisible({ timeout: 5000 });

    // Save the repeat config — wait for the button to be enabled first
    const saveBtn = repeatDialog.getByRole('button', { name: /Save/i });
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click();
    await repeatDialog.waitFor({ state: 'hidden', timeout: 10000 });

    // 4. Reload and navigate to today view to verify persisted state
    await page.reload();
    await workViewPage.waitForTaskList();
    await page.goto('/#/tag/TODAY/tasks');
    await workViewPage.waitForTaskList();

    // 5. Assert: task should NOT be visible in today's task list
    // Bug #6856: The task appears immediately instead of being scheduled
    // for the configured future start date.
    await expect(taskPage.getTaskByText(taskTitle)).not.toBeVisible({ timeout: 5000 });
  });
});
