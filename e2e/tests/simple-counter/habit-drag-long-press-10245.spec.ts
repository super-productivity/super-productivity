import { expect, test } from '../../fixtures/test.fixture';
import type { Page } from '@playwright/test';
import { waitForStatePersistence } from '../../utils/waits';

const TITLES = ['Upper habit', 'Lower habit'];
const EDITORS = 'dialog-simple-counter-edit, dialog-simple-counter-edit-settings';
const ROWS = '.habit-grid > .habit-row';

const createHabits = async (page: Page): Promise<void> => {
  await page.goto('/#/habits');
  for (const title of TITLES) {
    await page.locator('.add-habit-btn').click();
    const dialog = page.locator('dialog-simple-counter-edit-settings');
    await dialog.locator('formly-form input').first().fill(title);
    await dialog.locator('button[type="submit"]').click();
    await expect(dialog).toBeHidden();
  }
  await expect(page.locator(`${ROWS} .habit-name`)).toHaveText(TITLES);
  await waitForStatePersistence(page);
  // Mouse setup changes input intent. Reload restores touch-primary bootstrap.
  await page.reload();
  await expect(page.locator(`${ROWS} .habit-name`)).toHaveText(TITLES);
};

const touchDriver = async (
  page: Page,
): Promise<{
  start: (x: number, y: number) => Promise<unknown>;
  move: (x: number, y: number) => Promise<unknown>;
  end: () => Promise<unknown>;
  detach: () => Promise<void>;
}> => {
  const cdp = await page.context().newCDPSession(page);
  return {
    start: (x: number, y: number) =>
      cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y }],
      }),
    move: (x: number, y: number) =>
      cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y }],
      }),
    end: () =>
      cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
    detach: () => cdp.detach(),
  };
};

test.describe('Habit touch drag (#10245 habit subcase)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('reorders without opening an editor or changing counts', async ({
    page,
  }, info) => {
    await createHabits(page);
    const rows = page.locator(ROWS);
    const lower = rows.filter({ hasText: TITLES[1] });
    const cell = lower.locator('.day-cell:not(.is-disabled)').first();
    const start = await cell.boundingBox();
    const upper = await rows.first().boundingBox();
    expect(start).not.toBeNull();
    expect(upper).not.toBeNull();
    const halfWidth = start!.width / 2;
    const x = start!.x + halfWidth;
    const halfHeight = start!.height / 2;
    const y = start!.y + halfHeight;
    const upperHalfHeight = upper!.height / 2;
    const targetY = upper!.y + upperHalfHeight - 10;

    // Observe editors throughout the gesture, including ones dismissed before release.
    const seenEditors: string[] = [];
    await page.exposeFunction('recordHabitEditor', (name: string) => {
      seenEditors.push(name);
    });
    await page.evaluate((selector) => {
      new MutationObserver(() => {
        for (const editor of document.querySelectorAll(selector)) {
          void (
            window as unknown as { recordHabitEditor: (name: string) => Promise<void> }
          ).recordHabitEditor(editor.tagName.toLowerCase());
        }
      }).observe(document.body, { childList: true, subtree: true });
    }, EDITORS);

    const touch = await touchDriver(page);
    try {
      await touch.start(x, y);
      // CDK permits dragging after 500ms; cell editing queues after 700ms.
      await page.waitForTimeout(550);
      for (let step = 1; step <= 8; step++) {
        const distance = ((targetY - y) * step) / 8;
        await touch.move(x, y + distance);
        await page.waitForTimeout(40);
      }
      await touch.end();
    } finally {
      await touch.detach();
    }

    // Establish the reported successful movement before diagnosing the unwanted editor.
    await expect(page.locator(`${ROWS} .habit-name`)).toHaveText([...TITLES].reverse());
    await expect(rows.locator('.check-circle.is-done, .value-text')).toHaveCount(0);
    const evidence = {
      order: await page.locator(`${ROWS} .habit-name`).allTextContents(),
      seenEditors: [...new Set(seenEditors)],
      editorsAfterRelease: await page.locator(EDITORS).count(),
      changedCounts: await rows.locator('.check-circle.is-done, .value-text').count(),
    };
    await info.attach('habit-drag-evidence', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json',
    });
    console.log('HABIT_DRAG_EVIDENCE', JSON.stringify(evidence));
    await expect(page.locator(EDITORS)).toHaveCount(0);
    expect(seenEditors).toEqual([]);
  });

  // Long-press editing is covered by the component spec: in touch emulation the
  // browser's click after release can hit the new dialog's backdrop and close it.
  test('tap toggles a count without opening an editor', async ({ page }) => {
    await createHabits(page);
    const row = page.locator(ROWS).filter({ hasText: TITLES[1] });
    const cell = row.locator('.day-cell:not(.is-disabled)').first();
    await cell.tap();
    await expect(cell.locator('.check-circle')).toHaveClass(/is-done/);
    await expect(page.locator(EDITORS)).toHaveCount(0);
    await expect(page.locator(`${ROWS} .habit-name`)).toHaveText(TITLES);
  });
});
