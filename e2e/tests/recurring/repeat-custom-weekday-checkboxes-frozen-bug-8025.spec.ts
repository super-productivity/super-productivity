import { expect, test } from '../../fixtures/test.fixture';
import { type Page } from '@playwright/test';
import { openRecurDialog, saveRecurDialog } from '../../utils/recurring-task-helpers';

/**
 * Bug: https://github.com/super-productivity/super-productivity/issues/8025
 *
 * In the CUSTOM recurring config, switching the "Recur cycle" away from Weekly
 * (to Month/Year) and back to Weekly leaves the weekday checkboxes rendered but
 * non-interactive: they "look enabled but are actually disabled". A click no
 * longer updates the model, so the user's weekday selection is silently lost.
 *
 * Expected: after the Week -> Month -> Week round-trip the weekday checkboxes
 *           remain fully interactive: un-checking Monday persists, exactly as
 *           it would without the round-trip.
 *
 * This test reproduces the defect by toggling Monday off AFTER the round-trip
 * and asserting the change survives a save (read back from the NgRx store). The
 * weekday group is configured with `resetOnHide: false`, so preservation is the
 * intended design; the failure is the lost interactivity, not a deliberate
 * reset.
 */

const DIALOG = 'mat-dialog-container';

/** Switch the quick-setting select (first select in the dialog). */
const setQuickSetting = async (page: Page, optionLabel: RegExp): Promise<void> => {
  const dialog = page.locator(DIALOG);
  await dialog.locator('mat-select').first().click();
  const option = page.locator('mat-option').filter({ hasText: optionLabel });
  await expect(option).toBeVisible({ timeout: 5000 });
  await option.click();
  await expect(page.locator('mat-option')).toHaveCount(0, { timeout: 5000 });
};

/** Switch the CUSTOM "Recur cycle" select (Day / Week / Month / Year). */
const setRepeatCycle = async (page: Page, optionLabel: RegExp): Promise<void> => {
  const dialog = page.locator(DIALOG);
  const cycleSelect = dialog.locator('.repeat-cycle mat-select').first();
  await expect(cycleSelect).toBeVisible({ timeout: 5000 });
  await cycleSelect.click();
  const option = page.locator('mat-option').filter({ hasText: optionLabel });
  await expect(option).toBeVisible({ timeout: 5000 });
  await option.click();
  await expect(page.locator('mat-option')).toHaveCount(0, { timeout: 5000 });
};

type WeekdayKey =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

type PersistedRepeatCfgSnapshot = {
  quickSetting: string | null;
  repeatCycle: string | null;
  weekday: boolean | null;
};

/** Read a recurrence snapshot for the repeat config created for the given title. */
const getPersistedRepeatCfgSnapshot = async (
  page: Page,
  title: string,
  weekday: WeekdayKey,
): Promise<PersistedRepeatCfgSnapshot> =>
  page.evaluate(
    ({ taskTitle, weekdayKey }: { taskTitle: string; weekdayKey: WeekdayKey }) => {
      type RepeatCfgLike = {
        quickSetting?: string | null;
        repeatCycle?: string | null;
        title?: string | null;
      } & Partial<Record<WeekdayKey, boolean>>;
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
        weekday: cfg ? (cfg[weekdayKey] ?? null) : null,
      };
    },
    { taskTitle: title, weekdayKey: weekday },
  );

test.describe('Recurring Task - Custom weekday checkboxes frozen after cycle round-trip (#8025)', () => {
  test('should keep weekday checkboxes interactive after switching cycle to Month and back to Week', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const taskTitle = `${testPrefix}-WeekdayFrozen8025`;

    await workViewPage.waitForTaskList();
    await workViewPage.addTask(taskTitle);
    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });
    await taskPage.openTaskDetail(task);
    const dialog = await openRecurDialog(page);

    // Enter CUSTOM mode; repeatCycle defaults to WEEKLY with Mon-Fri checked.
    await setQuickSetting(page, /Custom recurring config/i);

    const mondayCheckbox = dialog
      .locator('.weekdays mat-checkbox')
      .filter({ hasText: /Monday/i });
    const mondayInput = mondayCheckbox.locator('input[type="checkbox"]');
    await expect(mondayInput).toBeChecked(); // sanity: default Weekly has Monday on

    // The round-trip that triggers the bug: Week -> Month -> Week.
    await setRepeatCycle(page, /^Month$/);
    await setRepeatCycle(page, /^Week$/);

    // After the round-trip the checkbox is re-rendered. Try to un-check Monday.
    await expect(mondayCheckbox).toBeVisible({ timeout: 5000 });
    await mondayCheckbox.click();

    // Save and read the persisted config back from the store. With the bug the
    // click never reached the model, so `monday` is still `true`.
    await saveRecurDialog(page);

    await expect
      .poll(() => getPersistedRepeatCfgSnapshot(page, taskTitle, 'monday'), {
        timeout: 10000,
      })
      .toEqual({
        quickSetting: 'CUSTOM',
        repeatCycle: 'WEEKLY',
        weekday: false,
      });
  });

  test('should keep weekday checkboxes interactive after switching away from CUSTOM and back', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const taskTitle = `${testPrefix}-CustomRoundTrip8025`;

    await workViewPage.waitForTaskList();
    await workViewPage.addTask(taskTitle);
    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });
    await taskPage.openTaskDetail(task);
    const dialog = await openRecurDialog(page);

    await setQuickSetting(page, /Custom recurring config/i);
    await setQuickSetting(page, /Every day/i);
    await setQuickSetting(page, /Custom recurring config/i);
    await setRepeatCycle(page, /^Week$/);

    const tuesdayCheckbox = dialog
      .locator('.weekdays mat-checkbox')
      .filter({ hasText: /Tuesday/i });
    const tuesdayInput = tuesdayCheckbox.locator('input[type="checkbox"]');
    await expect(tuesdayInput).toBeChecked();

    await tuesdayCheckbox.click();
    await saveRecurDialog(page);

    await expect
      .poll(() => getPersistedRepeatCfgSnapshot(page, taskTitle, 'tuesday'), {
        timeout: 10000,
      })
      .toEqual({
        quickSetting: 'CUSTOM',
        repeatCycle: 'WEEKLY',
        weekday: false,
      });
  });
});
