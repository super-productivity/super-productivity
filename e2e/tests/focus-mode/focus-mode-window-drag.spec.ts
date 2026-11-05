import { expect, test } from '../../fixtures/test.fixture';

/**
 * Bug: on macOS Electron the window cannot be moved while focus mode is open.
 *
 * The desktop build is frameless on macOS, so the overlay's `.electron-drag-bar`
 * is the only drag region while the overlay replaces the app shell. Since
 * Chromium 150 (Electron 44) `app-region` is inherited and Chromium emits one
 * region per box in DOM order, so a `no-drag` on the overlay host turned every
 * overlay box after the drag bar into a no-drag region covering it.
 *
 * The OS-level drag cannot run here, and the bundled Playwright Chromium
 * predates the inheritance, so the test checks the invariant instead: no
 * ancestor of the overlay content declares a region for it to inherit (an
 * explicit `none` counts as no-drag, so only the ancestor can opt out). Same
 * approach as e2e/tests/schedule/schedule-title-bar-drag-10170.spec.ts.
 *
 * Run: npm run e2e:file e2e/tests/focus-mode/focus-mode-window-drag.spec.ts -- --retries=0
 */
test('focus mode overlay content does not inherit a no-drag region', async ({
  page,
  workViewPage,
}) => {
  await workViewPage.waitForTaskList();
  await page.locator('focus-button button').click();

  const dialog = page.locator('focus-mode-overlay .focus-mode-dialog');
  await expect(dialog).toBeVisible();

  const ancestorsWithRegion = await dialog.evaluate((el) => {
    const found: string[] = [];
    for (let node: Element | null = el; node; node = node.parentElement) {
      const region = getComputedStyle(node).getPropertyValue('-webkit-app-region');
      if (region !== 'none') {
        found.push(`${node.tagName.toLowerCase()}.${node.className}: ${region}`);
      }
    }
    return found;
  });
  expect(ancestorsWithRegion).toEqual([]);
});
