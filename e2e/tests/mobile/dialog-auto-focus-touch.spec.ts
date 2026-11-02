import { expect, test } from '../../fixtures/test.fixture';

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
    // On a phone a view is a list, and its title in the title bar opens the
    // view editor.
    await expect(page.locator('board-panel')).toHaveCount(3);
    const viewTitle = page.locator('page-title .page-title');
    await viewTitle.tap();

    const container = page.locator('mat-dialog-container');
    await expect(container.locator('dialog-board-edit')).toBeVisible();
    // The container itself holds focus, so no text field does and the
    // on-screen keyboard stays down.
    await expect(container).toBeFocused();
    await expect(container).toHaveAttribute('role', 'dialog');

    // Layout is tucked below the sections on phones, without horizontal scroll.
    const layout = container.locator('segmented-button-group');
    await expect(layout).toHaveCount(0);
    await container.getByRole('button', { name: /Layout on wider screens/ }).tap();
    await expect(layout).toBeVisible();
    await expect(
      layout.getByRole('radio', { name: 'Board', exact: true }),
    ).toHaveAttribute('aria-checked', 'true');
    const content = container.locator('mat-dialog-content');
    expect(await content.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

    // Opening a tag picker by touch also leaves the keyboard down.
    await container
      .locator('view-editor-section')
      .first()
      .getByRole('button', { name: /^Excluded Tags:/ })
      .tap();
    const filter = page.getByRole('searchbox', { name: 'Filter tags', exact: true });
    await expect(filter).toBeVisible();
    await expect(filter).not.toBeFocused();
    await page.keyboard.press('Escape');
    await expect(filter).toBeHidden();

    // Closing hands focus back to the button that opened the dialog.
    await container.getByRole('button', { name: 'Cancel', exact: true }).tap();
    await expect(container).toHaveCount(0);
    await expect(viewTitle).toBeFocused();
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
