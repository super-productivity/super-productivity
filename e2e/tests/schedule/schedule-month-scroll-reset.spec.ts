import { expect, test } from '../../fixtures/test.fixture';

/**
 * Review of #9463: a month grid that overflows the scroll wrapper on a short
 * window kept the scroll position carried over from week view, so the month
 * opened with its first row above the viewport (scrollTop 121 of a 121px
 * maximum, reproduced here).
 *
 * The unit spec asserts the reset call fires; only this test runs it at a real
 * constrained height with a real overflowing month grid, which is the
 * combination the bug needed.
 *
 * The month is navigated to rather than taken from the clock. Rows follow the
 * displayed month (4-6), and `.month-day-cell` has `min-height: 80px`, so the
 * track minimum sets the grid height once the rows stop fitting: at this
 * viewport six rows overflow by 121px, five by 40, and four not at all. Taking
 * whatever month today happens to be would make the precondition below fail
 * for the 28 days of a non-leap February starting on the week's first day.
 *
 * Run: npm run e2e:file e2e/tests/schedule/schedule-month-scroll-reset.spec.ts -- --retries=0
 */
const SHORT_DESKTOP_VIEWPORT = { width: 1280, height: 500 };
/** Rows the grid must show for the wrapper to overflow at this viewport. */
const ROWS_THAT_OVERFLOW = 6;

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

    // Land on a month that actually overflows, before the scroll position that
    // the reset has to clear is set up. The view switch below keeps it: only
    // `selectedTimeView` changes, never the selected date.
    await page.getByRole('button', { name: 'View Month' }).click();
    await expect(page.locator('schedule-month')).toBeVisible();
    const monthRows = (): Promise<number> =>
      page
        .locator('schedule-month')
        .evaluate((el) =>
          Number(getComputedStyle(el).getPropertyValue('--nr-of-weeks').trim()),
        );
    const firstDay = (): Promise<string | null> =>
      page.locator('.month-day-cell[data-day]').first().getAttribute('data-day');
    // Wait for the grid to actually advance rather than re-reading the row
    // count before Angular has re-rendered. Six rows is at most 11 months away.
    for (let i = 0; i < 12 && (await monthRows()) !== ROWS_THAT_OVERFLOW; i++) {
      const before = await firstDay();
      await page.getByRole('button', { name: 'Next Month' }).click();
      await expect.poll(firstDay).not.toBe(before);
    }
    expect(await monthRows()).toBe(ROWS_THAT_OVERFLOW);

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
    // this would pass on the unfixed code too. Pinned to six rows above, so it
    // does not depend on the month the suite happens to run in.
    const overflow = await wrapper.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(overflow).toBeGreaterThan(0);

    await expect
      .poll(async () => wrapper.evaluate((el) => el.scrollTop), { timeout: 5000 })
      .toBe(0);
  });
});
