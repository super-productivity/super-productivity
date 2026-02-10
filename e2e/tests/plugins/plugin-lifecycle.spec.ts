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

// Plugin-related selectors
const API_TEST_PLUGIN_NAV_ITEM = `${SIDENAV} nav-item button:has-text("API Test Plugin")`;
const TIMEOUT_MULTIPLIER = getCITimeoutMultiplier();
const TEST_TIMEOUT_MS = 30000 * TIMEOUT_MULTIPLIER;

test.describe('Plugin Lifecycle', () => {
  test.beforeEach(async ({ page, workViewPage }) => {
    test.setTimeout(TEST_TIMEOUT_MS);

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

  test('verify plugin is initially loaded', async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT_MS);
    // Wait for magic-side-nav to be ready
    await page.locator(SIDENAV).waitFor({ state: 'visible' });

    // Plugin doesn't show snack bar on load, check plugin nav item instead
    await expect(page.locator(API_TEST_PLUGIN_NAV_ITEM)).toBeVisible({ timeout: 10000 });
    await expect(page.locator(API_TEST_PLUGIN_NAV_ITEM)).toContainText('API Test Plugin');
  });

  test('test plugin navigation', async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT_MS);

    // Click on the plugin nav item to navigate to plugin
    const pluginNavItem = page.locator(API_TEST_PLUGIN_NAV_ITEM);
    await expect(pluginNavItem).toBeVisible({ timeout: 10000 });
    await Promise.all([
      page.waitForURL(/\/plugins\/api-test-plugin\/index/, { timeout: 15000 }),
      pluginNavItem.click(),
    ]);

    // Verify we navigated to the plugin page
    await expect(page).toHaveURL(/\/plugins\/api-test-plugin\/index/, { timeout: 10000 });

    // Wait for Angular component initialization after navigation
    await expect(async () => {
      const iframe = page.locator('iframe');
      await expect(iframe).toBeAttached({ timeout: 2000 });
      await expect(iframe).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 10000, intervals: [500, 1000] });

    // Go back to work view
    await page.goto('/#/tag/TODAY');
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
    await page.goto('/#/tag/TODAY');
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
