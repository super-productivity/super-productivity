import type { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { openRecurDialog, saveRecurDialog } from '../../utils/recurring-task-helpers';

const readRepeatInstanceIds = (page: Page): Promise<string[]> =>
  page.evaluate(async () => {
    const { store } = (
      window as unknown as {
        __e2eTestHelpers: {
          store: {
            subscribe: (cb: (state: { tasks: { ids: string[] } }) => void) => {
              unsubscribe: () => void;
            };
          };
        };
      }
    ).__e2eTestHelpers;
    return new Promise<string[]>((resolve) => {
      const subscription = store.subscribe((state) => {
        window.setTimeout(() => subscription.unsubscribe());
        // Same config, so sorting orders the instances by day.
        resolve(state.tasks.ids.filter((id) => id.startsWith('rpt_')).sort());
      });
    });
  });

/**
 * A repeat instance is created at noon of its day in the creating timezone.
 * Twelve or more hours further east, that noon falls on the next day, and the
 * next day's occurrence used to count as already created. Its deterministic id
 * (`rpt_<cfgId>_<day>`) names the occurrence's day in every timezone.
 *
 * The clock moves with setSystemTime, as in the #6230 day-change spec.
 */
test.describe('Repeat Task - timezone change', () => {
  test('creates the next daily occurrence after moving to a timezone a day ahead', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const taskTitle = `${testPrefix}-DailyRepeatTimezone`;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTimezoneOverride', {
      timezoneId: 'America/Los_Angeles',
    });
    // June 15, 12:00 in Los Angeles.
    await page.clock.setSystemTime(new Date('2026-06-15T19:00:00Z'));
    await page.reload();
    await workViewPage.waitForTaskList();

    await workViewPage.addTask(taskTitle);
    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });
    await taskPage.openTaskDetail(task);
    await openRecurDialog(page);
    await saveRecurDialog(page);
    await page.keyboard.press('Escape');

    // June 16, 09:00 in Los Angeles: the June 16 occurrence is created at
    // 12:00 Los Angeles time, which is June 17, 04:00 in Tokyo.
    await page.clock.setSystemTime(new Date('2026-06-16T16:00:00Z'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect
      .poll(() => readRepeatInstanceIds(page), { timeout: 60000 })
      .toEqual([expect.stringMatching(/_2026-06-16$/)]);

    // The device travels to Tokyo and the app starts on June 17, 09:00.
    await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Tokyo' });
    await page.clock.setSystemTime(new Date('2026-06-17T00:00:00Z'));
    await page.reload();
    await workViewPage.waitForTaskList();

    // Default Daily cleanup may already have removed the untouched June 16 instance.
    await expect
      .poll(() => readRepeatInstanceIds(page), { timeout: 60000 })
      .toContainEqual(expect.stringMatching(/_2026-06-17$/));
  });
});
