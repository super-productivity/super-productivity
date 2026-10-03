import type { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { cssSelectors } from '../../constants/selectors';
import {
  openTaskDetailPanel,
  scheduleTaskForDay,
} from '../../utils/schedule-task-helper';

const { DIALOG_SCHEDULE_TASK, SCHEDULE_TASK_ITEM, TASK_SCHEDULE_BTN } = cssSelectors;

const getDateWithDayOffset = (dayOffset: number): Date => {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  return date;
};

/**
 * Clicks the dialog's "Unschedule" button (remove()), waits for the dialog to
 * close, then locates the resulting "Removed plan date" undo snack and clicks
 * its Undo action. Kept tight (no intervening waits/navigation) since the
 * snack auto-dismisses after 3000ms (snack.const.ts DEFAULT_SNACK_CFG).
 */
const clickUnscheduleAndUndo = async (page: Page): Promise<void> => {
  const scheduleDialog = page.locator(DIALOG_SCHEDULE_TASK);
  await scheduleDialog.locator('[data-test-id="schedule-unschedule-btn"]').click();
  await scheduleDialog.waitFor({ state: 'hidden', timeout: 10000 });

  const snack = page.locator('snack-custom').filter({ hasText: 'Removed plan date' });
  await expect(snack).toBeVisible({ timeout: 5000 });
  await snack.locator('button.action').click();
};

test.describe('Schedule dialog: undo unschedule button', () => {
  test('restores a day-only plan date when Undo is clicked', async ({
    page,
    taskPage,
    workViewPage,
    waitForNav,
    testPrefix,
  }) => {
    const title = `${testPrefix}-day-only`;
    const targetDate = getDateWithDayOffset(1);

    await workViewPage.waitForTaskList();
    // The default "Today" view only shows tasks due today, so a task
    // scheduled for tomorrow would vanish from it entirely once scheduled.
    // Use Inbox instead, which shows all of its tasks regardless of dueDay.
    await page.getByRole('menuitem', { name: 'Inbox' }).click();
    await waitForNav();
    await workViewPage.waitForTaskList();
    await workViewPage.addTask(title);

    const task = taskPage.getTaskByText(title).first();
    await expect(task).toBeVisible();

    await scheduleTaskForDay(page, task, targetDate);

    const scheduleBtn = task.locator(TASK_SCHEDULE_BTN);
    await expect(scheduleBtn).toBeVisible();
    const badgeTextBefore = await scheduleBtn.locator('.time-badge').innerText();

    // Reopen the dialog to unschedule it.
    await task.focus();
    await page.keyboard.press('s');
    await expect(page.locator(DIALOG_SCHEDULE_TASK)).toBeVisible({ timeout: 10000 });

    await clickUnscheduleAndUndo(page);

    // Undo should bring the day-only plan date back exactly as it was.
    await expect(scheduleBtn).toBeVisible();
    await expect(scheduleBtn.locator('.time-badge')).toHaveText(badgeTextBefore);
  });

  test('restores a timed plan date (no reminder) when Undo is clicked', async ({
    page,
    taskPage,
    workViewPage,
    testPrefix,
  }) => {
    const title = `${testPrefix}-timed`;

    await workViewPage.waitForTaskList();
    await workViewPage.addTask(title);

    const task = taskPage.getTaskByText(title).first();
    await expect(task).toBeVisible();

    await openTaskDetailPanel(page, task);
    await page.locator(SCHEDULE_TASK_ITEM).first().click();

    const scheduleDialog = page.locator(DIALOG_SCHEDULE_TASK);
    await expect(scheduleDialog).toBeVisible({ timeout: 10000 });

    await scheduleDialog.locator('input[type="time"]').fill('22:15');

    // Explicitly pick "Never" for the reminder: the dialog's default option
    // is "At start" (DEFAULT_GLOBAL_CONFIG.reminder.defaultTaskRemindOption).
    // This test covers the no-reminder restore path; the next test covers
    // restoring a timed plan date that still has its reminder set.
    await scheduleDialog.locator('mat-select').click();
    await page.getByRole('option', { name: 'Never', exact: true }).click();

    await scheduleDialog.locator('[data-test-id="schedule-submit-btn"]').click();
    await scheduleDialog.waitFor({ state: 'hidden', timeout: 10000 });

    const scheduleBtn = task.locator(TASK_SCHEDULE_BTN);
    await expect(scheduleBtn).toBeVisible();
    const badgeTextBefore = await scheduleBtn.locator('.time-badge').innerText();

    // Reopen the dialog via the schedule button itself (always rendered once
    // scheduled, no hover required).
    await scheduleBtn.click();
    await expect(scheduleDialog).toBeVisible({ timeout: 10000 });

    await clickUnscheduleAndUndo(page);

    // Undo should bring the exact scheduled time back, with no reminder badge.
    await expect(scheduleBtn).toBeVisible();
    await expect(scheduleBtn.locator('.time-badge')).toHaveText(badgeTextBefore);
  });

  test('restores a timed plan date with its reminder when Undo is clicked', async ({
    page,
    taskPage,
    workViewPage,
    testPrefix,
  }) => {
    const title = `${testPrefix}-reminder`;

    await workViewPage.waitForTaskList();
    await workViewPage.addTask(title);

    const task = taskPage.getTaskByText(title).first();
    await expect(task).toBeVisible();

    await openTaskDetailPanel(page, task);
    await page.locator(SCHEDULE_TASK_ITEM).first().click();

    const scheduleDialog = page.locator(DIALOG_SCHEDULE_TASK);
    await expect(scheduleDialog).toBeVisible({ timeout: 10000 });

    await scheduleDialog.locator('input[type="time"]').fill('22:30');
    // Keep the dialog's default "At start" reminder so the task ends up with
    // remindAt set - unscheduling must still offer (and honor) Undo here,
    // restoring the time and the reminder together.

    await scheduleDialog.locator('[data-test-id="schedule-submit-btn"]').click();
    await scheduleDialog.waitFor({ state: 'hidden', timeout: 10000 });

    const scheduleBtn = task.locator(TASK_SCHEDULE_BTN);
    await expect(scheduleBtn).toBeVisible();
    // The "alarm" icon (vs. "schedule"/"wb_sunny") is only rendered when
    // task.remindAt is set.
    await expect(scheduleBtn.locator('mat-icon')).toHaveText('alarm');
    const badgeTextBefore = await scheduleBtn.locator('.time-badge').innerText();

    await scheduleBtn.click();
    await expect(scheduleDialog).toBeVisible({ timeout: 10000 });

    await clickUnscheduleAndUndo(page);

    // Undo should bring back the exact time and the reminder (alarm icon).
    await expect(scheduleBtn).toBeVisible();
    await expect(scheduleBtn.locator('mat-icon')).toHaveText('alarm');
    await expect(scheduleBtn.locator('.time-badge')).toHaveText(badgeTextBefore);
  });
});
