import type { Page } from '@playwright/test';

/**
 * Dismisses the Shepherd tour if it appears on the page.
 * Silently ignores if tour doesn't appear.
 */
export const dismissTourIfVisible = async (page: Page): Promise<void> => {
  try {
    const tourElement = page.locator('.shepherd-element').first();
    await tourElement.waitFor({ state: 'visible', timeout: 4000 });

    const cancelIcon = page.locator('.shepherd-cancel-icon').first();
    if (await cancelIcon.isVisible()) {
      await cancelIcon.click();
    } else {
      await page.keyboard.press('Escape');
    }

    await tourElement.waitFor({ state: 'hidden', timeout: 3000 });
  } catch {
    // Tour didn't appear or wasn't dismissable, ignore
  }
};
