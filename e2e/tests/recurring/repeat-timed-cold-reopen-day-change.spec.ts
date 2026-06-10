import { expect, test } from '../../fixtures/test.fixture';

/**
 * Regression guard: a TIMED daily repeat task must get its new-day instance
 * created after a COLD REOPEN across a day boundary.
 *
 * Context: investigated under https://github.com/super-productivity/super-productivity/issues/7951
 * — a user reported that, with sync off, a timed daily task's instance was not
 * created after closing the app, advancing the OS clock a day, and reopening.
 * It did NOT reproduce in web (this test passes), so the reporter's bug is
 * likely Electron- or config-specific (e.g. a custom "start of next day"). This
 * test locks in that the plain web cold-reopen creation path keeps working, and
 * complements:
 *   - repeat-task-day-change-bug-6230.spec.ts (UNTIMED, app stays open across midnight)
 *   - repeat-edit-strands-today-bug-7951.spec.ts (the EDIT path, #7955)
 *
 * Strategy: mirror #6230 — page.clock.setSystemTime gives a MOVING clock (a
 * frozen setFixedTime would wedge the create effect's debounceTime(1000)). Both
 * days boot at 09:00, before the 13:00 start time, so a correctly-created
 * instance is scheduled in the future and stays in Today.
 */
test.describe('Repeat Task - Timed + Cold Reopen Day Change', () => {
  test('creates the new-day instance of a timed daily repeat task after a cold reopen', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const taskTitle = `${testPrefix}-TimedDailyColdReopen`;

    // 1. Boot on Day X at 09:00 (before the 13:00 start time) with a moving clock.
    await page.clock.setSystemTime(new Date('2026-06-15T09:00:00'));
    await page.reload();
    await workViewPage.waitForTaskList();

    // 2. Create the task.
    await workViewPage.addTask(taskTitle);
    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });

    // 3. Open task detail → open the repeat/recurrence dialog.
    await taskPage.openTaskDetail(task);
    const recurItem = page
      .locator('task-detail-item')
      .filter({ has: page.locator('mat-icon', { hasText: /^repeat$/ }) });
    await expect(recurItem).toBeVisible({ timeout: 5000 });
    await recurItem.click();

    const repeatDialog = page.locator('mat-dialog-container').first();
    await repeatDialog.waitFor({ state: 'visible', timeout: 10000 });

    // 4. Make it a TIMED daily repeat: Open schedule dialog and set a start time (13:00).
    //    remindAt defaults to AtStart once startTime is set, so the config is timed.
    const scheduleBtn = repeatDialog.locator('.planned-start-date-btn');
    await expect(scheduleBtn).toBeVisible({ timeout: 5000 });
    await scheduleBtn.click();

    // Wait for the schedule dialog to appear
    const scheduleDialog = page
      .locator('mat-dialog-container')
      .filter({ has: page.locator('datetime-picker') });
    await scheduleDialog.waitFor({ state: 'visible', timeout: 5000 });

    // Set a valid startTime
    const startTimeField = scheduleDialog.getByLabel('Time');
    await expect(startTimeField).toBeVisible({ timeout: 5000 });
    await startTimeField.fill('13:00');
    await startTimeField.blur();

    // Click Schedule button
    const scheduleSubmitBtn = scheduleDialog.locator(
      '[data-test-id="schedule-submit-btn"]',
    );
    await scheduleSubmitBtn.click();
    await scheduleDialog.waitFor({ state: 'hidden', timeout: 5000 });

    // 5. Save the (default DAILY) repeat config.
    const saveBtn = repeatDialog.getByRole('button', { name: /Save/i });
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click();
    await repeatDialog.waitFor({ state: 'hidden', timeout: 10000 });
    await page.keyboard.press('Escape');

    // 6. Day X instance exists in Today (scheduled 13:00, still in the future).
    const undoneWithTitle = taskPage.getUndoneTasks().filter({ hasText: taskTitle });
    await expect(undoneWithTitle.first()).toBeVisible({ timeout: 10000 });

    // 7. Mark Day X instance done.
    await taskPage.markTaskAsDone(undoneWithTitle.first());
    await expect(
      taskPage.getDoneTasks().filter({ hasText: taskTitle }).first(),
    ).toBeVisible({ timeout: 5000 });
    await expect(undoneWithTitle).toHaveCount(0, { timeout: 10000 });

    // Let the op flush to IndexedDB before the cold reopen.
    await page.waitForTimeout(1500);

    // 8. Advance the clock to Day X+1 (still 09:00, before start time) and COLD
    //    REOPEN via reload — the reporter's close-then-reopen-next-day.
    await page.clock.setSystemTime(new Date('2026-06-16T09:05:00'));
    await page.reload();
    await workViewPage.waitForTaskList();

    // Nudge the day-change detector (focusBased$, debounced 100ms) alongside the
    // 1s interval tick, mirroring #6230.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));

    // 9. A fresh undone instance for Day X+1 must appear in Today.
    await expect(
      taskPage.getUndoneTasks().filter({ hasText: taskTitle }).first(),
    ).toBeVisible({ timeout: 60000 });
  });
});
