import { expect, test } from '../../fixtures/test.fixture';
import { openRecurDialog, saveRecurDialog } from '../../utils/recurring-task-helpers';

/**
 * Bug: https://github.com/super-productivity/super-productivity/issues/6230
 *
 * Repeat tasks don't appear in Today after a day change without restarting
 * the app. The app creates repeat task instances only when `todayDateStr$`
 * emits a new date (once per day via `distinctUntilChanged()`). If this
 * mechanism fails, tasks never appear until restart.
 *
 * Strategy: Use `page.clock.setSystemTime()` so the wall clock keeps ticking
 * forward on real time. This is load-bearing: RxJS time-based operators
 * (debounceTime, interval) read `Date.now()` via their scheduler, so a *frozen*
 * clock (`setFixedTime`) permanently wedges the effect's `debounceTime(1000)` —
 * `now` never reaches `lastTime + dueTime` — and `addAllDueToday()` never runs.
 * With `setSystemTime` the clock advances, the day-change is detected, and the
 * effect fires exactly as it does in production. (Same trap and fix as #4559.)
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

    // 1. Set clock to 23:55 on Day X and reload so the app boots with our clock.
    //    setSystemTime (not setFixedTime) so Date.now() keeps advancing — the
    //    effect chain's debounceTime relies on a moving clock.
    await page.clock.setSystemTime(new Date('2026-06-15T23:55:00'));
    await page.reload();
    await workViewPage.waitForTaskList();

    // 2. Create a task and configure it as daily repeat
    await workViewPage.addTask(taskTitle);
    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });

    // 3. Open task detail and click the repeat/recurrence icon
    await taskPage.openTaskDetail(task);
    // 4. Save the repeat dialog with default settings (DAILY)
    await openRecurDialog(page);
    await saveRecurDialog(page);

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

    // 7. Advance clock past midnight to Day X+1. With setSystemTime the clock
    //    keeps ticking from here, so the 1s `interval` (timerBased$) samples the
    //    new day and the effect's debounceTime(1000) settles normally.
    await page.clock.setSystemTime(new Date('2026-06-16T00:05:00'));

    // Also dispatch a focus event to exercise focusBased$ (debounced 100ms) for a
    // faster, deterministic trigger alongside the 1s interval tick.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));

    // 8. Assert: a new undone task with the same title should appear once the
    //    date-change mechanism detects the new day and creates a fresh instance.
    //    60s timeout accounts for debounce + sync on saturated CI runners where
    //    the 1s tick can lag substantially.
    await expect(
      taskPage.getUndoneTasks().filter({ hasText: taskTitle }).first(),
    ).toBeVisible({ timeout: 60000 });

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
