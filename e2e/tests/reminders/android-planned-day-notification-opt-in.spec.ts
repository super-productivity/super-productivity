import { expect } from '../../fixtures/test.fixture';
import { waitForAppReady } from '../../utils/waits';
import {
  androidReminderTest,
  readCalls,
  readReminderCfg,
  type ReminderCall,
  updateReminderCfg,
} from './android-reminder-recorder';

/**
 * 2026 user survey #88: at 9:00 the phone rang once for every task in Today.
 * The notification became opt-in in v20.0.0, but installs from v17.3–v19.x had
 * stored the old default `notifyOnDueDate: true` and kept ringing. The setting
 * now lives under `isNotifyOnPlannedDay`, so the stored value is ignored.
 */
const TODAY = '2026-06-15';
const NINE_AM = new Date(`${TODAY}T09:00:00`).getTime();

const test = androidReminderTest(`${TODAY}T07:00:00`);

const nineAmAlarms = (calls: ReminderCall[]): ReminderCall[] =>
  calls.filter((c) => c.op === 'schedule' && c.triggerAtMs === NINE_AM);

test.describe('Android planned-for-today notification is opt-in', () => {
  test('a stored legacy opt-in does not ring after a restart', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.addTask('No time, no reminder');
    await updateReminderCfg(page, { notifyOnDueDate: true });
    await expect
      .poll(() => readReminderCfg(page))
      .toMatchObject({ notifyOnDueDate: true });

    // Restart: the stored config goes through the real load path.
    await page.reload();
    await waitForAppReady(page);
    await expect
      .poll(() => readReminderCfg(page))
      .toMatchObject({ notifyOnDueDate: true });
    await expect(page.locator('task')).toHaveCount(1);
    // With the notification off, the effect cancels the alarm an older build
    // may have armed for the task: that cancel shows the effect has run.
    await expect
      .poll(async () => (await readCalls(page)).some((c) => c.op === 'cancel'), {
        timeout: 30000,
      })
      .toBe(true);

    expect(nineAmAlarms(await readCalls(page))).toEqual([]);
  });

  // Control: the same path does arm the 9:00 alarm once the user opts in.
  test('rings at 9:00 after opting in', async ({ page, workViewPage }) => {
    await workViewPage.addTask('No time, no reminder');
    await updateReminderCfg(page, { isNotifyOnPlannedDay: true });

    await expect
      .poll(async () => nineAmAlarms(await readCalls(page)).length, { timeout: 30000 })
      .toBe(1);
  });
});
