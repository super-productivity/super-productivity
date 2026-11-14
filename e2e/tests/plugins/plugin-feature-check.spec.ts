import { test, expect } from '../../fixtures/test.fixture';

test.describe.serial('Plugin Management Feature Check', () => {
  test('renders plugin management install controls', async ({ page, workViewPage }) => {
    // Wait for Angular app to be fully loaded
    await workViewPage.waitForTaskList();

    // Navigate to config/plugin management
    await page.goto('/#/config');

    // Click on the Plugins tab to show plugin management
    const pluginsTab = page.getByRole('tab', { name: 'Plugins' });
    await pluginsTab.click();

    const pluginMgmt = page.locator('plugin-management');
    await expect(pluginMgmt).toBeVisible({ timeout: 10000 });
    // Feature plugins open by default; installing lives in the "Community" tab.
    await expect(pluginMgmt.getByRole('tab', { name: 'Features' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await pluginMgmt.getByRole('tab', { name: 'Community' }).click();
    await expect(
      pluginMgmt.getByRole('button', { name: /Install from file/i }),
    ).toBeVisible();
    await pluginMgmt.getByRole('button', { name: 'More actions' }).click();
    await expect(
      page.getByRole('menuitem', { name: /Remove all uploaded plugins/i }),
    ).toBeVisible();
  });

  test('renders community plugin catalog', async ({ page, workViewPage }) => {
    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    // Navigate to config page
    await page.goto('/#/config');
    await expect(page.locator('.page-settings')).toBeVisible({ timeout: 10000 });
    await page.getByRole('tab', { name: 'Plugins' }).click();

    const pluginManagement = page.locator('plugin-management');
    await expect(pluginManagement).toBeVisible({ timeout: 10000 });
    await pluginManagement.getByRole('tab', { name: 'Community' }).click();
    await expect(
      pluginManagement.getByRole('heading', { name: 'Community Plugins' }),
    ).toBeVisible();
    await expect(
      pluginManagement.locator('.community-plugin-item').first(),
    ).toBeVisible();
    await expect(
      pluginManagement.getByRole('link', { name: /Get your plugin to show up here/i }),
    ).toHaveAttribute('href', /plugin-development\.md#get-listed-in-the-app/);
  });
});
