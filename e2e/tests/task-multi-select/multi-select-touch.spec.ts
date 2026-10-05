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

  test('moves touch-selected Inbox tasks to a section and exits selection mode', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await page.goto('/#/project/INBOX_PROJECT/tasks');
    await workViewPage.waitForTaskList();
    const names = [testPrefix + '-One', testPrefix + '-Two'];
    for (const name of names) await workViewPage.addTask(name);
    await page.locator('.project-settings-btn').click();
    await waitForMenuSettled(page);
    await page.getByRole('menuitem', { name: 'Add Section' }).click();
    const dialog = page.locator('mat-dialog-container');
    await dialog.locator('input[type="text"]').fill('Touch destination');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await page.mouse.move(5, 5); // Park the setup mouse away from the touch menus.
    await page.evaluate(() =>
      window.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch' })),
    );
    const a = taskPage.getTaskByText(names[0]);
    await a.focus();
    await page.keyboard.press('q');
    await waitForMenuSettled(page);
    await page.getByRole('menuitem', { name: 'Select several tasks' }).tap();
    await taskPage.getTaskByText(names[1]).tap();
    await expect(page.locator(BAR)).toContainText('2 selected');
    await page.locator(BAR).getByRole('button', { name: 'Actions' }).tap();
    await waitForMenuSettled(page);
    // The shared touch submenu guard guards submenu taps during the first 350ms.
    // Send a real finger press/release with a deliberate hold through Chromium.
    const trigger = page.getByRole('menuitem', { name: 'Move to section' });
    const box = await trigger.boundingBox();
    expect(box).not.toBeNull();
    const halfWidth = box!.width / 2;
    const halfHeight = box!.height / 2;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: box!.x + halfWidth, y: box!.y + halfHeight }],
    });
    await page.waitForTimeout(400); // Intentional hold for the existing touch guard.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await expect(page.locator('.mat-mdc-menu-panel')).toHaveCount(2);
    await waitForMenuSettled(page);
    await page.getByRole('menuitem', { name: 'Touch destination', exact: true }).tap();
    await expect(page.locator('.section-container task')).toHaveCount(2);
    await expect(page.locator(BAR)).toBeHidden();
    await expect(page.locator('.mat-mdc-menu-panel')).toHaveCount(0);
  });

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
});
