import { Page } from 'playwright/test';

import { expect, test } from '../../fixtures/test.fixture';

test.describe('Default task reminder option', () => {
  test.use({ locale: 'en-US', timezoneId: 'UTC' });

  // Should match the option set inside the default global configuration
  const defaultOptionText = 'when it starts';
  // Any other option different to the default to test the settings change
  const changedOptionText = 'never';

  const changeDefaultTaskReminderOption = async (page: Page): Promise<void> => {
    await page.getByRole('menuitem', { name: 'Settings' }).click();

    // Navigate to Time & Tracking tab first (2nd tab with timer icon)
    await page.evaluate(() => {
      const timeTrackingTab = Array.from(
        document.querySelectorAll('mat-tab-header .mat-mdc-tab'),
      ).find((tab) => {
        const icon = tab.querySelector('mat-icon');
        return icon?.textContent?.trim() === 'timer';
      });

      if (timeTrackingTab) {
        (timeTrackingTab as HTMLElement).click();
      }
    });

    await page.waitForTimeout(500);

    const remindersSection = await page.locator('section', { hasText: 'Reminders' });
    await remindersSection.click();

    // Should match the option set inside the default global configuration
    const selectedOption = remindersSection.getByText(defaultOptionText);
    await expect(selectedOption).toBeVisible();

    // Change it to another option to check whether the setting takes effect
    // across other application areas where a reminder option can be chosen
    await selectedOption.click();
    await page.getByText(changedOptionText).click();
  };

  test('should apply when scheduling a task using the due action', async ({
    page,
    waitForNav,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await changeDefaultTaskReminderOption(page);

    await page.getByRole('menuitem', { name: 'Inbox' }).click();
    await waitForNav();

    // First, add a task so the schedule button will be available
    await workViewPage.addTask('test task');

    // Wait for the task to be visible
    const task = page.locator('task').filter({ hasText: 'test task' }).first();
    await task.waitFor({ state: 'visible', timeout: 10000 });

    // Scroll into view and hover over the task to reveal action buttons
    await task.scrollIntoViewIfNeeded();
    await task.hover({ force: true });

    // Open the detail panel to access the schedule action
    const detailBtn = task.locator('.show-additional-info-btn').first();
    await detailBtn.waitFor({ state: 'visible', timeout: 10000 });
    await detailBtn.click();

    // Click on the schedule item in the detail panel
    const scheduleItem = page
      .locator(
        'task-detail-item:has(mat-icon:text("alarm")), ' +
          'task-detail-item:has(mat-icon:text("today")), ' +
          'task-detail-item:has(mat-icon:text("schedule"))',
      )
      .first();
    await scheduleItem.waitFor({ state: 'visible', timeout: 10000 });
    await scheduleItem.click();

    // Wait for the schedule dialog to appear
    const scheduleDialog = page.locator('dialog-schedule-task');
    await scheduleDialog.waitFor({ state: 'visible', timeout: 10000 });

    // Click on the time input in the schedule dialog to reveal the reminder input
    const timeInput = scheduleDialog.locator('input[type="time"]');
    await timeInput.waitFor({ state: 'visible', timeout: 10000 });
    await timeInput.click();

    // Wait for the reminder dropdown to appear and check the default option
    await expect(page.getByText(changedOptionText)).toBeVisible({ timeout: 5000 });
  });

  test('should apply when scheduling a task using short syntax', async ({
    page,
    waitForNav,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await changeDefaultTaskReminderOption(page);

    await page.getByRole('menuitem', { name: 'Inbox' }).click();
    await waitForNav();

    // Click the add button to reveal the input if it's not already visible
    const addTaskInput = page.locator('add-task-bar.global input');
    const inputCount = await addTaskInput.count();
    if (inputCount === 0) {
      const addBtn = page.locator('.tour-addBtn');
      await addBtn.waitFor({ state: 'visible', timeout: 10000 });
      await addBtn.click();
    }

    // Wait for the global add-task input to be available
    await addTaskInput.waitFor({ state: 'visible', timeout: 15000 });
    await addTaskInput.fill('due task @at 1pm');
    await addTaskInput.press('Enter');

    // Close the add-task bar by clicking the backdrop
    const backdrop = page.locator('.backdrop');
    const backdropVisible = await backdrop.isVisible().catch(() => false);
    if (backdropVisible) {
      await backdrop.click();
      await backdrop.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    }

    // Wait for task to be created and reschedule button to appear
    const rescheduleBtn = page.getByTitle('Reschedule').first();
    await rescheduleBtn.waitFor({ state: 'visible', timeout: 10000 });
    await rescheduleBtn.click();

    await expect(page.getByText(changedOptionText)).toBeVisible();
  });

  test('should apply when scheduling a task via the week schedule view', async ({
    page,
    waitForNav,
  }) => {
    await waitForNav();
    await changeDefaultTaskReminderOption(page);

    await page.getByRole('menuitem', { name: 'Schedule' }).click();
    // Click somewhere during the final day column to create a placeholder task
    await page.locator('schedule-week [data-day]').last().click();
    const taskInput = page.getByPlaceholder('Schedule task...');
    await taskInput.fill('task');
    await taskInput.press('Enter');
    // Click the scheduled task to reveal the details panel
    await page.locator('schedule-event').click();

    // Click on the schedule item in the detail panel (using icon-based selector for robustness)
    const scheduleItem = page
      .locator(
        'task-detail-item:has(mat-icon:text("alarm")), ' +
          'task-detail-item:has(mat-icon:text("today")), ' +
          'task-detail-item:has(mat-icon:text("schedule"))',
      )
      .first();
    await scheduleItem.waitFor({ state: 'visible', timeout: 10000 });
    await scheduleItem.click();

    await expect(page.getByText(changedOptionText)).toBeVisible();
  });
});
