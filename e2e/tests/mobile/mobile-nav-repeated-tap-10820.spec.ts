import { type Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';

type StoreLike = {
  dispatch: (action: unknown) => void;
  subscribe: (fn: (state: Record<string, unknown>) => void) => { unsubscribe(): void };
};

// Enough tags that drawer rows reach down to the menu button, as in the report.
const seedTags = async (page: Page, count: number): Promise<void> => {
  await page.evaluate((tagCount) => {
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) {
      throw new Error('__e2eTestHelpers.store missing');
    }
    let state: Record<string, unknown> = {};
    store.subscribe((s) => (state = s)).unsubscribe();
    // Clone the TODAY tag so the seed never drifts from the Tag model.
    const template = (state['tag'] as { entities: Record<string, object> }).entities[
      'TODAY'
    ];
    for (let i = 0; i < tagCount; i++) {
      const id = `tap-10820-${i}`;
      store.dispatch({
        type: '[Tag] Add Tag',
        tag: { ...template, id, title: `Tag ${i}`, taskIds: [], icon: null },
        meta: { isPersistent: true, entityType: 'TAG', entityId: id, opType: 'CRT' },
      });
    }
  }, count);
};

/**
 * #10820: on a slow phone the menu button seemed unresponsive, so users tapped
 * again — and the second tap landed on whatever drawer row had slid under the
 * finger ("Create New Tag"). Taps during the enter animation must be ignored,
 * and the drawer must still close and reopen normally.
 */
test.describe('Mobile nav repeated tap #10820', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('a double tap on the menu button opens the drawer and nothing else', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await seedTags(page, 15);
    const menuBtn = page.locator('mobile-bottom-nav .tour-navMenuBtn');
    const box = await menuBtn.boundingBox();
    if (!box) {
      throw new Error('menu button is not visible');
    }
    const halfWidth = box.width / 2;
    const halfHeight = box.height / 2;
    const x = box.x + halfWidth;
    const y = box.y + halfHeight;
    const urlBefore = page.url();

    // The second tap of a double tap lands mid-animation: unguarded, it closes
    // the drawer again or hits a row that slid under the finger.
    await page.touchscreen.tap(x, y);
    await page.touchscreen.tap(x, y);
    const drawer = page.locator('.nav-sidenav.mobile');
    // Outlast the 225ms enter/leave animation: a second tap that closed the
    // drawer again would otherwise still look open mid-leave.
    await page.waitForTimeout(500);

    await expect(page.locator('.nav-backdrop-mobile')).toHaveCount(1);
    await expect(drawer.locator('.mobile-menu-close')).toBeVisible();
    await expect(page.locator('.mat-mdc-menu-panel')).toHaveCount(0);
    await expect(page.locator('mat-dialog-container')).toHaveCount(0);
    expect(page.url()).toBe(urlBefore);

    // The kept drawer must still close, hide its rows, and reopen.
    await drawer.locator('.mobile-menu-close').click();
    await expect(page.locator('.nav-backdrop-mobile')).toHaveCount(0);
    await expect(drawer.locator('.mobile-menu-close')).toBeHidden();

    await menuBtn.click();
    await expect(drawer.locator('.mobile-menu-close')).toBeVisible();
    await expect(drawer.locator('.mobile-menu-close')).toBeFocused();
  });
});
