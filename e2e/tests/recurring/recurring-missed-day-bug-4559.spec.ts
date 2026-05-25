import { expect, test } from '../../fixtures/test.fixture';

/**
 * Bug: https://github.com/super-productivity/super-productivity/issues/4559
 *
 * Reported in v13.0.10: when the user did NOT open Super Productivity on the
 * scheduled day of a recurring task (e.g. the 1st of the month falls on a
 * weekend, or Monday is a public holiday), no instance for the missed day
 * was created when the app was reopened later that week. The recurring task
 * became a "ghost" — invisible until the next on-day reopen.
 *
 * Expected: cold-starting the app on a day after a missed scheduled day must
 * create the missed instance and surface it to the user.
 *
 * Strategy: boot the app on Jun 1 2026, configure a "first of month"
 * recurring task and complete the Jun 1 instance, then jump straight to
 * Jul 3 — skipping Jul 1 entirely, as if the user was on holiday — and
 * cold-start. On reload the missed Jul 1 instance must be visible.
 *
 * The post-fix path: TaskDueEffects.createRepeatableTasksAndAddDueToday$
 * fires on the startWith emission of todayDateStr$, addAllDueToday() pulls
 * cfgs from selectAllUnprocessedTaskRepeatCfgs (which uses
 * getNewestPossibleDueDate to surface past-due scheduled dates), and
 * createRepeatableTask materialises the missed instance.
 *
 * Note: uses `setSystemTime` rather than `setFixedTime` so real-time
 * setTimeouts (notably the 1s debounceTime in the effect chain) keep
 * ticking after the second reload.
 */
test.describe('Recurring task - missed scheduled day (#4559)', () => {
  test('cold start after a missed first-of-month creates the missed instance', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const taskTitle = `${testPrefix}-MissedFirst4559`;

    // 1. Boot on Jun 1, 2026 — the 1st of the month.
    await page.clock.setSystemTime(new Date('2026-06-01T10:00:00'));
    await page.reload();
    await workViewPage.waitForTaskList();

    // 2. Add a task and open the repeat dialog.
    await workViewPage.addTask(taskTitle);
    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });

    await taskPage.openTaskDetail(task);
    const recurItem = page
      .locator('task-detail-item')
      .filter({ has: page.locator('mat-icon', { hasText: /^repeat$/ }) });
    await expect(recurItem).toBeVisible({ timeout: 5000 });
    await recurItem.click();

    // 3. Pick the "Every month on the first day" quick setting and save.
    //    The regex avoids "first Monday" (Q_MONTHLY_NTH_WEEKDAY) — only
    //    Q_MONTHLY_FIRST_DAY contains the literal "first day".
    const repeatDialog = page.locator('mat-dialog-container');
    await repeatDialog.waitFor({ state: 'visible', timeout: 10000 });

    const quickSettingSelect = repeatDialog.locator('mat-select').first();
    await quickSettingSelect.click();
    const firstDayOption = page.locator('mat-option').filter({ hasText: /first day/i });
    await expect(firstDayOption).toBeVisible({ timeout: 5000 });
    await firstDayOption.click();

    const saveBtn = repeatDialog.getByRole('button', { name: /Save/i });
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click();
    await repeatDialog.waitFor({ state: 'hidden', timeout: 10000 });
    await page.keyboard.press('Escape');

    // 4. Mark the Jun 1 instance done so the cfg's lastTaskCreationDay is
    //    pinned to 2026-06-01. Without this, the cfg's lastTaskCreationDay
    //    could already point at Jul 1 and we'd be testing a different path.
    const undoneJune = taskPage.getUndoneTasks().filter({ hasText: taskTitle }).first();
    await expect(undoneJune).toBeVisible({ timeout: 10000 });
    await taskPage.markTaskAsDone(undoneJune);
    await expect(
      taskPage.getDoneTasks().filter({ hasText: taskTitle }).first(),
    ).toBeVisible({ timeout: 5000 });

    // 5. Skip Jul 1 entirely — jump to Jul 3 and cold-start the app. This
    //    simulates "didn't open SP on the 1st of the month".
    await page.clock.setSystemTime(new Date('2026-07-03T10:00:00'));
    await page.reload();
    await workViewPage.waitForTaskList();

    // 6. ASSERTION (regression for #4559): a fresh undone instance for the
    //    missed Jul 1 must be visible. Pre-fix (v13.0.10) no instance was
    //    created and this assertion would time out.
    await expect(
      taskPage.getUndoneTasks().filter({ hasText: taskTitle }).first(),
    ).toBeVisible({ timeout: 30000 });
  });
});
