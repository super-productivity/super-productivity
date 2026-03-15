import { test, expect } from '../../fixtures/test.fixture';

/**
 * Bug: https://github.com/super-productivity/super-productivity/issues/6766
 *
 * When creating a recurring task config for a task that has a scheduled due date,
 * the quick setting dropdown labels show the current date instead of the task's
 * due date. For example, if a task is scheduled for May 1st, the dropdown shows
 * "Every year on the 15.03." (today) instead of "Every year on the 1.5." (due date).
 */
test.describe('Repeat config uses due date for labels (#6766)', () => {
  test('should show due date in quick setting labels, not current date', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();

    // Step 1: Create a task
    const taskTitle = 'Repeat Due Date Test';
    await workViewPage.addTask(taskTitle);

    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });

    // Step 2: Open task detail panel
    await task.hover();
    const detailBtn = task.locator('.show-additional-info-btn').first();
    await detailBtn.waitFor({ state: 'visible', timeout: 5000 });
    await detailBtn.click();
    await page
      .locator('task-detail-panel')
      .first()
      .waitFor({ state: 'visible', timeout: 10000 });

    // Step 3: Open the schedule dialog via "Planned for" item
    const planItem = page.locator('task-detail-item').filter({
      hasText: /Planned for/,
    });
    await planItem.waitFor({ state: 'visible', timeout: 5000 });
    await planItem.click();

    // Step 4: Schedule to the 1st of next month via the calendar
    const dialog = page.locator('mat-dialog-container');
    await dialog.waitFor({ state: 'visible', timeout: 10000 });

    // Navigate to next month
    const nextMonthBtn = dialog.getByRole('button', { name: /next month/i });
    await nextMonthBtn.click();
    await page.waitForTimeout(300);

    // Click on day 1 of next month
    const day1 = dialog
      .locator('button.mat-calendar-body-cell')
      .getByText('1', { exact: true })
      .first();
    await day1.click();

    // Submit
    await page.waitForTimeout(300);
    const scheduleBtn = dialog.getByRole('button', { name: 'Schedule', exact: true });
    await scheduleBtn.click();
    await dialog.waitFor({ state: 'hidden', timeout: 10000 });

    // Step 5: Task moved to future — navigate to Planner to find it
    await page.locator('a').filter({ hasText: 'Planner' }).click();
    await page.waitForTimeout(1000);

    // Find the task in the planner view
    const plannerTask = page.locator('planner-task, task').filter({ hasText: taskTitle }).first();
    await expect(plannerTask).toBeVisible({ timeout: 10000 });

    // Click on it to select and open detail panel
    await plannerTask.click();
    await page.waitForTimeout(500);

    // Step 6: Open the repeat config dialog via "Recur" item in the detail panel
    const repeatItem = page.locator('task-detail-item').filter({
      has: page.locator('mat-icon[svgIcon="repeat"]'),
    });
    await repeatItem.waitFor({ state: 'visible', timeout: 10000 });
    await repeatItem.click();

    // Step 7: Wait for the repeat config dialog
    const repeatDialog = page.locator('mat-dialog-container');
    await repeatDialog.waitFor({ state: 'visible', timeout: 10000 });
    await expect(repeatDialog.locator('h1')).toContainText('Add Recurring Task Config');

    // Step 8: Open the "Recurring Config" dropdown
    const quickSettingSelect = repeatDialog.locator('mat-select').first();
    await quickSettingSelect.click();

    const options = page.locator('.cdk-overlay-pane mat-option');
    await options.first().waitFor({ state: 'visible', timeout: 5000 });

    // Step 9: Verify labels use the scheduled date (1st of next month), not today
    const today = new Date();
    const todayDay = today.getDate();

    // The monthly option should say "Every month on the day 1" (the 1st)
    const monthlyOption = options.filter({ hasText: /Every month/ });
    const monthlyText = await monthlyOption.textContent();
    expect(monthlyText).toContain('Every month on the day 1');

    // Today is the 15th — if the bug exists, it would show "day 15" instead of "day 1"
    if (todayDay !== 1) {
      expect(monthlyText).not.toContain(`day ${todayDay}`);
    }
  });

  test('should preserve due date in labels after selecting a quick setting', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();

    // Step 1: Create and schedule task for 1st of next month
    const taskTitle = 'Repeat Select Test';
    await workViewPage.addTask(taskTitle);

    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });

    await task.hover();
    const detailBtn = task.locator('.show-additional-info-btn').first();
    await detailBtn.waitFor({ state: 'visible', timeout: 5000 });
    await detailBtn.click();
    await page.locator('task-detail-panel').first().waitFor({ state: 'visible', timeout: 10000 });

    const planItem = page.locator('task-detail-item').filter({ hasText: /Planned for/ });
    await planItem.waitFor({ state: 'visible', timeout: 5000 });
    await planItem.click();

    const dialog = page.locator('mat-dialog-container');
    await dialog.waitFor({ state: 'visible', timeout: 10000 });
    await dialog.getByRole('button', { name: /next month/i }).click();
    await page.waitForTimeout(300);
    const day1 = dialog.locator('button.mat-calendar-body-cell').getByText('1', { exact: true }).first();
    await day1.click();
    await page.waitForTimeout(300);
    await dialog.getByRole('button', { name: 'Schedule', exact: true }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 10000 });

    // Navigate to planner to find the task
    await page.locator('a').filter({ hasText: 'Planner' }).click();
    await page.waitForTimeout(1000);
    const plannerTask = page.locator('planner-task, task').filter({ hasText: taskTitle }).first();
    await expect(plannerTask).toBeVisible({ timeout: 10000 });
    await plannerTask.click();
    await page.waitForTimeout(500);

    // Open repeat config dialog
    const repeatItem = page.locator('task-detail-item').filter({
      has: page.locator('mat-icon[svgIcon="repeat"]'),
    });
    await repeatItem.waitFor({ state: 'visible', timeout: 10000 });
    await repeatItem.click();

    const repeatDialog = page.locator('mat-dialog-container');
    await repeatDialog.waitFor({ state: 'visible', timeout: 10000 });

    // Step 2: Select "Every month on the day 1" from the dropdown
    const quickSettingSelect = repeatDialog.locator('mat-select').first();
    await quickSettingSelect.click();

    let options = page.locator('.cdk-overlay-pane mat-option');
    await options.first().waitFor({ state: 'visible', timeout: 5000 });

    // Select the monthly option
    const monthlyOption = options.filter({ hasText: /Every month/ });
    await monthlyOption.click();
    await page.waitForTimeout(500);

    // Step 3: Re-open dropdown and check labels are STILL using the due date
    await quickSettingSelect.click();
    options = page.locator('.cdk-overlay-pane mat-option');
    await options.first().waitFor({ state: 'visible', timeout: 5000 });

    const monthlyTextAfter = await options.filter({ hasText: /Every month/ }).textContent();
    const yearlyTextAfter = await options.filter({ hasText: /Every year/ }).textContent();

    // After selecting monthly, the startDate should still reference the 1st
    // BUG: without the fix in task-repeat-cfg-form.const.ts, selecting a quick setting
    // overwrites startDate with today's date, causing labels to switch to today
    const todayDay = new Date().getDate();
    expect(monthlyTextAfter).toContain('Every month on the day 1');
    if (todayDay !== 1) {
      expect(monthlyTextAfter).not.toContain(`day ${todayDay}`);
    }
  });
});
