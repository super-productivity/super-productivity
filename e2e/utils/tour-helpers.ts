import type { Page } from '@playwright/test';

/**
 * Dismisses the Welcome dialog if present.
 * This is the mat-dialog that appears for new users,
 * asking them to add their first task or take a tour.
 */
export const dismissWelcomeDialog = async (page: Page): Promise<void> => {
  try {
    // Look for the "Skip" button in the new welcome dialog,
    // or the legacy "No thanks" / "Close Tour" buttons
    const skipBtn = page.locator('button:has-text("Skip")').first();
    const noThanksBtn = page.locator('button:has-text("No thanks")').first();
    const closeTourBtn = page.locator('button:has-text("Close Tour")').first();

    const skipVisible = await skipBtn.isVisible().catch(() => false);
    const noThanksVisible = await noThanksBtn.isVisible().catch(() => false);
    const closeTourVisible = await closeTourBtn.isVisible().catch(() => false);

    if (skipVisible) {
      await skipBtn.click();
      await page.waitForTimeout(300);
    } else if (noThanksVisible) {
      await noThanksBtn.click();
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
 * Dismisses both the Welcome dialog and the Shepherd tour if they appear.
 * This handles the full tour dismissal flow:
 * 1. First, dismiss the welcome dialog (if present)
 * 2. Then, dismiss any Shepherd tour steps (if present)
 *
 * Silently ignores if neither appears.
 */
export const dismissTourIfVisible = async (page: Page): Promise<void> => {
  // First, dismiss the welcome dialog if present
  await dismissWelcomeDialog(page);

  // Then, dismiss the Shepherd tour if it appears
  await dismissShepherdTour(page);
};
