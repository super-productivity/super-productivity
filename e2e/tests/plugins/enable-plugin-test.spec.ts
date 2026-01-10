import { expect, test } from '../../fixtures/test.fixture';
import { cssSelectors } from '../../constants/selectors';
import {
  getCITimeoutMultiplier,
  waitForPluginAssets,
  waitForPluginManagementInit,
} from '../../helpers/plugin-test.helpers';

const { SETTINGS_BTN } = cssSelectors;

test.describe('Enable Plugin Test', () => {
  test('navigate to plugin settings and enable API Test Plugin', async ({
    page,
    workViewPage,
  }) => {
    const timeoutMultiplier = getCITimeoutMultiplier();
    test.setTimeout(30000 * timeoutMultiplier); // Reduced from 60s to 30s base

    // console.log('[Plugin Test] Starting enable plugin test...');

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

    await waitForPluginManagementInit(page);

    // Navigate to plugin settings
    await page.click(SETTINGS_BTN);
    await page
      .locator('.page-settings')
      .first()
      .waitFor({ state: 'visible', timeout: 10000 });

    await page.evaluate(() => {
      const configPage = document.querySelector('.page-settings');
      if (!configPage) {
        console.error('Not on config page');
        return;
      }

      const pluginSection = document.querySelector('.plugin-section');
      if (pluginSection) {
        pluginSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        console.error('Plugin section not found');
        return;
      }

      const collapsible = document.querySelector('.plugin-section collapsible');
      if (collapsible) {
        const isExpanded = collapsible.classList.contains('isExpanded');
        if (!isExpanded) {
          const header = collapsible.querySelector('.collapsible-header');
          if (header) {
            (header as HTMLElement).click();
            // console.log('Clicked to expand plugin collapsible');
          } else {
            console.error('Could not find collapsible header');
          }
        } else {
          // console.log('Plugin collapsible already expanded');
        }
      } else {
        console.error('Plugin collapsible not found');
      }
    });

    await expect(page.locator('plugin-management')).toBeVisible({ timeout: 10000 });
    // Wait for plugin cards to be loaded
    await page
      .locator('plugin-management mat-card')
      .first()
      .waitFor({ state: 'attached', timeout: 10000 });

    // Check if plugin-management has any content
    await page.evaluate(() => {
      const pluginMgmt = document.querySelector('plugin-management');
      const matCards = pluginMgmt ? pluginMgmt.querySelectorAll('mat-card') : [];

      // Filter out warning card
      const pluginCards = Array.from(matCards).filter((card) => {
        return card.querySelector('mat-slide-toggle') !== null;
      });

      return {
        pluginMgmtExists: !!pluginMgmt,
        totalCardCount: matCards.length,
        pluginCardCount: pluginCards.length,
        pluginCardTexts: pluginCards.map(
          (card) => card.querySelector('mat-card-title')?.textContent?.trim() || '',
        ),
      };
    });

    // Try to find and enable the API Test Plugin (which exists by default)
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

    // console.log('Plugin enablement result:', enableResult);
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

    // Now check if plugin menu has buttons
    await page.evaluate(() => {
      const sideNav = document.querySelector('magic-side-nav');
      const buttons = sideNav ? sideNav.querySelectorAll('nav-item button') : [];
      return {
        sideNavExists: !!sideNav,
        buttonCount: buttons.length,
        buttonTexts: Array.from(buttons).map((btn) => btn.textContent?.trim() || ''),
      };
    });
  });
});
