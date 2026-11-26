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
  await page.goto('/#/tag/TODAY/tasks');
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
      // the Views section of the side menu (boards)
      label: 'Views',
      locator: (page: Page) => page.getByRole('menuitem', { name: 'Views' }),
    },
    {
      // the day panel button follows the Schedule switch
      label: 'Schedule',
      title: 'Schedule (day panel button)',
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
    test(`Element assigned with App feature ${feature.title ?? feature.label} is only visible if feature is enabled`, async ({
      page,
    }) => {
      const featureElement = feature.locator(page);

      // elements on settings page
      const featureSwitch = page.getByRole('switch', {
        name: feature.label,
        exact: true,
      });

      // Go to settings page
      await goToConfig(page);

      // "App Features" is open by default; wait for the switch
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

      // "App Features" is open by default; wait for the switch
      await expect(featureSwitch).toBeVisible();

      // Click toggle button to enable and verify state change
      await featureSwitch.click();
      await expect(featureSwitch).toBeChecked();

      // Go back to main view and expect feature's element to be visible
      await goToMainView(page);
      await expect(featureElement).toBeAttached();
    });
  });

  test('Issues panel app feature hides the mobile bottom-nav panel option', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const featureSwitch = page.getByRole('switch', {
      name: 'Issues panel',
      exact: true,
    });
    const issuePanelButton = page.locator('.e2e-toggle-issue-provider-panel');
    const notesButton = page.locator('.e2e-toggle-notes-btn');
    const sidePanelMenuButton = page.getByRole('button', {
      name: 'Side Panel Menu',
    });

    await goToMainView(page);
    await expect(page.locator('mobile-bottom-nav')).toBeVisible();
    await sidePanelMenuButton.click();
    await expect(issuePanelButton).toBeVisible();
    await page.keyboard.press('Escape');

    await goToConfig(page);
    await expect(featureSwitch).toBeVisible();
    await expect(featureSwitch).toBeChecked();
    await featureSwitch.click();
    await expect(featureSwitch).not.toBeChecked();

    await goToMainView(page);
    await expect(page.locator('mobile-bottom-nav')).toBeVisible();
    await sidePanelMenuButton.click();
    await expect(notesButton).toBeVisible();
    await expect(issuePanelButton).not.toBeAttached();
  });
});
