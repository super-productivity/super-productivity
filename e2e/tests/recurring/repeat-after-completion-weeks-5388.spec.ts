import { expect, test } from '../../fixtures/test.fixture';
import { type Page } from '@playwright/test';
import {
  openRecurDialog,
  saveRecurDialog,
  setRecurQuickSetting,
} from '../../utils/recurring-task-helpers';

/**
 * #5388: "After I complete it…" in the repeat dialog. "Every 2 weeks after I
 * complete it" needs no weekday, is stored as 14 days (a weekly cycle without a
 * weekday never fires on any client), and waits for completion, so there is
 * only ever one open copy.
 *
 * Moving clock via page.clock.setSystemTime (a frozen setFixedTime would wedge
 * the create effect's debounce), cold reopen per day like #6230.
 */

type Snapshot = {
  cfg: {
    quickSetting?: string;
    repeatCycle?: string;
    repeatEvery?: number;
    repeatFromCompletionDate?: boolean;
    waitForCompletion?: boolean;
  } | null;
  openCopies: number;
  openDueDays: string[];
};

const readSnapshot = async (page: Page, title: string): Promise<Snapshot> =>
  page.evaluate((taskTitle: string) => {
    type TaskLike = {
      isDone?: boolean;
      parentId?: string | null;
      repeatCfgId?: string | null;
      dueDay?: string;
    };
    type CfgLike = {
      id?: string;
      title?: string | null;
      quickSetting?: string;
      repeatCycle?: string;
      repeatEvery?: number;
      repeatFromCompletionDate?: boolean;
      waitForCompletion?: boolean;
    };
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
    const open = Object.values(latest?.tasks?.entities ?? {}).filter(
      (t): t is TaskLike =>
        !!t && !t.parentId && !t.isDone && !!cfg?.id && t.repeatCfgId === cfg.id,
    );
    return {
      cfg: cfg
        ? {
            quickSetting: cfg.quickSetting,
            repeatCycle: cfg.repeatCycle,
            repeatEvery: cfg.repeatEvery,
            repeatFromCompletionDate: cfg.repeatFromCompletionDate,
            waitForCompletion: cfg.waitForCompletion,
          }
        : null,
      openCopies: open.length,
      openDueDays: open.map((t) => t.dueDay ?? '').sort(),
    };
  }, title);

/** Cold reopen on another day and give the creation effect time to run. */
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

