import { expect, test } from '../../fixtures/test.fixture';
import {
  closeDetailPanelIfOpen,
  openTaskDetailPanel,
} from '../../utils/schedule-task-helper';
import { fillTimeInput } from '../../utils/time-input-helper';

/**
 * Regression guard for https://github.com/super-productivity/super-productivity/issues/8120
 *
 * A timed task scheduled for a FUTURE day with an armed reminder must KEEP its
 * reminder (remindAt) when the day-rollover pulls it into Today via the automatic
 * addAllDueToday path. Before the fix, handlePlanTasksForToday ignored the
 * isSkipRemoveReminder flag that path passes and unconditionally cleared remindAt,
 * so a future-day reminder was silently wiped at the rollover — before it could
 * ever fire, on every platform (the reporter saw it fail on both iOS and desktop).
 *
 * User-visible proxy: the task-row icon. `alarm` = reminder armed; without it the
 * row falls back to the plain scheduled-time icon (no reminder). This is exactly
 * the alarm-vs-clock signal used to triage the issue.
 *
 * Clock note: page.clock fakes time in the PAGE context, so DateService /
 * addAllDueToday correctly see the simulated day — but it does NOT reach the
 * reminder web worker (separate thread, real clock). We therefore assert the
 * surviving reminder via the row icon (data), not by waiting for the worker to fire.
 */
test.describe('Reminders - future-day reminder survives rollover (#8120)', () => {
  test('keeps the reminder when a future-day timed task is pulled into Today', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    test.setTimeout(90000);

    const taskTitle = `${testPrefix}-FutureReminder`;

    // 1. Boot on Day X (the 15th) at 09:00 with a moving clock.
    await page.clock.setSystemTime(new Date('2026-06-15T09:00:00'));
    await page.reload();
    await workViewPage.waitForTaskList();

    // 2. Create the task.
    await workViewPage.addTask(taskTitle);
    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });

    // 3. Open the schedule dialog via the detail panel.
    await openTaskDetailPanel(page, task);
    const scheduleItem = page
      .locator(
        'task-detail-item:has(mat-icon:text("alarm")), ' +
          'task-detail-item:has(mat-icon:text("today")), ' +
          'task-detail-item:has(mat-icon:text("schedule"))',
      )
      .first();
    await scheduleItem.waitFor({ state: 'visible', timeout: 5000 });
    await scheduleItem.click();

    const dialog = page.locator('mat-dialog-container').first();
    await dialog.waitFor({ state: 'visible', timeout: 10000 });

    // 4. Pick TOMORROW (Day X+1 = the 16th) on the calendar, then set 13:00.
    //    Setting a time arms the reminder (defaults to AtStart).
    await dialog.locator('mat-calendar').getByText('16', { exact: true }).click();
    await fillTimeInput(page, new Date('2026-06-16T13:00:00'));

    // 5. Submit the schedule.
    await dialog.locator('[data-test-id="schedule-submit-btn"]').click();
    await dialog.waitFor({ state: 'hidden', timeout: 10000 });
    await closeDetailPanelIfOpen(page);

    // Let the op flush to IndexedDB before the cold reopen.
    await page.waitForTimeout(1500);

    // 6. Advance to Day X+1 at 09:00 (before the 13:00 reminder) and COLD REOPEN.
    await page.clock.setSystemTime(new Date('2026-06-16T09:00:00'));
    await page.reload();
    await workViewPage.waitForTaskList();
    // Nudge the day-change / due-today detector (focusBased$, debounced).
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));

    // 7. The task is pulled into Today. Its row must still show the ALARM icon —
    //    i.e. remindAt survived. Pre-fix it was wiped (no alarm) = the bug.
    const todayTask = taskPage.getTaskByText(taskTitle).first();
    await expect(todayTask).toBeVisible({ timeout: 60000 });
    await expect(todayTask.locator('mat-icon', { hasText: /^alarm$/ })).toBeVisible({
      timeout: 10000,
    });
  });
});
