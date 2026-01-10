import { test, expect } from '../../fixtures/test.fixture';
import { cssSelectors } from '../../constants/selectors';
import {
  waitForPluginAssets,
  waitForPluginManagementInit,
  getCITimeoutMultiplier,
} from '../../helpers/plugin-test.helpers';

const { SIDENAV, SETTINGS_BTN } = cssSelectors;

// Plugin-related selectors
const API_TEST_PLUGIN_NAV_ITEM = `${SIDENAV} nav-item button:has-text("API Test Plugin")`;

test.describe('Plugin Lifecycle', () => {
  test.beforeEach(async ({ page, workViewPage }) => {
    const timeoutMultiplier = getCITimeoutMultiplier();
    test.setTimeout(30000 * timeoutMultiplier); // Reduced from 60s to 30s base

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

    const initSuccess = await waitForPluginManagementInit(page);
    if (!initSuccess) {
      throw new Error(
        'Plugin management failed to initialize (timeout waiting for plugin cards)',
      );
    }

    // Enable API Test Plugin
    const settingsBtn = page.locator(SETTINGS_BTN);
    await settingsBtn.waitFor({ state: 'visible' });
    await settingsBtn.click();
    // Wait for settings page to be fully visible - use first() to avoid multiple matches
    await page
      .locator('.page-settings')
      .first()
      .waitFor({ state: 'visible', timeout: 10000 });

    await page.evaluate(() => {
      const configPage = document.querySelector('.page-settings');
      if (!configPage) {
        return;
      }

      const pluginSection = document.querySelector('.plugin-section');
      if (pluginSection) {
        pluginSection.scrollIntoView({ behavior: 'instant', block: 'center' });
      }

      const collapsible = document.querySelector('.plugin-section collapsible');
      if (collapsible) {
        const isExpanded = collapsible.classList.contains('isExpanded');
        if (!isExpanded) {
          const header = collapsible.querySelector('.collapsible-header');
          if (header) {
            (header as HTMLElement).click();
          }
        }
      }
    });

    // Scroll plugin-management into view
    await page.evaluate(() => {
      const pluginMgmt = document.querySelector('plugin-management');
      if (pluginMgmt) {
        pluginMgmt.scrollIntoView({ behavior: 'instant', block: 'center' });
      }
    });

    // Wait for plugin management section to be attached
    await page.locator('plugin-management').waitFor({ state: 'attached', timeout: 5000 });

    // Enable the plugin
    const enableResult = await page.evaluate((pluginName: string) => {
      const cards = Array.from(document.querySelectorAll('plugin-management mat-card'));
      const targetCard = cards.find((card) => {
        const title = card.querySelector('mat-card-title')?.textContent || '';
        return title.includes(pluginName);
      });

      if (targetCard) {
        const toggleButton = targetCard.querySelector(
          'mat-slide-toggle button[role="switch"]',
        ) as HTMLButtonElement;
        if (toggleButton) {
          const wasChecked = toggleButton.getAttribute('aria-checked') === 'true';
          if (!wasChecked) {
            toggleButton.click();
          }
          return {
            found: true,
            wasEnabled: wasChecked,
            clicked: !wasChecked,
          };
        }
        return { found: true, hasToggle: false };
      }

      return { found: false };
    }, 'API Test Plugin');

    expect(enableResult.found).toBe(true);

    // Go back to work view
    await page.goto('/#/tag/TODAY');
    // Wait for navigation and work view to be ready
    await page.locator('.route-wrapper').waitFor({ state: 'visible', timeout: 10000 });

    // Wait for task list to be visible
    await page.waitForSelector('task-list', { state: 'visible', timeout: 10000 });
  });

  test('verify plugin is initially loaded', async ({ page }) => {
    test.setTimeout(20000); // Increase timeout
    // Wait for magic-side-nav to be ready
    await page.locator(SIDENAV).waitFor({ state: 'visible' });

    // Plugin doesn't show snack bar on load, check plugin nav item instead
    await expect(page.locator(API_TEST_PLUGIN_NAV_ITEM)).toBeVisible({ timeout: 10000 });
    await expect(page.locator(API_TEST_PLUGIN_NAV_ITEM)).toContainText('API Test Plugin');
  });

  test('test plugin navigation', async ({ page }) => {
    test.setTimeout(20000); // Increase timeout

    // Click on the plugin nav item to navigate to plugin
    await expect(page.locator(API_TEST_PLUGIN_NAV_ITEM)).toBeVisible();
    await page.click(API_TEST_PLUGIN_NAV_ITEM);

    // Verify we navigated to the plugin page
    await expect(page).toHaveURL(/\/plugins\/api-test-plugin\/index/, { timeout: 10000 });
    await expect(page.locator('iframe')).toBeVisible({ timeout: 10000 });

    // Go back to work view
    await page.goto('/#/tag/TODAY');
  });

  test('disable plugin and verify cleanup', async ({ page, workViewPage }) => {
    test.setTimeout(30000); // Increase timeout

    // Navigate to settings
    await page.click(SETTINGS_BTN);
    // Wait for settings page to be visible - use first() to avoid multiple matches
    await page
      .locator('.page-settings')
      .first()
      .waitFor({ state: 'visible', timeout: 10000 });

    // Expand plugin section
    await page.evaluate(() => {
      const pluginSection = document.querySelector('.plugin-section');
      if (pluginSection) {
        pluginSection.scrollIntoView({ behavior: 'instant', block: 'center' });
      }

      const collapsible = document.querySelector('.plugin-section collapsible');
      if (collapsible && !collapsible.classList.contains('isExpanded')) {
        const header = collapsible.querySelector('.collapsible-header');
        if (header) {
          (header as HTMLElement).click();
        }
      }
    });

    // Scroll plugin-management into view
    await page.evaluate(() => {
      const pluginMgmt = document.querySelector('plugin-management');
      if (pluginMgmt) {
        pluginMgmt.scrollIntoView({ behavior: 'instant', block: 'center' });
      }
    });

    // Wait for plugin management to be ready (attached, not necessarily visible)
    await page
      .locator('plugin-management')
      .waitFor({ state: 'attached', timeout: 10000 });
    // Wait for plugin cards to be available
    await page
      .locator('plugin-management mat-card')
      .first()
      .waitFor({ state: 'attached', timeout: 10000 });

    // Check current state of the plugin and enable if needed
    const currentState = await page.evaluate((pluginName: string) => {
      const cards = Array.from(document.querySelectorAll('plugin-management mat-card'));
      const targetCard = cards.find((card) => {
        const title = card.querySelector('mat-card-title')?.textContent || '';
        return title.includes(pluginName);
      });

      if (targetCard) {
        const toggleButton = targetCard.querySelector(
          'mat-slide-toggle button[role="switch"]',
        ) as HTMLButtonElement;
        if (toggleButton) {
          const isEnabled = toggleButton.getAttribute('aria-checked') === 'true';
          if (!isEnabled) {
            toggleButton.click();
            return { found: true, wasEnabled: false, clicked: true };
          }
          return { found: true, wasEnabled: true, clicked: false };
        }
      }
      return { found: false };
    }, 'API Test Plugin');

    // If we just enabled it, wait for it to be enabled
    if (currentState.clicked) {
      await page.waitForFunction(
        (name) => {
          const cards = Array.from(
            document.querySelectorAll('plugin-management mat-card'),
          );
          const targetCard = cards.find((card) => {
            const title = card.querySelector('mat-card-title')?.textContent || '';
            return title.includes(name);
          });
          const toggle = targetCard?.querySelector(
            'mat-slide-toggle button[role="switch"]',
          ) as HTMLButtonElement;
          return toggle?.getAttribute('aria-checked') === 'true';
        },
        'API Test Plugin',
        { timeout: 5000 },
      );
    }

    // Now disable the plugin
    await page.evaluate((pluginName: string) => {
      const cards = Array.from(document.querySelectorAll('plugin-management mat-card'));
      const targetCard = cards.find((card) => {
        const title = card.querySelector('mat-card-title')?.textContent || '';
        return title.includes(pluginName);
      });

      if (targetCard) {
        const toggleButton = targetCard.querySelector(
          'mat-slide-toggle button[role="switch"]',
        ) as HTMLButtonElement;
        if (toggleButton && toggleButton.getAttribute('aria-checked') === 'true') {
          toggleButton.click();
          return { found: true, clicked: true };
        }
        return { found: true, clicked: false, alreadyDisabled: true };
      }
      return { found: false };
    }, 'API Test Plugin');

    // Wait for toggle state to update to disabled
    await page.waitForFunction(
      (name) => {
        const cards = Array.from(document.querySelectorAll('plugin-management mat-card'));
        const targetCard = cards.find((card) => {
          const title = card.querySelector('mat-card-title')?.textContent || '';
          return title.includes(name);
        });
        const toggle = targetCard?.querySelector(
          'mat-slide-toggle button[role="switch"]',
        ) as HTMLButtonElement;
        return toggle?.getAttribute('aria-checked') === 'false';
      },
      'API Test Plugin',
      { timeout: 5000 },
    );

    // Go back to work view
    await page.goto('/#/tag/TODAY');
    // Wait for navigation and work view to be ready
    await page.locator('.route-wrapper').waitFor({ state: 'visible', timeout: 10000 });

    // Check if the magic-side-nav exists and verify the API Test Plugin is not in it
    const sideNavExists = (await page.locator(SIDENAV).count()) > 0;

    if (sideNavExists) {
      // Check all plugin nav items to ensure API Test Plugin is not present
      const hasApiTestPlugin = await page.evaluate(() => {
        const menuItems = Array.from(
          document.querySelectorAll('magic-side-nav nav-item button'),
        );
        return menuItems.some((item) => item.textContent?.includes('API Test Plugin'));
      });

      expect(hasApiTestPlugin).toBe(false);
    } else {
      // Magic-side-nav doesn't exist at all, which is unexpected
      expect(sideNavExists).toBe(true);
    }
  });
});