test.describe('Recurring task - After I complete it (#5388)', () => {
  test('every 2 weeks after completion needs no weekday, waits, and comes back 14 days after completion', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const taskTitle = `${testPrefix}-AfterCompletion5388`;
    const waitForTaskList = (): Promise<void> => workViewPage.waitForTaskList();

    // 1. Day 0 (Mon 2026-06-15): create the task and make it repeat
    //    "every 2 weeks after I complete it", without touching any weekday.
    await page.clock.setSystemTime(new Date('2026-06-15T09:00:00'));
    await page.reload();
    await waitForTaskList();
    await workViewPage.addTask(taskTitle);
    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });
    await taskPage.openTaskDetail(task);

    const dialog = await openRecurDialog(page);
    await setRecurQuickSetting(page, /After I complete it/i);
    await expect(page.locator('mat-option')).toHaveCount(0, { timeout: 5000 });

    // Weekdays don't apply after completion.
    await expect(dialog.locator('.weekdays')).toBeHidden();

    const cycleSelect = dialog.locator('.repeat-cycle mat-select').first();
    await cycleSelect.click();
    await page
      .locator('mat-option')
      .filter({ hasText: /^Week$/ })
      .click();
    await expect(page.locator('mat-option')).toHaveCount(0, { timeout: 5000 });
    const everyInput = dialog.locator('.repeat-cycle input').first();
    await everyInput.fill('2');
    await everyInput.blur();

    await saveRecurDialog(page);

    await expect
      .poll(async () => (await readSnapshot(page, taskTitle)).cfg)
      .toEqual({
        quickSetting: 'CUSTOM',
        repeatCycle: 'DAILY',
        repeatEvery: 14,
        repeatFromCompletionDate: true,
        waitForCompletion: true,
      });

    // 2. Re-opening shows it as entered: the preset and "2 weeks".
    await page.keyboard.press('Escape');
    await taskPage.openTaskDetail(taskPage.getTaskByText(taskTitle).first());
    const reopened = await openRecurDialog(page);
    await expect(reopened.locator('mat-select').first()).toContainText(
      /After I complete it/i,
    );
    await expect(reopened.locator('.repeat-cycle input').first()).toHaveValue('2');
    await expect(reopened.locator('.repeat-cycle mat-select').first()).toContainText(
      'Week',
    );
    await reopened.getByRole('button', { name: /Cancel/i }).click();
    await page.keyboard.press('Escape');

    // 3. Day 15, the copy is still open: no second copy while waiting.
    await reopenOn(page, '2026-06-30T09:00:00', waitForTaskList);
    // Asserting that nothing gets created needs elapsed time for the debounced
    // creation effect.
    await page.waitForTimeout(4000);
    expect((await readSnapshot(page, taskTitle)).openCopies).toBe(1);

    // 4. Complete it on day 15.
    const overdueCopy = taskPage.getTaskByText(taskTitle).first();
    await expect(overdueCopy).toBeVisible({ timeout: 10000 });
    await taskPage.markTaskAsDone(overdueCopy);
    await expect
      .poll(async () => (await readSnapshot(page, taskTitle)).openCopies)
      .toBe(0);
    // Let the op flush to IndexedDB before the cold reopen.
    await page.waitForTimeout(1500);

    // 5. 13 days after completion: still nothing.
    await reopenOn(page, '2026-07-13T09:00:00', waitForTaskList);
    // See step 3.
    await page.waitForTimeout(4000);
    expect((await readSnapshot(page, taskTitle)).openCopies).toBe(0);

    // 6. 14 days after completion: exactly one new copy, due that day.
    await reopenOn(page, '2026-07-14T09:00:00', waitForTaskList);
    await expect
      .poll(async () => (await readSnapshot(page, taskTitle)).openDueDays, {
        timeout: 60000,
      })
      .toEqual(['2026-07-14']);
  });
  // The preset is the one switch: the custom fields follow it, and switching it
  // with the arrow keys keeps focus on it (the dialog rebuilds the form then).
  test('switches between fixed and after completion with the preset alone', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const taskTitle = `${testPrefix}-PresetSwitch5388`;
    await workViewPage.waitForTaskList();
    await workViewPage.addTask(taskTitle);
    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });
    await taskPage.openTaskDetail(task);
    const dialog = await openRecurDialog(page);
    const preset = dialog.locator('mat-select').first();
    const weekdays = dialog.locator('.weekdays');

    await expect(dialog.getByRole('radio')).toHaveCount(0);

    await setRecurQuickSetting(page, /Custom/i);
    await expect(weekdays).toBeVisible();
    await expect(dialog.locator('.rule-summary')).not.toContainText(/after completion/i);

    await setRecurQuickSetting(page, /After I complete it/i);
    await expect(weekdays).toBeHidden();
    await expect(dialog.locator('.rule-summary')).toContainText(/after completion/i);

    await setRecurQuickSetting(page, /Every Monday through Friday/i);
    await expect(dialog.locator('.rule-summary')).toHaveCount(0);

    // Keyboard: "After I complete it…" sits just above Custom in the list.
    await setRecurQuickSetting(page, /After I complete it/i);
    await page.waitForFunction(() =>
      document.getAnimations().every((a) => a.playState !== 'running'),
    );
    await preset.focus();
    await expect(preset).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(preset).toContainText(/Custom/i);
    await expect(weekdays).toBeVisible();
    await expect(preset).toBeFocused();
  });
});
