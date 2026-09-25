/**
 * Keyboard reel — five-beat choreography demonstrating Super Productivity's
 * keyboard-first design. Each beat anchors a visible keycap chip to a real
 * `page.keyboard.press()` so the cause-and-effect reads honestly: the chip
 * appears, the shortcut fires, the app reacts.
 *
 *   Lead-in       Black fades to SP task list.
 *   1  "Keyboard-first." tagline overlay.
 *   2  Shift+A → global add-task-bar opens, types "Read book 30m", Enter.
 *   3  J / K   → moves task focus down then back up, with both chips.
 *   4  F       → focus mode opens on the highlighted task.
 *   5  End card "Made for keyboards." with platforms line.
 *
 * Activated only by `REEL_VARIANT=keyboard` so the default capture run
 * still produces the canonical marketing reel.
 */
import { expect } from '@playwright/test';
import { test } from '../fixture';
import {
  loopBoundary,
  markScene,
  setCursorVisible,
  showEndCard,
  showKeyChip,
  showOverlay,
} from '../../video-kit';

const VARIANT = process.env.REEL_VARIANT ?? '';
const NEW_TASK_TITLE = 'Read book 30m';
// Tuned before the kit's above-caption default; the corner keeps chips clear
// of this reel's centered overlays.
const CHIP = { position: 'top-right' } as const;

const parkCursor = async (page: import('@playwright/test').Page): Promise<void> => {
  try {
    await page.mouse.move(0, 0);
  } catch {
    /* noop */
  }
};

/**
 * Aggressively clear CDK overlay blockers that swallow SP's keyboard shortcuts.
 *
 * SP's `ShortcutService.handleKeyDown` bails when `_hasOpenCdkOverlay` finds
 * ANY `.cdk-overlay-pane` in the overlay container with `childElementCount > 0`
 * (excluding tooltip panes). The check is purely DOM-structural — `display:
 * none` does NOT exempt a pane. The fixture hides snack-bar / dialog /
 * mention-list / add-task-bar panes via CSS only, so their hosting panes
 * linger in the DOM with children intact and silently block every J/K/F press.
 *
 * Also blurs editable focus targets (input/textarea/contenteditable) so the
 * shortcut handler's `isInputElement` check doesn't bail. Crucially: does
 * NOT blur a focused <task>, because beat 3 relies on that focus staying
 * put between keypresses.
 */
const clearShortcutBlockers = async (
  page: import('@playwright/test').Page,
): Promise<void> => {
  await page.evaluate(() => {
    document.querySelectorAll('.cdk-overlay-pane').forEach((pane) => {
      if (pane.classList.contains('mat-mdc-tooltip-panel')) return;
      pane.remove();
    });
    const active = document.activeElement as HTMLElement | null;
    if (!active) return;
    const tag = active.tagName;
    if (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      (active as HTMLElement).isContentEditable
    ) {
      active.blur();
    }
  });
};

