import { expect, test } from '../../fixtures/test.fixture';
import {
  getCITimeoutMultiplier,
  waitForPluginAssets,
  waitForPluginManagementInit,
} from '../../helpers/plugin-test.helpers';

test.describe('Enable Plugin Test', () => {
  test('navigate to plugin settings and enable API Test Plugin', async ({
    page,
    workViewPage,
  }) => {
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
    // This navigates to settings, selects plugin tab, and expands plugin section
    await waitForPluginManagementInit(page);

    await expect(page.locator('plugin-management')).toBeVisible({ timeout: 10000 });

    // Wait for plugin cards to be loaded
    await page
      .locator('plugin-management mat-card')
      .first()
      .waitFor({ state: 'attached', timeout: 10000 });

    // Try to find and enable the API Test Plugin
    const enableResult = await page.evaluate(() => {
      const pluginCards = document.querySelectorAll('plugin-management mat-card');
      let foundApiTestPlugin = false;
      let toggleClicked = false;

      for (const card of Array.from(pluginCards)) {
        const title = card.querySelector('mat-card-title')?.textContent || '';
        if (title.includes('API Test Plugin') || title.includes('api-test-plugin')) {
          foundApiTestPlugin = true;
          const toggle = card.querySelector(
            'mat-slide-toggle button[role="switch"]',
          ) as HTMLButtonElement;
          if (toggle && toggle.getAttribute('aria-checked') !== 'true') {
            toggle.click();
            toggleClicked = true;
            break;
          }
        }
      }

      return {
        totalPluginCards: pluginCards.length,
        foundApiTestPlugin,
        toggleClicked,
      };
    });

    expect(enableResult.foundApiTestPlugin).toBe(true);

    // Wait for toggle state to change to enabled
    if (enableResult.toggleClicked) {
      await page.waitForFunction(
        () => {
          const cards = Array.from(
            document.querySelectorAll('plugin-management mat-card'),
          );
          const apiTestCard = cards.find((card) => {
            const title = card.querySelector('mat-card-title')?.textContent || '';
            return title.includes('API Test Plugin');
          });
          const toggle = apiTestCard?.querySelector(
            'mat-slide-toggle button[role="switch"]',
          ) as HTMLButtonElement;
          return toggle?.getAttribute('aria-checked') === 'true';
        },
        { timeout: 10000 },
      );
    }
  });
});
