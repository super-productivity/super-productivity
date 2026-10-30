import { expect, test } from '../../fixtures/test.fixture';
import { waitForMenuSettled } from '../../utils/waits';

/**
 * #10835: the task detail panel's ⋮ (more actions) button was only rendered
 * below the xs breakpoint, so touch devices wider than that (phone in
 * landscape, tablets) had no visible way to reach the task menu.
 */

const VIEWPORTS = [
  { name: 'phone portrait', width: 390, height: 844 },
  { name: 'phone landscape', width: 844, height: 390 },
  { name: 'tablet', width: 800, height: 1280 },
];

for (const vp of VIEWPORTS) {
  test.describe(`Task detail menu on touch (${vp.name}) #10835`, () => {
    // isMobile makes Chromium report `pointer: coarse`, which puts detect-it in
    // touchOnly mode, as on an Android/iOS device. The viewport starts
    // desktop-sized so the shared add-task flow works, then shrinks.
    test.use({ viewport: { width: 1024, height: 900 }, hasTouch: true, isMobile: true });

    test('shows the more-actions button and opens the task menu', async ({
      page,
      workViewPage,
      taskPage,
      testPrefix,
    }) => {
      await workViewPage.waitForTaskList();
      const title = `${testPrefix}-Menu Task`;
      await workViewPage.addTask(title);
      const task = taskPage.getTaskByText(title);
      await page.setViewportSize({ width: vp.width, height: vp.height });

      // The shared add-task flow clicks with a mouse; a touch pointerdown
      // switches the input intent back to touch, as a finger would.
      await page.evaluate(() =>
        window.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch' })),
      );
      await expect(page.locator('body')).toHaveClass(/isTouchPrimary/);

      // On touch, tapping the title opens the detail panel.
      await task.locator('.title-and-tags-wrapper').first().tap();
      await expect(page.locator('task-detail-panel .task-title-wrapper')).toBeVisible();
      const moreBtn = page.locator('task-detail-panel .task-detail-more-btn');
      await expect(moreBtn).toBeVisible();

      await moreBtn.tap();
      await waitForMenuSettled(page);
      await expect(page.locator('.mat-mdc-menu-content').first()).toBeVisible();
    });
  });
}

test.describe('Task detail menu on desktop #10835', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('keeps the side panel header free of the more-actions button', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const title = `${testPrefix}-Desktop Task`;
    await workViewPage.addTask(title);
    await taskPage.openTaskDetail(taskPage.getTaskByText(title));

    await expect(page.locator('task-detail-panel .task-title-wrapper')).toBeVisible();
    await expect(page.locator('task-detail-panel .task-detail-more-btn')).toHaveCount(0);
  });
});
