import { expect, test } from '../../fixtures/test.fixture';
import { type Locator, type Page } from '@playwright/test';
import {
  openRecurDialog,
  saveRecurDialog,
  setRecurQuickSetting,
} from '../../utils/recurring-task-helpers';

/**
 * Coming back to the app on a new day opens the sync window (2s without sync,
 * the sync's duration plus cooldown with it), and the store's `todayStr` only
 * follows the clock once that window closes. Saving a repeat config inside it,
 * so that its first occurrence is today, runs `addAllDueToday()` directly.
 *
 * Expected: the series gets today's copy; other tasks keep their reminders.
 * Bug:      `addAllDueToday()` picked today's timed tasks by the clock's day
 *           but judged "already in Today" by the store's stale day, so it
 *           planned them for today again, which erases `remindAt`.
 */

type Snapshot = {
  todayStr?: string;
  remindAt: number | null;
  dueWithTime: number | null;
  dueDay: string | null;
  openCopies: number;
};

type TaskLike = {
  id: string;
  title: string;
  isDone?: boolean;
  repeatCfgId?: string | null;
  remindAt?: number;
  dueWithTime?: number;
  dueDay?: string;
};
type State = {
  appState: { todayStr: string };
  tasks: { entities: Record<string, TaskLike | undefined> };
};
type StoreLike = {
  dispatch: (a: unknown) => void;
  subscribe: (fn: (s: State) => void) => { unsubscribe: () => void };
};

const readSnapshot = (
  page: Page,
  timedTitle: string,
  repeatTitle: string,
): Promise<Snapshot> =>
  page.evaluate(
    ({ timed, repeat }) => {
      const store = (window as unknown as { __e2eTestHelpers: { store: StoreLike } })
        .__e2eTestHelpers.store;
      let state: State | undefined;
      store.subscribe((s) => (state = s)).unsubscribe();
      const all = Object.values(state?.tasks.entities ?? {}).filter(
        (t): t is TaskLike => !!t,
      );
      const timedTask = all.find((t) => t.title.includes(timed));
      return {
        todayStr: state?.appState.todayStr,
        remindAt: timedTask?.remindAt ?? null,
        dueWithTime: timedTask?.dueWithTime ?? null,
        dueDay: timedTask?.dueDay ?? null,
        openCopies: all.filter(
          (t) => t.title.includes(repeat) && !t.isDone && !!t.repeatCfgId,
        ).length,
      };
    },
    { timed: timedTitle, repeat: repeatTitle },
  );

const scheduleWithReminder = (page: Page, title: string, due: number): Promise<void> =>
  page.evaluate(
    ({ taskTitle, dueWithTime }) => {
      const store = (window as unknown as { __e2eTestHelpers: { store: StoreLike } })
        .__e2eTestHelpers.store;
      let task: TaskLike | undefined;
      store
        .subscribe((s) => {
          task = Object.values(s.tasks.entities).find((t) =>
            t?.title.includes(taskTitle),
          );
        })
        .unsubscribe();
      if (!task) throw new Error('Timed task missing');
      store.dispatch({
        type: '[Task Shared] scheduleTaskWithTime',
        task,
        dueWithTime,
        remindAt: dueWithTime,
        isMoveToBacklog: false,
        meta: {
          isPersistent: true,
          entityType: 'TASK',
          entityId: task.id,
          opType: 'UPD',
        },
      });
    },
    { taskTitle: title, dueWithTime: due },
  );

/** Open the config from the Inbox's Recurring panel and flip "Paused". */
const togglePausedInDialog = async (page: Page, title: string): Promise<void> => {
  await page.locator('magic-side-nav').getByText('Inbox', { exact: true }).click();
  const preview = page.locator('repeat-cfg-preview').filter({ hasText: title });
  await expect(preview).toBeVisible({ timeout: 10000 });
  await preview.click();
  const dialog: Locator = page.locator(
    'mat-dialog-container:has(dialog-edit-task-repeat-cfg)',
  );
  await dialog.waitFor({ state: 'visible', timeout: 10000 });
  await dialog.locator('.collapsible-header', { hasText: 'Options' }).click();
  const paused = dialog.getByRole('checkbox', { name: 'Paused' });
  await expect(paused).toBeVisible({ timeout: 5000 });
  await paused.click();
};

const EVENING = new Date('2026-06-15T21:00:00');
const NEXT_MORNING = new Date('2026-06-16T07:00:00');
const REMINDER_AT = new Date('2026-06-16T08:00:00').getTime();

test.describe('Recurring task - resumed right after a day change', () => {
  test('keeps the reminders of other tasks due today', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const repeatTitle = `${testPrefix}-Daily`;
    const timedTitle = `${testPrefix}-Timed`;

    await page.clock.setSystemTime(EVENING);
    await page.reload();
    await workViewPage.waitForTaskList();

    // A paused daily series whose only copy is done.
    await workViewPage.addTask(repeatTitle);
    const repeatTask = taskPage.getTaskByText(repeatTitle).first();
    await expect(repeatTask).toBeVisible({ timeout: 10000 });
    await taskPage.openTaskDetail(repeatTask);
    await openRecurDialog(page);
    await setRecurQuickSetting(page, /Every day/i);
    await saveRecurDialog(page);
    await page.keyboard.press('Escape');
    await taskPage.markTaskAsDone(taskPage.getTaskByText(repeatTitle).first());
    await togglePausedInDialog(page, repeatTitle);
    await saveRecurDialog(page);

    // Another task with a reminder for tomorrow morning.
    await page.locator('magic-side-nav').getByText('Today', { exact: true }).click();
    await workViewPage.waitForTaskList();
    await workViewPage.addTask(timedTitle);
    await scheduleWithReminder(page, timedTitle, REMINDER_AT);
    await expect
      .poll(async () => (await readSnapshot(page, timedTitle, repeatTitle)).remindAt)
      .toBe(REMINDER_AT);

    // The user un-pauses the series but leaves the dialog open overnight.
    await togglePausedInDialog(page, repeatTitle);

    // Next morning the app comes back: the resume listener opens the sync
    // window, so the store keeps yesterday's date for a moment.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.clock.setSystemTime(NEXT_MORNING);
    await saveRecurDialog(page);
    // The save must have landed while the store was still on yesterday;
    // otherwise the test passes for the wrong reason.
    expect((await readSnapshot(page, timedTitle, repeatTitle)).todayStr).toBe(
      '2026-06-15',
    );

    // The series gets today's copy right away...
    await expect
      .poll(async () => (await readSnapshot(page, timedTitle, repeatTitle)).openCopies, {
        timeout: 15000,
      })
      .toBe(1);
    await expect
      .poll(async () => (await readSnapshot(page, timedTitle, repeatTitle)).todayStr, {
        timeout: 15000,
      })
      .toBe('2026-06-16');
    // ...and the other task is left as it was.
    expect(await readSnapshot(page, timedTitle, repeatTitle)).toEqual({
      todayStr: '2026-06-16',
      remindAt: REMINDER_AT,
      dueWithTime: REMINDER_AT,
      dueDay: null,
      openCopies: 1,
    });
  });
});
