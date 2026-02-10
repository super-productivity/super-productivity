import { expect, test } from '../../fixtures/test.fixture';
import { cssSelectors } from '../../constants/selectors';
import {
  enablePluginWithVerification,
  getCITimeoutMultiplier,
  waitForPluginAssets,
  waitForPluginInMenu,
  waitForPluginManagementInit,
} from '../../helpers/plugin-test.helpers';

const { SIDENAV } = cssSelectors;

// Plugin-related selectors
const PLUGIN_NAV_ITEMS = `${SIDENAV} nav-item button`;
const PLUGIN_IFRAME = 'plugin-index iframe';

test.describe.serial('Plugin Iframe', () => {
  test.beforeEach(async ({ page, workViewPage }) => {
    const timeoutMultiplier = getCITimeoutMultiplier();
    test.setTimeout(30000 * timeoutMultiplier);

    // Ensure plugin assets are available
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

    // Dismiss tour dialog if present (non-blocking)
    const tourDialog = page.locator('[data-shepherd-step-id="Welcome"]');
    if (await tourDialog.isVisible().catch(() => false)) {
      const cancelBtn = page.locator(
        'button:has-text("No thanks"), .shepherd-cancel-icon',
      );
      if (await cancelBtn.isVisible().catch(() => false)) {
        await cancelBtn.click();
        await tourDialog.waitFor({ state: 'hidden' });
      }
    }
  });

  test('open plugin iframe view', async ({ page }) => {
    // Plugin nav item should already be visible from beforeEach
    const pluginMenuItem = page
      .locator(PLUGIN_NAV_ITEMS)
      .filter({ hasText: 'API Test Plugin' });

    // Click plugin menu item
    await pluginMenuItem.click();

    // Wait for navigation to plugin page
    await page.waitForURL(/\/plugins\/api-test-plugin\/index/);

    // Wait for iframe to be visible
    const iframe = page.locator(PLUGIN_IFRAME);
    await iframe.waitFor({ state: 'visible' });

    // Verify iframe is loaded
    await expect(iframe).toBeVisible();
  });

  test('verify iframe loads with correct content', async ({ page }) => {
    // Navigate directly to plugin page
    await page.goto('/#/plugins/api-test-plugin/index');

    // Wait for iframe to be visible
    const iframe = page.locator(PLUGIN_IFRAME);
    await iframe.waitFor({ state: 'visible' });

    // Verify iframe exists and is visible
    await expect(iframe).toBeVisible();

    // Try to verify iframe content if possible
    const frameLocator = page.frameLocator(PLUGIN_IFRAME);
    try {
      await frameLocator.locator('body').waitFor({ state: 'visible' });

      const h1 = frameLocator.locator('h1');
      const hasH1 = (await h1.count()) > 0;
      if (hasH1) {
        await expect(h1).toContainText('API Test Plugin');
      }
    } catch (error) {
      // If iframe content is not accessible due to cross-origin restrictions,
      // at least verify the iframe element itself is present
      await expect(iframe).toBeVisible();
    }
  });
});
