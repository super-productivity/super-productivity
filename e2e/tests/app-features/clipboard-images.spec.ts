import { test, expect } from '../../fixtures/test.fixture';

test.describe('Clipboard Images Settings', () => {
  test('should show IndexedDB manager button in web but not in config', async ({
    page,
    settingsPage,
  }) => {
    test.setTimeout(30000);

    // Navigate to settings
    await settingsPage.navigateToSettings();

    // Wait for settings page to load
    await page.waitForLoadState('networkidle');

    // Find and click on clipboard images section
    // Look for the collapsible section title (not an h2/h3, but a div.collapsible-title)
    const sectionHeading = page
      .locator('.collapsible-title')
      .filter({ hasText: /clipboard.*image/i });
    await sectionHeading.first().waitFor({ state: 'visible', timeout: 10000 });

    // Scroll into view if needed
    await sectionHeading.first().scrollIntoViewIfNeeded();

    // Click to expand the section if it's collapsed
    await sectionHeading.first().click();

    // Wait a moment for expansion animation
    await page.waitForTimeout(500);

    // In web version, verify IndexedDB manager button IS visible
    const managerBtn = page.locator('button', {
      hasText: /manage.*image|open.*manager/i,
    });
    await expect(managerBtn.first()).toBeVisible({ timeout: 5000 });

    // Verify the button text contains expected text
    const btnText = await managerBtn.first().textContent();
    expect(btnText?.toLowerCase()).toMatch(/manage|manager/);
  });

  test('should open clipboard images manager dialog', async ({ page, settingsPage }) => {
    test.setTimeout(30000);

    // Navigate to settings
    await settingsPage.navigateToSettings();
    await page.waitForLoadState('networkidle');

    // Find clipboard images section (collapsible title, not h2/h3)
    const sectionHeading = page
      .locator('.collapsible-title')
      .filter({ hasText: /clipboard.*image/i });
    await sectionHeading.first().waitFor({ state: 'visible', timeout: 10000 });
    await sectionHeading.first().scrollIntoViewIfNeeded();

    // Click to expand the section if it's collapsed
    await sectionHeading.first().click();

    // Wait a moment for expansion animation
    await page.waitForTimeout(500);

    // Click the manager button
    const managerBtn = page.locator('button', {
      hasText: /manage.*image|open.*manager/i,
    });
    await managerBtn.first().click();

    // Wait for dialog to open
    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Verify dialog title
    const dialogTitle = dialog.locator('h1, h2').filter({ hasText: /clipboard.*image/i });
    await expect(dialogTitle).toBeVisible();

    // Verify close button exists (looking for button with "Close" text)
    const closeBtn = dialog.locator('button').filter({ hasText: /close/i });
    await expect(closeBtn.first()).toBeVisible();

    // Close the dialog
    await closeBtn.first().click();

    // Verify dialog is closed
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
  });
});
