import { expect, test } from '../../fixtures/test.fixture';

/**
 * Context menus opened through `context-menu` must work by keyboard (#11403):
 * MatMenu's arrow keys only reach items written in the menu's own template, so
 * items passed in from another template used to be skipped; and the menu's
 * real trigger is a hidden element, which put a keyboard-opened menu in the
 * window's corner and dropped the focus on close.
 */
test.describe('Context menu keyboard navigation', () => {
  test('arrow keys, Home and End move through a side-menu row menu', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();

    const inboxRow = page
      .locator('magic-side-nav nav-item button.nav-link')
      .filter({ hasText: 'Inbox' });
    await inboxRow.click({ button: 'right' });

    const menu = page.locator('.mat-mdc-menu-panel');
    const item = (name: string): ReturnType<typeof menu.getByRole> =>
      menu.getByRole('menuitem', { name, exact: true });

    // The Inbox can't be renamed, so History comes first.
    await expect(item('History')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(item('Metrics')).toBeFocused();
    await page.keyboard.press('End');
    await expect(item('Settings')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(item('History')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(inboxRow).toBeFocused();
  });

  // The ⋮ is a tab stop where it always shows (touch-primary screens, repeating
  // form sections); on desktop it shows on hover, which the test uses.
  test('Enter on a row menu button opens the menu at the button', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();

    const viewRow = page
      .locator('magic-side-nav nav-item')
      .filter({ has: page.locator('.nav-label', { hasText: /^\s*Kanban\s*$/ }) });
    await viewRow.hover();
    const moreBtn = viewRow.locator('.additional-btn');
    await moreBtn.focus();
    // Measured now: the button shows only while its row is hovered or focused.
    const btnBox = (await moreBtn.boundingBox())!;
    await page.keyboard.press('Enter');

    const menu = page.locator('.mat-mdc-menu-panel');
    await expect(menu.getByRole('menuitem', { name: 'Edit', exact: true })).toBeFocused();
    const menuBox = (await menu.boundingBox())!;
    expect(Math.abs(menuBox.x - btnBox.x)).toBeLessThan(btnBox.width);
    expect(menuBox.y).toBeGreaterThanOrEqual(btnBox.y);

    // Off the row, its ⋮ hides (desktop) and can't take the focus back: the
    // row gets it instead.
    await page.mouse.move(700, 600);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(viewRow.locator('a.nav-link')).toBeFocused();
  });
});
