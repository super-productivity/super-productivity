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
import { test } from '../fixture';
import { loopBoundary, showEndCard, showKeyChip, showOverlay } from '../overlays';

const VARIANT = process.env.REEL_VARIANT ?? '';
const NEW_TASK_TITLE = 'Read book 30m';

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

/**
 * Drive SP's task focus state from the test side, without using the store.
 *
 * The shortcut handler needs TWO things to route `focusNext()`:
 *   1. `_taskFocusService.focusedTaskId()` set, OR an active `<task>` element
 *      whose `data-task-id` the recovery path can read.
 *   2. `_taskFocusService.lastFocusedTaskComponent()` set — this only happens
 *      from the task component's `focusin` HostListener, gated by
 *      `_isInnermostTaskFor(ev.target)` which requires
 *      `ev.target.closest('task') === host`.
 *
 * Both `taskEl.focus()` (real focus) and a follow-up `dispatchEvent(new
 * FocusEvent('focusin', { bubbles: true }))` are issued. The browser already
 * fires focusin on `.focus()` in normal pages, but we re-dispatch to harden
 * against any test-runner edge case where the bubbling focusin doesn't run
 * the Angular HostListener in time.
 *
 * Returns the `data-task-id` of the newly focused task, or `null` if no
 * `<task>` exists.
 */
