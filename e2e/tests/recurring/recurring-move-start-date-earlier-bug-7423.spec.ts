import { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';

/**
 * Bug: https://github.com/super-productivity/super-productivity/issues/7423
 *
 * When a recurring task already has lastTaskCreationDay set (because
 * updateTaskAfterMakingItRepeatable$ stamped it on initial save), and the
 * user later edits the repeat config to move startDate to an EARLIER date,
 * the live task instance was rescheduled to the day after the OLD
 * startDate (because getNextRepeatOccurrence advanced from the stale
 * lastTaskCreationDay) instead of landing on the NEW startDate.
 *
 * Repro from the issue (today fixed to 2026-05-01):
 *   1. Create task → make recurring → startDate = 2026-05-04 → save
 *   2. Reopen recur dialog → change startDate to 2026-05-02 → save
 * Expected post-fix: task lands on 2026-05-02.
 * Bug:               task lands on 2026-05-05 (May 4 + 1 day).
 *
 * Dates kept close to today so they fit inside the planner's default
 * 15-day desktop window without horizontal scrolling.
 */

const FIXED_TODAY = new Date('2026-05-01T10:00:00');

const openRecurDialog = async (page: Page): Promise<Locator> => {
  const recurItem = page
    .locator('task-detail-item')
    .filter({ has: page.locator('mat-icon', { hasText: /^repeat$/ }) });
  await expect(recurItem).toBeVisible({ timeout: 5000 });
  await recurItem.click();
  const dialog = page.locator('mat-dialog-container');
  await dialog.waitFor({ state: 'visible', timeout: 10000 });
  return dialog;
};

// Set the Start date by typing into the matInput directly. The input parses
// the locale's display format (en-GB → "DD/MM/YYYY") on blur/Enter. This is
// far more robust than driving the calendar overlay across Material versions.
const setStartDate = async (page: Page, ddmmyyyy: string): Promise<void> => {
  const dialog = page.locator('mat-dialog-container');
  const startDateInput = dialog
    .locator('mat-form-field')
    .filter({ hasText: /Start date/i })
    .locator('input')
    .first();
  await expect(startDateInput).toBeVisible({ timeout: 5000 });
  await startDateInput.fill('');
  await startDateInput.fill(ddmmyyyy);
  await startDateInput.press('Tab');
  await expect(startDateInput).toHaveValue(ddmmyyyy, { timeout: 3000 });
};

const saveDialog = async (page: Page): Promise<void> => {
  const dialog = page.locator('mat-dialog-container');
  const saveBtn = dialog.getByRole('button', { name: /Save/i });
  await expect(saveBtn).toBeEnabled({ timeout: 5000 });
  await saveBtn.click();
  await dialog.waitFor({ state: 'hidden', timeout: 10000 });
};

test.describe('Recurring Task - Move Start Date Earlier (#7423)', () => {
  test('changing startDate to an earlier date re-anchors the task on the new startDate', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const taskTitle = `${testPrefix}-MoveStartEarlier7423`;

    // Fix today to Friday, May 1, 2026 so calendar interactions are deterministic.
    await page.clock.setFixedTime(FIXED_TODAY);
    await page.reload();
    await workViewPage.waitForTaskList();

    // 1. Create the task and open its detail panel.
    await workViewPage.addTask(taskTitle);
    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });
    await taskPage.openTaskDetail(task);

    // 2. First save: startDate = May 4, 2026 (3 days from today; daily by default).
    await openRecurDialog(page);
    await setStartDate(page, '04/05/2026');
    await saveDialog(page);

    // After the first save the task moves out of TODAY (dueDay = May 4) and the
    // detail panel re-renders. Reopen the panel via the Inbox project view,
    // which lists tasks regardless of due day. The leave/enter animations need
    // a moment to settle.
    await page.goto('/#/project/INBOX_PROJECT/tasks');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
    const taskAfterFirstSave = page
      .locator('task')
      .filter({ hasText: taskTitle })
      .first();
    await expect(taskAfterFirstSave).toBeVisible({ timeout: 15000 });
    await taskPage.openTaskDetail(taskAfterFirstSave);

    // 3. Second save: change startDate to May 2, 2026 (1 day from today,
    //    still earlier than the previous value).
    await openRecurDialog(page);
    await setStartDate(page, '02/05/2026');
    await saveDialog(page);

    // 4. Verify in planner: task lands on May 2 ("2/5"), NOT on May 5 ("5/5").
    //    The planner header for each day uses the format DD/M (locale-aware).
    await page.goto('/#/planner');
    await page.waitForLoadState('networkidle');

    // The LIVE task instance lives in <planner-task>; subsequent days render
    // the same recurring task as <planner-repeat-projection> (faded preview).
    // The bug puts the live task on May 5; the fix puts it on May 2.
    const dayMay2 = page
      .locator('planner-day')
      .filter({ has: page.locator('.date', { hasText: /^2\/5$/ }) });
    await expect(
      dayMay2.locator('planner-task').filter({ hasText: taskTitle }),
    ).toHaveCount(1, { timeout: 15000 });

    const dayMay5 = page
      .locator('planner-day')
      .filter({ has: page.locator('.date', { hasText: /^5\/5$/ }) });
    await expect(
      dayMay5.locator('planner-task').filter({ hasText: taskTitle }),
    ).toHaveCount(0);
  });
});
