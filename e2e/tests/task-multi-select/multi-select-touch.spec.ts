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

    // Deselecting the last task keeps the mode (the bar stays).
    await a.tap();
    await b.tap();
    await expect(bar).toContainText('0 selected');
    await expect(bar.getByRole('button', { name: 'Actions' })).toBeDisabled();

    await bar.getByRole('button', { name: 'Clear selection' }).tap();
    await expect(bar).toBeHidden();
    await expect(page.locator('task .select-ring')).toHaveCount(0);
    await expect(page.locator('task done-toggle')).toHaveCount(2);
  });
});
