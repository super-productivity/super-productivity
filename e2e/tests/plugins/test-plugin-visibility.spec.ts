import { test, expect } from '../../fixtures/test.fixture';

const SIDENAV = 'magic-side-nav';
const ROUTER_WRAPPER = '.route-wrapper';
const SETTINGS_BTN = `${SIDENAV} nav-item:has([icon="settings"]) button, ${SIDENAV} .tour-settingsMenuBtn`;

test.describe.serial('Plugin Visibility', () => {
  test('navigate to settings page', async ({ page, workViewPage }) => {
    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    await page.click(SETTINGS_BTN);
    await page.waitForSelector(ROUTER_WRAPPER, { state: 'visible' });
    await expect(page).toHaveURL(/\/config/);
  });

  test('check page structure', async ({ page, workViewPage }) => {
    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    // Navigate to settings
    await page.click(SETTINGS_BTN);
    await page.waitForSelector(ROUTER_WRAPPER, { state: 'visible' });
    await page.getByRole('tab', { name: 'Plugins' }).click();

    const settingsPage = page.locator('.page-settings');
    const pluginManagement = page.locator('plugin-management');
    await expect(settingsPage).toBeVisible();
    await expect(page.locator('.plugin-section')).toBeVisible({ timeout: 10000 });
    await expect(pluginManagement).toBeVisible({ timeout: 10000 });
  });

  test('settings page includes plugin content', async ({ page, workViewPage }) => {
    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    // Navigate to settings
    await page.click(SETTINGS_BTN);
    await page.waitForSelector(ROUTER_WRAPPER, { state: 'visible' });
    await page.getByRole('tab', { name: 'Plugins' }).click();

    const settingsPage = page.locator('.page-settings');
    const pluginManagement = page.locator('plugin-management');
    const apiTestPluginCard = pluginManagement
      .locator('mat-card')
      .filter({ hasText: 'API Test Plugin' })
      .first();

    await expect(settingsPage).toBeVisible();
    await expect(pluginManagement).toBeVisible({ timeout: 10000 });
    await expect(apiTestPluginCard.locator('mat-card-title')).toHaveText(
      'API Test Plugin',
    );
  });
});
