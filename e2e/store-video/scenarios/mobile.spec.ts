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
 *   3  Tap task  → focus mode on tapped task.
 *   4  End card  "Mobile · iOS · Android" with stat counter.
 *
 * Activated only by `REEL_VARIANT=mobile`. Output lands as
 * `dist/video/reel-mobile.{mp4,webm,gif}` at 1080×2340.
 */
import type { Locator, Page } from '@playwright/test';
import { test } from '../fixture';
import { loopBoundary, showEndCard, showOverlay } from '../overlays';

const VARIANT = process.env.REEL_VARIANT ?? '';
const NEW_TASK_TITLE = 'Plan trip 30m';
const NEW_TASK_DISPLAY = 'Plan trip';

const tapCenter = async (page: Page, locator: Locator): Promise<void> => {
  const box = await locator.boundingBox();
  if (!box) return;
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
    const b1 = await showOverlay(page, 'On the go.');
    await page.waitForTimeout(900);
    void b1.hide();
    await page.waitForTimeout(220);

    // ── Beat 2 — Tap + → quick capture ───────────────────────────────────
    const b2 = await showOverlay(page, 'Tap to capture.');
    // Open the global add-task bar via store dispatch — the mobile FAB
    // selector varies across breakpoints, but the bar itself is the same
    // surface and the tap-ripple before dispatch makes the cause visible.
    const fab = page
      .locator(
        'button.e2e-add-task-fab, .add-task-fab button, button[aria-label*="Add Task" i]',
      )
      .first();
    if (await fab.isVisible().catch(() => false)) {
      await tapCenter(page, fab);
    } else {
      await page.evaluate(() => {
        const helper = (
          window as unknown as {
            __e2eTestHelpers?: { store?: { dispatch: (a: unknown) => void } };
          }
        ).__e2eTestHelpers;
        helper?.store?.dispatch({ type: '[Layout] Show AddTaskBar' });
      });
    }
    const globalInput = page.locator('add-task-bar.global input').first();
    await globalInput.waitFor({ state: 'visible', timeout: 5_000 });
    await page.waitForTimeout(220);
    await globalInput.pressSequentially(NEW_TASK_TITLE, { delay: 55 });
    await page.waitForTimeout(360);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    const backdrop = page.locator('.backdrop').first();
    if (await backdrop.isVisible().catch(() => false)) {
      await backdrop.click({ force: true });
      await backdrop.waitFor({ state: 'hidden', timeout: 2_000 }).catch(() => undefined);
    }
    await page
      .locator('add-task-bar.global')
      .first()
      .waitFor({ state: 'hidden', timeout: 3_000 })
      .catch(() => undefined);
    void b2.hide();
    await page.waitForTimeout(220);

    // ── Beat 3 — Tap captured task → focus mode ──────────────────────────
    const b3 = await showOverlay(page, 'Tap to focus.');
    const newTask = page.locator('task').filter({ hasText: NEW_TASK_DISPLAY }).first();
    await newTask.waitFor({ state: 'visible', timeout: 5_000 });
    const newTaskId = await newTask.getAttribute('data-task-id').catch(() => null);
    await tapCenter(page, newTask);
    await page.waitForTimeout(160);
    // The tap visibly lands on the task; the focus-mode entry happens via
    // dispatch so it doesn't depend on whichever overflow menu the tap
    // routes through on this breakpoint.
    if (newTaskId) {
      await page.evaluate((id) => {
        const helper = (
          window as unknown as {
            __e2eTestHelpers?: { store?: { dispatch: (a: unknown) => void } };
          }
        ).__e2eTestHelpers;
        if (!helper?.store) return;
        helper.store.dispatch({ type: '[Task] SetCurrentTask', id });
        helper.store.dispatch({ type: '[FocusMode] Show Overlay' });
        helper.store.dispatch({
          type: '[FocusMode] Start Session',
          duration: 1500000,
        });
      }, newTaskId);
      await page
        .locator('focus-mode-main')
        .first()
        .waitFor({ state: 'visible', timeout: 8_000 })
        .catch(() => undefined);
      await page.clock.runFor(5500).catch(() => undefined);
      await page
        .locator('focus-mode-main .bottom-controls')
        .first()
        .waitFor({ state: 'visible', timeout: 5_000 })
        .catch(() => undefined);
      await page.clock.resume().catch(() => undefined);
    }
    await page.waitForTimeout(1600);
    void b3.hide();
    await page.waitForTimeout(220);

    // ── Beat 4 — End card "Mobile · iOS · Android" ──────────────────────
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
