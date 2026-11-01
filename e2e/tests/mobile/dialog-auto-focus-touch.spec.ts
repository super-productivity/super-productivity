import { expect, test } from '../../fixtures/test.fixture';
import { columnTitleButton } from '../../utils/view-helpers';

/**
 * Dialogs on a phone open without focusing a text field, so the on-screen
 * keyboard does not cover them. Focus still moves into the dialog (its
 * container) and returns to the trigger on close. Dialogs whose first step is
 * typing opt in and keep focusing their field. See
 * src/app/util/dialog-auto-focus.ts.
 */

const PHONE = { width: 400, height: 800 };

test.describe('Dialog auto focus on a phone', () => {
  // isMobile makes Chromium report `pointer: coarse`, so the app starts in
  // touch input mode, as on an Android/iOS device.
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test('the view editor focuses itself, not a field', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();
    await page.goto('/#/boards/KANBAN_DEFAULT');
    // Default views show their columns even before their tags exist.
    // A column's title opens the view editor with that column's card asked to
    // take first focus (`cdkFocusInitial`); on touch the container wins.
    const columnTitle = columnTitleButton(page.locator('board-panel').first(), 'To Do');
    await columnTitle.tap();

    const container = page.locator('mat-dialog-container');
    await expect(container.locator('dialog-board-edit')).toBeVisible();
    // The container itself holds focus, so no text field does and the
    // on-screen keyboard stays down.
    await expect(container).toBeFocused();
    await expect(container).toHaveAttribute('role', 'dialog');

    // Closing hands focus back to the button that opened the dialog.
    await container.getByRole('button', { name: 'Cancel', exact: true }).tap();
    await expect(container).toHaveCount(0);
    await expect(columnTitle).toBeFocused();
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
