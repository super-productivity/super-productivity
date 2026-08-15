import { expect, test } from '../../fixtures/test.fixture';
import type { Page } from '@playwright/test';

/**
 * The right panel shares one row with everything to its left, so its width is
 * not only its own business: past a point, every pixel it keeps is one the
 * header cannot use. It is capped at half the content area for exactly that
 * reason — but the cap used to stop applying in the band where it matters. The
 * CSS swapped `max-width: 50%` for a flat `500px` under a 960px window, and the
 * resize handler gave up re-clamping entirely once half the content area fell
 * under the panel's own `MIN_WIDTH`. So a window narrowed with the panel open
 * left it holding ~270px of a ~460px row and the header with ~190px — enough to
 * push every header action, overflow trigger included, out of reach (#9480).
 */
const measure = async (
  page: Page,
): Promise<{ content: number; panel: number; header: number }> =>
  page.evaluate(() => {
    const w = (sel: string): number =>
      Math.round(
        (document.querySelector(sel) as HTMLElement)?.getBoundingClientRect().width ?? 0,
      );
    return {
      content: w('.main-content'),
      panel: w('right-panel .side'),
      header: w('main-header'),
    };
  });

test.describe('right panel sizing', () => {
  test('never keeps more than half the row as the window narrows', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.setViewportSize({ width: 1200, height: 860 });
    await page.locator('.e2e-toggle-notes-btn').first().click();
    await expect(page.locator('right-panel.isOpen')).toBeVisible();
    await expect(page.locator('right-panel.isPanelAnimating')).toHaveCount(0);

    for (const width of [900, 800, 720, 650]) {
      await page.setViewportSize({ width, height: 860 });
      await expect(async () => {
        const m = await measure(page);
        // Half the row, plus a pixel of rounding slop.
        expect(
          m.panel,
          `panel ${m.panel}px of a ${m.content}px row at ${width}px (header ${m.header}px)`,
        ).toBeLessThanOrEqual(Math.ceil(m.content / 2) + 1);
      }).toPass({ timeout: 10000 });
    }
  });

  test('gives the width back when the window widens again', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.setViewportSize({ width: 1200, height: 860 });
    await page.locator('.e2e-toggle-notes-btn').first().click();
    await expect(page.locator('right-panel.isOpen')).toBeVisible();
    await expect(page.locator('right-panel.isPanelAnimating')).toHaveCount(0);
    const before = (await measure(page)).panel;

    await page.setViewportSize({ width: 700, height: 860 });
    await expect(async () => {
      expect((await measure(page)).panel).toBeLessThan(before);
    }).toPass({ timeout: 10000 });

    // Squeezing the panel is the window's doing, not the user's, so the width
    // they chose has to survive it.
    await page.setViewportSize({ width: 1200, height: 860 });
    await expect(async () => {
      expect((await measure(page)).panel).toBe(before);
    }).toPass({ timeout: 10000 });
  });
});
