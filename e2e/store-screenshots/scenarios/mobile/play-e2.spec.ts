/**
 * Google Play listing experiment "E2": a captioned 8-slot phone set, captured
 * separately from the regular store matrix. Opt-in via SP_SCREENSHOTS_PLAY_E2=1
 * and only on the androidPhone project, so normal capture runs are unchanged.
 *
 * Output: dist/screenshots/play-e2/en/NN-<name>.png (written directly, not via
 * screenshotMaster, so build-store-assets never mixes these into play/phone).
 * The regular build's cleanDerivedOutput() deletes this folder, so upload the
 * set before running `npm run screenshots`, or re-capture afterwards.
 *
 * Spec and captions: the marketing repo's ASO doc, aso/super-productivity.md
 * under its docs folder ("E2"). Not a path in this repo.
 *
 *   npm run screenshots:capture:play-e2
 */
import fs from 'fs';
import path from 'path';
import type { Locator, Page } from '@playwright/test';
import { test } from '../../fixture';
import { SCREENSHOTS_OUT_DIR } from '../../matrix';
import {
  addTrackedTime,
  applyTheme,
  applyTimeTrackingEnabled,
  gotoAndSettle,
  resetView,
  scrollScheduleUp,
  setPlannerCalendarExpanded,
  showIssuePanel,
  showMarketingOverlay,
  startFocusOverlay,
  stopFocusOverlay,
} from '../../helpers';
import { PLAY_E2_CAPTIONS as CAPTIONS } from '../../marketing-copy';

const OUT_DIR = path.join(SCREENSHOTS_OUT_DIR, 'play-e2', 'en');

const shoot = async (page: Page, file: string, caption: string): Promise<void> => {
  await showMarketingOverlay(page, caption);
  // The bottom sheet's backdrop lives in the browser top layer, which no
  // z-index beats (slot 5). Promote the caption into the top layer as well,
  // undoing the popover UA defaults that would centre and frame it.
  await page.locator('#__sp-marketing-overlay').evaluate((el: HTMLElement) => {
    el.setAttribute('popover', 'manual');
    Object.assign(el.style, {
      bottom: 'auto',
      margin: '0',
      border: '0',
      width: 'auto',
      height: 'auto',
      // Near-opaque behind the text so app headings don't ghost through it.
      background:
        'linear-gradient(to bottom, rgba(0,0,0,0.97) 0%, rgba(0,0,0,0.95) 70%, rgba(0,0,0,0) 100%)',
    });
    // Even out two-line captions instead of leaving a one-word last line.
    (el.firstElementChild as HTMLElement).style.textWrap = 'balance';
    el.showPopover();
  });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(150);
  await page.screenshot({
    path: path.join(OUT_DIR, `${file}.png`),
    type: 'png',
    animations: 'disabled',
    caret: 'hide',
  });
  await resetView(page);
};

// Plausible three weeks of tracked work: the time-tracking slot needs real
// content, and a page long enough to scroll its summary heading out from
// under the caption. One entry per task (each entry replaces its history).
// [day offset from today, minutes]
const TRACKED_TIME = [
  {
    taskId: 't-design-review',
    minutesByDay: [
      [0, 45],
      [-1, 70],
      [-3, 30],
      [-10, 75],
      [-17, 40],
    ],
  },
  {
    taskId: 't-pr-review',
    minutesByDay: [
      [0, 25],
      [-1, 40],
      [-2, 55],
      [-7, 60],
      [-9, 45],
      [-14, 50],
      [-16, 35],
    ],
  },
  {
    taskId: 't-release-handoff',
    minutesByDay: [
      [-2, 90],
      [-4, 35],
    ],
  },
  {
    taskId: 't-quarterly-plan-sub-1',
    minutesByDay: [
      [-1, 50],
      [-3, 65],
    ],
  },
  {
    taskId: 't-onboarding-doc',
    minutesByDay: [
      [-4, 80],
      [-2, 20],
    ],
  },
  {
    taskId: 't-team-1on1',
    minutesByDay: [
      [0, 15],
      [-3, 25],
      [-8, 30],
      [-15, 30],
    ],
  },
] as const;

/** Wheel-scroll the page so `target` sits `topPx` CSS pixels from the top. */
const scrollToTop = async (page: Page, target: Locator, topPx: number): Promise<void> => {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  // The history list keeps laying out while it scrolls, so one wheel step can
  // overshoot; re-measure and correct a few times.
  for (let i = 0; i < 4; i++) {
    const box = await target.boundingBox();
    if (!box) throw new Error('scroll target not rendered');
    const delta = box.y - topPx;
    if (Math.abs(delta) < 4) return;
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(300);
  }
};

