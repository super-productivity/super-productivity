import { expect, test } from '../../fixtures/test.fixture';

/**
 * Closing the mobile drawer pops its history entry with history.back(). If
 * that pop fires while the tapped route is still resolving, Angular cancels
 * the tap's navigation and the tap is silently lost.
 */
test.describe('Mobile nav tap vs drawer history pop', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('tapping a project in the drawer navigates to it', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await expect(page).toHaveURL(/\/tag\/TODAY/);

    await page.locator('mobile-bottom-nav .tour-navMenuBtn').tap();
    const drawer = page.locator('.nav-sidenav.mobile');
    await expect(drawer.locator('.mobile-menu-close')).toBeVisible();
    // Let the enter animation finish so the tap is not ignored (#10820).
    await page.waitForTimeout(500);

    await drawer.getByRole('menuitem', { name: 'Inbox' }).first().tap();

    await expect(page.locator('.nav-backdrop-mobile')).toHaveCount(0);
    await expect(page).toHaveURL(/\/project\/INBOX_PROJECT\/tasks/);
    // Outlast the async popstate: a late pop would navigate back to Today.
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/project\/INBOX_PROJECT\/tasks/);
  });
});
