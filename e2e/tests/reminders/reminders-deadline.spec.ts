import { expect, test } from '../../fixtures/test.fixture';
import {
  openTaskDetailPanel,
  closeDetailPanelIfOpen,
} from '../../utils/schedule-task-helper';
import { fillTimeInput } from '../../utils/time-input-helper';

const REMINDER_DIALOG = 'dialog-view-task-reminder';
const REMINDER_DIALOG_TASK = `${REMINDER_DIALOG} .task`;
const REMINDER_DIALOG_TASK_1 = `${REMINDER_DIALOG_TASK}:first-of-type`;
const DEADLINE_DIALOG = 'dialog-deadline';
const SCHEDULE_MAX_WAIT_TIME = 60000;

const DETAIL_PANEL_DEADLINE_ITEM = 'task-detail-item:has(mat-icon:text("flag"))';

test.describe('Deadline Reminders', () => {
  test('should show reminder dialog when deadline with reminder is reached and dismiss correctly', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    test.setTimeout(SCHEDULE_MAX_WAIT_TIME + 30000);

    await workViewPage.waitForTaskList();

    const taskTitle = `${testPrefix}-deadline-remind`;
    await workViewPage.addTask(taskTitle);

    // Find the task
    const escapedTitle = taskTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const task = page.locator(`task:has-text("${escapedTitle}")`).first();
    await task.waitFor({ state: 'visible', timeout: 10000 });

    // Open detail panel and click deadline item
    await openTaskDetailPanel(page, task);
    const deadlineItem = page.locator(DETAIL_PANEL_DEADLINE_ITEM).first();
    await deadlineItem.waitFor({ state: 'visible', timeout: 5000 });
    await deadlineItem.click();

    // Wait for deadline dialog
    const deadlineDialog = page.locator(DEADLINE_DIALOG);
    await deadlineDialog.waitFor({ state: 'visible', timeout: 10000 });

    // Today is already highlighted — click it to select
    await deadlineDialog.locator('.mat-calendar-body-today').click();

    // Set time to ~10 seconds from now
    const deadlineTime = Date.now() + 10000;
    await fillTimeInput(page, deadlineTime);

    // Select "At deadline time" reminder option
    const remindSelect = deadlineDialog.locator('mat-select[name="type"]').last();
    await remindSelect.waitFor({ state: 'visible', timeout: 5000 });
    await remindSelect.click();

    const atDeadlineOption = page
      .locator('mat-option')
      .filter({ hasText: 'At deadline' })
      .first();
    await atDeadlineOption.waitFor({ state: 'visible', timeout: 5000 });
    await atDeadlineOption.click();

    // Submit deadline dialog via "Set deadline" button
    const submitBtn = deadlineDialog.locator('button:has-text("Set deadline")');
    await submitBtn.click();
    await deadlineDialog.waitFor({ state: 'hidden', timeout: 10000 });
    await closeDetailPanelIfOpen(page);

    // Wait for reminder dialog to appear
    await page.waitForSelector(REMINDER_DIALOG, {
      state: 'visible',
      timeout: SCHEDULE_MAX_WAIT_TIME,
    });

    // Verify the reminder dialog shows the task
    await expect(page.locator(REMINDER_DIALOG)).toBeVisible();
    await page.waitForSelector(REMINDER_DIALOG_TASK_1, { state: 'visible' });
    await expect(page.locator(REMINDER_DIALOG_TASK_1)).toContainText(taskTitle);

    // Verify the reminder dialog shows the deadline time (Issue 1 fix)
    const dueForEl = page.locator(`${REMINDER_DIALOG_TASK_1} .due-for`);
    await expect(dueForEl).toBeVisible();
    const dueForText = await dueForEl.textContent();
    expect(dueForText!.trim().length).toBeGreaterThan(0);

    // Dismiss by marking the task as done
    await page.locator(REMINDER_DIALOG).locator('button:has-text("Done")').click();

    // Wait for the reminder dialog to close
    await page.locator(REMINDER_DIALOG).waitFor({ state: 'hidden', timeout: 10000 });

    // Wait and verify the dialog does NOT reappear (the key fix)
    await page.waitForTimeout(5000);
    await expect(page.locator(REMINDER_DIALOG)).not.toBeVisible();
  });

  test('should not re-trigger after reschedule until tomorrow', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    test.setTimeout(SCHEDULE_MAX_WAIT_TIME + 30000);

    await workViewPage.waitForTaskList();

    const taskTitle = `${testPrefix}-deadline-reschedule`;
    await workViewPage.addTask(taskTitle);

    const escapedTitle = taskTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const task = page.locator(`task:has-text("${escapedTitle}")`).first();
    await task.waitFor({ state: 'visible', timeout: 10000 });

    // Open detail panel and set deadline
    await openTaskDetailPanel(page, task);
    const deadlineItem = page.locator(DETAIL_PANEL_DEADLINE_ITEM).first();
    await deadlineItem.waitFor({ state: 'visible', timeout: 5000 });
    await deadlineItem.click();

    const deadlineDialog = page.locator(DEADLINE_DIALOG);
    await deadlineDialog.waitFor({ state: 'visible', timeout: 10000 });

    await deadlineDialog.locator('.mat-calendar-body-today').click();

    const deadlineTime = Date.now() + 10000;
    await fillTimeInput(page, deadlineTime);

    const remindSelect = deadlineDialog.locator('mat-select[name="type"]').last();
    await remindSelect.waitFor({ state: 'visible', timeout: 5000 });
    await remindSelect.click();

    const atDeadlineOption = page
      .locator('mat-option')
      .filter({ hasText: 'At deadline' })
      .first();
    await atDeadlineOption.waitFor({ state: 'visible', timeout: 5000 });
    await atDeadlineOption.click();

    const submitBtn = deadlineDialog.locator('button:has-text("Set deadline")');
    await submitBtn.click();
    await deadlineDialog.waitFor({ state: 'hidden', timeout: 10000 });
    await closeDetailPanelIfOpen(page);

    // Wait for reminder dialog
    await page.waitForSelector(REMINDER_DIALOG, {
      state: 'visible',
      timeout: SCHEDULE_MAX_WAIT_TIME,
    });

    await expect(page.locator(REMINDER_DIALOG)).toBeVisible();
    await page.waitForSelector(REMINDER_DIALOG_TASK_1, { state: 'visible' });
    await expect(page.locator(REMINDER_DIALOG_TASK_1)).toContainText(taskTitle);

    // Click "Snooze" to open snooze menu, then "Reschedule until tomorrow"
    const snoozeBtn = page
      .locator(REMINDER_DIALOG)
      .locator('button:has(mat-icon:text("snooze"))')
      .first();
    await snoozeBtn.click();

    const rescheduleOption = page.locator(
      'button[mat-menu-item]:has-text("Reschedule for tomorrow")',
    );
    await rescheduleOption.waitFor({ state: 'visible', timeout: 5000 });
    await rescheduleOption.click();

    // Dialog should close
    await page.locator(REMINDER_DIALOG).waitFor({ state: 'hidden', timeout: 10000 });

    // Wait and verify the dialog does NOT reappear (Issue 2 fix)
    await page.waitForTimeout(5000);
    await expect(page.locator(REMINDER_DIALOG)).not.toBeVisible();
  });
});
