import { type Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { ensureGlobalAddTaskBarOpen } from '../../utils/element-helpers';

/**
 * Bug: https://github.com/super-productivity/super-productivity/pull/9404
 *
 * A `MONDAY_TO_FRIDAY` schedule has no weekend occurrence, so a weekend due
 * date names a day the recurrence never lands on. The add bar let the two be
 * combined and wrote the weekend day straight into `TaskRepeatCfg.startDate`.
 *
 * The task itself still appeared on the Monday — `getFirstRepeatOccurrence`
 * scans the weekday flags forward from `startDate` — so nothing looked wrong.
 * But the repeat dialog re-derives every later quick setting *from* that stored
 * date, so switching the task to "weekly on current weekday" afterwards
 * produced a Saturday-only recurrence.
 *
 * Expected: submitting rolls the weekend day forward once, so the persisted
 *           `startDate` and the task's own due day are both the Monday.
 *
 * The unit specs for this stop at `TaskService.add` and a mocked repeat-cfg
 * service. This one is here to cover the part they cannot: that the value
 * actually lands in the store, after the `addTaskRepeatCfgToTask` effects have
 * had their say.
 */

const ADD_TASK_BAR = 'add-task-bar.global';
const DUE_BUTTON = `${ADD_TASK_BAR} [data-test="add-task-bar-due-btn"]`;
const REPEAT_BUTTON = `${ADD_TASK_BAR} [data-test="add-task-bar-repeat-btn"]`;

const toDbDateStr = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;

/**
 * The next Saturday strictly after today, and the Monday two days later.
 *
 * Computed rather than hardcoded so the test cannot rot into a past date, and
 * always in the future so overdue/clamping behaviour stays out of it.
 */
const nextWeekend = (): { saturday: string; monday: string } => {
  const d = new Date();
  // Midday, so a DST transition cannot shift the day while stepping
  d.setHours(12, 0, 0, 0);
  do {
    d.setDate(d.getDate() + 1);
  } while (d.getDay() !== 6);
  const monday = new Date(d);
  monday.setDate(monday.getDate() + 2);
  return { saturday: toDbDateStr(d), monday: toDbDateStr(monday) };
};

type PersistedSnapshot = {
  quickSetting: string | null;
  startDate: string | null;
  dueDay: string | null;
};

/** The persisted repeat config and task created for the given title. */
const getPersisted = async (page: Page, title: string): Promise<PersistedSnapshot> =>
  page.evaluate((taskTitle: string) => {
    type RepeatCfgLike = {
      quickSetting?: string | null;
      startDate?: string | null;
      title?: string | null;
    };
    type TaskLike = { title?: string | null; dueDay?: string | null };
    type StoreState = {
      taskRepeatCfg?: { entities?: Record<string, RepeatCfgLike | undefined> };
      tasks?: { entities?: Record<string, TaskLike | undefined> };
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
    const task = Object.values(latest?.tasks?.entities ?? {}).find((t) =>
      t?.title?.includes(taskTitle),
    );
    return {
      quickSetting: cfg?.quickSetting ?? null,
      startDate: cfg?.startDate ?? null,
      dueDay: task?.dueDay ?? null,
    };
  }, title);

test.describe('Recurring Task - workday schedule on a weekend date (#9404)', () => {
  test('should start a menu-picked Workdays recurrence on the Monday after a weekend due date', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    const { saturday, monday } = nextWeekend();
    const taskTitle = `${testPrefix}-Workdays9404`;

    await workViewPage.waitForTaskList();
    const input = await ensureGlobalAddTaskBarOpen(page);

    // The date comes from the text and the schedule from the menu — the pick
    // deliberately leaves a plain date token alone, so this is the combination
    // that survives every following keystroke.
    await input.fill(`${taskTitle} @${saturday}`);
    await expect(page.locator(DUE_BUTTON).first()).toHaveClass(/has-value/, {
      timeout: 10000,
    });

    const repeatButton = page.locator(REPEAT_BUTTON).first();
    await repeatButton.click();
    await page
      .locator('button[mat-menu-item]')
      .filter({ hasText: /Every Monday through Friday/i })
      .first()
      .click();
    await expect(repeatButton).toHaveClass(/has-value/, { timeout: 10000 });
    // `has-value` flips on click, but focus only returns to the input once the
    // menu's close animation ends (menuClosed -> refocus). Pressing Enter
    // before that would re-open the menu off the still-focused trigger.
    await expect(input).toBeFocused({ timeout: 10000 });

    await page.keyboard.press('Enter');

    // Polled: the task's due day is written on submit and then re-asserted by
    // the addTaskRepeatCfgToTask effects, which run after the add.
    await expect
      .poll(async () => await getPersisted(page, taskTitle), { timeout: 15000 })
      .toEqual({
        quickSetting: 'MONDAY_TO_FRIDAY',
        // Not the Saturday: it is the anchor every later quick-setting change
        // in the repeat dialog is derived from
        startDate: monday,
        dueDay: monday,
      });
  });
});
