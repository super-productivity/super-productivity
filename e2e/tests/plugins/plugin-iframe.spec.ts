import { expect, test } from '../../fixtures/test.fixture';
import {
  enablePluginWithVerification,
  getCITimeoutMultiplier,
  waitForPluginAssets,
  waitForPluginInMenu,
  waitForPluginManagementInit,
} from '../../helpers/plugin-test.helpers';

const PLUGIN_IFRAME = 'plugin-index iframe';

test.describe.serial('Plugin Iframe', () => {
  test.beforeEach(async ({ page, workViewPage }) => {
    const timeoutMultiplier = getCITimeoutMultiplier();
    test.setTimeout(30000 * timeoutMultiplier);

    // Ensure plugin assets are available
    const assetsAvailable = await waitForPluginAssets(page);
    if (!assetsAvailable) {
      throw new Error('Plugin assets not available - cannot proceed with test');
    }

    await workViewPage.waitForTaskList();

    // Navigate to settings and initialize plugin management
    const initSuccess = await waitForPluginManagementInit(page);
    if (!initSuccess) {
      throw new Error(
        'Plugin management failed to initialize (timeout waiting for plugin cards)',
      );
    }

    // Enable API Test Plugin
    const pluginEnabled = await enablePluginWithVerification(
      page,
      'API Test Plugin',
      10000 * timeoutMultiplier,
    );

    if (!pluginEnabled) {
      throw new Error('Failed to enable API Test Plugin');
    }

    // Wait for plugin to appear in menu (navigates to work view internally)
    const pluginInMenu = await waitForPluginInMenu(
      page,
      'API Test Plugin',
      15000 * timeoutMultiplier,
    );

    if (!pluginInMenu) {
      throw new Error('API Test Plugin not found in menu after enabling');
    }
  });

  // #9526: the API bridge script must be injected in <head> so that classic
  // (non-defer) plugin scripts see window.PluginAPI at parse time. The bundled
  // API Test Plugin records `typeof window.PluginAPI` at the top of its inline
  // body script; before the fix the bridge was appended before </body> and this
  // read 'undefined', pushing plugins into local fallbacks that bypass sync.
  test('PluginAPI is available to parse-time plugin scripts', async ({ page }) => {
    await page.goto('/#/plugins/api-test-plugin/index');

    const iframe = page.locator(PLUGIN_IFRAME);
    await iframe.waitFor({ state: 'visible' });

    const frameLocator = page.frameLocator(PLUGIN_IFRAME);
    await frameLocator.locator('body').waitFor({ state: 'visible' });

    const typeAtParseTime = await frameLocator
      .locator('body')
      .evaluate(
        () => (window as unknown as Record<string, unknown>).__pluginApiTypeAtParseTime,
      );
    expect(typeAtParseTime).toBe('object');
  });
});
