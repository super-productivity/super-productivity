import { expect, test } from '../../fixtures/test.fixture';
import { type Page } from '@playwright/test';
import type { WorkViewPage } from '../../pages/work-view.page';
import type { TaskPage } from '../../pages/task.page';
import {
  openRecurDialog,
  openRecurScheduleDialog,
  saveRecurDialog,
} from '../../utils/recurring-task-helpers';

/**
 * skipOverdue ("Don't let overdue instances pile up") for a TIMED daily repeat,
 * end to end.
 *
 * Why this needs an e2e: the unit specs for TaskRepeatCleanupEffects mock the
 * effect's whole gating chain and hand-build the task objects, so nothing
 * asserts that an instance produced by the REAL creation path
 * (TaskRepeatCfgService -> scheduleTaskWithTime) is recognised as unmodified by
 * the reaper's template comparison. _hasTemplateSchedule reconstructs
 * getDateTimeFromClockString(cfg.startTime, dateStrToUtcDate(dueStr)) and
 * assumes it equals what creation produced; if either side drifts, both unit
 * suites stay green while skipOverdue silently stops working — which is exactly
 * the bug that shipped.
 *
 * Strategy mirrors repeat-timed-cold-reopen-day-change.spec.ts: a MOVING clock
 * via page.clock.setSystemTime (a frozen setFixedTime would wedge the create
 * effect's debounceTime(1000)), Day X and Day X+1 both booting at 09:00 so the
 * 13:00 instance is created scheduled-in-the-future.
 *
 * The reminder then really fires: page.clock does not reach into the reminder
 * Worker, so the worker compares the instance's remindAt against the REAL clock
 * and always finds the (fixed, long past) Day X reminder overdue. That gives
 * the tests the genuine reminder dialog to act on — snoozing rewrites remindAt,
 * starting the task clears it — which is precisely the app-managed drift that
 * used to make a timed instance unreapable forever.
 */

const DAY_X = '2026-06-15T09:00:00';
const DAY_X_PLUS_1 = '2026-06-16T09:05:00';
const START_TIME = '13:00';
const REMINDER_DIALOG = 'dialog-view-task-reminder';

interface RepeatInstances {
  /** Active (not done, not sub-task) instances of the repeat config. */
  count: number;
  /** Precondition: the Daily preset must have defaulted skipOverdue to ON. */
  skipOverdue: boolean | null;
  totalTimeSpent: number;
  /** remindAt of every active instance, to prove the reminder really drifted. */
  remindAts: (number | null)[];
  /** Local due day (YYYY-MM-DD) of every active instance. */
  dueDays: (string | null)[];
}

/** Read instance state straight from the NgRx store (see skip-overdue-default-8644). */
const readInstances = async (page: Page, title: string): Promise<RepeatInstances> =>
  page.evaluate((taskTitle: string) => {
    type TaskLike = {
      title?: string;
      isDone?: boolean;
      parentId?: string | null;
      repeatCfgId?: string | null;
      timeSpent?: number;
      remindAt?: number;
      dueWithTime?: number;
      dueDay?: string;
    };
    type CfgLike = { id?: string; title?: string | null; skipOverdue?: boolean };
    type StoreState = {
      tasks?: { entities?: Record<string, TaskLike | undefined> };
      taskRepeatCfg?: { entities?: Record<string, CfgLike | undefined> };
    };
    type StoreLike = {
      subscribe: (next: (s: StoreState) => void) => { unsubscribe: () => void };
    };
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) {
      throw new Error('__e2eTestHelpers.store missing');
    }
    let latest: StoreState | undefined;
    store
      .subscribe((s) => {
        latest = s;
      })
      .unsubscribe();

    const cfg = Object.values(latest?.taskRepeatCfg?.entities ?? {}).find((c) =>
      c?.title?.includes(taskTitle),
    );
    const instances = Object.values(latest?.tasks?.entities ?? {}).filter(
      (t): t is TaskLike =>
        !!t && !t.parentId && !t.isDone && !!cfg?.id && t.repeatCfgId === cfg.id,
    );
    return {
      count: instances.length,
      skipOverdue: cfg ? (cfg.skipOverdue ?? null) : null,
      totalTimeSpent: instances.reduce((acc, t) => acc + (t.timeSpent ?? 0), 0),
      remindAts: instances.map((t) => t.remindAt ?? null),
      dueDays: instances.map((t) => {
        if (typeof t.dueWithTime === 'number') {
          const d = new Date(t.dueWithTime);
          const pad = (n: number): string => `${n}`.padStart(2, '0');
          return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        }
        return t.dueDay ?? null;
      }),
    };
  }, title);

/**
 * Boot on Day X and create `title` as a TIMED daily repeat (13:00). Leaves the
 * Day X instance in place: scheduled, empty, and about to become overdue.
 */
