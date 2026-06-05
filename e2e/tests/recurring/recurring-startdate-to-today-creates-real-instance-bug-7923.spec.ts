import { expect, test } from '../../fixtures/test.fixture';
import {
  gotoHashRoute,
  openRecurDialog,
  openRecurDialogFromProjection,
  saveRecurDialog,
  setRecurStartDate,
} from '../../utils/recurring-task-helpers';

/**
 * Bug: https://github.com/super-productivity/super-productivity/issues/7923
 *
 * When the user:
 *   1. Creates a recurring (daily) task with a future startDate
 *   2. Deletes the materialised live instance (plain delete — does NOT touch
 *      deletedInstanceDates or lastTaskCreationDay)
 *   3. Opens the repeat config from a transparent projection and moves
 *      startDate to TODAY
 *
 * Expected: a real (non-transparent) task instance is created for today and
 *           added to the Today work-view.
 * Bug:      today keeps showing only a transparent projection; no real task
 *           is created.
 *
 * Root cause: `rescheduleTaskOnRepeatCfgUpdate$` correctly re-anchors
 * `lastTaskCreationDay` to yesterday and calls `addAllDueToday()` (#7768 Bug 2
 * fix), but `addAllDueToday()` fails to materialise today's instance — the
 * downstream real-creation path was not exercised by existing unit tests
 * (which mock `addAllDueToday`).
 */

// Fix the clock so calendar interactions and date arithmetic are deterministic.
// May 1, 2026 is mid-month, so the future offset (+9 days → May 10) stays inside
// the same month, keeping the date-picker entry simple. The repeat is DAILY, so
// the weekday is irrelevant.
const FIXED_TODAY = new Date('2026-05-01T10:00:00');
const FIXED_TODAY_DDMMYYYY = '01/05/2026';
const FIXED_TODAY_DATA_DAY = '2026-05-01'; // planner-day[data-day] form of FIXED_TODAY
const FUTURE_START_DDMMYYYY = '10/05/2026'; // today + 9 days

test.describe('Recurring Task - Move startDate to Today Creates Real Instance (#7923)', () => {
  test('moving startDate to today with no live instance creates a real task in Today, not a projection', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const taskTitle = `${testPrefix}-StartDateToday7923`;

    // Fix today to May 1, 2026 so date arithmetic is deterministic.
    await page.clock.setFixedTime(FIXED_TODAY);
    await page.reload();
    await workViewPage.waitForTaskList();

    // 1. Create the task and make it recurring (daily) starting May 10 (9 days
    //    in the future). This materialises a live instance for May 10.
    await workViewPage.addTask(taskTitle);
    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });
    await taskPage.openTaskDetail(task);
    await openRecurDialog(page);
    await setRecurStartDate(page, FUTURE_START_DDMMYYYY);
    await saveRecurDialog(page);

    // 2. Delete the live (non-transparent) May 10 instance. The delete is a
    //    plain delete — it does NOT touch lastTaskCreationDay or
    //    deletedInstanceDates (per the maintainer's note in #7923).
    const taskRows = page.locator('task').filter({ hasText: taskTitle });
    await gotoHashRoute(page, '/#/project/INBOX_PROJECT/tasks', taskRows.first());
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

    // 3. Open the planner. The task now appears only as transparent projections
    //    (starting May 10, since lastTaskCreationDay = May 10 suppresses earlier
    //    days). Open the projection for May 11 and change startDate to today
    //    (May 1) — the exact scenario from issue #7923.
    await gotoHashRoute(
      page,
      '/#/planner',
      page.locator('planner-repeat-projection').filter({ hasText: taskTitle }).first(),
    );
    await openRecurDialogFromProjection(page, taskTitle);
    await setRecurStartDate(page, FIXED_TODAY_DDMMYYYY); // Move startDate → today
    await saveRecurDialog(page);

    // 4. Navigate to the Today work-view and verify a REAL task was created.
    //    After the fix, rescheduleTaskOnRepeatCfgUpdate$ re-anchors
    //    lastTaskCreationDay to yesterday and addAllDueToday() materialises
    //    the task for May 1. The task must appear in the Today list as a real
    //    task element, NOT as a planner-repeat-projection.
    await gotoHashRoute(
      page,
      '/#/tag/TODAY/tasks',
      page.locator('task').filter({ hasText: taskTitle }).first(),
    );
    const realTaskInToday = page.locator('task').filter({ hasText: taskTitle }).first();
    await expect(realTaskInToday).toBeVisible({ timeout: 15000 });

    // Guard: there must be NO transparent projection for today in the planner.
    // A projection means addAllDueToday() did not materialise the real instance.
    await gotoHashRoute(page, '/#/planner', page.locator('planner-day').first());
    // Match today by the stable data-day attribute rather than the rendered date
    // text: during the route-enter animation the leaving and entering columns are
    // briefly both in the DOM, so a text filter resolves to 2 elements. Asserting
    // the projection count across every matching column (toHaveCount(0)) is correct
    // regardless of how many copies the animation leaves behind.
    const todayColumns = page.locator(`planner-day[data-day="${FIXED_TODAY_DATA_DAY}"]`);
    await expect(todayColumns.first()).toBeVisible({ timeout: 10000 });
    await expect(
      todayColumns.locator('planner-repeat-projection').filter({ hasText: taskTitle }),
    ).toHaveCount(0, { timeout: 5000 });
  });
});
