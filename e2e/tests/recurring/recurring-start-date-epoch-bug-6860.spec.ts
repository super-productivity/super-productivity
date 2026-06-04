import { expect, test } from '../../fixtures/test.fixture';

/**
 * Bug: https://github.com/super-productivity/super-productivity/issues/6860
 *
 * When setting a date in the recurring task configuration, the value always
 * reverts to 01/01/1970 (Unix epoch). The root cause was that
 * FormlyDatePickerComponent passed undefined min/max to DatePickerInputComponent,
 * causing validateDate() to reject all dates via Invalid Date comparison,
 * which the formly parser then converted to '1970-01-01'.
 */
test.describe('Recurring Task - Start Date Epoch Bug (#6860)', () => {
  test('should preserve start date when configuring recurring task via calendar', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // 1. Create a task
    const taskTitle = `${testPrefix}-EpochBug`;
    await workViewPage.addTask(taskTitle);

    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });

    // 2. Open task detail panel and click the repeat item
    await task.hover();
    const detailBtn = page.getByRole('button', {
      name: 'Show/hide task panel',
    });
    await expect(detailBtn).toBeVisible({ timeout: 5000 });
    await detailBtn.click();

    const recurItem = page
      .locator('task-detail-item')
      .filter({ has: page.locator('mat-icon', { hasText: /^repeat$/ }) });
    await expect(recurItem).toBeVisible({ timeout: 5000 });
    await recurItem.click();

    // 3. Wait for the repeat dialog to appear
    const repeatDialog = page.locator('mat-dialog-container').first();
    await repeatDialog.waitFor({ state: 'visible', timeout: 10000 });

    // 4. Open the schedule dialog and select first day of next month
    await repeatDialog.locator('.planned-start-date-btn').click();
    const scheduleDialog = page
      .locator('mat-dialog-container')
      .filter({ has: page.locator('datetime-picker') });
    await expect(scheduleDialog).toBeVisible();

    const calendar = scheduleDialog.locator('mat-calendar');
    await expect(calendar).toBeVisible({ timeout: 5000 });

    // Navigate to next month and select the first available day
    const nextMonthBtn = scheduleDialog.getByRole('button', { name: /next month/i });
    await nextMonthBtn.click();

    const firstDay = scheduleDialog
      .locator('.mat-calendar-body-cell:not(.mat-calendar-body-disabled)')
      .first();
    await expect(firstDay).toBeVisible({ timeout: 5000 });
    await firstDay.click();

    // 5. Verify the date survives persistence and does not show epoch
    // Click Schedule button
    const scheduleBtn = scheduleDialog.getByRole('button', {
      name: 'Schedule',
      exact: true,
    });
    await scheduleBtn.click();
    await scheduleDialog.waitFor({ state: 'hidden' });

    // 6. Save and verify the date survives persistence
    const dateVal = repeatDialog.locator('.planned-date-val');
    await expect(dateVal).not.toContainText('1970');

    const saveBtn = repeatDialog.getByRole('button', { name: /Save/i });
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click();
    await repeatDialog.waitFor({ state: 'hidden', timeout: 10000 });
  });
});
