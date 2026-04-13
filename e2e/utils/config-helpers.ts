import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Navigate to Misc Settings section in the config page (General tab)
 * and expand it if collapsed.
 *
 * When `forceReload` is true, navigates away first then back to ensure the
 * OnPush config component is fully re-created with fresh store data.
 */
export const navigateToMiscSettings = async (
  page: Page,
  forceReload = false,
): Promise<void> => {
  if (forceReload) {
    // Navigate away first to destroy the config component, then back
    await page.goto('/#/tag/TODAY/tasks');
    await page.waitForURL(/tag\/TODAY/);
  }
  await page.goto('/#/config');
  await page.waitForURL(/config/);

  // "Misc Settings" is a collapsible section in the General tab (default tab).
  const miscCollapsible = page.locator(
    'collapsible:has(.collapsible-title:has-text("Misc"))',
  );
  await miscCollapsible.waitFor({ state: 'visible', timeout: 10000 });
  await miscCollapsible.scrollIntoViewIfNeeded();

  // Expand if collapsed (host element gets .isExpanded class when expanded)
  const isExpanded = await miscCollapsible.evaluate((el: Element) =>
    el.classList.contains('isExpanded'),
  );
  if (!isExpanded) {
    await miscCollapsible.locator('.collapsible-header').click();
    // Wait for the collapsible panel to appear (conditionally rendered via @if)
    await miscCollapsible
      .locator('.collapsible-panel')
      .waitFor({ state: 'visible', timeout: 5000 });
  }
};

/**
 * Toggle a slide-toggle setting by its label text.
 */
export const toggleSetting = async (page: Page, labelText: string): Promise<void> => {
  const toggle = page
    .locator('mat-slide-toggle, mat-checkbox')
    .filter({ hasText: labelText })
    .first();
  await toggle.scrollIntoViewIfNeeded();
  // Capture current checked state before clicking
  const wasChecked = await toggle.evaluate((el: Element) =>
    el.className.includes('checked'),
  );
  await toggle.click();
  // Wait for toggle state to change
  if (wasChecked) {
    await expect(toggle).not.toHaveClass(/checked/, { timeout: 5000 });
  } else {
    await expect(toggle).toHaveClass(/checked/, { timeout: 5000 });
  }
};

/**
 * Check whether a slide-toggle is currently checked (ON).
 */
export const isSettingChecked = async (
  page: Page,
  labelText: string,
): Promise<boolean> => {
  const toggle = page
    .locator('mat-slide-toggle, mat-checkbox')
    .filter({ hasText: labelText })
    .first();
  await toggle.scrollIntoViewIfNeeded();
  // mat-slide-toggle adds 'mat-mdc-slide-toggle-checked' when checked
  // mat-checkbox adds 'mat-mdc-checkbox-checked' when checked
  const classes = (await toggle.getAttribute('class')) ?? '';
  return classes.includes('checked');
};

/**
 * Set a setting to a specific state (ON/OFF).
 */
export const ensureSettingState = async (
  page: Page,
  labelText: string,
  wantChecked: boolean,
): Promise<void> => {
  const current = await isSettingChecked(page, labelText);
  if (current !== wantChecked) {
    await toggleSetting(page, labelText);
  }
};
