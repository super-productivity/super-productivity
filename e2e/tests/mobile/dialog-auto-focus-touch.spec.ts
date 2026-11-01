import { type Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';

/**
 * Dialogs on a phone open without focusing a text field, so the on-screen
 * keyboard does not cover them. Focus still moves into the dialog (its
 * container) and returns to the trigger on close. Dialogs whose first step is
 * typing opt in and keep focusing their field. See
 * src/app/util/dialog-auto-focus.ts.
 */

const PHONE = { width: 400, height: 800 };
const isTextEntryFocused = (page: Page): Promise<boolean> =>
  page.evaluate(
    () =>
      !!document.activeElement?.matches(
        'input:not([type=checkbox]):not([type=radio]), textarea, [contenteditable]',
      ),
  );

test.describe('Dialog auto focus on a phone', () => {
  // isMobile makes Chromium report `pointer: coarse`, so the app starts in
  // touch input mode, as on an Android/iOS device.
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test('the edit-board dialog focuses itself, not its title field', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.goto('/#/boards');
    await expect(page.locator('boards')).toBeVisible({ timeout: 10000 });
    await page.getByRole('tab', { name: 'Kanban', exact: true }).tap();
    // A fresh profile lacks the board's tag; once created, the panels show.
    await page.getByRole('button', { name: 'Create Tag' }).tap();

    const editBtn = page
      .locator('board-panel header')
      .getByRole('button', { name: 'Edit' })
      .first();
    await editBtn.tap();

    const container = page.locator('mat-dialog-container');
    await expect(container.locator('board-edit')).toBeVisible();
    await expect(container).toBeFocused();
    await expect(container).toHaveAttribute('role', 'dialog');
    expect(await isTextEntryFocused(page)).toBe(false);

    // Closing hands focus back to the button that opened the dialog.
    await container.getByRole('button', { name: 'Cancel', exact: true }).tap();
    await expect(container).toHaveCount(0);
    await expect(editBtn).toBeFocused();
  });

  test('the create-project dialog still focuses its name field', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();

    await page.locator('mobile-bottom-nav .tour-navMenuBtn').tap();
    await page
      .locator('magic-side-nav nav-list-tree', { hasText: 'Projects' })
      .locator('button:has(mat-icon:text-is("add"))')
      .first()
      .tap();

    const container = page.locator('mat-dialog-container');
    await expect(container.locator('dialog-create-project')).toBeVisible();
    await expect(container.getByRole('textbox', { name: 'Project Name' })).toBeFocused();
  });
});
