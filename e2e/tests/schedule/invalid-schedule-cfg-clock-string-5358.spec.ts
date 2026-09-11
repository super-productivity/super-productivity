import { expect, test } from '../../fixtures/test.fixture';

/**
 * Bug: https://github.com/super-productivity/super-productivity/issues/5358
 * (and the `#/schedule` variant in #4842)
 *
 * A malformed time in the *schedule config* (workStart / workEnd /
 * lunchBreakStart / lunchBreakEnd) makes getDateTimeFromClockString() throw
 * "Invalid clock string" the moment the Schedule renders, taking the whole
 * view down.
 *
 * The settings form validates, so such a value does not come from the UI --
 * it arrives verbatim from an import or a synced snapshot: `loadAllData`
 * spreads globalConfig over the defaults at the top level only, so unlike
 * misc/tasks/idle/... the `schedule` section gets no per-field defaulting,
 * and typia accepts '' for a `string` so autoFixTypiaErrors never repairs it.
 * `updateGlobalConfigSection` -- dispatched below, and the same action a
 * remote op replays -- takes a partial section with no validation at all.
 *
 * Expected: the Schedule renders without work-hours blocks (as when the
 *           feature is off), rather than crashing.
 */

const DESKTOP_VIEWPORT = { width: 1280, height: 720 };

type StoreLike = {
  dispatch: (action: unknown) => void;
  subscribe: (next: (state: unknown) => void) => { unsubscribe: () => void };
};

/**
 * Dispatch straight into the in-memory NgRx store and read the resulting
 * schedule config back, so the test cannot silently pass on a no-op write.
 *
 * Uses `window.__e2eTestHelpers.store` (main.ts), NOT `ng.getComponent`: the
 * CI e2e bundle is built by `ng build` with no configuration, which keeps the
 * dev `environment` (so the helper is exposed) but leaves `optimization` at
 * its default `true` -- and that defines `ngDevMode: false`, which strips the
 * Angular global debug utils. A `ng.getComponent` probe therefore works under
 * `ng serve` locally and silently returns nothing in CI.
 *
 * The helper is attached after a dynamic import resolves, hence the poll.
 */
const corruptScheduleCfg = async (
  page: import('@playwright/test').Page,
): Promise<void> => {
  await expect
    .poll(
      () =>
        page.evaluate((): string | null => {
          const store = (
            window as unknown as { __e2eTestHelpers?: { store?: StoreLike } }
          ).__e2eTestHelpers?.store;
          if (!store) return null;

          store.dispatch({
            type: '[Global Config] Update Global Config Section',
            sectionKey: 'schedule',
            sectionCfg: {
              isWorkStartEndEnabled: true,
              workStart: '',
              workEnd: '',
              isLunchBreakEnabled: true,
              lunchBreakStart: '',
              lunchBreakEnd: '',
            },
            isSkipSnack: true,
          });

          let state: unknown = null;
          store.subscribe((s) => (state = s)).unsubscribe();
          return (
            (state as { globalConfig?: { schedule?: { workStart?: string } } } | null)
              ?.globalConfig?.schedule?.workStart ?? null
          );
        }),
      { message: 'schedule config should read back as corrupted' },
    )
    .toBe('');
};

test.describe('Schedule with a corrupt schedule config (#5358)', () => {
  test.use({ viewport: DESKTOP_VIEWPORT });

  test('renders the Schedule instead of throwing "Invalid clock string"', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();

    // At least one task is required: mapToScheduleDays early-returns [] when
    // tasks, scheduled tasks, repeat cfgs, calendar items and planner days are
    // ALL empty, so a clean profile never reaches the blocker-block code at
    // all. That is very likely why this was filed "unable to reproduce".
    await workViewPage.addTask('ScheduleCfgBug5358');

    // Both oracles below were verified to FAIL against the pre-fix commit:
    // the throw escapes the schedule computed, `schedule-week` never renders,
    // and the error surfaces as a pageerror. (An earlier version of this test
    // passed while broken because it had no task -- see addTask above.)
    const clockErrors: string[] = [];
    const record = (text: string): void => {
      if (text.includes('Invalid clock string')) clockErrors.push(text);
    };
    page.on('console', (m) => m.type() === 'error' && record(m.text()));
    page.on('pageerror', (e) => record(e.message));

    await corruptScheduleCfg(page);

    await page.getByRole('menuitem', { name: 'Schedule' }).click();
    await expect(page.locator('schedule-week')).toBeVisible({ timeout: 10000 });

    // The view must actually be populated, not an empty shell left behind by a
    // swallowed error.
    await expect(
      page.locator('schedule-week .col:not(.end-of-day)[data-day]').first(),
    ).toBeVisible();

    expect(clockErrors).toEqual([]);
  });
});
