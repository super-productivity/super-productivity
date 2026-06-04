import { expect, test } from '../../fixtures/test.fixture';

/**
 * Regression guard for #7957 — habit edit popout chart/dialog "jitter".
 *
 * The chart popout (dialog-simple-counter-edit) used to force
 * `canvas { width:100% !important; height:auto !important }` while Chart.js ran
 * responsive + maintainAspectRatio. That overrode the inline size Chart.js sets
 * on every resize, so its ResizeObserver chased a size it didn't set and the
 * canvas/dialog height oscillated by <1px every frame.
 *
 * This samples the canvas + dialog height across animation frames and asserts the
 * steady-state tail is perfectly stable. Fractional deviceScaleFactor mimics the
 * desktop/KDE/Windows scaling where the reporters saw it. Before the fix the tail
 * flipped on ~every frame (range ~0.53px); after, range is 0.
 */
test.use({ viewport: { width: 1101, height: 900 }, deviceScaleFactor: 1.25 });

const TITLE = 'JitterProbe';

const summarizeTail = (
  arr: number[],
  tail: number,
): { transitions: number; range: number } => {
  const slice = arr.slice(-tail);
  let transitions = 0;
  for (let i = 1; i < slice.length; i++) {
    if (slice[i] !== slice[i - 1]) transitions++;
  }
  const range = +(Math.max(...slice) - Math.min(...slice)).toFixed(3);
  return { transitions, range };
};

test.describe('Habit chart popout jitter (#7957)', () => {
  test('chart popout height must not oscillate', async ({ page }) => {
    // --- create a click counter via the habits "add habit" flow ---
    await page.goto('/#/habits');
    await page.waitForURL(/habits/);

    const addBtn = page.locator('.add-habit-btn');
    await addBtn.waitFor({ state: 'visible', timeout: 15000 });
    await addBtn.click();

    const settingsDialog = page.locator('dialog-simple-counter-edit-settings');
    await settingsDialog.waitFor({ state: 'visible', timeout: 10000 });
    const titleInput = settingsDialog.locator('formly-form input').first();
    await titleInput.waitFor({ state: 'visible', timeout: 5000 });
    await titleInput.fill(TITLE);
    await settingsDialog.locator('button[type="submit"]').click();
    await settingsDialog.waitFor({ state: 'hidden', timeout: 10000 });

    // --- seed varied count data so the chart renders with points ---
    const row = page.locator('.habit-row', { hasText: TITLE });
    await row.waitFor({ state: 'visible', timeout: 10000 });
    const cells = row.locator('.day-cell');
    const cellCount = await cells.count();
    for (let i = 0; i < cellCount; i++) {
      for (let c = 0; c <= i % 3; c++) {
        await cells.nth(i).click();
      }
    }

    // --- open the chart popout (right-click -> openEditDialog) ---
    // New habits are weekday-only by default; pick an enabled cell so the test
    // does not depend on which weekday is first in the rolling 7-day grid.
    const enabledCells = row.locator('.day-cell:not(.is-disabled)');
    await expect(enabledCells.first()).toBeVisible();
    await enabledCells.first().click({ button: 'right' });
    const editDialog = page.locator('dialog-simple-counter-edit');
    await editDialog.waitFor({ state: 'visible', timeout: 10000 });
    await editDialog.locator('canvas').waitFor({ state: 'visible', timeout: 10000 });

    // --- sample height across ~120 frames; assess the steady-state tail so we
    // don't depend on an arbitrary "animation settled" wait ---
    const probe = await page.evaluate(async () => {
      const dialogEl = document.querySelector(
        'mat-dialog-container',
      ) as HTMLElement | null;
      const canvasEl = document.querySelector(
        'dialog-simple-counter-edit canvas',
      ) as HTMLElement | null;
      const dialog: number[] = [];
      const canvas: number[] = [];
      const FRAMES = 120;
      await new Promise<void>((resolve) => {
        let n = 0;
        const tick = (): void => {
          if (dialogEl) dialog.push(+dialogEl.getBoundingClientRect().height.toFixed(3));
          if (canvasEl) canvas.push(+canvasEl.getBoundingClientRect().height.toFixed(3));
          if (++n >= FRAMES) return resolve();
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return { dialog, canvas };
    });

    const dialogTail = summarizeTail(probe.dialog, 80);
    const canvasTail = summarizeTail(probe.canvas, 80);
    console.log('JITTER_TAIL', JSON.stringify({ dialogTail, canvasTail }));

    expect(canvasTail.transitions, 'canvas height should be stable').toBe(0);
    expect(canvasTail.range).toBeLessThan(0.05);
    expect(dialogTail.transitions, 'dialog height should be stable').toBe(0);
    expect(dialogTail.range).toBeLessThan(0.05);
  });
});
