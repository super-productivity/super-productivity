import { type Locator } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { waitForMenuSettled } from '../../utils/waits';

/**
 * Touch selection mode: entered from the task context menu (there is no
 * modifier key on touch), rows show a ring instead of the done toggle, a tap
 * toggles, the bar's ✕ leaves the mode.
 */

const BAR = 'task-multi-select-bar .bar';

test.describe('Task multi-select (touch)', () => {
  // isMobile makes Chromium report `pointer: coarse`, which puts detect-it in
  // touchOnly mode and InputIntentService in 'touch' intent from bootstrap.
  // The viewport stays desktop-sized so the shared add-task flow works.
  test.use({ viewport: { width: 1024, height: 900 }, hasTouch: true, isMobile: true });

  test('the context menu enters selection mode, taps toggle, ✕ leaves', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const first = `${testPrefix}-Touch One`;
    const second = `${testPrefix}-Touch Two`;
    await workViewPage.addTask(first);
    await workViewPage.addTask(second);
    const a = taskPage.getTaskByText(first);
    const b = taskPage.getTaskByText(second);
    const bar = page.locator(BAR);

    // The shared add-task flow clicks with a mouse, which switches the input
    // intent to 'mouse' on this hybrid-detected device; a touch pointerdown
    // (what InputIntentService listens for) switches it back, as a finger would.
    await page.evaluate(() =>
      window.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch' })),
    );
    await expect(page.locator('body')).toHaveClass(/isTouchPrimary/);

    // Open the row's context menu (the keyboard route to the same menu that
    // swipe-left opens) and pick the touch entry point. Menu items are inert
    // for 300ms after a touch open (#4436); tap() waits that out.
    await a.focus();
    await expect(a).toBeFocused();
    await page.keyboard.press('q');
    await waitForMenuSettled(page);
    await page
      .locator('.mat-mdc-menu-content button', { hasText: 'Select several tasks' })
      .tap();

    await expect(bar).toContainText('1 selected');
    await expect(a).toHaveClass(/isTouchSelectionMode/);
    await expect(a.locator('.select-ring.isOn')).toHaveCount(1);
    await expect(b.locator('.select-ring')).toHaveCount(1);
    await expect(page.locator('task done-toggle')).toHaveCount(0);

    await b.tap();
    await expect(bar).toContainText('2 selected');
    await expect(b.locator('.select-ring.isOn')).toHaveCount(1);

    // Deselecting the last task ends the mode.
    await a.tap();
    await expect(bar).toContainText('1 selected');
    await b.tap();
    await expect(bar).toBeHidden();
    await expect(page.locator('task .select-ring')).toHaveCount(0);
    await expect(page.locator('task done-toggle')).toHaveCount(2);

    // A completed action ends the mode as well.
    await a.focus();
    await page.keyboard.press('q');
    await waitForMenuSettled(page);
    await page
      .locator('.mat-mdc-menu-content button', { hasText: 'Select several tasks' })
      .tap();
    await b.tap();
    await expect(bar).toContainText('2 selected');
    await bar.getByRole('button', { name: 'Actions' }).tap();
    await waitForMenuSettled(page);
    await page
      .locator('.mat-mdc-menu-content button', { hasText: 'Mark as completed' })
      .tap();
    await expect(
      page.locator('.task-list-inner[data-id="DONE"] > task.isDone'),
    ).toHaveCount(2);
    await expect(bar).toBeHidden();
    await expect(page.locator('task .select-ring')).toHaveCount(0);
    await expect(page.locator('.mat-mdc-menu-panel')).toHaveCount(0);
  });

  test('mobile planner swipe menu enables tap selection and pauses dragging', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const first = `${testPrefix}-Planner One`;
    const second = `${testPrefix}-Planner Two`;
    await workViewPage.addTask(first);
    await workViewPage.addTask(second);
    await page.locator('magic-side-nav a[href="#/planner"]').click();
    await page.setViewportSize({ width: 390, height: 844 });
    const a = page.locator('planner-task').filter({ hasText: first });
    const b = page.locator('planner-task').filter({ hasText: second });
    await expect(a).toBeVisible();
    await a.scrollIntoViewIfNeeded();

    // Use native touch input for menu entry and disabled swipe behavior.
    const swipe = async (task: Locator, direction: 'left' | 'right'): Promise<void> => {
      await task.scrollIntoViewIfNeeded();
      const box = await task.boundingBox();
      if (!box) throw new Error('Planner task has no bounding box');
      const cdp = await page.context().newCDPSession(page);
      const sign = direction === 'left' ? -1 : 1;
      const startOffset = box.width * (direction === 'left' ? 0.8 : 0.3);
      const halfHeight = box.height / 2;
      const x = box.x + startOffset;
      const y = box.y + halfHeight;
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y }],
      });
      for (let step = 1; step <= 5; step++) {
        const distance = sign * box.width * 0.1 * step;
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: x + distance, y }],
        });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
    };
    await swipe(a, 'left');
    await waitForMenuSettled(page);
    await page
      .locator('.mat-mdc-menu-content button', { hasText: 'Select several tasks' })
      .tap();

    const bar = page.locator(BAR);
    await expect(bar).toContainText('1 selected');
    await expect(a).toHaveClass(/isMultiSelected/);
    await expect(a).toHaveClass(/cdk-drag-disabled/);
    await expect(b).toHaveClass(/cdk-drag-disabled/);
    await expect(a.locator('done-toggle')).toHaveCount(0);
    await expect(b.locator('done-toggle')).toHaveCount(0);
    await swipe(b, 'right');
    // Swipe completion and the task-done animation dispatch after 200ms each.
    await page.waitForTimeout(600);
    await expect(b).not.toHaveClass(/isDone/);
    await expect(bar).toContainText('1 selected');
    await b.locator('.title').tap();
    await expect(bar).toContainText('2 selected');
    await expect(b).toHaveClass(/isMultiSelected/);
    await expect(page.locator('task-detail-panel')).toBeHidden();

    await a.locator('.title').tap();
    await expect(bar).toContainText('1 selected');
    await b.locator('.title').tap();
    await expect(bar).toBeHidden();
    await expect(a).not.toHaveClass(/cdk-drag-disabled/);
    await expect(b).not.toHaveClass(/cdk-drag-disabled/);
    await expect(a.locator('done-toggle')).toBeVisible();
    await expect(page.locator('task-detail-panel')).toBeHidden();
  });
});
