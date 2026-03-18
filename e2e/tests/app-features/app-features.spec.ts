import { Page } from 'playwright/test';
import { test, expect } from '../../fixtures/test.fixture';
import { waitForAngularStability } from '../../utils/waits';

// Navigate to config page and wait for it to be ready
const goToConfig = async (page: Page): Promise<void> => {
  await page.goto('/#/config');
  await waitForAngularStability(page);
};

// Navigate to main view and wait for it to be ready
const goToMainView = async (page: Page): Promise<void> => {
  await page.goto('/#/tag/TODAY');
  await waitForAngularStability(page);
};

test.describe('App Features', () => {
  // check simple feature toggles which effectively just hide ui elements
  [
    {
      label: 'Schedule',
      locator: (page: Page) => page.getByRole('menuitem', { name: 'Schedule' }),
    },
    {
      label: 'Planner',
      locator: (page: Page) => page.getByRole('menuitem', { name: 'Planner' }),
    },
    {
      label: 'Boards',
      locator: (page: Page) => page.getByRole('menuitem', { name: 'Boards' }),
    },
    {
      label: 'Schedule day panel',
      locator: (page: Page) => page.locator('.e2e-toggle-schedule-day-panel'),
    },
    {
      label: 'Issues panel',
      locator: (page: Page) => page.locator('.e2e-toggle-issue-provider-panel'),
    },
    {
      label: 'Project notes',
      locator: (page: Page) => page.locator('.e2e-toggle-notes-btn'),
    },
    {
      label: 'Sync button',
      locator: (page: Page) => page.locator('.sync-btn'),
    },
  ].forEach((feature) => {
    test(`Element assigned with App feature ${feature.label} is only visible if feature is enabled`, async ({
      page,
    }) => {
      const featureElement = feature.locator(page);

      // elements on settings page
      // Use .first() because there may be multiple "App Features" sections (global and project-specific)
      const appFeaturesSection = page
        .locator('collapsible', { hasText: 'App Features' })
        .first();
      const featureSwitch = page.getByRole('switch', {
        name: feature.label,
        exact: true,
      });

      // Go to settings page
      await goToConfig(page);

      // expand "App Features" and wait for switch to be visible
      await appFeaturesSection.click();
      await expect(featureSwitch).toBeVisible();

      // Ensure feature is enabled (all features are enabled by default)
      await expect(featureSwitch).toBeChecked();

      // Click switch to disable and wait for state change
      await featureSwitch.click();
      await expect(featureSwitch).not.toBeChecked();

      // Navigate to main view
      await goToMainView(page);

      // Feature's element should not be present when disabled
      await expect(featureElement).not.toBeAttached();

      // Re-enable the feature
      await goToConfig(page);

      // expand "App Features" and wait for switch to be visible and interactable
      await appFeaturesSection.click();
      await expect(featureSwitch).toBeVisible();

      // Click toggle button to enable and verify state change
      await featureSwitch.click();
      await expect(featureSwitch).toBeChecked();

      // Go back to main view and expect feature's element to be visible
      await goToMainView(page);
      await expect(featureElement).toBeAttached();
    });
  });
});
