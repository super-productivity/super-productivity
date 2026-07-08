import { expect, test } from '../../fixtures/test.fixture';
import { type Page } from '@playwright/test';
import { openRecurDialog, saveRecurDialog } from '../../utils/recurring-task-helpers';

/**
 * PR #8644: new recurring configs default `skipOverdue` ("Don't let overdue
 * instances pile up") to ON for the plain everyday Daily schedule (where missed
 * instances pile up and skipping is safe — today is always scheduled), and OFF
 * for every other schedule (where a missed occurrence is a real obligation that
 * must stay visible).
 *
 * These assert the persisted default via the NgRx store — the user never has
 * to open Advanced for it to apply.
 */

/** Read the persisted skipOverdue flag for the config created for `title`. */
const getPersistedSkipOverdue = async (
  page: Page,
  title: string,
): Promise<boolean | null | undefined> =>
  page.evaluate((taskTitle: string) => {
    type RepeatCfgLike = { title?: string | null; skipOverdue?: boolean };
    type StoreState = {
      taskRepeatCfg?: { entities?: Record<string, RepeatCfgLike | undefined> };
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
    return cfg ? (cfg.skipOverdue ?? null) : undefined;
  }, title);

test.describe('Recurring task - skipOverdue default by schedule (#8644)', () => {
  test('a new Daily recurring task defaults skipOverdue to ON', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const taskTitle = `${testPrefix}-DailySkip8644`;
    await workViewPage.waitForTaskList();
    await workViewPage.addTask(taskTitle);
    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });
    await taskPage.openTaskDetail(task);

    // The dialog opens on the Daily quick setting by default — just save.
    await openRecurDialog(page);
    await saveRecurDialog(page);

    await expect.poll(() => getPersistedSkipOverdue(page, taskTitle)).toBe(true);
  });

  test('a new Monthly recurring task keeps skipOverdue OFF', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const taskTitle = `${testPrefix}-MonthlySkip8644`;
    await workViewPage.waitForTaskList();
    await workViewPage.addTask(taskTitle);
    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });
    await taskPage.openTaskDetail(task);

    const dialog = await openRecurDialog(page);
    await dialog.locator('mat-select').first().click();
    const monthlyOption = page.locator('mat-option').filter({ hasText: /first day/i });
    await expect(monthlyOption).toBeVisible({ timeout: 5000 });
    await monthlyOption.click();
    await saveRecurDialog(page);

    await expect.poll(() => getPersistedSkipOverdue(page, taskTitle)).toBe(false);
  });
});