const ensureTaskFocused = async (
  page: import('@playwright/test').Page,
): Promise<string | null> => {
  return await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    const currentTaskEl = active?.closest('task') as HTMLElement | null;
    const taskEl =
      currentTaskEl ?? (document.querySelector('task') as HTMLElement | null);
    if (!taskEl) return null;
    taskEl.focus();
    taskEl.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    return taskEl.getAttribute('data-task-id');
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
    const b1 = await showOverlay(page, 'Keyboard-first.');
    await page.waitForTimeout(900);
    void b1.hide();
    await page.waitForTimeout(200);

    // ── Beat 2 — Shift+A → quick capture ─────────────────────────────────
    const chipAdd = await showKeyChip(page, 'Shift+A');
    await clearShortcutBlockers(page);
    await page.keyboard.press('Shift+A');
    const globalInput = page.locator('add-task-bar.global input').first();
    if (!(await globalInput.isVisible().catch(() => false))) {
      await page.evaluate(() => {
        const helper = (
          window as unknown as {
            __e2eTestHelpers?: { store?: { dispatch: (a: unknown) => void } };
          }
        ).__e2eTestHelpers;
        helper?.store?.dispatch({ type: '[Layout] Show AddTaskBar' });
      });
    }
    await globalInput.waitFor({ state: 'visible', timeout: 5_000 });
    await page.waitForTimeout(220);
    await page.evaluate(() => document.body.classList.add('__sp-hide-cursor-highlight'));
    await globalInput.pressSequentially(NEW_TASK_TITLE, { delay: 55 });
    await page.waitForTimeout(360);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(450);
    await page.evaluate(() =>
      document.body.classList.remove('__sp-hide-cursor-highlight'),
    );
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
    await chipAdd.hide();

    // Focus the first task before pressing J/K. SP's focusin handler only
    // routes `setSelectedId` (which opens the detail panel) when
    // `selectedTaskId` is already set; if we start with no selection,
    // focusin just registers the task with TaskFocusService and the
    // shortcut handler's `focusNext()` walks the list via `:focus`
    // styling — no panel side effects.
    await clearShortcutBlockers(page);
    const firstTask = page.locator('task').first();
    await firstTask.scrollIntoViewIfNeeded().catch(() => undefined);
    const initialTaskId = await ensureTaskFocused(page);
    await page.evaluate((id) => {
      const tasks = Array.from(document.querySelectorAll('task'));
      const msg =
        `[keyboard-reel] initial focus task=${id ?? 'null'} ` +
        `taskCount=${tasks.length}`;
      console.log(msg);
    }, initialTaskId);
    await page.waitForTimeout(200);

    /**
     * One step in the J/K navigation beat. Chip already up; press the real
     * key. SP's task-shortcut service calls `focusNext()` / `focusPrevious()`
     * on the focused task component, which moves DOM focus to the next /
     * previous `<task>` host element — the `:focus` border (from
     * `_task-base.scss`) is the visible cue.
     *
     * Logs activeElement + task index + overlay-pane count before each
     * press, then the activeElement + task index after, so trace inspection
     * can confirm focus actually moved. If `taskIndex` is unchanged, the
     * shortcut handler bailed (overlay pane present, component reference
     * null/mismatched) — check the forwarded `[page:warning]` lines.
     */
    const step = async (direction: 'next' | 'prev'): Promise<void> => {
      await clearShortcutBlockers(page);
      await ensureTaskFocused(page);
      const snap = async (label: string): Promise<void> => {
        const info = await page.evaluate(() => {
          const a = document.activeElement as HTMLElement | null;
          const taskEl = a?.closest('task') as HTMLElement | null;
          const all = Array.from(document.querySelectorAll('task'));
          const idx = taskEl ? all.indexOf(taskEl) : -1;
          const paneCount = Array.from(
            document.querySelectorAll('.cdk-overlay-pane'),
          ).filter(
            (p) =>
              !p.classList.contains('mat-mdc-tooltip-panel') && p.childElementCount > 0,
          ).length;
          return {
            tag: a?.tagName ?? null,
            taskId: taskEl?.getAttribute('data-task-id') ?? null,
            taskIndex: idx,
            taskCount: all.length,
            paneCount,
          };
        });
        await page.evaluate(
          (payload) => {
            const msg =
              `[keyboard-reel] ${payload.label} tag=${payload.tag} ` +
              `task=${payload.taskId} ` +
              `idx=${payload.taskIndex}/${payload.taskCount} ` +
              `panes=${payload.paneCount}`;
            console.log(msg);
          },
          { ...info, label },
        );
      };
      await snap(`before-${direction}`);
      await page.keyboard.press(direction === 'next' ? 'j' : 'k');
      await snap(`after-${direction}`);
    };

    // ── Beat 3 — J / K → navigate task list ──────────────────────────────
    const chipJ = await showKeyChip(page, 'J');
    await step('next');
    await page.waitForTimeout(420);
    await step('next');
    await page.waitForTimeout(420);
    await chipJ.hide();
    await page.waitForTimeout(80);
    const chipK = await showKeyChip(page, 'K');
    await step('prev');
    await page.waitForTimeout(420);
    await chipK.hide();
    await page.waitForTimeout(120);

    // ── Beat 4 — F → focus mode ──────────────────────────────────────────
    const chipF = await showKeyChip(page, 'F');
    await clearShortcutBlockers(page);
    await page.keyboard.press('f');
    const focusVisible = await page
      .locator('focus-mode-main')
      .first()
      .waitFor({ state: 'visible', timeout: 2_000 })
      .then(() => true)
      .catch(() => false);
    if (!focusVisible) {
      const focusedTaskId = await page.evaluate(() => {
        const focused = document.querySelector(
          'task:focus, task.isCurrent, task[class*="isSelected"]',
        );
        return focused?.getAttribute('data-task-id') ?? null;
      });
      await page.evaluate((id) => {
        const helper = (
          window as unknown as {
            __e2eTestHelpers?: { store?: { dispatch: (a: unknown) => void } };
          }
        ).__e2eTestHelpers;
        if (!helper?.store) return;
        if (id) helper.store.dispatch({ type: '[Task] SetCurrentTask', id });
        helper.store.dispatch({ type: '[FocusMode] Show Overlay' });
        helper.store.dispatch({
          type: '[FocusMode] Start Session',
          duration: 1500000,
        });
      }, focusedTaskId);
      await page
        .locator('focus-mode-main')
        .first()
        .waitFor({ state: 'visible', timeout: 8_000 })
        .catch(() => undefined);
    }
    await page.clock.runFor(5500).catch(() => undefined);
    await page
      .locator('focus-mode-main .bottom-controls')
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 })
      .catch(() => undefined);
    await page.clock.resume().catch(() => undefined);
    await page.waitForTimeout(1500);
    await chipF.hide();
    await page.waitForTimeout(200);

    // ── Beat 4 → 5 — dismiss focus mode behind the end card ──────────────
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
