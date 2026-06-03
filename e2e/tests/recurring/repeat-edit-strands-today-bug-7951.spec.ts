import { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';

/**
 * Bug: https://github.com/super-productivity/super-productivity/issues/7951
 *
 * Editing a schedule-affecting field of a recurring task whose CURRENT day is
 * still a valid occurrence moved the live instance to the NEXT occurrence
 * (tomorrow) and advanced lastTaskCreationDay past today. The day-change repeat
 * processor then permanently skips today (today's effectiveLastDay already
 * points at tomorrow), so today's task simply vanishes — matching the issue's
 * screenshot where the current day is empty while future days are populated.
 *
 * Repro (today fixed to Tue 2026-06-16):
 *   1. Create task → make recurring (Daily, startDate defaults to today) → save.
 *      The live instance lands on today.
 *   2. Reopen the recur dialog → switch the quick setting Daily → Mon-Fri → save.
 * Tuesday is still a valid Mon-Fri occurrence, so the live instance MUST STAY on
 * today (16/6) — the bug moved it to Wednesday (17/6).
 *
 * - Pass (post-fix): the live <planner-task> is on 16/6, not 17/6.
 * - Fail (pre-fix): the live <planner-task> is on 17/6 and 16/6 is empty.
 *
 * Dates kept close to today so they fit the planner's default desktop window.
 */

const FIXED_TODAY = new Date('2026-06-16T09:00:00'); // Tuesday

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

const saveDialog = async (page: Page): Promise<void> => {
  const dialog = page.locator('mat-dialog-container');
  const saveBtn = dialog.getByRole('button', { name: /Save/i });
  await expect(saveBtn).toBeEnabled({ timeout: 5000 });
  await saveBtn.click();
  await dialog.waitFor({ state: 'hidden', timeout: 10000 });
};

// Switch the "Recurring Config" quick-setting select. The option labels come
// from en.json (Q_MONDAY_TO_FRIDAY = "Every Monday through Friday").
const setQuickSetting = async (page: Page, optionLabel: RegExp): Promise<void> => {
  const dialog = page.locator('mat-dialog-container');
  await dialog.locator('mat-select').first().click();
  const option = page.locator('mat-option').filter({ hasText: optionLabel });
  await expect(option).toBeVisible({ timeout: 5000 });
  await option.click();
};

test.describe('Recurring Task - Edit must not strand today (#7951)', () => {
  test('switching Daily -> Mon-Fri keeps the live instance on today', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const taskTitle = `${testPrefix}-EditStrands7951`;

    // Fix today to Tuesday, June 16 2026 so both Daily and Mon-Fri include today.
    await page.clock.setFixedTime(FIXED_TODAY);
    await page.reload();
    await workViewPage.waitForTaskList();

    // 1. Create the task and open its detail panel.
    await workViewPage.addTask(taskTitle);
    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });
    await taskPage.openTaskDetail(task);

    // 2. First save: default Daily. The live instance stays on today.
    await openRecurDialog(page);
    await saveDialog(page);

    // The detail panel stays open after saving the repeat config. Reopen the
    // recur dialog and switch the quick setting to Mon-Fri (a schedule-affecting
    // change that still includes today, a Tuesday).
    await openRecurDialog(page);
    await setQuickSetting(page, /Every Monday through Friday/i);
    await saveDialog(page);

    // 3. Verify in planner: the live task is on 16/6 (today), NOT 17/6 (tomorrow).
    //    The live instance renders as <planner-task>; future occurrences render
    //    as faded <planner-repeat-projection>.
    await page.goto('/#/planner');
    await page.waitForLoadState('networkidle');

    const dayToday = page
      .locator('planner-day')
      .filter({ has: page.locator('.date', { hasText: /^16\/6$/ }) });
    await expect(
      dayToday.locator('planner-task').filter({ hasText: taskTitle }),
    ).toHaveCount(1, { timeout: 15000 });

    const dayTomorrow = page
      .locator('planner-day')
      .filter({ has: page.locator('.date', { hasText: /^17\/6$/ }) });
    await expect(
      dayTomorrow.locator('planner-task').filter({ hasText: taskTitle }),
    ).toHaveCount(0);
  });
});
