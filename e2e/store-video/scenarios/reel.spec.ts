/**
 * Marketing reel — five (tight) or six (full) beats.
 *
 *   Lead-in       Black fades to SP UI with schedule panel open.
 *   1  Capture in seconds.        type a task with short syntax
 *                                 (`A task 1h`).
 *   1.5 [full only]               No account. No tracking.
 *   2  Plan your day.             drag the captured task onto the
 *                                 schedule panel using the app's real
 *                                 cdkDrag behavior.
 *   3  Focus on what matters.     focus-mode in progress on the
 *                                 captured task. clock.resume() lets
 *                                 the timer tick visibly.
 *   4  Work from GitHub, Jira & more.  full-screen integrations card.
 *   5  Free and open source.      end card with stat counter-ups
 *                                 (staggered).
 *   Boundary       Black fades in so the gif loop seam is clean.
 *
 * Variant selection via `REEL_VARIANT`:
 *   (unset)        tight default — drops "No account. No tracking."
 *                  and tightens beat holds, lands at ~16-17s.
 *   full           includes every beat at the original durations,
 *                  ~21s. Run via `npm run video:full`.
 *
 * Tune copy or beat order in this file — every choice is one block,
 * edited independently.
 */
import { test } from '../fixture';
import type { OverlayHandle } from '../overlays';
import {
  LOGOS,
  cutToScene,
  loopBoundary,
  showEndCard,
  showIntegrationsCard,
  showOverlay,
} from '../overlays';

const VARIANT = process.env.REEL_VARIANT ?? '';
const isFull = VARIANT === 'full';
// 9:16 portrait variant for TikTok / YouTube Shorts / Instagram Reels. Skips
// beat 2 (the side-panel drag doesn't translate to portrait — the schedule
// panel makes no sense without horizontal room) and tightens hold timings
// so the reel lands in the ~12-14s sweet spot for short-form algorithms.
const isShorts = VARIANT === 'shorts';

const parkCursor = async (page: import('@playwright/test').Page): Promise<void> => {
  // Park the cursor offscreen so any matTooltip dismisses and the cursor
  // doesn't sit on top of a button while overlays are visible.
  try {
    await page.mouse.move(0, 0);
  } catch {
    /* noop */
  }
};

/**
 * Short-syntax string typed into the global add-task bar in beat 1.
 *   "A task"      title
 *   "1h"          time estimate
 */
const CAPTURED_TASK_TITLE = 'A task 1h';
const CAPTURED_TASK_DISPLAY_TITLE = 'A task';

