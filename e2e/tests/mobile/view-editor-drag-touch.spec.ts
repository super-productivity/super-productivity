import { expect, test } from '../../fixtures/test.fixture';
import { touchPan } from '../../utils/touch-pan';

const PHONE = { width: 400, height: 800 };

/**
 * On a phone the view editor's sections (a board's columns) reorder with a
 * finger. The handle's glyph is small and sits at the screen's edge, so the
 * handle is a finger-wide strip down the card: a press beside the glyph still
 * drags instead of scrolling the list.
 */
test.describe('View editor on a phone', () => {
  // isMobile makes Chromium report `pointer: coarse`, so the app starts in
  // touch input mode, as on an Android/iOS device.
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test('a section moves by a finger on its handle strip', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.goto('/#/boards/KANBAN_DEFAULT');
    await expect(page.locator('board-panel')).toHaveCount(3);
    await page.locator('page-title .page-title').tap();

    const dialog = page.locator('mat-dialog-container');
    const sections = dialog.locator('view-editor-section');
    await expect(sections).toHaveCount(3);
    // The first card starts open; closing it keeps all three on screen.
    const firstToggle = sections.first().locator('.section-toggle');
    await expect(firstToggle).toHaveAttribute('aria-expanded', 'true');
    await firstToggle.tap();
    await expect(firstToggle).toHaveAttribute('aria-expanded', 'false');

    const titles = (): Promise<string[]> =>
      sections.evaluateAll((els) =>
        els.map((el) => el.querySelector('.title-static')?.textContent?.trim() ?? ''),
      );
    await expect.poll(titles).toEqual(['To Do', 'In Progress', 'Done']);

    // Measured once the cards have settled (they animate closed).
    const second = sections.nth(1);
    let prev = '';
    await expect
      .poll(async () => {
        const box = JSON.stringify(await second.boundingBox());
        const isStable = box === prev;
        prev = box;
        return isStable;
      })
      .toBe(true);
    const card = await second.boundingBox();
    const target = await sections.first().boundingBox();
    if (!card || !target) throw new Error('Section boxes missing');

    // Below the bar and its glyph (48px), where a thumb lands as easily, at
    // the card's left edge.
    const start = { x: card.x + 20, y: card.y + card.height - 8 };
    expect(start.y).toBeGreaterThan(card.y + 48 + 8);
    await touchPan(page, second, 0, {
      start,
      deltaY: target.y + 5 - start.y,
      steps: 20,
    });

    await expect.poll(titles).toEqual(['In Progress', 'To Do', 'Done']);
  });
});
