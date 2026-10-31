import { test, expect } from '../../fixtures/test.fixture';
import type { Locator, Page } from '@playwright/test';
import * as path from 'path';
import { waitForPluginManagementInit } from '../../helpers/plugin-test.helpers';

const FILE_INPUT = 'plugin-management input[type="file"][accept=".zip"]';
const TEST_PLUGIN_ZIP = path.resolve(__dirname, '../../../src/assets/test-plugin.zip');

// Rows are matched by name: the id sits in the collapsed details
const TEST_PLUGIN_NAME = 'Test Upload Plugin';

const openTab = async (
  page: Page,
  name: 'Features' | 'Integrations' | 'Community',
): Promise<void> => {
  const tab = page.locator('plugin-management').getByRole('tab', { name });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
};

const pluginRow = (page: Page): Locator =>
  page.locator('plugin-management .plugin-row', { hasText: TEST_PLUGIN_NAME });

// Uploading asks for confirmation (risk warning) before the plugin is installed.
const uploadTestPlugin = async (page: Page): Promise<void> => {
  await openTab(page, 'Community');
  await page.locator(FILE_INPUT).setInputFiles(TEST_PLUGIN_ZIP);
  const confirmDialog = page.locator('dialog-confirm');
  await confirmDialog.locator('button[e2e="confirmBtn"]').click();
  await expect(confirmDialog).toBeHidden();
};

test.describe.serial('Plugin Upload', () => {
  test.beforeEach(async ({ workViewPage }) => {
    await workViewPage.waitForTaskList();
  });

  test('upload and manage plugin lifecycle', async ({ page }) => {
    // Give the plugin pipeline more breathing room on slower machines/CI
    test.setTimeout(process.env.CI ? 90000 : 60000);
    expect(await waitForPluginManagementInit(page)).toBe(true);

    await uploadTestPlugin(page);

    // The new row is revealed and briefly highlighted, so the upload never looks
    // like nothing happened (#10477).
    const row = pluginRow(page);
    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(row).toHaveClass(/isHighlighted/);
    await expect(row).toBeInViewport();
    await expect(row).not.toHaveClass(/isHighlighted/, { timeout: 5000 });

    // Only the "Community" tab lists uploaded plugins
    await openTab(page, 'Features');
    await expect(pluginRow(page)).toHaveCount(0);
    await openTab(page, 'Integrations');
    await expect(pluginRow(page)).toHaveCount(0);
    await openTab(page, 'Community');

    // Uploaded plugins start disabled; toggle them on, off and on again
    const toggle = row.getByRole('switch');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    for (const isChecked of ['true', 'false', 'true']) {
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', isChecked, {
        timeout: 10000,
      });
    }

    // Remove it through the row's "more actions" menu
    await row.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Remove' }).click();
    const confirmDialog = page.locator('dialog-confirm');
    await confirmDialog.locator('button[e2e="confirmBtn"]').click();
    await expect(confirmDialog).toBeHidden();

    await expect(row).toHaveCount(0, { timeout: 15000 });
  });

  test('remove all uploaded plugins asks before removing them', async ({ page }) => {
    test.setTimeout(process.env.CI ? 90000 : 60000);
    expect(await waitForPluginManagementInit(page)).toBe(true);

    await uploadTestPlugin(page);
    const uploadedRow = pluginRow(page);
    await expect(uploadedRow).toBeVisible({ timeout: 15000 });

    // The button sits in the menu of the Community tab's header row
    const removeAll = async (): Promise<void> => {
      await page.locator('plugin-management .community-menu-btn').click();
      await page.getByRole('menuitem', { name: 'Remove all uploaded plugins' }).click();
    };
    const confirmDialog = page.locator('dialog-confirm');

    // Cancel keeps the uploaded plugin
    await removeAll();
    await expect(confirmDialog).toContainText('Remove uploaded plugins (1)?');
    await confirmDialog.locator('button', { hasText: 'Cancel' }).click();
    await expect(confirmDialog).toBeHidden();
    await expect(uploadedRow).toBeVisible();

    // Confirm removes it
    await removeAll();
    await confirmDialog.locator('button[e2e="confirmBtn"]').click();
    await expect(confirmDialog).toBeHidden();
    await expect(uploadedRow).toHaveCount(0, { timeout: 15000 });
  });
});
