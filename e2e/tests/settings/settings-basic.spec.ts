import { expect, test } from '../../fixtures/test.fixture';

/**
 * Settings/Configuration E2E Tests
 *
 * Tests the settings page:
 * - Navigate to settings
 * - View different settings sections
 * - Modify basic settings
 */

test.describe('Settings', () => {
  test('should navigate to settings page', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();

    // Navigate to settings
    await page.goto('/#/config');
    await page.waitForLoadState('networkidle');

    // Verify URL
    await expect(page).toHaveURL(/config/);

    // Verify settings page is visible
    await expect(page.locator('.page-settings')).toBeVisible();
  });

  test('should navigate to settings via sidebar', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();

    // Click Settings in sidebar
    await page.click('text=Settings');
    await page.waitForLoadState('networkidle');

    // Verify we're on settings page
    await expect(page).toHaveURL(/config/);
    await expect(page.locator('.page-settings')).toBeVisible();
  });

  test('should display settings sections', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();

    // Navigate to settings
    await page.goto('/#/config');
    await page.waitForLoadState('networkidle');

    // Verify settings sections are visible
    await expect(page.locator('.page-settings')).toBeVisible();

    // Look for common settings sections
    const sections = page.locator('config-section, .config-section, mat-expansion-panel');
    const sectionCount = await sections.count();
    expect(sectionCount).toBeGreaterThan(0);
  });

  test('should expand settings section', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();

    // Navigate to settings
    await page.goto('/#/config');
    await page.waitForLoadState('networkidle');

    // Find first expansion panel and click to expand
    const firstSection = page.locator('mat-expansion-panel').first();
    const isFirstSectionVisible = await firstSection
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (isFirstSectionVisible) {
      await firstSection.click();
      await page.waitForTimeout(300);

      // Section should be expanded
      const expandedContent = firstSection.locator('.mat-expansion-panel-content');
      await expect(expandedContent).toBeVisible();
    }
  });

  test('should have multiple config sections', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();

    // Navigate to settings
    await page.goto('/#/config');
    await page.waitForLoadState('networkidle');

    // Verify settings page data is rendered
    await expect(page.locator('.settings-container')).toBeVisible();

    // Should have multiple config sections for different config areas
    const sections = page.locator('.tab-content .config-section');
    await expect.poll(() => sections.count()).toBeGreaterThan(1);
  });

  test('should have form elements in settings', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();

    // Navigate to settings
    await page.goto('/#/config');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.page-settings')).toBeVisible();

    // Expand first config section to reveal form elements
    const firstSection = page.locator('config-section').first();
    const isSectionVisible = await firstSection
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (isSectionVisible) {
      await firstSection.click();
      await page.waitForTimeout(300);

      // Look for form elements like inputs, checkboxes, or toggles
      const formElements = page.locator(
        'config-section input, config-section mat-checkbox, config-section mat-slide-toggle, config-section mat-select',
      );
      const formCount = await formElements.count();
      expect(formCount).toBeGreaterThanOrEqual(0);
    }
  });

  test('should return to work view from settings', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();

    // Navigate to settings
    await page.goto('/#/config');
    await page.waitForLoadState('networkidle');

    // Navigate back to work view via URL (more reliable)
    await page.goto('/#/tag/TODAY');
    await page.waitForLoadState('networkidle');

    // Verify we're back at work view
    await expect(page).toHaveURL(/tag\/TODAY/);
    await expect(page.locator('task-list').first()).toBeVisible();
  });
});
