import { test, expect } from '../../fixtures/test.fixture';
import {
  waitForPluginAssets,
  waitForPluginManagementInit,
  getCITimeoutMultiplier,
} from '../../helpers/plugin-test.helpers';

test.describe.serial('Plugin Structure Test', () => {
  test('check plugin card structure', async ({ page, workViewPage }) => {
    const timeoutMultiplier = getCITimeoutMultiplier();
    test.setTimeout(30000 * timeoutMultiplier); // Reduced from 60s to 30s base

    // First, ensure plugin assets are available
    const assetsAvailable = await waitForPluginAssets(page);
    if (!assetsAvailable) {
      throw new Error('Plugin assets not available - cannot proceed with test');
    }

    await workViewPage.waitForTaskList();

    const initSuccess = await waitForPluginManagementInit(page);
    if (!initSuccess) {
      throw new Error(
        'Plugin management failed to initialize (timeout waiting for plugin cards)',
      );
    }

    const pluginManagement = page.locator('plugin-management');
    const apiTestCard = pluginManagement
      .locator('mat-card')
      .filter({ hasText: 'API Test Plugin' })
      .first();
    const enableSwitch = apiTestCard.locator('mat-slide-toggle [role="switch"]').first();

    await expect(pluginManagement).toBeVisible({ timeout: 10000 });
    await expect(apiTestCard).toBeVisible({ timeout: 10000 });
    await expect(apiTestCard.locator('mat-card-title')).toContainText('API Test Plugin');
    await expect(apiTestCard.locator('mat-card-subtitle')).toContainText(/v\d/);
    await expect(enableSwitch).toBeVisible();
    await expect(enableSwitch).toHaveAttribute('aria-checked', /^(true|false)$/);
  });
});
