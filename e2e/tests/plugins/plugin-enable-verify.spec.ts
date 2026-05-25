import { expect, test } from '../../fixtures/test.fixture';
import {
  enablePluginWithVerification,
  getCITimeoutMultiplier,
  waitForPluginAssets,
  waitForPluginInMenu,
  waitForPluginManagementInit,
} from '../../helpers/plugin-test.helpers';

test.describe.serial('Plugin Enable Verify', () => {
  test('enable API Test Plugin and verify menu entry', async ({ page, workViewPage }) => {
    const timeoutMultiplier = getCITimeoutMultiplier();
    test.setTimeout(30000 * timeoutMultiplier);

    // First, ensure plugin assets are available
    const assetsAvailable = await waitForPluginAssets(page);
    if (!assetsAvailable) {
      if (process.env.CI) {
        test.skip(true, 'Plugin assets not available in CI - skipping test');
        return;
      }
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

    // Plugin management is now visible - enable API Test Plugin
    const pluginEnabled = await enablePluginWithVerification(
      page,
      'API Test Plugin',
      10000 * timeoutMultiplier,
    );

    expect(pluginEnabled).toBe(true);

    // Wait for plugin to appear in menu
    const pluginInMenu = await waitForPluginInMenu(
      page,
      'API Test Plugin',
      15000 * timeoutMultiplier,
    );

    expect(pluginInMenu).toBe(true);

    // Additional verification - check menu structure in magic-side-nav
    const menuResult = await page.evaluate(() => {
      const sideNav = document.querySelector('magic-side-nav');
      const navButtons = sideNav
        ? Array.from(sideNav.querySelectorAll('nav-item button'))
        : [];

      return {
        hasSideNav: !!sideNav,
        buttonCount: navButtons.length,
        buttonTexts: navButtons.map((btn) => btn.textContent?.trim() || ''),
      };
    });

    expect(menuResult.hasSideNav).toBe(true);
    expect(menuResult.buttonCount).toBeGreaterThan(0);
    const hasApiTestPlugin = menuResult.buttonTexts.some((text: string) =>
      text.includes('API Test Plugin'),
    );
    expect(hasApiTestPlugin).toBe(true);
  });
});
