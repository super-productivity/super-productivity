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
      name: 'Show/Hide additional info',
    });
    await expect(detailBtn).toBeVisible({ timeout: 5000 });
    await detailBtn.click();

    const recurItem = page
      .locator('task-detail-item')
      .filter({ has: page.locator('mat-icon[svgIcon="repeat"]') });
    await expect(recurItem).toBeVisible({ timeout: 5000 });
    await recurItem.click();

    // 3. Wait for the repeat dialog to appear
    const repeatDialog = page.locator('mat-dialog-container');
    await repeatDialog.waitFor({ state: 'visible', timeout: 10000 });

    // 4. Open the calendar popup and select first day of next month
    const calendarToggle = repeatDialog.locator('mat-datepicker-toggle button');
    await calendarToggle.click();

    const calendar = page.locator('.mat-calendar');
    await expect(calendar).toBeVisible({ timeout: 5000 });

    // Navigate to next month and select the first available day
    const nextMonthBtn = page.getByRole('button', { name: /next month/i });
    await nextMonthBtn.click();

    const firstDay = page
      .locator('.mat-calendar-body-cell:not(.mat-calendar-body-disabled)')
      .first();
    await expect(firstDay).toBeVisible({ timeout: 5000 });
    await firstDay.click();

    // 5. Verify the date input does not show epoch
    const dateInput = repeatDialog.getByRole('textbox', { name: /start date/i });
    await expect(dateInput).toBeVisible();
    const inputValue = await dateInput.inputValue();
    expect(inputValue).not.toBe('');
    expect(inputValue).not.toContain('1970');

    // 6. Save and verify the date survives persistence
    const saveBtn = repeatDialog.getByRole('button', { name: /Save/i });
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click();
    await repeatDialog.waitFor({ state: 'hidden', timeout: 10000 });
  });

  test('should preserve start date when typing date manually into input', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // 1. Create a task
    const taskTitle = `${testPrefix}-EpochBugManual`;
    await workViewPage.addTask(taskTitle);

    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });

    // 2. Open task detail panel and click the repeat item
    await task.hover();
    const detailBtn = page.getByRole('button', {
      name: 'Show/Hide additional info',
    });
    await expect(detailBtn).toBeVisible({ timeout: 5000 });
    await detailBtn.click();

    const recurItem = page
      .locator('task-detail-item')
      .filter({ has: page.locator('mat-icon[svgIcon="repeat"]') });
    await expect(recurItem).toBeVisible({ timeout: 5000 });
    await recurItem.click();

    // 3. Wait for the repeat dialog to appear
    const repeatDialog = page.locator('mat-dialog-container');
    await repeatDialog.waitFor({ state: 'visible', timeout: 10000 });

    // 4. Type a date directly into the date input field
    // The app defaults to en-GB locale (DD/MM/YYYY format)
    const dateInput = repeatDialog.getByRole('textbox', { name: /start date/i });
    await expect(dateInput).toBeVisible();
    // Click to focus the input, then select all and type the date
    await dateInput.click();
    await dateInput.press('Control+a');
    await dateInput.pressSequentially('15/06/2026', { delay: 50 });
    // Trigger change by pressing Tab to blur
    await dateInput.press('Tab');

    // 5. Verify the input retained the typed date
    const inputValue = await dateInput.inputValue();
    expect(inputValue).not.toBe('');
    expect(inputValue).not.toContain('1970');

    // 6. Save
    const saveBtn = repeatDialog.getByRole('button', { name: /Save/i });
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click();
    await repeatDialog.waitFor({ state: 'hidden', timeout: 10000 });
  });
});
