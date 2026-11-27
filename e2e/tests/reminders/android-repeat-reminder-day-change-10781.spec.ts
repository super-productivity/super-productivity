import { type Page } from '@playwright/test';
import { expect } from '../../fixtures/test.fixture';
import {
  androidReminderTest,
  readCalls,
  type ReminderCall,
  type ReminderWindow,
} from './android-reminder-recorder';
import {
  openRecurDialog,
  openRecurScheduleDialog,
  saveRecurDialog,
} from '../../utils/recurring-task-helpers';

/**
 * https://github.com/super-productivity/super-productivity/issues/10781
 *
 * Android: the first recurring reminder of the day does not ring until the app
 * is opened. The app, reducers and effects are real; only the native alarm
 * bridge is a recorder, so these tests cover what the app arms and cancels, not
 * whether Android delivers the alarm. Both pass on master (2026-11): the app
 * keeps the alarm, so the cause of the report is still open.
 *
 * `cancelNativeReminder` cancels the alarm AND dismisses a notification that is
 * already on screen, so a cancel for the new day's occurrence loses the reminder.
 */
const DAY_1 = '2026-06-15';
const DAY_2 = '2026-06-16';
const DAY_2_8AM = new Date(`${DAY_2}T08:00:00`).getTime();

const test = androidReminderTest(`${DAY_1}T07:00:00`);

const readTaskIds = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    let ids: string[] = [];
    (window as unknown as ReminderWindow).__e2eTestHelpers.store
      .subscribe((state) => (ids = state.tasks.ids))
      .unsubscribe();
    return ids;
  });

/** Daily recurring task at 08:00 with the default "at start" reminder. */
const createDailyTaskAt8 = async (
  page: Page,
  addTask: (title: string) => Promise<void>,
): Promise<void> => {
  await addTask('Daily 8am');
  // The Android layout has no hover buttons: open the detail panel by shortcut.
  await page.locator('task').first().focus();
  await page.keyboard.press('i');
  await openRecurDialog(page);
  const scheduleDialog = await openRecurScheduleDialog(page);
  const startTimeField = scheduleDialog.getByLabel('Time');
  await startTimeField.fill('08:00');
  await startTimeField.blur();
  await scheduleDialog.locator('[data-test-id="schedule-submit-btn"]').click();
  await scheduleDialog.waitFor({ state: 'hidden', timeout: 5000 });
  await saveRecurDialog(page);
  await page.keyboard.press('Escape');
};

/** The alarm the app pre-arms for tomorrow's occurrence, before its task exists. */
const waitForDay2Alarm = async (page: Page): Promise<ReminderCall> => {
  let armed: ReminderCall | undefined;
  await expect
    .poll(
      async () => {
        armed = (await readCalls(page)).find(
          (c) =>
            c.op === 'schedule' &&
            !!c.reminderId?.startsWith('rpt_') &&
            c.reminderId.endsWith(DAY_2),
        );
        return armed?.triggerAtMs;
      },
      { timeout: 30000 },
    )
    .toBe(DAY_2_8AM);
  return armed as ReminderCall;
};

const waitForDay2Instance = (page: Page, reminderId: string): Promise<void> =>
  expect.poll(() => readTaskIds(page), { timeout: 60000 }).toContain(reminderId);

test.describe('Android recurring reminder across a day change (#10781)', () => {
  test('keeps the fired alarm when the app wakes after it rang', async ({
    page,
    workViewPage,
  }) => {
    await createDailyTaskAt8(page, (title) => workViewPage.addTask(title));
    const armed = await waitForDay2Alarm(page);
    const callsBefore = (await readCalls(page)).length;

    // The app stays in memory overnight with its JS frozen. The 08:00 alarm
    // rings and wakes the process, so JS first sees the new day after the alarm.
    await page.clock.setSystemTime(new Date(DAY_2_8AM + 3000));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await waitForDay2Instance(page, armed.reminderId as string);
    // Let the reminder effects (1s debounce) and the reminder worker settle.
    await page.waitForTimeout(15000);

    const cancelsOfDay2 = (await readCalls(page))
      .slice(callsBefore)
      .filter((c) => c.op === 'cancel' && c.id === armed.id);
    expect(cancelsOfDay2).toEqual([]);
    // Nothing re-armed it for a different time either.
    const lastCallForDay2 = (await readCalls(page))
      .filter((c) => c.id === armed.id)
      .pop();
    expect(lastCallForDay2?.triggerAtMs).toBe(DAY_2_8AM);
  });

  // The reporter's setup: the logical day starts at 01:00.
  test('keeps the alarm armed with a 01:00 day start', async ({ page, workViewPage }) => {
    await page.evaluate(() =>
      (window as unknown as ReminderWindow).__e2eTestHelpers.store.dispatch({
        type: '[Global Config] Update Global Config Section',
        sectionKey: 'misc',
        sectionCfg: { startOfNextDay: 1, startOfNextDayTime: '01:00' },
        isSkipSnack: true,
        meta: {
          isPersistent: true,
          entityType: 'GLOBAL_CONFIG',
          entityId: 'misc',
          opType: 'UPD',
        },
      }),
    );
    await createDailyTaskAt8(page, (title) => workViewPage.addTask(title));
    const armed = await waitForDay2Alarm(page);

    // Awake after midnight but before the logical day starts, then after it.
    await page.clock.setSystemTime(new Date(`${DAY_2}T00:30:00`));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(8000);
    await page.clock.setSystemTime(new Date(`${DAY_2}T01:05:00`));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await waitForDay2Instance(page, armed.reminderId as string);
    await page.waitForTimeout(15000);

    const lastCallForDay2 = (await readCalls(page))
      .filter((c) => c.id === armed.id)
      .pop();
    expect(lastCallForDay2).toEqual({
      op: 'schedule',
      id: armed.id,
      reminderId: armed.reminderId,
      triggerAtMs: DAY_2_8AM,
    });
  });
});