const createTimedDailyRepeat = async (
  page: Page,
  workViewPage: WorkViewPage,
  taskPage: TaskPage,
  title: string,
): Promise<void> => {
  await page.clock.setSystemTime(new Date(DAY_X));
  await page.reload();
  await workViewPage.waitForTaskList();

  await workViewPage.addTask(title);
  const task = taskPage.getTaskByText(title).first();
  await expect(task).toBeVisible({ timeout: 10000 });

  await taskPage.openTaskDetail(task);
  await openRecurDialog(page);

  // Timed daily: setting a start time makes remindAt default to AtStart.
  const scheduleDialog = await openRecurScheduleDialog(page);
  const startTimeField = scheduleDialog.getByLabel('Time');
  await expect(startTimeField).toBeVisible({ timeout: 5000 });
  await startTimeField.fill(START_TIME);
  await startTimeField.blur();
  await scheduleDialog.locator('[data-test-id="schedule-submit-btn"]').click();
  await scheduleDialog.waitFor({ state: 'hidden', timeout: 5000 });

  // Save the (default DAILY) repeat config — skipOverdue defaults ON for it.
  await saveRecurDialog(page);
  await page.keyboard.press('Escape');

  await expect(taskPage.getUndoneTasks().filter({ hasText: title }).first()).toBeVisible({
    timeout: 10000,
  });
};

/** The reminder worker runs on the real clock, so the Day X reminder always fires. */
const waitForReminderDialog = async (page: Page): Promise<void> => {
  await page
    .locator(REMINDER_DIALOG)
    .first()
    .waitFor({ state: 'visible', timeout: 60000 });
};

test.describe('Recurring task - skipOverdue reaps a timed overdue instance', () => {
  test('deletes the empty Day X instance after a cold reopen on Day X+1', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const taskTitle = `${testPrefix}-SkipOverdueTimed`;
    await workViewPage.waitForTaskList();
    await createTimedDailyRepeat(page, workViewPage, taskPage, taskTitle);

    await expect
      .poll(async () => (await readInstances(page, taskTitle)).skipOverdue, {
        timeout: 10000,
      })
      .toBe(true);

    // Snooze the fired reminder: reScheduleTaskWithTime rewrites remindAt and
    // keeps dueWithTime, leaving the instance app-modified but user-untouched.
    await waitForReminderDialog(page);
    await page.locator(`${REMINDER_DIALOG} .split-btn-main`).first().click();
    await page
      .locator(REMINDER_DIALOG)
      .first()
      .waitFor({ state: 'hidden', timeout: 10000 });

    // The snooze must really have moved remindAt off the template value
    // (13:00 on Day X) — otherwise this test would pass with the pre-fix
    // comparison in place and prove nothing.
    const templateRemindAt = new Date(`${DAY_X.slice(0, 10)}T${START_TIME}:00`).getTime();
    await expect
      .poll(async () => (await readInstances(page, taskTitle)).remindAts, {
        timeout: 10000,
      })
      .not.toContain(templateRemindAt);

    // Let the ops flush to IndexedDB before the cold reopen.
    await page.waitForTimeout(1500);

    // Day X+1, cold reopen. Creation runs (1s debounce), then the reaper (3s).
    await page.clock.setSystemTime(new Date(DAY_X_PLUS_1));
    await page.reload();
    await workViewPage.waitForTaskList();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));

    // Day X+1's instance is created...
    await expect
      .poll(async () => (await readInstances(page, taskTitle)).dueDays, {
        timeout: 60000,
      })
      .toContain(DAY_X_PLUS_1.slice(0, 10));

    // ...and the snoozed-but-empty Day X instance is reaped, leaving only it.
    await expect
      .poll(async () => (await readInstances(page, taskTitle)).dueDays, {
        timeout: 30000,
      })
      .toEqual([DAY_X_PLUS_1.slice(0, 10)]);
  });

  test('keeps the Day X instance when time was tracked on it', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const taskTitle = `${testPrefix}-SkipOverdueTracked`;
    await workViewPage.waitForTaskList();
    await createTimedDailyRepeat(page, workViewPage, taskPage, taskTitle);

    // "Start" from the reminder dialog clears remindAt (dismissReminderOnly)
    // AND starts tracking — the same app-managed drift as above, but now on an
    // instance carrying real work.
    await waitForReminderDialog(page);
    await page
      .locator(REMINDER_DIALOG)
      .first()
      .getByRole('button', { name: /Start/i })
      .click();
    await page
      .locator(REMINDER_DIALOG)
      .first()
      .waitFor({ state: 'hidden', timeout: 10000 });

    await expect
      .poll(async () => (await readInstances(page, taskTitle)).totalTimeSpent, {
        timeout: 30000,
      })
      .toBeGreaterThan(0);

    // Stop the tracker. Tracked time lives in an in-memory accumulator that is
    // only committed on a 5-minute interval or when the current task changes,
    // so without this the time never reaches the store and the reload starts
    // from zero.
    await page.locator('play-button .play-btn').first().click();
    await page.waitForTimeout(1500);

    await page.clock.setSystemTime(new Date(DAY_X_PLUS_1));
    await page.reload();
    await workViewPage.waitForTaskList();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));

    // Precondition for the assertion below: the tracked time survived the reload.
    await expect
      .poll(async () => (await readInstances(page, taskTitle)).totalTimeSpent, {
        timeout: 30000,
      })
      .toBeGreaterThan(0);

    // Both instances must be present: Day X+1's new one and the tracked Day X one.
    await expect
      .poll(async () => (await readInstances(page, taskTitle)).count, { timeout: 60000 })
      .toBe(2);

    // Hold past the reaper's 3s debounce. The sibling test proves the reaper
    // fires under this exact timing, so this is not a vacuous pass.
    await page.waitForTimeout(8000);
    expect((await readInstances(page, taskTitle)).count).toBe(2);
  });
});
