import { expect, Locator, Page } from '@playwright/test';

/**
 * Opens the "Create view" dialog from the + of the side menu's Views section.
 * The + only shows on hover (desktop), like the other section buttons.
 */
export const openCreateViewDialog = async (page: Page): Promise<Locator> => {
  await page.locator('nav-view-group > div.g-multi-btn-wrapper').hover();
  await page.locator('[data-nav-btn="add-view"]').click();
  const dialog = page.locator('dialog-board-edit');
  await expect(dialog).toBeVisible();
  return dialog;
};

/** A view row of the side menu's Views section, by view id. */
export const sideNavViewRow = (page: Page, viewId: string): Locator =>
  page.locator(`nav-view-group [data-view-id="${viewId}"]`);
