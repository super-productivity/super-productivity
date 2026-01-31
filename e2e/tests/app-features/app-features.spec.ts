import { Page } from 'playwright/test';
import { test, expect } from '../../fixtures/test.fixture';

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
      label: 'Schedule Day Panel',
      locator: (page: Page) => page.locator('.e2e-toggle-schedule-day-panel'),
    },
    {
      label: 'Issues Panel',
      locator: (page: Page) => page.locator('.e2e-toggle-issue-provider-panel'),
    },
    {
      label: 'Project Notes',
      locator: (page: Page) => page.locator('.e2e-toggle-notes-btn'),
    },
    {
      label: 'Sync Button',
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
      await page.goto('/#/config');

      // expand "App Features" and wait for switch to be visible
      await appFeaturesSection.click();
      await expect(featureSwitch).toBeVisible();

      // Ensure feature is enabled (all features are enabled by default)
      await expect(featureSwitch).toBeChecked();

      // Click switch to disable and wait for state change
      await featureSwitch.click();
      await expect(featureSwitch).not.toBeChecked();

      // Navigate to main view
      await page.goto('/#/tag/TODAY');

      // Feature's element should not be present when disabled
      await expect(featureElement).not.toBeAttached();

      // Re-enable the feature
      await page.goto('/#/config');

      // expand "App Features" and wait for switch to be visible and interactable
      await appFeaturesSection.click();
      await expect(featureSwitch).toBeVisible();

      // Click toggle button to enable and verify state change
      await featureSwitch.click();
      await expect(featureSwitch).toBeChecked();

      // Go back to main view and expect feature's element to be visible
      await page.goto('/#/tag/TODAY');
      await expect(featureElement).toBeAttached();
    });
  });
});
