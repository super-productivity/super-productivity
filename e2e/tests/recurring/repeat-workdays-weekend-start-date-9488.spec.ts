import { type Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import {
  gotoHashRoute,
  openRecurDialog,
  saveRecurDialog,
  setRecurQuickSetting,
  setRecurStartDate,
} from '../../utils/recurring-task-helpers';

/**
 * Bug: https://github.com/super-productivity/super-productivity/issues/9488
 *
 * A `MONDAY_TO_FRIDAY` ("Workdays") config excludes weekends, but nothing kept
 * its `startDate` off a weekend day. `getQuickSettingUpdates('MONDAY_TO_FRIDAY')`
 * returns the weekday mask and no `startDate`, so a Saturday anchor was
 * persisted verbatim. The dialog re-derives every later quick setting *from*
 * that stored date, so switching to "Every week on ..." afterwards produced a
 * Saturday-only recurrence.
 *
 * Expected: the persisted `startDate` is rolled forward to the first day the
 *           schedule actually lands on (the Monday), so the later switch to
 *           "Every week on ..." derives a Monday recurrence instead.
 */

const toDbDateStr = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;

const toDDMMYYYY = (d: Date): string =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(
    2,
    '0',
  )}/${d.getFullYear()}`;

/**
 * The next Saturday strictly after today, and the Monday two days later.
 *
 * Computed rather than hardcoded so the test cannot rot into a past date, and
 * always in the future so overdue/clamping behaviour stays out of it.
 */
const nextWeekend = (): {
  saturday: string;
  monday: string;
  saturdayDDMMYYYY: string;
} => {
  const d = new Date();
  // Midday, so a DST transition cannot shift the day while stepping
  d.setHours(12, 0, 0, 0);
  do {
    d.setDate(d.getDate() + 1);
  } while (d.getDay() !== 6);
  const monday = new Date(d);
  monday.setDate(monday.getDate() + 2);
  return {
    saturday: toDbDateStr(d),
    monday: toDbDateStr(monday),
    saturdayDDMMYYYY: toDDMMYYYY(d),
  };
};

type PersistedSnapshot = {
  quickSetting: string | null;
  repeatCycle: string | null;
  startDate: string | null;
  monday: boolean | null;
  saturday: boolean | null;
};

/** The persisted repeat config created for the given title. */
const getPersisted = async (page: Page, title: string): Promise<PersistedSnapshot> =>
  page.evaluate((taskTitle: string) => {
    type RepeatCfgLike = {
      quickSetting?: string | null;
      repeatCycle?: string | null;
      startDate?: string | null;
      monday?: boolean | null;
      saturday?: boolean | null;
      title?: string | null;
    };
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
    return {
      quickSetting: cfg?.quickSetting ?? null,
      repeatCycle: cfg?.repeatCycle ?? null,
      startDate: cfg?.startDate ?? null,
      monday: cfg?.monday ?? null,
      saturday: cfg?.saturday ?? null,
    };
  }, title);

test.describe('Recurring Task - workdays schedule on a weekend start date (#9488)', () => {
  test('should re-anchor a Workdays recurrence off a weekend start date, so a later weekly switch derives a workday', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const { monday, saturdayDDMMYYYY } = nextWeekend();
    const taskTitle = `${testPrefix}-Workdays9488`;

    await workViewPage.waitForTaskList();
    await workViewPage.addTask(taskTitle);
    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });

    // Seed the repeat config's start date with the Saturday, then pick Workdays
    await taskPage.openTaskDetail(task);
    await openRecurDialog(page);
    await setRecurStartDate(page, saturdayDDMMYYYY);
    await setRecurQuickSetting(page, /Every Monday through Friday/i);
    await saveRecurDialog(page);

    // Sync barrier only: the config must exist before it is reopened. The bug
    // assertion is the final snapshot below.
    await expect
      .poll(async () => (await getPersisted(page, taskTitle)).quickSetting, {
        timeout: 15000,
      })
      .toBe('MONDAY_TO_FRIDAY');

    // The live instance moved to the Monday (a future day), so it left the
    // Today view. The Inbox lists the task regardless of its due day.
    const inboxTask = page.locator('task').filter({ hasText: taskTitle }).first();
    await gotoHashRoute(page, '/#/project/INBOX_PROJECT/tasks', inboxTask);
    await taskPage.openTaskDetail(inboxTask);
    await openRecurDialog(page);
    await setRecurQuickSetting(page, /Every week on/i);
    await saveRecurDialog(page);

    // The weekly switch must derive from the Monday the schedule lands on.
    // With the bug, startDate is still the Saturday and the recurrence comes
    // out Saturday-only: { startDate: saturday, monday: false, saturday: true }
    await expect
      .poll(async () => await getPersisted(page, taskTitle), { timeout: 15000 })
      .toMatchObject({
        quickSetting: 'WEEKLY_CURRENT_WEEKDAY',
        repeatCycle: 'WEEKLY',
        startDate: monday,
        monday: true,
        saturday: false,
      });
  });
});
