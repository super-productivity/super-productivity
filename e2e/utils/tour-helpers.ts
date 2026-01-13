import type { Page } from '@playwright/test';

/**
 * Dismisses the Welcome intro dialog if present.
 * This is the mat-dialog that appears before the Shepherd tour,
 * asking "Do you want a quick tour of the most important features?"
 */
export const dismissWelcomeDialog = async (page: Page): Promise<void> => {
  try {
    // Look for the "No thanks" button or "Close Tour" button in the welcome dialog
    const closeBtn = page.locator('button:has-text("No thanks")').first();
    const closeTourBtn = page.locator('button:has-text("Close Tour")').first();

    // Check if either button is visible (with short timeout)
    const noThanksVisible = await closeBtn.isVisible().catch(() => false);
    const closeTourVisible = await closeTourBtn.isVisible().catch(() => false);

    if (noThanksVisible) {
      await closeBtn.click();
      // Wait for dialog to close
      await page.waitForTimeout(300);
    } else if (closeTourVisible) {
      await closeTourBtn.click();
      await page.waitForTimeout(300);
    }
  } catch {
    // Dialog not present, ignore
  }
};

/**
 * Dismisses the Shepherd tour if it appears on the page.
 * Silently ignores if tour doesn't appear.
 */
export const dismissShepherdTour = async (page: Page): Promise<void> => {
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

/**
 * Dismisses both the Welcome intro dialog and the Shepherd tour if they appear.
 * This handles the full tour dismissal flow:
 * 1. First, dismiss the "Welcome to Super Productivity!" mat-dialog (if present)
 * 2. Then, dismiss any Shepherd tour steps (if present)
 *
 * Silently ignores if neither appears.
 */
export const dismissTourIfVisible = async (page: Page): Promise<void> => {
  // First, dismiss the welcome intro dialog if present
  await dismissWelcomeDialog(page);

  // Then, dismiss the Shepherd tour if it appears
  await dismissShepherdTour(page);
};
