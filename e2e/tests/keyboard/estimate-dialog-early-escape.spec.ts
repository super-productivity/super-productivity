import { expect, test } from '../../fixtures/test.fixture';
import { cssSelectors } from '../../constants/selectors';

const { ADD_TASK_INPUT } = cssSelectors;

// With reduced motion, Material closes a dialog in a microtask instead of after
// an exit animation, so Escape right after opening disposes the estimate dialog
// before its first change detection.
test.use({ contextOptions: { reducedMotion: 'reduce' } });

test.describe('Estimate dialog closed right after opening', () => {
  test('should close cleanly and keep keyboard shortcuts working', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await workViewPage.waitForTaskList();
    const taskName = `${testPrefix}-Estimate Task`;
    await workViewPage.addTask(taskName);

    const task = taskPage.getTaskByText(taskName);
    await task.focus();
    await expect(task).toBeFocused();

    // Open the dialog with T and press Escape in the same browser task, so no
    // change detection runs in between.
    const wasOpened = await task.evaluate((el) => {
      el.dispatchEvent(
        new KeyboardEvent('keydown', { key: 't', code: 'KeyT', bubbles: true }),
      );
      const isOpen = !!document.querySelector('mat-dialog-container');
      const escape = new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
      });
      // The CDK dialog matches Escape by keyCode.
      Object.defineProperty(escape, 'keyCode', { get: () => 27 });
      el.dispatchEvent(escape);
      return isOpen;
    });
    expect(wasOpened).toBe(true);

    await expect(page.locator('mat-dialog-container')).toHaveCount(0);

    const addTaskInput = page.locator(ADD_TASK_INPUT);
    await expect(addTaskInput).toHaveCount(0);
    await page.keyboard.press('Shift+A');
    await expect(addTaskInput).toBeFocused();

    expect(pageErrors).toEqual([]);
  });
});
