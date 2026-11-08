import { expect, test } from '../../fixtures/test.fixture';
import { type Page } from '@playwright/test';
import { openRecurDialog, saveRecurDialog } from '../../utils/recurring-task-helpers';

/**
 * #10202: skipOverdue ("Don't let overdue instances pile up") must still reap
 * instances when the global "default estimate" is set but the repeat config
 * has none.
 *
 * Creating a repeat from a task copies the task's estimate into the config, so
 * the config ends up with 0 when the user sets the global default AFTER the
 * repeat exists. Every later instance is then created without an estimate and
 * setDefaultEstimateIfNonGiven$ fills in the global default — which the reaper
 * used to read as a user edit, keeping one leftover per day.
 *
 * Day X: create the daily repeat, then set the global default estimate.
 * Day X+1: its instance is created carrying the global default.
 * Day X+2 (cold reopen): the empty Day X+1 instance must be reaped.
 *
 * Moving clock via setSystemTime, as in skip-overdue-reaps-timed-instance.spec.ts.
 */

const DAY_X = '2026-06-15T09:00:00';
const DAY_X_PLUS_1 = '2026-06-16T09:05:00';
const DAY_X_PLUS_2 = '2026-06-17T09:10:00';
const GLOBAL_DEFAULT_ESTIMATE = 30 * 60 * 1000;

type StoreLike = {
  dispatch: (action: unknown) => void;
  subscribe: (next: (s: unknown) => void) => { unsubscribe: () => void };
};

interface RepeatInstances {
  skipOverdue: boolean | null;
  dueDays: (string | null)[];
  timeEstimates: number[];
}

/** Read instance state straight from the NgRx store (see skip-overdue-default-8644). */
const readInstances = async (page: Page, title: string): Promise<RepeatInstances> =>
  page.evaluate((taskTitle: string) => {
    type TaskLike = {
      isDone?: boolean;
      parentId?: string | null;
      repeatCfgId?: string | null;
      dueDay?: string;
      timeEstimate?: number;
    };
    type CfgLike = { id?: string; title?: string | null; skipOverdue?: boolean };
    type StoreState = {
      tasks?: { entities?: Record<string, TaskLike | undefined> };
      taskRepeatCfg?: { entities?: Record<string, CfgLike | undefined> };
    };
    const store = (
      window as unknown as {
        __e2eTestHelpers?: {
          store?: {
            subscribe: (next: (s: StoreState) => void) => { unsubscribe: () => void };
          };
        };
      }
    ).__e2eTestHelpers?.store;
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
      skipOverdue: cfg ? (cfg.skipOverdue ?? null) : null,
      dueDays: instances.map((t) => t.dueDay ?? null).sort(),
      timeEstimates: instances.map((t) => t.timeEstimate ?? 0),
    };
  }, title);

/** Persisted like a settings-form save, so it survives the cold reopen. */
const setGlobalDefaultEstimate = async (page: Page, ms: number): Promise<void> => {
  await page.evaluate((defaultEstimate: number) => {
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) {
      throw new Error('__e2eTestHelpers.store missing');
    }
    store.dispatch({
      type: '[Global Config] Update Global Config Section',
      sectionKey: 'timeTracking',
      sectionCfg: { defaultEstimate },
      isSkipSnack: true,
      meta: {
        isPersistent: true,
        entityType: 'GLOBAL_CONFIG',
        entityId: 'timeTracking',
        opType: 'UPD',
      },
    });
  }, ms);
};

const coldReopenAt = async (page: Page, isoDateTime: string): Promise<void> => {
  // Let the ops flush to IndexedDB before the reload.
  await page.waitForTimeout(1500);
  await page.clock.setSystemTime(new Date(isoDateTime));
  await page.reload();
  await page.locator('task-list').first().waitFor({ state: 'visible', timeout: 30000 });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
};

test.describe('Recurring task - skipOverdue with a global default estimate (#10202)', () => {
  test('reaps the empty overdue instance that carries the global default estimate', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const taskTitle = `${testPrefix}-SkipOverdueGlobalEst`;
    await workViewPage.waitForTaskList();
    await page.clock.setSystemTime(new Date(DAY_X));
    await page.reload();
    await workViewPage.waitForTaskList();

    await workViewPage.addTask(taskTitle);
    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });
    await taskPage.openTaskDetail(task);
    await openRecurDialog(page);
    // Default DAILY preset — skipOverdue defaults ON for it.
    await saveRecurDialog(page);
    await page.keyboard.press('Escape');

    await expect
      .poll(async () => (await readInstances(page, taskTitle)).skipOverdue, {
        timeout: 10000,
      })
      .toBe(true);

    await setGlobalDefaultEstimate(page, GLOBAL_DEFAULT_ESTIMATE);

    await coldReopenAt(page, DAY_X_PLUS_1);
    // Precondition: Day X+1's instance really got the global default, else
    // this test would pass without the fix.
    await expect
      .poll(async () => (await readInstances(page, taskTitle)).dueDays, {
        timeout: 60000,
      })
      .toContain(DAY_X_PLUS_1.slice(0, 10));
    await expect
      .poll(async () => (await readInstances(page, taskTitle)).timeEstimates, {
        timeout: 10000,
      })
      .toContain(GLOBAL_DEFAULT_ESTIMATE);

    await coldReopenAt(page, DAY_X_PLUS_2);
    // Creation runs (1s debounce), then the reaper (3s): only Day X+2 is left.
    await expect
      .poll(async () => (await readInstances(page, taskTitle)).dueDays, {
        timeout: 60000,
      })
      .toEqual([DAY_X_PLUS_2.slice(0, 10)]);
  });
});
