import { expect, test } from '../../fixtures/test.fixture';
import { type Page } from '@playwright/test';
import {
  openRecurDialog,
  openRecurScheduleDialog,
  saveRecurDialog,
} from '../../utils/recurring-task-helpers';

/**
 * https://github.com/super-productivity/super-productivity/issues/3378
 *
 * With "start of next day" at 05:00, a daily repeat at 02:00 belongs to the
 * late night of its logical day, i.e. 02:00 on the NEXT calendar day. It used
 * to be placed on 02:00 of the calendar day itself, which already belongs to
 * the previous logical day, so every instance was overdue when created.
 *
 * Strategy mirrors repeat-timed-cold-reopen-day-change.spec.ts: a MOVING clock
 * (setFixedTime would wedge the create effect's debounceTime(1000)) and a cold
 * reopen on Day X+1 to run the real creation path (TaskRepeatCfgService).
 */

const DAY_X = '2026-06-15T09:00:00';
const DAY_X_PLUS_1 = '2026-06-16T09:05:00';

interface Instance {
  id: string;
  dueWithTime: number | null;
}

const readInstances = async (page: Page, title: string): Promise<Instance[]> =>
  page.evaluate((taskTitle: string) => {
    type TaskLike = {
      id: string;
      title?: string;
      isDone?: boolean;
      parentId?: string | null;
      repeatCfgId?: string | null;
      dueWithTime?: number;
    };
    type StoreState = { tasks?: { entities?: Record<string, TaskLike | undefined> } };
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
    return Object.values(latest?.tasks?.entities ?? {})
      .filter(
        (t): t is TaskLike =>
          !!t && !t.parentId && !!t.repeatCfgId && !!t.title?.includes(taskTitle),
      )
      .map((t) => ({ id: t.id, dueWithTime: t.dueWithTime ?? null }));
  }, title);

const setStartOfNextDay = async (page: Page, time: string): Promise<void> =>
  page.evaluate((startOfNextDayTime: string) => {
    type StoreLike = { dispatch: (a: unknown) => void };
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) {
      throw new Error('__e2eTestHelpers.store missing');
    }
    store.dispatch({
      type: '[Global Config] Update Global Config Section',
      sectionKey: 'misc',
      sectionCfg: { startOfNextDayTime },
      isSkipSnack: true,
      meta: {
        isPersistent: true,
        entityType: 'GLOBAL_CONFIG',
        entityId: 'misc',
        opType: 'UPD',
      },
    });
  }, time);

test.describe('Repeat Task - start time before the start of the next day (#3378)', () => {
  test('schedules a 02:00 daily repeat on the late night of its logical day', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const taskTitle = `${testPrefix}-LateNightRepeat`;

    await page.clock.setSystemTime(new Date(DAY_X));
    await page.reload();
    await workViewPage.waitForTaskList();
    await setStartOfNextDay(page, '05:00');

    await workViewPage.addTask(taskTitle);
    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });
    await taskPage.openTaskDetail(task);
    await openRecurDialog(page);

    const scheduleDialog = await openRecurScheduleDialog(page);
    const startTimeField = scheduleDialog.getByLabel('Time');
    await expect(startTimeField).toBeVisible({ timeout: 5000 });
    await startTimeField.fill('02:00');
    await startTimeField.blur();
    await scheduleDialog.locator('[data-test-id="schedule-submit-btn"]').click();
    await scheduleDialog.waitFor({ state: 'hidden', timeout: 5000 });
    await saveRecurDialog(page);
    await page.keyboard.press('Escape');

    // Making the task repeatable schedules it for logical Day X: 02:00 on X+1.
    const dayXDue = new Date('2026-06-16T02:00:00').getTime();
    await expect
      .poll(
        async () => (await readInstances(page, taskTitle)).map((t) => t.dueWithTime),
        {
          timeout: 10000,
        },
      )
      .toEqual([dayXDue]);

    // Let the ops flush to IndexedDB before the cold reopen.
    await page.waitForTimeout(1500);

    await page.clock.setSystemTime(new Date(DAY_X_PLUS_1));
    await page.reload();
    await workViewPage.waitForTaskList();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));

    // The instance created for logical Day X+1 keeps its day-keyed id and is
    // due 02:00 on X+2: in the future, not overdue on creation.
    const dayX1Due = new Date('2026-06-17T02:00:00').getTime();
    await expect
      .poll(
        async () =>
          (await readInstances(page, taskTitle)).find((t) => t.id.endsWith('_2026-06-16'))
            ?.dueWithTime,
        { timeout: 60000 },
      )
      .toBe(dayX1Due);
    await expect(
      taskPage.getUndoneTasks().filter({ hasText: taskTitle }).first(),
    ).toBeVisible();
  });
});
