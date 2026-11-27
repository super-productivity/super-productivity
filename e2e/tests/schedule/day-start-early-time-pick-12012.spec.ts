import { expect, test } from '../../fixtures/test.fixture';
import type { Locator, Page } from '@playwright/test';
import { cssSelectors } from '../../constants/selectors';
import { fillTimeInput } from '../../utils/time-input-helper';

// Fixed zone so the expected timestamps don't depend on the runner's timezone.
// Dates lie in the future because the reminder worker runs on the real clock.
test.use({ timezoneId: 'Europe/Berlin' });

const TITLE = 'Night shift task';

type StoreHelper = {
  dispatch: (a: unknown) => void;
  subscribe: (fn: (s: unknown) => void) => { unsubscribe: () => void };
};

const setDayStart = (page: Page, offset: string): Promise<void> =>
  page.evaluate((startOfNextDayTime) => {
    const store = (window as unknown as { __e2eTestHelpers: { store: StoreHelper } })
      .__e2eTestHelpers.store;
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
  }, offset);

const readDueWithTime = (page: Page, title: string): Promise<number | null> =>
  page.evaluate((taskTitle) => {
    type State = {
      tasks: { entities: Record<string, { title: string; dueWithTime?: number }> };
    };
    const store = (window as unknown as { __e2eTestHelpers: { store: StoreHelper } })
      .__e2eTestHelpers.store;
    let due: number | null = null;
    store
      .subscribe((s) => {
        const task = Object.values((s as State).tasks.entities).find((t) =>
          t.title.includes(taskTitle),
        );
        due = task?.dueWithTime ?? null;
      })
      .unsubscribe();
    return due;
  }, title);

const openScheduleDialog = async (page: Page, task: Locator): Promise<Locator> => {
  const dialog = page.locator(cssSelectors.DIALOG_SCHEDULE_TASK);
  // Right after navigation the task can hold DOM focus before the app has
  // registered it as the focused task, which makes the shortcut a no-op.
  await expect(async () => {
    await task.blur();
    await task.focus();
    await expect(task).toBeFocused();
    await page.keyboard.press('s');
    await expect(dialog).toBeVisible({ timeout: 2000 });
  }).toPass();
  return dialog;
};

const submit = async (dialog: Locator): Promise<void> => {
  await dialog.locator('[data-test-id="schedule-submit-btn"]').click();
  await dialog.waitFor({ state: 'hidden' });
};

// #12012: with the day starting at 04:00, 02:00 picked "on Jun 16" is the late
// night of Jun 16, i.e. Jun 17 02:00 — not Jun 16 02:00, which belongs to Jun 15.
test('keeps a 02:00 pick on the chosen day with a 04:00 day start', async ({
  page,
  workViewPage,
  taskPage,
}) => {
  await page.clock.setSystemTime(
    await page.evaluate(() => new Date('2027-06-15T10:00:00').getTime()),
  );
  await page.reload();
  await workViewPage.waitForTaskList();
  await setDayStart(page, '04:00');
  await workViewPage.addTask(TITLE);
  const task = taskPage.getTaskByText(TITLE).first();

  const dialog = await openScheduleDialog(page, task);
  await dialog
    .locator('.mat-calendar-body-cell:not(.mat-calendar-body-disabled)')
    .filter({ hasText: /^\s*16\s*$/ })
    .first()
    .click();
  // fillTimeInput formats in the runner's zone, so build the time there
  await fillTimeInput(page, new Date(2027, 5, 16, 2, 0));
  await submit(dialog);

  const expected = await page.evaluate(() => new Date('2027-06-17T02:00:00').getTime());
  await expect.poll(() => readDueWithTime(page, TITLE)).toBe(expected);

  // Reopening shows the logical day; saving unchanged must not move the task.
  // The task left Today when it was scheduled, so reopen it from the Inbox.
  await page.goto('/#/project/INBOX_PROJECT/tasks');
  await workViewPage.waitForTaskList();
  const reopened = await openScheduleDialog(page, task);
  await expect(reopened.locator('input[type="time"]')).toHaveValue('02:00');
  await expect(reopened.locator('.mat-calendar-body-selected')).toHaveText(/^\s*16\s*$/);
  await submit(reopened);
  await expect.poll(() => readDueWithTime(page, TITLE)).toBe(expected);
});

test('defaults to the coming 04:00 when the clock has just sprung forward', async ({
  page,
  workViewPage,
  taskPage,
}) => {
  await page.goto('about:blank');
  await page.clock.setFixedTime(new Date('2026-03-29T03:10:00+02:00'));
  await page.goto('/#/project/INBOX_PROJECT/tasks');
  await workViewPage.waitForTaskList();
  await setDayStart(page, '04:00');
  await workViewPage.addTask(TITLE);
  const dialog = await openScheduleDialog(page, taskPage.getTaskByText(TITLE).first());
  await dialog.locator('input[type="time"]').focus();
  await expect
    .soft(dialog.locator('input[type="time"]'))
    .toHaveValue('04:00', { timeout: 2000 });
  await submit(dialog);
  expect(await readDueWithTime(page, TITLE)).toBe(
    Date.parse('2026-03-29T04:00:00+02:00'),
  );
});
