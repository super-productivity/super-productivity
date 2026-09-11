import { expect, test } from '../../fixtures/test.fixture';

/**
 * Bug: `.bg-image` (app.component.scss) is `position: absolute`, and its
 * containing block is `body` (page.scss: `body { position: absolute }`) --
 * there's nothing between the two to clip it (`app-root` sits in between in
 * the DOM and is `overflow: hidden`, but that clip doesn't apply: an abspos
 * descendant whose containing block is an *ancestor* of the clipping box
 * escapes it entirely). `.is-blurred` scales this element -- that doesn't
 * change its layout size, but it does expand its *painted* bounds, and a
 * transformed descendant's painted bounds count toward its containing
 * block's scrollable-overflow region -- so `body` ends up with real,
 * permanent scrollable overflow the entire time the background is
 * transformed, independent of any route or animation.
 *
 * This is silent on its own, but any `scrollIntoView()` call anywhere in the
 * app whose ancestor walk reaches `body` (e.g. ScheduleComponent's
 * current-time anchor) can then nudge `body.scrollLeft`/`scrollTop`, and
 * since the overflow is a static style (not an animation), nothing ever
 * resets it back to 0 -- the app shell stays visibly shifted until restart.
 *
 * "Blurred" is the common trigger (the app's own `.is-blurred` class), but
 * not the only one: the built-in `velvet` theme applies its own
 * `transform: scale(1.06)` to `.bg-image` for every dark-theme wallpaper,
 * blur setting aside (velvet.css) -- covered by the second test below.
 */
type StoreLike = {
  dispatch: (action: unknown) => void;
};

const setBackground = (
  page: import('@playwright/test').Page,
  blur: number,
): Promise<boolean> =>
  expect
    .poll(() =>
      page.evaluate((blurPx) => {
        const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
          .__e2eTestHelpers?.store;
        if (!store) return false;
        store.dispatch({
          type: '[Global Config] Update Global Config Section',
          sectionKey: 'misc',
          sectionCfg: {
            backgroundImageLight: 'e2e-test-bg.png',
            backgroundImageDark: 'e2e-test-bg.png',
            backgroundImageBlur: blurPx,
          },
          isSkipSnack: true,
        });
        return true;
      }, blur),
    )
    .toBe(true);

const expectNoRealBodyOverflow = async (
  page: import('@playwright/test').Page,
): Promise<void> => {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.body.scrollWidth,
    clientWidth: document.body.clientWidth,
    scrollHeight: document.body.scrollHeight,
    clientHeight: document.body.clientHeight,
  }));

  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  expect(overflow.scrollHeight).toBeLessThanOrEqual(overflow.clientHeight);
};

test.describe('Background image transform', () => {
  test('blurred background does not leave <body> with real scrollable overflow', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await setBackground(page, 20);
    // Wait for the blurred background to actually be in the DOM.
    await expect(page.locator('.bg-image.is-blurred')).toBeVisible();
    await expectNoRealBodyOverflow(page);
  });

  test('velvet theme scales the background at blur 0, still no real <body> overflow', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.evaluate(() => {
      localStorage.setItem('DARK_MODE', 'dark');
      localStorage.setItem('CUSTOM_THEME', 'builtin:velvet');
    });
    await page.reload();
    await workViewPage.waitForTaskList();
    await setBackground(page, 0);
    await expect(page.locator('.bg-image')).toBeVisible();
    await expectNoRealBodyOverflow(page);
  });
});