test.describe('@video reel', () => {
  // The keyboard and mobile variants have their own choreography (see
  // keyboard.spec.ts / mobile.spec.ts); skip this spec when either is
  // active so a single capture run doesn't record two unrelated webms.
  test.skip(VARIANT === 'keyboard', 'keyboard variant runs keyboard.spec.ts');
  test.skip(VARIANT === 'mobile', 'mobile variant runs mobile.spec.ts');
  test.use({ locale: 'en', theme: 'dark' });

  test('marketing reel', async ({ seededPage, markBeatsStart }) => {
    const page = seededPage;

    // ── Pre-roll (trimmed off the gif) ────────────────────────────────────
    await page.goto('/#/tag/TODAY/tasks');
    await page.locator('task').first().waitFor({ state: 'visible', timeout: 15_000 });
    const scheduleBtn = page.locator('.e2e-toggle-schedule-day-panel').first();
    if (!isShorts && (await scheduleBtn.isVisible().catch(() => false))) {
      await scheduleBtn.click();
      await page.locator('schedule-day-panel').first().waitFor({
        state: 'visible',
        timeout: 5_000,
      });
      // The panel's `_scrollToCurrentTime` runs on a 100ms timeout after init
      // and parks the current-time marker ~50px from the top, which lands the
      // simulated 09:30 close to the panel's top edge. Wait past that and
      // nudge further down so the visible window covers more of the working
      // day — gives beat 2's drop target more visual context (the drag lands
      // on a populated mid-day stretch instead of an empty pre-9:30 area).
      await page.waitForTimeout(200);
      await page.evaluate(() => {
        const panel = document.querySelector('schedule-day-panel');
        const container =
          (panel?.closest('.side-inner') as HTMLElement | null) ??
          (document.querySelector('.side-inner') as HTMLElement | null);
        if (container) {
          container.scrollTop += 120;
        }
      });
    }
    await parkCursor(page);
    await page.waitForTimeout(400);

    markBeatsStart();

    // ── Lead-in ──────────────────────────────────────────────────────────
    await loopBoundary(page, 'in', isFull ? 600 : 480);

    // ── Beat 1 — Capture in seconds. ─────────────────────────────────────
    const b1 = await showOverlay(page, 'Capture in seconds.');
    await page.evaluate(() => {
      const helper = (
        window as unknown as {
          __e2eTestHelpers?: { store?: { dispatch: (a: unknown) => void } };
        }
      ).__e2eTestHelpers;
      helper?.store?.dispatch({ type: '[Layout] Show AddTaskBar' });
    });
    const globalInput = page.locator('add-task-bar.global input').first();
    await globalInput.waitFor({ state: 'visible', timeout: 5_000 });
    await page.waitForTimeout(250);
    await globalInput.click();
    // Hide the cursor highlight during typing — it sits in the middle of
    // the focused input and reads as a stray white dot. Restored after.
    await page.evaluate(() => document.body.classList.add('__sp-hide-cursor-highlight'));
    await globalInput.pressSequentially(CAPTURED_TASK_TITLE, { delay: 55 });
    await page.waitForTimeout(450);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // ── Beat 1 → next: cut to black, swap state ──────────────────────────
    // cutToScene fades to opaque black (z-index max), runs the callback
    // behind it (state changes invisible), then fades back to reveal the
    // new state. `noWait` on the next overlay lets its fade-in play
    // *during* the fade-from-black instead of being wasted behind it.
    let capturedTaskId: string | null = null;
    let bExtra: OverlayHandle | undefined;
    let b2: OverlayHandle | undefined;
    await cutToScene(
      page,
      async () => {
        const backdrop = page.locator('.backdrop').first();
        await backdrop.waitFor({ state: 'visible', timeout: 1_000 }).catch(() => {
          /* Add-task bar may have already closed itself after Enter. */
        });
        if (await backdrop.isVisible().catch(() => false)) {
          await backdrop.click({ force: true });
          await backdrop.waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {
            /* Non-fatal: backdrop can detach during the cut. */
          });
        }
        await page
          .locator('add-task-bar.global')
          .first()
          .waitFor({ state: 'hidden', timeout: 3_000 })
          .catch(() => undefined);
        const capturedTask = page
          .locator('task')
          .filter({ hasText: CAPTURED_TASK_DISPLAY_TITLE })
          .first();
        await capturedTask.waitFor({ state: 'visible', timeout: 3_000 });
        capturedTaskId = await capturedTask
          .getAttribute('data-task-id')
          .catch(() => null);
        // Restore the cursor highlight — drag in beat 2 needs it visible.
        await page.evaluate(() =>
          document.body.classList.remove('__sp-hide-cursor-highlight'),
        );
        await parkCursor(page);
        void b1.hide();
        if (isFull) {
          bExtra = await showOverlay(page, 'No account. No tracking.', {
            noWait: true,
          });
        } else if (isShorts) {
          // Shorts skip beat 2's drag entirely — go straight to Focus.
          b2 = await showOverlay(page, 'Focus on what matters.', { noWait: true });
        } else {
          b2 = await showOverlay(page, 'Plan your day.', { noWait: true });
        }
      },
      {
        fadeMs: 260,
        label: isFull ? 'beat 1 to 1.5' : 'beat 1 to 2',
      },
    );

    // ── Beat 1.5 → 2 transition (full variant only) ──────────────────────
    if (isFull) {
      await page.waitForTimeout(1500);
      await cutToScene(
        page,
        async () => {
          void bExtra!.hide();
          b2 = await showOverlay(page, 'Plan your day.', { noWait: true });
        },
        {
          fadeMs: 260,
          label: 'beat 1.5 to 2',
        },
      );
    }

    // ── Beat 2 — Plan your day. (native app drag) ────────────────────────
    // Shorts variant skips this entirely: the side schedule panel doesn't
    // open on portrait, and there's nothing meaningful to drag onto.
    const schedulePanel = page.locator('schedule-day-panel').first();
    const dragSource = page
      .locator('task')
      .filter({ hasText: CAPTURED_TASK_DISPLAY_TITLE })
      .first();
    if (!isShorts) {
      await dragSource.waitFor({ state: 'visible', timeout: 5_000 });
    }
    const taskBox = !isShorts ? await dragSource.boundingBox() : null;
    const panelBox = !isShorts ? await schedulePanel.boundingBox() : null;
    if (taskBox && panelBox) {
      const taskHalfW = taskBox.width * 0.5;
      const taskHalfH = taskBox.height * 0.5;
      const panelHalfW = panelBox.width * 0.5;
      const panelMidH = panelBox.height * 0.5;
      const startX = taskBox.x + taskHalfW;
      const startY = taskBox.y + taskHalfH;
      const endX = panelBox.x + panelHalfW;
      const endY = panelBox.y + panelMidH;
      await page.mouse.move(startX, startY);
      await page.waitForTimeout(120);
      await page.mouse.down();
      await page.waitForTimeout(120);
      await page.mouse.move(endX, endY, { steps: 25 });
      await page.waitForTimeout(180);
      await page.mouse.up();
      await page.waitForTimeout(isFull ? 250 : 150);
      await parkCursor(page);
    }
    await page.waitForTimeout(isFull ? 900 : isShorts ? 0 : 600);

    // ── Beat 2 → 3 transition: cut to black, dispatch focus mode ─────────
    // Shorts: b2 already says "Focus on what matters." so reuse it rather
    // than hide-and-respawn (which would re-fade the same words).
    let b3: OverlayHandle | undefined;
    await cutToScene(
      page,
      async () => {
        if (!isShorts) void b2!.hide();
        if (!isShorts && (await scheduleBtn.isVisible().catch(() => false))) {
          await scheduleBtn.click();
        }
        if (capturedTaskId) {
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
          }, capturedTaskId);
          await page
            .locator('focus-mode-main')
            .first()
            .waitFor({ state: 'visible', timeout: 10_000 })
            .catch(() => undefined);
          await page.clock.runFor(5500).catch(() => undefined);
          await page
            .locator('focus-mode-main .bottom-controls')
            .first()
            .waitFor({ state: 'visible', timeout: 5_000 })
            .catch(() => undefined);
          await page.clock.resume().catch(() => undefined);
        }
        await parkCursor(page);
        b3 = isShorts
          ? b2
          : await showOverlay(page, 'Focus on what matters.', { noWait: true });
      },
      {
        fadeMs: 260,
        label: 'beat 2 to 3',
      },
    );
    await page.waitForTimeout(isFull ? 1800 : isShorts ? 900 : 1200);

    // ── Beat 3 → 4 transition: cut to black, swap to integrations card ──
    let b4: OverlayHandle | undefined;
    await cutToScene(
      page,
      async () => {
        if (b3) void b3.hide();
        await page.evaluate(() => {
          const helper = (
            window as unknown as {
              __e2eTestHelpers?: { store?: { dispatch: (a: unknown) => void } };
            }
          ).__e2eTestHelpers;
          helper?.store?.dispatch({ type: '[FocusMode] Hide Overlay' });
          helper?.store?.dispatch({ type: '[FocusMode] Cancel Session' });
        });
        await page
          .locator('focus-mode-main')
          .first()
          .waitFor({ state: 'hidden', timeout: 3_000 })
          .catch(() => undefined);
        b4 = await showIntegrationsCard(
          page,
          {
            title: 'Plays well with GitHub, Jira & many more',
            logos: [
              { svg: LOGOS.github, label: 'GitHub' },
              { svg: LOGOS.gitlab, label: 'GitLab', color: '#fc6d26' },
              { svg: LOGOS.jira, label: 'Jira', color: '#2684ff' },
              { svg: LOGOS.linear, label: 'Linear', color: '#5e6ad2' },
              { svg: LOGOS.trello, label: 'Trello', color: '#0079bf' },
              { svg: LOGOS.calendar, label: 'Calendar' },
            ],
          },
          { noWait: true },
        );
      },
      {
        fadeMs: 260,
        label: 'beat 3 to 4',
      },
    );
    await page.waitForTimeout(isFull ? 2500 : isShorts ? 1700 : 2000);

    // ── Beat 4 → 5 transition: crossfade between controlled cards ───────
    await showEndCard(
      page,
      {
        logo: {
          src: '/assets/icons/sp.svg',
          alt: 'Super Productivity',
          monochrome: true,
        },
        title: 'Free and open source.',
        subtitle: 'superproductivity.com',
        stats: [
          { template: '★ {n}K on GitHub', to: 19 },
          { template: '{n} ★ on Google Play', to: 4.8, decimals: 1 },
          'Web · iOS · Android · macOS · Linux · Windows & many more',
        ],
      },
      { fadeMs: 560, noWait: true },
    );
    await page.waitForTimeout(260);
    if (b4) void b4.hide();
    await page.waitForTimeout(isFull ? 2740 : isShorts ? 1940 : 2240);

    // ── Loop boundary ────────────────────────────────────────────────────
    // Don't hide the end card — let it stay live. The loop boundary
    // (z-index 2147483647) fades black over the still-visible card so
    // the gif loop seam is end-card → black → black-fading-to-app-ui,
    // with no brief flash of the underlying SP view between end-card
    // hide and the boundary fade-in.
    await loopBoundary(page, 'out', isFull ? 500 : 450);
  });
});
