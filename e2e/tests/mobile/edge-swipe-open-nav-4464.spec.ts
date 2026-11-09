import { type Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';

/**
 * #4464: on a phone the side nav could only be opened with the menu button.
 * The drawer slides in from the right, so a leftward swipe starting at the right
 * screen edge opens it — also over a task row, without that task's swipe-left
 * context menu opening underneath.
 */

const PHONE = { width: 360, height: 800 };

const swipe = async (
  page: Page,
  from: { x: number; y: number },
  toX: number,
): Promise<void> => {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [from],
    });
    const steps = 6;
    for (let step = 1; step <= steps; step++) {
      const progress = step / steps;
      const travelled = (toX - from.x) * progress;
      const x = from.x + travelled;
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: from.y }],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await cdp.detach();
  }
};

test.describe('Mobile nav edge swipe #4464', () => {
  // Desktop-sized first so the shared add-task flow works, then a phone.
  test.use({ viewport: { width: 1024, height: 900 }, hasTouch: true, isMobile: true });

  test('a leftward swipe from the right edge over a task opens the drawer only', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const title = `${testPrefix}-Edge swipe task`;
    await workViewPage.addTask(title);
    const task = taskPage.getTaskByText(title);
    await page.setViewportSize(PHONE);
    await expect(task).toBeVisible();
    const box = await task.boundingBox();
    if (!box) throw new Error('task has no bounding box');
    const halfHeight = box.height / 2;
    const y = box.y + halfHeight;
    const url = page.url();

    await swipe(page, { x: PHONE.width - 4, y }, PHONE.width - 160);

    const drawer = page.locator('.nav-sidenav.mobile');
    await expect(page.locator('.nav-backdrop-mobile')).toHaveCount(1);
    await expect(drawer.locator('.mobile-menu-close')).toBeVisible();
    // Asserting an absence: give a late task swipe menu time to appear.
    await page.waitForTimeout(500);
    await expect(page.locator('.mat-mdc-menu-panel')).toHaveCount(0);
    expect(page.url()).toBe(url);

    // A swipe starting away from the edge stays the task's own gesture.
    await drawer.locator('.mobile-menu-close').click();
    await expect(page.locator('.nav-backdrop-mobile')).toHaveCount(0);
    await swipe(page, { x: PHONE.width * 0.8, y }, PHONE.width * 0.3);
    await expect(page.locator('.mat-mdc-menu-panel').first()).toBeVisible();
    await expect(page.locator('.nav-backdrop-mobile')).toHaveCount(0);
  });

  test('an edge swipe on the schedule day view still pages the day', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.goto('/#/schedule');
    await page.getByRole('button', { name: 'View Day' }).click();
    await page.setViewportSize(PHONE);
    const dayCol = page
      .locator('schedule-week:not([inert] *) .col:not(.end-of-day)[data-day]')
      .first();
    await expect(dayCol).toBeVisible();
    const dayBefore = await dayCol.getAttribute('data-day');
    // Mid-screen: the day column is taller than the viewport.
    const y = PHONE.height / 2;

    await swipe(page, { x: PHONE.width - 4, y }, PHONE.width - 240);

    await expect(dayCol).not.toHaveAttribute('data-day', dayBefore ?? '');
    await expect(page.locator('.nav-backdrop-mobile')).toHaveCount(0);
  });
});
