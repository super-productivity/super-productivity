import { test, expect } from '../../fixtures/test.fixture';
import { cssSelectors } from '../../constants/selectors';
import {
  waitForPluginAssets,
  waitForPluginManagementInit,
  getCITimeoutMultiplier,
} from '../../helpers/plugin-test.helpers';

const { SETTINGS_BTN } = cssSelectors;

test.describe.serial('Plugin Structure Test', () => {
  test('check plugin card structure', async ({ page, workViewPage }) => {
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

    // Navigate to plugin settings (implementing navigateToPluginSettings inline)
    await page.click(SETTINGS_BTN);
    await page
      .locator('.page-settings')
      .first()
      .waitFor({ state: 'visible', timeout: 10000 });

    // Execute script to navigate to plugin section
    await page.evaluate(() => {
      // First ensure we're on the config page
      const configPage = document.querySelector('.page-settings');
      if (!configPage) {
        console.error('Not on config page');
        return;
      }

      // Scroll to plugins section
      const pluginSection = document.querySelector('.plugin-section');
      if (pluginSection) {
        pluginSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        console.error('Plugin section not found');
        return;
      }

      // Make sure collapsible is expanded - click the header to toggle
      const collapsible = document.querySelector('.plugin-section collapsible');
      if (collapsible) {
        const isExpanded = collapsible.classList.contains('isExpanded');
        if (!isExpanded) {
          // Click the collapsible header to expand it
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

    // Check plugin card structure
    await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('plugin-management mat-card'));
      const apiTestCard = cards.find((card) => {
        const title = card.querySelector('mat-card-title')?.textContent || '';
        return title.includes('API Test Plugin');
      });

      if (!apiTestCard) {
        return { found: false };
      }

      // Look for all possible toggle selectors
      const toggleSelectors = [
        'mat-slide-toggle input',
        'mat-slide-toggle button',
        '.mat-mdc-slide-toggle input',
        '.mat-mdc-slide-toggle button',
        '[role="switch"]',
        'input[type="checkbox"]',
      ];

      const toggleResults = toggleSelectors.map((selector) => ({
        selector,
        found: !!apiTestCard.querySelector(selector),
        element: apiTestCard.querySelector(selector)?.tagName,
      }));

      // Get the card's inner HTML structure
      const cardStructure = apiTestCard.innerHTML.substring(0, 500);

      return {
        found: true,
        cardTitle: apiTestCard.querySelector('mat-card-title')?.textContent,
        toggleResults,
        cardStructure,
        hasMatSlideToggle: !!apiTestCard.querySelector('mat-slide-toggle'),
        allInputs: Array.from(apiTestCard.querySelectorAll('input')).map((input) => ({
          type: input.type,
          id: input.id,
          class: input.className,
        })),
      };
    });
  });
});
