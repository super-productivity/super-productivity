import { expect, test } from '../../fixtures/test.fixture';
import {
  waitForPluginAssets,
  waitForPluginManagementInit,
} from '../../helpers/plugin-test.helpers';

// Smoke test for the BUNDLED_PLUGIN_PATHS entry added in commit 199e816479.
// A typo or accidental removal of 'assets/bundled-plugins/doc-mode'
// would silently regress this; the test fails loudly instead.
test.describe('Doc Mode bundled plugin', () => {
  test('appears in plugin management list', async ({ page, workViewPage }) => {
    test.setTimeout(60000);

    const assetsAvailable = await waitForPluginAssets(page);
    if (!assetsAvailable) {
      if (process.env.CI) {
        // Mirrors plugin-loading.spec.ts: assets may not be built in CI.
        test.skip(true, 'Plugin assets not available in CI');
        return;
      }
      throw new Error('Plugin assets not available — run `npm run prebuild`');
    }

    await workViewPage.waitForTaskList();

    const pluginReady = await waitForPluginManagementInit(page);
    expect(pluginReady).toBeTruthy();

    // Manifest declares the user-visible name as "Doc Mode (Alpha)".
    // Match on the prefix so a future Alpha→Beta label change doesn't break.
    const titles = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('plugin-management mat-card'));
      return cards
        .map((card) => card.querySelector('mat-card-title')?.textContent?.trim() ?? '')
        .filter(Boolean);
    });

    const hasDocMode = titles.some((t) => t.startsWith('Doc Mode'));
    expect(hasDocMode).toBeTruthy();
  });
});
