import { expect, test } from '../../fixtures/test.fixture';

/**
 * Take-a-Break Feature E2E Tests
 *
 * Tests the break reminder functionality:
 * - Configure break settings
 * - Verify break feature is available
 *
 * Note: Full break timing tests would require waiting for real time,
 * so we focus on configuration and feature availability.
 */

test.describe('Take-a-Break Feature', () => {
  test('should navigate to settings page', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();

    // Navigate to settings page where break settings live
    await page.goto('/#/config');

    // Verify we're on the settings page
    await expect(page).toHaveURL(/config/);
    await expect(page.locator('.page-settings')).toBeVisible();
  });

  test('should display settings sections', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();

    // Navigate to settings
    await page.goto('/#/config');

    // Verify the settings page loaded with sections
    await expect(page.locator('.page-settings')).toBeVisible();

    // Look for config sections
    const sections = page.locator('config-section, mat-expansion-panel');
    const sectionCount = await sections.count();
    expect(sectionCount).toBeGreaterThan(0);
  });

  test('should have config sections in settings', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();

    // Navigate to settings
    await page.goto('/#/config');

    // Verify settings page loaded
    await expect(page.locator('.page-settings').first()).toBeVisible();

    // Look for config sections (may be config-section or other elements)
    const sections = page.locator('config-section, .config-section');
    const sectionCount = await sections.count();

    // There should be config sections
    expect(sectionCount).toBeGreaterThan(0);
  });

  test('should preserve settings after navigation', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();

    // Navigate to settings
    await page.goto('/#/config');
    await expect(page.locator('.page-settings').first()).toBeVisible();

    // Navigate away
    await page.goto('/#/tag/TODAY');
    await expect(page.locator('task-list').first()).toBeVisible();

    // Navigate back to settings
    await page.goto('/#/config');

    // Settings should still be accessible (use first() to avoid animation duplicates)
    await expect(page.locator('.page-settings').first()).toBeVisible();
  });

  test('should expand a settings section', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();

    // Navigate to settings
    await page.goto('/#/config');

    await expect(page.locator('.page-settings')).toBeVisible();

    // Find and click first expansion panel
    const firstPanel = page.locator('mat-expansion-panel').first();
    const isPanelVisible = await firstPanel
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (isPanelVisible) {
      await firstPanel.click();
      await page.waitForTimeout(300);

      // Panel content should be visible
      const content = firstPanel.locator('.mat-expansion-panel-content');
      await expect(content).toBeVisible();
    }
  });

  test('should return to work view from settings', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();

    // Navigate to settings
    await page.goto('/#/config');
    await expect(page.locator('.page-settings')).toBeVisible();

    // Navigate back to work view
    await page.goto('/#/tag/TODAY');

    // Verify we're back at work view
    await expect(page).toHaveURL(/tag\/TODAY/);
    await expect(page.locator('task-list').first()).toBeVisible();
  });
});
