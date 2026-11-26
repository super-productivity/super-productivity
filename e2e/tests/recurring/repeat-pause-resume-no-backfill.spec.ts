import { expect, test } from '../../fixtures/test.fixture';
import { type Locator, type Page } from '@playwright/test';
import {
  openRecurDialog,
  saveRecurDialog,
  setRecurQuickSetting,
} from '../../utils/recurring-task-helpers';

/**
 * Pause in the repeat dialog (#3589): a paused series creates nothing, and
 * resuming never adds the dates that passed while it was paused. Before the
 * fix, the first app start after resuming created the newest missed date
 * (e.g. last Monday's copy of a weekly task) as an overdue copy.
 *
 * Moving clock + cold reopen per day, as in repeat-after-completion-weeks-5388.
 */

const openCopyDueDays = async (page: Page, title: string): Promise<string[]> =>
  page.evaluate((taskTitle: string) => {
    type TaskLike = {
      isDone?: boolean;
      parentId?: string | null;
      repeatCfgId?: string | null;
      dueDay?: string;
    };
    type CfgLike = { id?: string; title?: string | null };
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
    return Object.values(latest?.tasks?.entities ?? {})
      .filter(
        (t): t is TaskLike =>
          !!t && !t.parentId && !t.isDone && !!cfg?.id && t.repeatCfgId === cfg.id,
      )
      .map((t) => t.dueDay ?? '')
      .sort();
  }, title);

const reopenOn = async (
  page: Page,
  isoDateTime: string,
  waitForTaskList: () => Promise<void>,
): Promise<void> => {
  await page.clock.setSystemTime(new Date(isoDateTime));
  await page.reload();
  await waitForTaskList();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
};

/** Open the config from the Inbox's Recurring panel (its copy may be done). */
const openRecurDialogFromInbox = async (page: Page, title: string): Promise<Locator> => {
  await page.locator('magic-side-nav').getByText('Inbox', { exact: true }).click();
  const preview = page.locator('repeat-cfg-preview').filter({ hasText: title });
  await expect(preview).toBeVisible({ timeout: 10000 });
  await preview.click();
  const dialog = page.locator('mat-dialog-container:has(dialog-edit-task-repeat-cfg)');
  await dialog.waitFor({ state: 'visible', timeout: 10000 });
  return dialog;
};

const setPaused = async (page: Page, title: string, isPaused: boolean): Promise<void> => {
  const dialog = await openRecurDialogFromInbox(page, title);
  await dialog.locator('.collapsible-header', { hasText: 'Options' }).click();
  const paused = dialog.getByRole('checkbox', { name: 'Paused' });
  await expect(paused).toBeVisible({ timeout: 5000 });
  if ((await paused.isChecked()) !== isPaused) {
    await paused.click();
  }
  await saveRecurDialog(page);
};

/** Day 0 (Mon 2026-06-15): a weekly Monday task whose first copy is done. */
const createDoneWeeklyMondayTask = async (
  page: Page,
  title: string,
  workViewPage: {
    waitForTaskList: () => Promise<void>;
    addTask: (t: string) => Promise<void>;
  },
  taskPage: {
    getTaskByText: (t: string) => Locator;
    openTaskDetail: (t: Locator) => Promise<void>;
    markTaskAsDone: (t: Locator) => Promise<void>;
  },
): Promise<void> => {
  await page.clock.setSystemTime(new Date('2026-06-15T09:00:00'));
  await page.reload();
  await workViewPage.waitForTaskList();
  await workViewPage.addTask(title);
  const task = taskPage.getTaskByText(title).first();
  await expect(task).toBeVisible({ timeout: 10000 });
  await taskPage.openTaskDetail(task);
  await openRecurDialog(page);
  await setRecurQuickSetting(page, /Every week on Monday/i);
  await saveRecurDialog(page);
  await page.keyboard.press('Escape');
  await taskPage.markTaskAsDone(taskPage.getTaskByText(title).first());
  await expect.poll(() => openCopyDueDays(page, title)).toEqual([]);
};

test.describe('Recurring task - pause and resume (#3589)', () => {
  test('creates nothing while paused and does not add missed dates on resume', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const title = `${testPrefix}-PauseResume`;
    const waitForTaskList = (): Promise<void> => workViewPage.waitForTaskList();
    await createDoneWeeklyMondayTask(page, title, workViewPage, taskPage);

    await setPaused(page, title, true);
    // Let the op flush to IndexedDB before the cold reopen.
    await page.waitForTimeout(1500);

    // Thu 2026-07-02: two Mondays passed while paused, nothing was created.
    await reopenOn(page, '2026-07-02T09:00:00', waitForTaskList);
    // Asserting that nothing gets created needs elapsed time for the debounced
    // creation effect.
    await page.waitForTimeout(4000);
    expect(await openCopyDueDays(page, title)).toEqual([]);

    // Resume on a day without an occurrence: Mon 2026-06-29 is not backfilled,
    // neither now nor after the next app start.
    await setPaused(page, title, false);
    await page.waitForTimeout(1500);
    await reopenOn(page, '2026-07-02T09:30:00', waitForTaskList);
    await page.waitForTimeout(4000);
    expect(await openCopyDueDays(page, title)).toEqual([]);

    // The series continues on the next Monday.
    await reopenOn(page, '2026-07-06T09:00:00', waitForTaskList);
    await expect
      .poll(() => openCopyDueDays(page, title), { timeout: 60000 })
      .toEqual(['2026-07-06']);
  });

  test('resuming on a scheduled day adds that day’s copy right away', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const title = `${testPrefix}-ResumeToday`;
    const waitForTaskList = (): Promise<void> => workViewPage.waitForTaskList();
    await createDoneWeeklyMondayTask(page, title, workViewPage, taskPage);

    await setPaused(page, title, true);
    await page.waitForTimeout(1500);

    // Mon 2026-06-29: paused, so today's copy is not created...
    await reopenOn(page, '2026-06-29T09:00:00', waitForTaskList);
    await page.waitForTimeout(4000);
    expect(await openCopyDueDays(page, title)).toEqual([]);

    // ...until the user resumes, without waiting for the next day change.
    await setPaused(page, title, false);
    await expect
      .poll(() => openCopyDueDays(page, title), { timeout: 15000 })
      .toEqual(['2026-06-29']);
  });
});