test.describe('@video keyboard reel', () => {
  test.skip(VARIANT !== 'keyboard', 'keyboard reel only runs when REEL_VARIANT=keyboard');
  test.use({ locale: 'en', theme: 'dark' });

  test('keyboard reel', async ({ seededPage, markBeatsStart }) => {
    const page = seededPage;

    // Forward in-page diagnostics + SP's own Log.warn output so we can see
    // whether the shortcut handler bailed at `lastFocusedTaskComponent ===
    // null` or the id-mismatch guard.
    page.on('console', (msg) => {
      const text = msg.text();
      if (
        text.startsWith('[keyboard-reel]') ||
        text.includes('No focused task component') ||
        text.includes('does not match shortcut target') ||
        text.includes('Method ') ||
        msg.type() === 'warning'
      ) {
        process.stdout.write(`[page:${msg.type()}] ${text}\n`);
      }
    });

    // ── Pre-roll (trimmed off the reel) ──────────────────────────────────
    await page.goto('/#/tag/TODAY/tasks');
    await page.locator('task').first().waitFor({ state: 'visible', timeout: 15_000 });
    await parkCursor(page);
    await page.waitForTimeout(300);
    markBeatsStart();

    // ── Lead-in ──────────────────────────────────────────────────────────
    await loopBoundary(page, 'in', 460);

    // ── Beat 1 — "Keyboard-first." ───────────────────────────────────────
    markScene(page, 'Keyboard-first.');
    const b1 = await showOverlay(page, 'Keyboard-first.');
    await page.waitForTimeout(900);
    void b1.hide();
    await page.waitForTimeout(200);

    // ── Beat 2 — Shift+A → quick capture ─────────────────────────────────
    markScene(page, 'Shift+A capture');
    const chipAdd = await showKeyChip(page, 'Shift+A', CHIP);
    await clearShortcutBlockers(page);
    await page.keyboard.press('Shift+A');
    const globalInput = page.locator('add-task-bar.global .main-input').first();
    await expect(globalInput).toBeFocused({ timeout: 5_000 });
    await page.waitForTimeout(220);
    await setCursorVisible(page, false);
    await globalInput.pressSequentially(NEW_TASK_TITLE, { delay: 55 });
    await page.waitForTimeout(360);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(450);
    await setCursorVisible(page, true);
    await expect(
      page.locator('task').filter({ hasText: 'Read book' }).first(),
    ).toBeVisible();
    const backdrop = page.locator('.backdrop').first();
    if (await backdrop.isVisible().catch(() => false)) {
      await backdrop.click({ force: true });
      await expect(backdrop).toBeHidden({ timeout: 2_000 });
    }
    await expect(page.locator('add-task-bar.global').first()).toBeHidden({
      timeout: 3_000,
    });
    await chipAdd.hide();

    // Focus the first task before pressing J/K. SP's focusin handler only
    // routes `setSelectedId` (which opens the detail panel) when
    // `selectedTaskId` is already set; if we start with no selection,
    // focusin just registers the task with TaskFocusService and the
    // shortcut handler's `focusNext()` walks the list via `:focus`
    // styling — no panel side effects.
    await clearShortcutBlockers(page);
    const firstTask = page.locator('task').first();
    const secondTask = page.locator('task').nth(1);
    const thirdTask = page.locator('task').nth(2);
    await firstTask.scrollIntoViewIfNeeded();
    await thirdTask.waitFor({ state: 'attached' });
    await firstTask.focus();
    await expect(firstTask).toBeFocused();
    await page.waitForTimeout(200);

    // ── Beat 3 — J / K → navigate task list ──────────────────────────────
    markScene(page, 'J / K navigate');
    const chipJ = await showKeyChip(page, 'J', CHIP);
    await page.keyboard.press('j');
    await expect(secondTask).toBeFocused();
    await page.waitForTimeout(420);
    await page.keyboard.press('j');
    await expect(thirdTask).toBeFocused();
    await page.waitForTimeout(420);
    await chipJ.hide();
    await page.waitForTimeout(80);
    const chipK = await showKeyChip(page, 'K', CHIP);
    await page.keyboard.press('k');
    await expect(secondTask).toBeFocused();
    await page.waitForTimeout(420);
    await chipK.hide();
    await page.waitForTimeout(120);

    // ── Beat 4 — F → focus mode ──────────────────────────────────────────
    markScene(page, 'F focus mode');
    const chipF = await showKeyChip(page, 'F', CHIP);
    await clearShortcutBlockers(page);
    await page.keyboard.press('f');
    await expect(page.locator('focus-mode-main')).toBeVisible({ timeout: 5_000 });
    await page.locator('focus-mode-main .task-title-placeholder').click();
    const selector = page.locator('focus-mode-task-selector .task-selector-overlay');
    await expect(selector).toBeVisible();
    await selector.locator('input').fill('Read book');
    await page.getByRole('option', { name: 'Read book' }).click();
    await expect(page.locator('focus-mode-main task-title')).toContainText('Read book');
    await page.locator('focus-mode-main button.play-button').click();
    await page.clock.runFor(5500);
    await expect(page.locator('focus-mode-main .bottom-controls')).toBeVisible();
    await page.clock.resume();
    await page.waitForTimeout(1500);
    await chipF.hide();
    await page.waitForTimeout(200);

    // ── Beat 4 → 5 — dismiss focus mode behind the end card ──────────────
    markScene(page, 'Made for keyboards.');
    await showEndCard(
      page,
      {
        logo: {
          src: '/assets/icons/sp.svg',
          alt: 'Super Productivity',
          monochrome: true,
        },
        title: 'Made for keyboards.',
        subtitle: 'superproductivity.com',
        stats: [
          { template: '{n}+ shortcuts', to: 40 },
          'Web · iOS · Android · macOS · Linux · Windows',
        ],
      },
      { fadeMs: 560 },
    );
    await page.evaluate(() => {
      const helper = (
        window as unknown as {
          __e2eTestHelpers?: { store?: { dispatch: (a: unknown) => void } };
        }
      ).__e2eTestHelpers;
      helper?.store?.dispatch({ type: '[FocusMode] Hide Overlay' });
      helper?.store?.dispatch({ type: '[FocusMode] Cancel Session' });
    });
    await page.waitForTimeout(2200);

    // ── Loop boundary ────────────────────────────────────────────────────
    await loopBoundary(page, 'out', 460);
  });
});
