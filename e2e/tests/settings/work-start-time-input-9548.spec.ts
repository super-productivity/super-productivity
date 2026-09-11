import { expect, test } from '../../fixtures/test.fixture';
import type { Page } from '@playwright/test';
import { SettingsPage } from '../../pages/settings.page';
import { waitForStatePersistence } from '../../utils/waits';

/**
 * #9548: typing `18` into the "Work Day Start" hour segment produced `08`.
 *
 * The config form binds `[model]="cfg()"`, so a field that commits on every
 * keystroke round-trips through the store and hands formly a new model object.
 * Under `extras: { immutable: true }` that replaces the root field config, and
 * formly re-creates the rendered field — measured: the focused `<input>` is
 * destroyed and a fresh one takes its place. Focus follows the replacement, so
 * typing continues, but Blink's segment typeahead buffer lives on the old node
 * and is gone — the first digit is lost.
 *
 * This has to drive the real settings UI: none of that path exists in a
 * component harness, and the segment state only reacts to real key events, so
 * `fill('18:30')` would pass against the broken build.
 */

const SECTION = '.section-schedule';
const WORK_START_INPUT = `${SECTION} input[type=time]`;

const openScheduleSection = async (
  page: Page,
  settingsPage: SettingsPage,
): Promise<void> => {
  await page.goto('/#/config?tab=2');
  await page.waitForURL(/config/);
  await page.locator(`${SECTION} collapsible`).waitFor({ state: 'visible' });
  await settingsPage.expandSection(SECTION);
  // `isWorkStartEndEnabled` defaults to true, so the time fields are rendered.
  await page.locator(WORK_START_INPUT).first().waitFor({ state: 'visible' });
};

test.describe('Schedule: work day start time input (#9548)', () => {
  test('should keep both hour digits and persist them', async ({
    page,
    workViewPage,
    settingsPage,
  }) => {
    await workViewPage.waitForTaskList();
    await openScheduleSection(page, settingsPage);

    const input = page.locator(WORK_START_INPUT).first();
    // focus() lands on the first segment deterministically; click() would target
    // the element centre, which is layout-dependent inside a mat-form-field.
    await input.focus();

    // One key at a time on purpose: the bug only appears between keystrokes, so
    // fill('18:30') would pass against the broken build. Depends on the pinned
    // en-GB (24h) locale in playwright.config.ts — a 12h locale needs a
    // different key sequence.
    for (const key of ['1', '8', '3', '0']) {
      await page.keyboard.press(key);
    }
    await expect(input).toHaveValue('18:30');

    // The field is `updateOn: 'blur'` — the value only reaches the form on blur.
    await input.blur();
    await waitForStatePersistence(page);

    await page.reload();
    await openScheduleSection(page, settingsPage);
    await expect(page.locator(WORK_START_INPUT).first()).toHaveValue('18:30');
  });
});
