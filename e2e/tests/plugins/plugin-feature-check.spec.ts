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
    await expect(
      pluginMgmt.getByRole('button', { name: /Choose Plugin File/i }),
    ).toBeVisible();
    await expect(
      pluginMgmt.getByRole('button', { name: /Clear Plugin Cache/i }),
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
    await expect(
      pluginManagement.locator('.community-plugins-card mat-card-title'),
    ).toContainText('Community Plugins');
    await expect(
      pluginManagement.locator('.community-plugin-item').first(),
    ).toBeVisible();
    await expect(
      pluginManagement.getByRole('link', { name: /Get your plugin to show up here/i }),
    ).toHaveAttribute('href', /community-plugins\.json/);
  });
});
