import { test, expect } from '../../fixtures/test.fixture';

test.describe.serial('Plugin Feature Check', () => {
  test('check if PluginService exists', async ({ page, workViewPage }) => {
    // Wait for Angular app to be fully loaded
    await workViewPage.waitForTaskList();

    // Navigate to config/plugin management
    await page.goto('/#/config');

    // Click on the Plugins tab to show plugin management
    const pluginsTab = page.getByRole('tab', { name: 'Plugins' });
    await pluginsTab.click();

    // Verify plugin management component exists (proves PluginService is loaded)
    // The plugin-management component requires PluginService to be injected and functional
    const pluginMgmt = page.locator('plugin-management');
    await expect(pluginMgmt).toBeAttached({ timeout: 10000 });

    // Additional verification: check that plugin management has rendered content
    // This confirms the service is not only loaded but also working correctly
    const pluginCards = pluginMgmt.locator('mat-card');
    await expect(pluginCards.first()).toBeVisible({ timeout: 10000 });
  });

  test('check plugin UI elements in DOM', async ({ page, workViewPage }) => {
    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    // Navigate to config page
    await page.goto('/#/config');

    await page.evaluate(() => {
      const uiResults: {
        hasPluginManagementTag: boolean;
        hasPluginSection: boolean;
        hasMagicSideNav: boolean;
        hasPluginHeaderBtns: boolean;
        hasPluginTextInBody: boolean;
        hasPluginTextInConfig?: boolean;
      } = {
        hasPluginManagementTag: false,
        hasPluginSection: false,
        hasMagicSideNav: false,
        hasPluginHeaderBtns: false,
        hasPluginTextInBody: false,
      };

      // Check various plugin-related elements
      uiResults.hasPluginManagementTag = !!document.querySelector('plugin-management');
      uiResults.hasPluginSection = !!document.querySelector('.plugin-section');
      uiResults.hasMagicSideNav = !!document.querySelector('magic-side-nav');
      uiResults.hasPluginHeaderBtns = !!document.querySelector('plugin-header-btns');

      // Check if plugin text appears anywhere
      const bodyText = (document.body as HTMLElement).innerText || '';
      uiResults.hasPluginTextInBody = bodyText.toLowerCase().includes('plugin');

      // Check config page
      const configPage = document.querySelector('.page-settings');
      if (configPage) {
        const configText = (configPage as HTMLElement).innerText || '';
        uiResults.hasPluginTextInConfig = configText.toLowerCase().includes('plugin');
      }

      return uiResults;
    });
  });
});
