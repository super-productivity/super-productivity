import { expect, test } from '../../fixtures/test.fixture';

/**
 * #10179: on iOS the keyboard shrinks the web view while the focus-mode
 * duration is edited. The centered task · clock · play group then rode up under
 * the mode selector, so "Select task to focus" overlapped its buttons. A short
 * phone viewport reproduces the shrunken web view; the soft keyboard itself
 * cannot be emulated here.
 */
test.describe('Focus mode on a short phone viewport #10179', () => {
  // iPhone width; height ≈ 844pt screen minus the keyboard and its bar.
  test.use({ viewport: { width: 390, height: 430 }, hasTouch: true, isMobile: true });

  test('task row and clock stay below the mode selector', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.getByRole('button').filter({ hasText: 'center_focus_strong' }).click();
    const main = page.locator('focus-mode-main');
    const selector = main.locator('segmented-button-group');
    const taskCta = main.locator('.select-task-cta');
    await expect(selector).toBeVisible();
    await expect(taskCta).toBeVisible();
    // Let the entry animations finish before measuring; skip the endless ones
    // (clock breathing) that would never resolve.
    await main.evaluate((el) =>
      Promise.all(
        el
          .getAnimations({ subtree: true })
          .filter((a) => a.effect?.getTiming().iterations !== Infinity)
          .map((a) => a.finished),
      ),
    );

    const selectorBox = await selector.boundingBox();
    const ctaBox = await taskCta.boundingBox();
    const clockBox = await main.locator('focus-clock-face').boundingBox();
    if (!selectorBox || !ctaBox || !clockBox) {
      throw new Error('focus-mode element has no layout box');
    }
    const selectorBottom = selectorBox.y + selectorBox.height;
    expect(ctaBox.y).toBeGreaterThanOrEqual(selectorBottom);
    expect(clockBox.y).toBeGreaterThanOrEqual(selectorBottom);
  });
});
