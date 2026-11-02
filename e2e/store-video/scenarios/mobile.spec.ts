/**
 * Mobile-touch reel — four-beat choreography demonstrating Super Productivity
 * on a phone. The fixture enables `hasTouch` and `isMobile` for this variant
 * so the context dispatches real touch events; each beat uses
 * `page.touchscreen.tap()` and the fixture's tap-ripple init script spawns a
 * visible ring at each touch point.
 *
 *   Lead-in       Black fades to SP work-view (mobile layout).
 *   1  "On the go." tagline overlay.
 *   2  Tap "+"   → quick add task, type, confirm.
 *   3  Tap focus → select the captured task and start a focus session.
 *   4  End card  "Mobile · iOS · Android" with stat counter.
 *
 * Activated only by `REEL_VARIANT=mobile`. Output lands as
 * `dist/video/reel-mobile.{mp4,webm,gif}` at 1080×2340.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { test } from '../fixture';
import { loopBoundary, markScene, showEndCard, showOverlay } from '../../video-kit';

const VARIANT = process.env.REEL_VARIANT ?? '';
const NEW_TASK_TITLE = 'Plan trip 30m';
const NEW_TASK_DISPLAY = 'Plan trip';

const tapCenter = async (page: Page, locator: Locator): Promise<void> => {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error('Touch target has no bounding box');
  const halfW = box.width / 2;
  const halfH = box.height / 2;
  const cx = box.x + halfW;
  const cy = box.y + halfH;
  await page.touchscreen.tap(cx, cy);
};

test.describe('@video mobile reel', () => {
  test.skip(VARIANT !== 'mobile', 'mobile reel only runs when REEL_VARIANT=mobile');
  test.use({ locale: 'en', theme: 'dark' });

  test('mobile reel', async ({ seededPage, markBeatsStart }) => {
    const page = seededPage;

    // ── Pre-roll (trimmed off the reel) ──────────────────────────────────
    await page.goto('/#/tag/TODAY/tasks');
    await page.locator('task').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(300);
    markBeatsStart();

    // ── Lead-in ──────────────────────────────────────────────────────────
    await loopBoundary(page, 'in', 460);

    // ── Beat 1 — "On the go." ────────────────────────────────────────────
    markScene(page, 'On the go.');
    const b1 = await showOverlay(page, 'On the go.');
    await page.waitForTimeout(900);
    void b1.hide();
    await page.waitForTimeout(220);

    // ── Beat 2 — Tap + → quick capture ───────────────────────────────────
    markScene(page, 'Tap to capture.');
    const b2 = await showOverlay(page, 'Tap to capture.');
    await page.waitForTimeout(600);
    await b2.hide();
    const fab = page.locator('mobile-bottom-nav button.add-task-button');
    await tapCenter(page, fab);
    const globalInput = page.locator('add-task-bar.global .main-input').first();
    await expect(globalInput).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(220);
    await globalInput.pressSequentially(NEW_TASK_TITLE, { delay: 55 });
    await page.waitForTimeout(360);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    const newTask = page.locator('task').filter({ hasText: NEW_TASK_DISPLAY }).first();
    await expect(newTask).toBeVisible({ timeout: 5_000 });
    const backdrop = page.locator('.backdrop').first();
    if (await backdrop.isVisible().catch(() => false)) {
      await backdrop.click({ force: true });
      await expect(backdrop).toBeHidden({ timeout: 2_000 });
    }
    await expect(page.locator('add-task-bar.global').first()).toBeHidden({
      timeout: 3_000,
    });
    await page.waitForTimeout(220);

    // ── Beat 3 — Open focus mode and select the captured task ────────────
    markScene(page, 'Tap to focus.');
    const b3 = await showOverlay(page, 'Tap to focus.');
    await page.waitForTimeout(600);
    await b3.hide();
    await tapCenter(page, page.locator('main-header focus-button button'));
    await expect(page.locator('focus-mode-main')).toBeVisible({ timeout: 5_000 });
    await tapCenter(page, page.locator('focus-mode-main .task-title-placeholder'));
    const selector = page.locator('focus-mode-task-selector .task-selector-overlay');
    await expect(selector).toBeVisible();
    await selector.locator('input').fill(NEW_TASK_DISPLAY);
    await tapCenter(page, page.getByRole('option', { name: NEW_TASK_DISPLAY }));
    await expect(page.locator('focus-mode-main task-title')).toContainText(
      NEW_TASK_DISPLAY,
    );
    await tapCenter(page, page.locator('focus-mode-main button.play-button'));
    await page.clock.runFor(5500);
    await expect(page.locator('focus-mode-main .bottom-controls')).toBeVisible();
    await page.clock.resume();
    await page.waitForTimeout(1600);
    await page.waitForTimeout(220);

    // ── Beat 4 — End card "Mobile · iOS · Android" ──────────────────────
    markScene(page, 'Take it anywhere.');
    await showEndCard(
      page,
      {
        logo: {
          src: '/assets/icons/sp.svg',
          alt: 'Super Productivity',
          monochrome: true,
        },
        title: 'Take it anywhere.',
        subtitle: 'superproductivity.com',
        stats: [
          { template: '{n} ★ on Google Play', to: 4.8, decimals: 1 },
          'iOS · Android · Web · Desktop',
        ],
      },
      { fadeMs: 560 },
    );
    // Tear focus mode down behind the card so the loop-out doesn't flash
    // it between end card and black.
    await page.evaluate(() => {
      const helper = (
        window as unknown as {
          __e2eTestHelpers?: { store?: { dispatch: (a: unknown) => void } };
        }
      ).__e2eTestHelpers;
      helper?.store?.dispatch({ type: '[FocusMode] Hide Overlay' });
      helper?.store?.dispatch({ type: '[FocusMode] Cancel Session' });
    });
    await page.waitForTimeout(2300);

    // ── Loop boundary ────────────────────────────────────────────────────
    await loopBoundary(page, 'out', 460);
  });
});
