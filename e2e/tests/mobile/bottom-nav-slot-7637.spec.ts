import { type Locator, type Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { waitForMenuSettled } from '../../utils/waits';
import {
  enablePluginWithVerification,
  waitForPluginAssets,
  waitForPluginInMenu,
  waitForPluginManagementInit,
} from '../../helpers/plugin-test.helpers';

/**
 * #7637: the phone bottom nav's second slot (Planner by default) can be pointed
 * at another destination by long-pressing it. The choice is device-local
 * (localStorage), so it must survive a reload.
 */

// Held past UI_LONG_PRESS_DURATION (600ms) through the real touch pipeline,
// so the click Chromium synthesizes on release is exercised too.
const longPress = async (page: Page, target: Locator): Promise<void> => {
  // Raw touch events skip actionability: wait until the target has stopped
  // moving (e.g. a drawer sliding in) and is the element at its center.
  await target.tap({ trial: true });
  const box = await target.boundingBox();
  if (!box) {
    throw new Error('long-press target is not visible');
  }
  const halfWidth = box.width / 2;
  const halfHeight = box.height / 2;
  const point = { x: box.x + halfWidth, y: box.y + halfHeight };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [point],
  });
  // Deliberate: the gesture is defined by elapsed time.
  await page.waitForTimeout(900);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
};

test.describe('Bottom nav configurable slot #7637', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('long-press picks Inbox, a tap then opens it, and it survives a reload', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    const slot = page.locator('mobile-bottom-nav .e2e-bottom-nav-slot');
    await expect(slot).toHaveAttribute('aria-label', 'Planner');

    await longPress(page, slot);
    await waitForMenuSettled(page);
    const menu = page.locator('.mobile-bottom-nav-slot-menu');
    await expect(menu).toBeVisible();
    // The long-press only opened the menu; it did not also navigate.
    await expect(page).not.toHaveURL(/\/planner/);

    await menu.getByRole('menuitemradio', { name: 'Inbox' }).tap();
    await expect(menu).toBeHidden();
    await expect(slot).toHaveAttribute('aria-label', 'Inbox');

    await slot.tap();
    await expect(page).toHaveURL(/\/project\/INBOX_PROJECT\/tasks/);
    await expect(slot).toHaveClass(/active/);

    await page.reload();
    await workViewPage.waitForTaskList();
    await expect(slot).toHaveAttribute('aria-label', 'Inbox');
    await expect(slot).toHaveClass(/active/);
  });
});

test.describe('Bottom nav slot with a plugin page #7637', () => {
  // Plugins are enabled through the desktop settings page; the phone width
  // is applied afterwards.
  test.use({ viewport: { width: 1024, height: 900 }, hasTouch: true, isMobile: true });

  test('a plugin side-nav entry can be picked and opens its page', async ({
    page,
    workViewPage,
  }) => {
    expect(await waitForPluginAssets(page)).toBe(true);
    await workViewPage.waitForTaskList();
    expect(await waitForPluginManagementInit(page)).toBe(true);
    expect(await enablePluginWithVerification(page, 'API Test Plugin', 10000)).toBe(true);
    expect(await waitForPluginInMenu(page, 'API Test Plugin')).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });

    const slot = page.locator('mobile-bottom-nav .e2e-bottom-nav-slot');
    await longPress(page, slot);
    await waitForMenuSettled(page);
    const menu = page.locator('.mobile-bottom-nav-slot-menu');
    await menu.getByRole('menuitemradio', { name: 'API Test Plugin' }).tap();
    await expect(menu).toBeHidden();
    await expect(slot).toHaveAttribute('aria-label', 'API Test Plugin');

    await slot.tap();
    await expect(page).toHaveURL(/\/plugins\/api-test-plugin\/index/);
    await expect(slot).toHaveClass(/active/);
  });
});