const startPomodoroSession = async (page: Page): Promise<void> => {
  await gotoAndSettle(page, '/#/tag/TODAY/tasks');
  const firstTask = page.locator('task').first();
  await firstTask.waitFor({ state: 'visible' });
  // Phones have no hover start button or header focus button; drive the store.
  await startFocusOverlay(page, 't-design-review', 'Pomodoro');
  await page.locator('focus-mode-main').first().waitFor({ state: 'visible' });
  await page.locator('focus-mode-main .play-button').click();
  // The clock is pinned; advance past the launch animation, then a few minutes.
  await page.clock.runFor(6500);
  await page.locator('focus-mode-main focus-mode-task-tracking').waitFor();
  await page.clock.runFor(4 * 60_000);
  await page.waitForTimeout(300);
};

test.describe('@screenshot play-e2', () => {
  // Play rejects screenshots whose long side exceeds twice the short side, so
  // the matrix's 1236x2745 phone size can't be uploaded. Render 1080x1920
  // (9:16), the size of the live listing set.
  test.use({
    locale: 'en',
    theme: 'dark',
    viewport: { width: 405, height: 720 },
    deviceScaleFactor: 1080 / 405,
  });
  // Skip before the seededPage fixture runs, so regular capture runs don't pay
  // for a full seed just to skip.
  test.skip(process.env.SP_SCREENSHOTS_PLAY_E2 !== '1', 'opt-in Play E2 set');

  test('captioned phone set', async ({ seededPage: page }, testInfo) => {
    test.skip(testInfo.project.name !== 'androidPhone', 'androidPhone only');
    test.setTimeout(6 * 60 * 1000);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    // The native Android app never shows the browser-only "data will not be
    // persisted" snack; report storage as persisted, as on a real phone.
    await page.addInitScript(() => {
      navigator.storage.persisted = async (): Promise<boolean> => true;
    });
    await applyTheme(page, 'dark');
    await applyTimeTrackingEnabled(page, false);

    await gotoAndSettle(page, '/#/tag/TODAY/tasks');
    await page.locator('task').first().waitFor({ state: 'visible' });
    await shoot(page, '01-today', CAPTIONS.today);

    await gotoAndSettle(page, '/#/schedule');
    await page.locator('schedule, schedule-week').first().waitFor({ state: 'visible' });
    await scrollScheduleUp(page);
    await shoot(page, '02-schedule', CAPTIONS.schedule);

    await applyTimeTrackingEnabled(page, true);
    await startPomodoroSession(page);
    await shoot(page, '03-pomodoro', CAPTIONS.pomodoro);
    // The open focus overlay blocks navigation (FocusOverlayOpenGuard).
    await stopFocusOverlay(page);

    await addTrackedTime(page, TRACKED_TIME);
    await gotoAndSettle(page, '/#/project/work/history');
    await page.locator('history').first().waitFor({ state: 'visible' });
    // Scroll so the page's "Time spent total" line sits just below the caption,
    // with the current week's breakdown under it.
    await scrollToTop(
      page,
      page.locator('history .week-title').filter({ hasText: 'Week 19' }),
      225,
    );
    await shoot(page, '04-time-tracking', CAPTIONS.timeTracking);
    await applyTimeTrackingEnabled(page, false);

    await gotoAndSettle(page, '/#/project/work/tasks');
    await page.locator('task').first().waitFor({ state: 'visible' });
    await showIssuePanel(page);
    await page.locator('issue-provider-setup-overview').waitFor({ state: 'visible' });
    // On phones the panel is a bottom sheet that would cover the caption;
    // lower it the way a user drag would.
    await page
      .locator('.mat-bottom-sheet-container')
      .first()
      .evaluate((el: HTMLElement) => {
        const h = `${Math.round(window.innerHeight * 0.78)}px`;
        el.style.setProperty('height', h, 'important');
        el.style.setProperty('max-height', h, 'important');
      });
    // Show the issue providers the caption names, not the calendar section.
    await page
      .locator('issue-provider-setup-overview')
      .getByText('Setup Issue Provider')
      .evaluate((el: HTMLElement) => el.scrollIntoView({ block: 'start' }));
    await shoot(page, '05-integrations', CAPTIONS.integrations);

    await gotoAndSettle(page, '/#/boards/EISENHOWER_MATRIX');
    await page.locator('boards').first().waitFor({ state: 'visible' });
    await shoot(page, '06-boards', CAPTIONS.boards);

    await gotoAndSettle(page, '/#/planner');
    await page.locator('planner-calendar-nav').waitFor({ state: 'visible' });
    await setPlannerCalendarExpanded(page, true);
    await shoot(page, '07-planner', CAPTIONS.planner);

    await gotoAndSettle(page, '/#/config');
    // Phones hide tab label text (icon only), so match the tab by its icon.
    await page.getByRole('tab').filter({ hasText: 'cloud_sync' }).click();
    await page.locator('.sync-summary').waitFor({ state: 'visible' });
    // The footer shows a web-build version string that would date the image.
    await page.locator('.version-footer').evaluate((el: HTMLElement) => {
      el.style.display = 'none';
    });
    await shoot(page, '08-sync', CAPTIONS.privacy);
  });
});
