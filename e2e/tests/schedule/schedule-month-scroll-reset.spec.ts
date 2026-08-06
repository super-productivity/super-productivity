import { expect, test } from '../../fixtures/test.fixture';

/**
 * Review of #9463: with the month grid fixed at six rows it overflows the
 * scroll wrapper on a short window, so the scroll position carried over from
 * week view clamped to the bottom and the month opened with its first row
 * above the viewport (scrollTop 121 of a 121px maximum, reproduced here).
 *
 * The unit spec asserts the reset call fires; only this test runs it at a real
 * constrained height with a real overflowing month grid, which is the
 * combination the bug needed.
 *
 * Run: npm run e2e:file e2e/tests/schedule/schedule-month-scroll-reset.spec.ts -- --retries=0
 */
const SHORT_DESKTOP_VIEWPORT = { width: 1280, height: 500 };

test.describe('Schedule month view scroll position', () => {
  test.use({ viewport: SHORT_DESKTOP_VIEWPORT });

  test('should open month view at the top after scrolling week view', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.getByRole('menuitem', { name: 'Schedule' }).click();

    const wrapper = page.locator('schedule .scroll-wrapper');
    await expect(wrapper).toBeVisible();
    await page.getByRole('button', { name: 'View Week' }).click();
    await expect(page.locator('schedule-week')).toBeVisible();

    // Week view is a full day timeline, so it always overflows this height.
    const scrolled = await wrapper.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      return el.scrollTop;
    });
    expect(scrolled).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'View Month' }).click();
    await expect(page.locator('schedule-month')).toBeVisible();

    // Precondition: without overflow there would be nothing to clamp to and
    // this would pass on the unfixed code too.
    const overflow = await wrapper.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(overflow).toBeGreaterThan(0);

    await expect
      .poll(async () => wrapper.evaluate((el) => el.scrollTop), { timeout: 5000 })
      .toBe(0);
  });
});
