import { expect, test } from '../../fixtures/test.fixture';
import type { Page } from '@playwright/test';

/**
 * The action row keeps whatever scroll it was left with, so the two moments
 * that make an off-screen control the relevant one must scroll it back on
 * screen (#9480 follow-up):
 *
 * - Opening a panel SHRINKS the row (the panel animates its width out of the
 *   same line), which pushes the very toggle just clicked — last in DOM
 *   order — behind the trailing edge, leaving the panel with no visible
 *   header control to close it. So an open reveals the row's end.
 * - A tracking change reveals the row's start, where the play button lives:
 *   scrolled behind the start edge, a running timer's pause control is
 *   invisible, and the start fade can land on the group gap and say nothing.
 *
 * Widths here are chosen so the row genuinely overflows (~60-80px at 720px
 * with the default side nav), which is what makes the reveal observable.
 */

const scroller = (page: Page): ReturnType<Page['locator']> =>
  page.locator('.action-nav-scroll');

const scrollDistance = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const el = document.querySelector('.action-nav-scroll') as HTMLElement;
    return Math.abs(el.scrollLeft);
  });

test.describe('main header action-row reveal', () => {
  test('keeps the toggle that closes a panel on screen when it opens', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.setViewportSize({ width: 720, height: 860 });

    // Playwright's actionability scroll parks the row wherever it needs to be
    // to click; the panel's width animation then shrinks the row under it.
    await page.locator('.e2e-toggle-notes-btn').first().click();
    await expect(page.locator('right-panel.isOpen')).toBeVisible();
    await expect(page.locator('right-panel.isPanelAnimating')).toHaveCount(0);

    // The active toggle is seated inside the scrollport, not somewhere in the
    // hidden overflow — `toBeInViewport` alone would pass on a 1px sliver.
    await expect(async () => {
      const seated = await page.evaluate(() => {
        const el = document.querySelector('.action-nav-scroll') as HTMLElement;
        const btn = document.querySelector('.e2e-toggle-notes-btn') as HTMLElement;
        const s = el.getBoundingClientRect();
        const b = btn.getBoundingClientRect();
        return b.left >= s.left - 1 && b.right <= s.right + 1;
      });
      expect(seated).toBe(true);
    }).toPass({ timeout: 5000 });
  });

  test('returns the row to its start when tracking starts', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.setViewportSize({ width: 720, height: 860 });
    await workViewPage.addTask('track me');

    // Park the row at its end, the state in which the play button is hidden
    // behind the start edge with the weakest cue.
    await scroller(page).evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await expect.poll(() => scrollDistance(page)).toBeGreaterThan(10);

    // Start tracking from the focused task's keyboard shortcut, NOT the header
    // play button — clicking that would let Playwright scroll it into view and
    // hand the test its own conclusion.
    const task = taskPage.getTaskByText('track me');
    await task.focus();
    await page.keyboard.press('y');
    await expect(
      page.locator('play-button mat-icon', { hasText: 'pause' }),
    ).toBeVisible();

    await expect
      .poll(() => scrollDistance(page), { timeout: 5000 })
      .toBeLessThanOrEqual(1);
  });
});
