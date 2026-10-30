import { test, expect } from '../../fixtures/test.fixture';
import { cssSelectors } from '../../constants/selectors';
import {
  waitForPluginAssets,
  waitForPluginManagementInit,
  enablePluginWithVerification,
  waitForPluginInMenu,
  disablePluginWithVerification,
  getCITimeoutMultiplier,
} from '../../helpers/plugin-test.helpers';

const { SIDENAV } = cssSelectors;
const TIMEOUT_MULTIPLIER = getCITimeoutMultiplier();
const TEST_TIMEOUT_MS = 30000 * TIMEOUT_MULTIPLIER;

test.describe('Plugin Lifecycle', () => {
  test.beforeEach(async ({ page, workViewPage }) => {
    test.setTimeout(TEST_TIMEOUT_MS);

    // First, ensure plugin assets are available
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

    const enabled = await enablePluginWithVerification(
      page,
      'API Test Plugin',
      10000 * TIMEOUT_MULTIPLIER,
    );
    expect(enabled).toBe(true);

    const pluginVisible = await waitForPluginInMenu(
      page,
      'API Test Plugin',
      15000 * TIMEOUT_MULTIPLIER,
    );
    expect(pluginVisible).toBe(true);
  });

  test('disable plugin and verify cleanup', async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT_MS);

    // Navigate to settings and set up plugin management view
    const initSuccess = await waitForPluginManagementInit(page);
    if (!initSuccess) {
      throw new Error('Plugin management failed to re-initialize for disable test');
    }

    const disabled = await disablePluginWithVerification(
      page,
      'API Test Plugin',
      10000 * TIMEOUT_MULTIPLIER,
    );
    expect(disabled).toBe(true);

    // Go back to work view
    await page.goto('/#/tag/TODAY/tasks');
    // Wait for navigation and work view to be ready
    await page.locator('.route-wrapper').waitFor({ state: 'visible', timeout: 10000 });

    // Check if the magic-side-nav exists and verify the API Test Plugin is not in it
    const sideNavExists = (await page.locator(SIDENAV).count()) > 0;

    if (sideNavExists) {
      const hasApiTestPlugin = await page.evaluate(() => {
        const menuItems = Array.from(
          document.querySelectorAll('magic-side-nav nav-item button'),
        );
        return menuItems.some((item) => item.textContent?.includes('API Test Plugin'));
      });

      expect(hasApiTestPlugin).toBe(false);
    } else {
      expect(sideNavExists).toBe(true);
    }
  });
});
