/**
 * Single-session capture of every desktop scenario across both locales and
 * both themes. Switches are driven via NgRx dispatch through
 * `window.__e2eTestHelpers.store` (exposed in dev/stage builds — see
 * src/main.ts), so we don't relaunch the browser / Electron app or
 * re-import the seed between variants.
 *
 * Order:
 *   en × dark   (slots 01, 02, 03, 05)
 *   en × light  (slots 04, 06)
 *   de × dark   (slots 01, 02, 03, 05)
 *   de × light  (slots 04, 06)
 *   en × dark   (slot 07 — project view, no wallpaper)
 */
import { test } from '../../fixture';
import { LOCALES, type Locale } from '../../matrix';
import {
  applyLocale,
  applySideNavCollapsed,
  applyTheme,
  gotoAndSettle,
  openNotesPanel,
  openSchedulePanel,
  resetView,
  scrollScheduleUp,
  showMarketingOverlay,
} from '../../helpers';
import { MARKETING_HEADLINE, MARKETING_SUBLINE } from '../../marketing-copy';
import type { Page } from '@playwright/test';

const captureDarkScenes = async (
  page: Page,
  shoot: (scenario: string, name: string) => Promise<void>,
): Promise<void> => {
  // 01 — Today + schedule day-panel open. Side nav collapsed so the right
  // panel doesn't squeeze the task list.
  await applySideNavCollapsed(page, true);
  await gotoAndSettle(page, '/#/tag/TODAY/tasks');
  await page.locator('task').first().waitFor({ state: 'visible' });
  await openSchedulePanel(page);
  await page.waitForTimeout(500);
  await shoot('desktop-01-list-with-schedule', 'list-with-schedule');
  await applySideNavCollapsed(page, false);
  await resetView(page);

  // 02 — Eisenhower board
  await gotoAndSettle(page, '/#/boards');
  await page.locator('boards').first().waitFor({ state: 'visible' });
  await page
    .locator('board-panel, .panel, mat-card')
    .first()
    .waitFor({ state: 'visible' });
  await shoot('desktop-02-eisenhower', 'eisenhower');
  await resetView(page);

  // 03 — Schedule
  await gotoAndSettle(page, '/#/schedule');
  await page.locator('schedule, schedule-week').first().waitFor({ state: 'visible' });
  await scrollScheduleUp(page);
  await shoot('desktop-03-schedule-dark', 'schedule-dark');
  await resetView(page);

  // 05 — Focus mode, running timer (not duration-selection).
  await gotoAndSettle(page, '/#/tag/TODAY/tasks');
  const firstTask = page.locator('task').first();
  await firstTask.waitFor({ state: 'visible' });
  await firstTask.hover();
  const playOnTask = firstTask.locator('.start-task-btn');
  await playOnTask.waitFor({ state: 'visible', timeout: 5_000 });
  await playOnTask.click();
  await page.waitForTimeout(200);
  await page.locator('.focus-btn-wrapper button').first().click();
  await page
    .locator('focus-mode-overlay, focus-mode-main')
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 });
  // Start the session, then skip the rocket countdown (5s + 900ms launch).
  // The fixture pinned the clock with `page.clock.install`, so we have to
  // advance simulated time to fire the rocket's RxJS timer + setTimeout.
  await page.locator('focus-mode-main .play-button').click();
  await page.clock.runFor(6500);
  await page
    .locator('focus-mode-main .pause-resume-btn')
    .waitFor({ state: 'visible', timeout: 10_000 });
  // Tick a minute of session time so the clock face shows progress and the
  // remaining time isn't exactly the starting duration.
  await page.clock.runFor(60_000);
  await page.waitForTimeout(300);
  await shoot('desktop-05-focus-mode', 'focus-mode');
  await resetView(page);

  // 08 — Planner (desktop layout). Mobile already has planner-default and
  // planner-expanded; desktop deserves its own canvas.
  await gotoAndSettle(page, '/#/planner');
  await page.locator('planner, planner-day').first().waitFor({ state: 'visible' });
  await shoot('desktop-08-planner', 'planner');
};

const captureLightScenes = async (
  page: Page,
  shoot: (scenario: string, name: string) => Promise<void>,
): Promise<void> => {
  // 04 — Project (Work) + notes panel. Side nav collapsed so the notes
  // panel can breathe.
  await applySideNavCollapsed(page, true);
  await gotoAndSettle(page, '/#/project/work/tasks');
  await page.locator('task').first().waitFor({ state: 'visible' });
  await openNotesPanel(page);
  await page.waitForTimeout(500);
  await shoot('desktop-04-list-with-notes', 'list-with-notes');
  await applySideNavCollapsed(page, false);
  await resetView(page);

  // 06 — Schedule (light variant)
  await gotoAndSettle(page, '/#/schedule');
  await page.locator('schedule, schedule-week').first().waitFor({ state: 'visible' });
  await scrollScheduleUp(page);
  await shoot('desktop-06-schedule-light', 'schedule-light');
  await resetView(page);

  // 02 — Eisenhower board (light variant). Distinct scenario name from the
  // dark slot so both land in the master tree without overwriting.
  await gotoAndSettle(page, '/#/boards');
  await page.locator('boards').first().waitFor({ state: 'visible' });
  await page
    .locator('board-panel, .panel, mat-card')
    .first()
    .waitFor({ state: 'visible' });
  await shoot('desktop-02-eisenhower-light', 'eisenhower-light');
};

test.describe('@screenshot desktop all', () => {
  // Initial values; switches happen mid-test.
  test.use({ locale: 'en', theme: 'dark' });

  test('every desktop variant in one session', async ({
    seededPage,
    screenshotMaster,
  }) => {
    // Two locales × multiple scenarios can exceed the 180s default.
    test.setTimeout(8 * 60 * 1000);
    const page = seededPage;

    // 00 — Cover/hero. Today list with a marketing caption strip overlaid
    // on top so the lead app-store gallery shot is branded but still shows
    // the real app underneath.
    await applyTheme(page, 'dark');
    await gotoAndSettle(page, '/#/tag/TODAY/tasks');
    await page.locator('task').first().waitFor({ state: 'visible' });
    await showMarketingOverlay(page, MARKETING_HEADLINE, MARKETING_SUBLINE);
    await screenshotMaster('desktop-00-hero', 'hero');
    await resetView(page);

    for (let i = 0; i < LOCALES.length; i += 1) {
      const lng = LOCALES[i] as Locale;
      // The seed already starts on `en`; only dispatch a switch when we move
      // to a different locale, otherwise we'd waste a translate-bundle fetch.
      if (i > 0) await applyLocale(page, lng);

      await applyTheme(page, 'dark');
      await captureDarkScenes(page, screenshotMaster);

      await applyTheme(page, 'light');
      await captureLightScenes(page, screenshotMaster);
    }

    // 07 — Project view, dark theme. Project contexts don't carry a
    // background image (see seed/build-seed.ts: `applyBg` only runs on
    // tag themes), so the regular palette reads cleanly without a
    // wallpaper competing for attention.
    await applyLocale(page, 'en');
    await applyTheme(page, 'dark');
    await gotoAndSettle(page, '/#/project/work/tasks');
    await page.locator('task').first().waitFor({ state: 'visible' });
    await screenshotMaster('desktop-07-project-dark', 'project-dark');
  });
});
