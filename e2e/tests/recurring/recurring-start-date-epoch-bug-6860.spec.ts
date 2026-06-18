import { expect, test } from '../../fixtures/test.fixture';
import { saveRecurDialog, setRecurStartDate } from '../../utils/recurring-task-helpers';

/**
 * Bug: https://github.com/super-productivity/super-productivity/issues/6860
 *
 * When setting a date in the recurring task configuration, the value always
 * reverts to 01/01/1970 (Unix epoch). The root cause was that
 * FormlyDatePickerComponent passed undefined min/max to DatePickerInputComponent,
 * causing validateDate() to reject all dates via Invalid Date comparison,
 * which the formly parser then converted to '1970-01-01'.
 */

// Pin today so the hardcoded start date below stays in the future: the
// datepicker disables past days, so without a fixed clock the helper-based
// test breaks once the wall clock passes the hardcoded date (e.g. a scheduled
// run on 2026-06-16 could no longer click the disabled 2026-06-15 cell).
const FIXED_TODAY = new Date('2026-05-01T10:00:00');

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

    // 4. Open the schedule dialog
    const scheduleBtn = repeatDialog.locator('.planned-start-date-btn');
    await expect(scheduleBtn).toBeVisible({ timeout: 5000 });
    await scheduleBtn.click();

    // Wait for the schedule dialog to appear
    const scheduleDialog = page
      .locator('mat-dialog-container')
      .filter({ has: page.locator('datetime-picker') });
    await scheduleDialog.waitFor({ state: 'visible', timeout: 5000 });

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

    // Click Schedule button
    const scheduleSubmitBtn = scheduleDialog.locator(
      '[data-test-id="schedule-submit-btn"]',
    );
    await scheduleSubmitBtn.click();
    await scheduleDialog.waitFor({ state: 'hidden', timeout: 5000 });

    // 5. Verify the date input/val does not show epoch
    const dateVal = repeatDialog.locator('.planned-date-val');
    await expect(dateVal).toBeVisible();
    const valText = await dateVal.innerText();
    expect(valText).not.toBe('');
    expect(valText).not.toContain('1970');

    // 6. Save and verify the date survives persistence
    const saveBtn = repeatDialog.getByRole('button', { name: /Save/i });
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click();
    await repeatDialog.waitFor({ state: 'hidden', timeout: 10000 });
  });
  test('should preserve start date when configuring recurring task via helper', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    // Fix today to May 1, 2026 so the hardcoded 15/06/2026 start date stays a
    // selectable (enabled) future day in the datepicker.
    await page.clock.setFixedTime(FIXED_TODAY);
    await page.reload();
    await workViewPage.waitForTaskList();

    // 1. Create a task
    const taskTitle = `${testPrefix}-EpochBugManual`;
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

    await setRecurStartDate(page, '15/06/2026');
    await saveRecurDialog(page);
  });
});
