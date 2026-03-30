import { expect, test } from '../../fixtures/test.fixture';

/**
 * Bug: https://github.com/super-productivity/super-productivity/issues/6230
 *
 * Repeat tasks don't appear in Today after a day change without restarting
 * the app. The app creates repeat task instances only when `todayDateStr$`
 * emits a new date (once per day via `distinctUntilChanged()`). If this
 * mechanism fails, tasks never appear until restart.
 *
 * Strategy: Use `page.clock.setFixedTime()` to override `Date.now()` while
 * keeping real timers (zone.js, RxJS interval, NgRx effects) running.
 * Set time to 23:55, create a daily repeat task, mark it done, then advance
 * the clock past midnight and wait for the new instance to appear.
 *
 * - Pass: the day-change trigger works and a new undone task appears.
 * - Fail/timeout: suggests a regression in the day-change mechanism.
 */
test.describe('Repeat Task - Day Change (#6230)', () => {
  test('should create new repeat task instance after midnight without restart', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const taskTitle = `${testPrefix}-DailyRepeat6230`;

    // 1. Set clock to 23:55 on Day X and reload so the app boots with our clock
    await page.clock.setFixedTime(new Date('2026-06-15T23:55:00'));
    await page.reload();
    await workViewPage.waitForTaskList();

    // 2. Create a task and configure it as daily repeat
    await workViewPage.addTask(taskTitle);
    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });

    // 3. Open task detail and click the repeat/recurrence icon
    await taskPage.openTaskDetail(task);
    const recurItem = page
      .locator('task-detail-item')
      .filter({ has: page.locator('mat-icon[svgIcon="repeat"]') });
    await expect(recurItem).toBeVisible({ timeout: 5000 });
    await recurItem.click();

    // 4. Save the repeat dialog with default settings (DAILY)
    const repeatDialog = page.locator('mat-dialog-container');
    await repeatDialog.waitFor({ state: 'visible', timeout: 10000 });
    const saveBtn = repeatDialog.getByRole('button', { name: /Save/i });
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click();
    await repeatDialog.waitFor({ state: 'hidden', timeout: 10000 });

    // Close the task detail panel
    await page.keyboard.press('Escape');

    // 5. Verify the task instance for Day X exists in Today
    await expect(
      taskPage.getUndoneTasks().filter({ hasText: taskTitle }).first(),
    ).toBeVisible({
      timeout: 10000,
    });

    // 6. Mark the task as done and verify it's in the done list
    const undoneTask = taskPage.getUndoneTasks().filter({ hasText: taskTitle }).first();
    await taskPage.markTaskAsDone(undoneTask);
    await expect(
      taskPage.getDoneTasks().filter({ hasText: taskTitle }).first(),
    ).toBeVisible({ timeout: 5000 });

    // 7. Advance clock past midnight to Day X+1
    await page.clock.setFixedTime(new Date('2026-06-16T00:05:00'));

    // 8. Assert: a new undone task with the same title should appear
    //    The app's date-change mechanism should detect the new day and create
    //    a fresh repeat task instance. 30s timeout accounts for debounce + sync.
    await expect(
      taskPage.getUndoneTasks().filter({ hasText: taskTitle }).first(),
    ).toBeVisible({ timeout: 30000 });

    console.log('[Bug #6230] New repeat task instance appeared after day change');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // COMMENTED OUT: Tests A and B below require __e2eTestHelpers (NgRx store +
  // HydrationStateService exposed on window in dev mode). That code is also
  // commented out in src/main.ts. Uncomment both if investigating #6230 further.
  //
  // Test A: Confirmed the intra-day gap — after resetting a repeat config's
  // lastTaskCreationDay via the store, no mechanism re-creates the task within
  // the same day. This is a negative assertion (passes because the gap exists).
  // If a periodic re-check is added, flip to expect(task).toBeVisible().
  //
  // Test B: Confirmed waitForSyncWindow correctly buffers a day-change emission
  // during sync and replays it after sync ends. Positive assertion — passes.
  //
  // Both tests passed as of 2026-03-25. See git history for full implementations.
  // ──────────────────────────────────────────────────────────────────────────

  // test('should NOT create repeat task mid-day when config is reset (confirms gap)', ...)
  // test('should buffer day-change during sync and create task after sync ends', ...)
});
