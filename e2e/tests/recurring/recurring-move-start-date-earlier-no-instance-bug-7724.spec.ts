import { expect, test } from '../../fixtures/test.fixture';
import {
  gotoHashRoute,
  openRecurDialog,
  openRecurDialogFromProjection,
  saveRecurDialog,
  setRecurStartDate,
} from '../../utils/recurring-task-helpers';

/**
 * Bug: https://github.com/super-productivity/super-productivity/issues/7724
 *
 * Sibling of #7423. A recurring config carries `lastTaskCreationDay` — a
 * watermark that the planner's projection logic treats as a hard lower bound:
 * days at or before it are never projected/created.
 *
 * `rescheduleTaskOnRepeatCfgUpdate$` re-anchors that watermark when the user
 * moves `startDate` earlier — but it used to bail out early when no live task
 * instance existed, so the re-anchoring never ran. Result: after the user
 * DELETES the materialised instance and then moves `startDate` earlier, the
 * stale watermark keeps suppressing every day between the new `startDate` and
 * the old watermark.
 *
 * Repro from the issue (today fixed to 2026-05-01):
 *   1. Create task → make recurring (daily) → startDate = 2026-05-04 → save
 *   2. Delete the live (non-transparent) instance
 *   3. Open the repeat config from a transparent projection → startDate =
 *      2026-05-02 → save
 * Expected post-fix: the task projects onto May 2, 3 and 4.
 * Bug:               May 2, 3 and 4 stay empty; projections resume on May 5.
 *
 * Dates kept close to today so they fit inside the planner's default 15-day
 * desktop window without horizontal scrolling.
 */

const FIXED_TODAY = new Date('2026-05-01T10:00:00');

test.describe('Recurring Task - Move Start Date Earlier With No Live Instance (#7724)', () => {
  test('moving startDate earlier still projects the new days after the instance is deleted', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const taskTitle = `${testPrefix}-MoveStartEarlierNoInstance7724`;

    // Fix today to Friday, May 1, 2026 so calendar interactions are deterministic.
    await page.clock.setFixedTime(FIXED_TODAY);
    await page.reload();
    await workViewPage.waitForTaskList();

    // 1. Create the task and make it recurring (daily) starting May 4, 2026.
    await workViewPage.addTask(taskTitle);
    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });
    await taskPage.openTaskDetail(task);
    await openRecurDialog(page);
    await setRecurStartDate(page, '04/05/2026');
    await saveRecurDialog(page);

    // 2. Delete the live (non-transparent) instance. After the first save the
    //    task has dueDay = May 4; the Inbox project view lists it regardless of
    //    due day. A plain task delete does NOT touch the repeat config's
    //    lastTaskCreationDay or deletedInstanceDates.
    const taskRows = page.locator('task').filter({ hasText: taskTitle });
    await gotoHashRoute(page, '/#/project/INBOX_PROJECT/tasks', taskRows.first());
    // The task list can still be settling (entry animation / re-render) right
    // after navigation, so a single right-click occasionally races the
    // "stable" check. Retry opening the context menu with a short per-attempt
    // timeout until it appears.
    const contextMenu = page.locator('.mat-mdc-menu-content');
    await expect(async () => {
      await taskRows.first().click({ button: 'right', timeout: 4000 });
      await expect(contextMenu).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20000 });
    await contextMenu.locator('button.color-warn').click();
    const confirmBtn = page.locator('[e2e="confirmBtn"]');
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();
    await expect(taskRows).toHaveCount(0, { timeout: 10000 });

    // 3. Re-open the repeat config from a transparent projection and move
    //    startDate to May 2 — earlier than the stale anchor (May 4).
    await gotoHashRoute(
      page,
      '/#/planner',
      page.locator('planner-repeat-projection').filter({ hasText: taskTitle }).first(),
    );
    await openRecurDialogFromProjection(page, taskTitle);
    await setRecurStartDate(page, '02/05/2026');
    await saveRecurDialog(page);

    // 4. Verify: the task now projects onto May 2, 3 and 4 — the days the stale
    //    anchor used to suppress. May 5 is the control (it projected pre-fix
    //    too). No live instance was recreated, so every day is a projection.
    await gotoHashRoute(page, '/#/planner', page.locator('planner-day').first());

    for (const date of [/^2\/5$/, /^3\/5$/, /^4\/5$/, /^5\/5$/]) {
      const day = page
        .locator('planner-day')
        .filter({ has: page.locator('.date', { hasText: date }) });
      await expect(
        day.locator('planner-repeat-projection').filter({ hasText: taskTitle }),
      ).toHaveCount(1, { timeout: 15000 });
    }
  });
});
