import { test, expect } from '../../fixtures/test.fixture';
import * as path from 'path';
import { cssSelectors } from '../../constants/selectors';

const { SETTINGS_BTN } = cssSelectors;

// Plugin-related selectors
const UPLOAD_PLUGIN_BTN = 'plugin-management button[mat-raised-button]'; // The "Choose Plugin File" button
const FILE_INPUT = 'input[type="file"][accept=".zip"]';
const PLUGIN_CARD = 'plugin-management mat-card.ng-star-inserted';

// Test plugin details
const TEST_PLUGIN_ID = 'test-upload-plugin';

test.describe.serial('Plugin Upload', () => {
  test.beforeEach(async ({ workViewPage }) => {
    await workViewPage.waitForTaskList();
  });

  test('upload and manage plugin lifecycle', async ({ page, workViewPage }) => {
    // Give the plugin pipeline more breathing room on slower machines/CI
    test.setTimeout(process.env.CI ? 90000 : 60000);
    // Navigate to plugin management
    await page.click(SETTINGS_BTN);
    await page
      .locator('.page-settings')
      .first()
      .waitFor({ state: 'visible', timeout: 10000 });

    // Navigate to Plugins tab first
    await page.evaluate(() => {
      const pluginsTab = Array.from(
        document.querySelectorAll('mat-tab-header .mat-mdc-tab'),
      ).find((tab) => {
        const icon = tab.querySelector('mat-icon');
        return icon?.textContent?.trim() === 'extension';
      });

      if (pluginsTab) {
        (pluginsTab as HTMLElement).click();
      }
    });

    await page.waitForTimeout(500);

    await page.evaluate(() => {
      const configPage = document.querySelector('.page-settings');
      if (!configPage) {
        console.error('Not on config page');
        return;
      }

      const pluginSection = document.querySelector('.plugin-section');
      if (pluginSection) {
        pluginSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

    await expect(page.locator('plugin-management')).toBeVisible({ timeout: 10000 });

    // Upload plugin ZIP file
    const testPluginPath = path.resolve(__dirname, '../../../src/assets/test-plugin.zip');

    await expect(page.locator(UPLOAD_PLUGIN_BTN)).toBeVisible();

    // Make file input visible for testing
    await page.evaluate(() => {
      const input = document.querySelector(
        'input[type="file"][accept=".zip"]',
      ) as HTMLElement;
      if (input) {
        input.style.display = 'block';
        input.style.position = 'relative';
        input.style.opacity = '1';
      }
    });

    await page.locator(FILE_INPUT).setInputFiles(testPluginPath);

    // Wait for uploaded plugin to appear in list
    await page.waitForFunction(
      (pluginId) => {
        const cards = Array.from(document.querySelectorAll('plugin-management mat-card'));
        return cards.some((card) => card.textContent?.includes(pluginId));
      },
      TEST_PLUGIN_ID,
      { timeout: 15000 },
    );

    // Verify uploaded plugin appears in list (there are multiple cards, so check first)
    await expect(page.locator(PLUGIN_CARD).first()).toBeVisible();

    const pluginExists = await page.evaluate((pluginName: string) => {
      const cards = Array.from(document.querySelectorAll('plugin-management mat-card'));
      return cards.some((card) => card.textContent?.includes(pluginName));
    }, TEST_PLUGIN_ID);

    expect(pluginExists).toBeTruthy();

    // Verify uploaded plugin is disabled by default
    const initialStatus = await page.evaluate((pluginId: string) => {
      const cards = Array.from(document.querySelectorAll('plugin-management mat-card'));
      const targetCard = cards.find((card) => card.textContent?.includes(pluginId));
      if (targetCard) {
        const toggleButton = targetCard.querySelector(
          'mat-slide-toggle button[role="switch"]',
        ) as HTMLButtonElement;
        return toggleButton?.getAttribute('aria-checked') === 'true';
      }
      return null;
    }, TEST_PLUGIN_ID);

    expect(initialStatus).toBe(false);

    // Enable uploaded plugin
    const enableResult = await page.evaluate((pluginName: string) => {
      const items = Array.from(document.querySelectorAll('plugin-management mat-card'));
      const pluginCard = items.find((item) => item.textContent?.includes(pluginName));
      if (pluginCard) {
        const toggle = pluginCard.querySelector(
          'mat-slide-toggle button[role="switch"]',
        ) as HTMLButtonElement;
        if (toggle) {
          toggle.click();
          return true;
        }
      }
      return false;
    }, TEST_PLUGIN_ID);

    expect(enableResult).toBeTruthy();

    // Wait for toggle state to change to enabled
    await page.waitForFunction(
      (pluginId) => {
        const cards = Array.from(document.querySelectorAll('plugin-management mat-card'));
        const targetCard = cards.find((card) => card.textContent?.includes(pluginId));
        if (targetCard) {
          const toggleButton = targetCard.querySelector(
            'mat-slide-toggle button[role="switch"]',
          ) as HTMLButtonElement;
          return toggleButton?.getAttribute('aria-checked') === 'true';
        }
        return false;
      },
      TEST_PLUGIN_ID,
      { timeout: 10000 },
    );

    // Verify plugin is now enabled
    const enabledStatus = await page.evaluate((pluginId: string) => {
      const cards = Array.from(document.querySelectorAll('plugin-management mat-card'));
      const targetCard = cards.find((card) => card.textContent?.includes(pluginId));
      if (targetCard) {
        const toggleButton = targetCard.querySelector(
          'mat-slide-toggle button[role="switch"]',
        ) as HTMLButtonElement;
        return toggleButton?.getAttribute('aria-checked') === 'true';
      }
      return null;
    }, TEST_PLUGIN_ID);

    expect(enabledStatus).toBe(true);

    // Disable uploaded plugin
    const disableResult = await page.evaluate((pluginId: string) => {
      const items = Array.from(document.querySelectorAll('plugin-management mat-card'));
      const pluginCard = items.find((item) => item.textContent?.includes(pluginId));
      if (pluginCard) {
        const toggle = pluginCard.querySelector(
          'mat-slide-toggle button[role="switch"]',
        ) as HTMLButtonElement;
        if (toggle) {
          toggle.click();
          return true;
        }
      }
      return false;
    }, TEST_PLUGIN_ID);

    expect(disableResult).toBeTruthy();

    // Wait for toggle state to change to disabled
    await page.waitForFunction(
      (pluginId) => {
        const cards = Array.from(document.querySelectorAll('plugin-management mat-card'));
        const targetCard = cards.find((card) => card.textContent?.includes(pluginId));
        if (targetCard) {
          const toggleButton = targetCard.querySelector(
            'mat-slide-toggle button[role="switch"]',
          ) as HTMLButtonElement;
          return toggleButton?.getAttribute('aria-checked') === 'false';
        }
        return false;
      },
      TEST_PLUGIN_ID,
      { timeout: 10000 },
    );

    // Verify plugin is now disabled
    const disabledStatus = await page.evaluate((pluginId: string) => {
      const cards = Array.from(document.querySelectorAll('plugin-management mat-card'));
      const targetCard = cards.find((card) => card.textContent?.includes(pluginId));
      if (targetCard) {
        const toggleButton = targetCard.querySelector(
          'mat-slide-toggle button[role="switch"]',
        ) as HTMLButtonElement;
        return toggleButton?.getAttribute('aria-checked') === 'true';
      }
      return null;
    }, TEST_PLUGIN_ID);

    expect(disabledStatus).toBe(false);

    // Re-enable uploaded plugin
    const reEnableResult = await page.evaluate((pluginId: string) => {
      const items = Array.from(document.querySelectorAll('plugin-management mat-card'));
      const pluginCard = items.find((item) => item.textContent?.includes(pluginId));
      if (pluginCard) {
        const toggle = pluginCard.querySelector(
          'mat-slide-toggle button[role="switch"]',
        ) as HTMLButtonElement;
        if (toggle) {
          toggle.click();
          return true;
        }
      }
      return false;
    }, TEST_PLUGIN_ID);

    expect(reEnableResult).toBeTruthy();

    // Wait for toggle state to change to enabled again
    await page.waitForFunction(
      (pluginId) => {
        const cards = Array.from(document.querySelectorAll('plugin-management mat-card'));
        const targetCard = cards.find((card) => card.textContent?.includes(pluginId));
        if (targetCard) {
          const toggleButton = targetCard.querySelector(
            'mat-slide-toggle button[role="switch"]',
          ) as HTMLButtonElement;
          return toggleButton?.getAttribute('aria-checked') === 'true';
        }
        return false;
      },
      TEST_PLUGIN_ID,
      { timeout: 10000 },
    );

    // Verify plugin is enabled again
    const reEnabledStatus = await page.evaluate((pluginId: string) => {
      const cards = Array.from(document.querySelectorAll('plugin-management mat-card'));
      const targetCard = cards.find((card) => card.textContent?.includes(pluginId));
      if (targetCard) {
        const toggleButton = targetCard.querySelector(
          'mat-slide-toggle button[role="switch"]',
        ) as HTMLButtonElement;
        return toggleButton?.getAttribute('aria-checked') === 'true';
      }
      return null;
    }, TEST_PLUGIN_ID);

    expect(reEnabledStatus).toBe(true);

    // Remove uploaded plugin
    // Handle confirmation dialog - set up before triggering the dialog
    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });

    await page.evaluate((pluginId: string) => {
      const items = Array.from(document.querySelectorAll('plugin-management mat-card'));
      const pluginCard = items.find((item) => item.textContent?.includes(pluginId));
      if (pluginCard) {
        const removeBtn = pluginCard.querySelector('button[color="warn"]') as HTMLElement;
        if (removeBtn) {
          removeBtn.click();
          return true;
        }
      }
      return false;
    }, TEST_PLUGIN_ID);

    // Wait for plugin to be removed from the list
    await page.waitForFunction(
      (pluginId) => {
        const items = Array.from(document.querySelectorAll('plugin-management mat-card'));
        return !items.some((item) => item.textContent?.includes(pluginId));
      },
      TEST_PLUGIN_ID,
      { timeout: 15000 },
    );

    // Verify plugin is removed
    const removalResult = await page.evaluate((pluginId: string) => {
      const items = Array.from(document.querySelectorAll('plugin-management mat-card'));
      const foundPlugin = items.some((item) => item.textContent?.includes(pluginId));
      return {
        removed: !foundPlugin,
        totalCards: items.length,
        cardTexts: items.map((item) => item.textContent?.trim().substring(0, 50)),
      };
    }, TEST_PLUGIN_ID);

    // console.log('Removal verification:', removalResult);
    expect(removalResult.removed).toBeTruthy();
  });
});
