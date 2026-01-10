import type { Locator } from '@playwright/test';

/**
 * Safely checks if an element is visible, returning false on any error.
 * Use this instead of `.isVisible().catch(() => false)` pattern.
 *
 * @param locator - Playwright locator to check
 * @param timeout - Optional timeout in ms (default uses Playwright's default)
 * @returns Promise<boolean> - true if visible, false otherwise
 */
export const safeIsVisible = async (
  locator: Locator,
  timeout?: number,
): Promise<boolean> => {
  try {
    return await locator.isVisible({ timeout });
  } catch {
    return false;
  }
};

/**
 * Safely checks if an element is enabled, returning false on any error.
 * Use this instead of `.isEnabled().catch(() => false)` pattern.
 *
 * @param locator - Playwright locator to check
 * @returns Promise<boolean> - true if enabled, false otherwise
 */
export const safeIsEnabled = async (locator: Locator): Promise<boolean> => {
  try {
    return await locator.isEnabled();
  } catch {
    return false;
  }
};
