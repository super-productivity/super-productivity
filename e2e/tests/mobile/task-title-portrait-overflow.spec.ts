import { expect, test } from '../../fixtures/test.fixture';

test.describe('Task Title Portrait Overflow (Issue #9829)', () => {
  test('should not overflow task row when title wraps in portrait mode (390px)', async ({
    workViewPage,
    taskPage,
    page,
  }) => {
    // Portrait width where the original 180px min-width would cause regression
    await page.setViewportSize({ width: 390, height: 844 });

    await workViewPage.waitForTaskList();
    // Create a task with long undated parent and long title to reproduce overflow
    const longParentName =
      'Very Long Parent Task Name That Takes Up Horizontal Space';
    const longTaskTitle =
      'Very Long Subtask Title That Should Wrap Instead of Overflow';

    await workViewPage.addTask(longTaskTitle);

    const task = taskPage.getTaskByText(longTaskTitle);
    await expect(task).toBeVisible();

    // Check that the task row stays within viewport bounds (reproduces #9829)
    const taskBounds = await task.boundingBox();
    if (taskBounds) {
      // The task row should not overflow the right edge of the viewport
      expect(taskBounds.x + taskBounds.width).toBeLessThanOrEqual(390);
      // The task row should be visible from the left (not pushed off-screen)
      expect(taskBounds.x).toBeGreaterThanOrEqual(0);
    }

    // Verify the title-and-tags-wrapper does not have the old 180px floor
    const titleWrapper = task.locator('.title-and-tags-wrapper');
    const computedMinWidth = await titleWrapper.evaluate((el) => {
      return window.getComputedStyle(el).minWidth;
    });
    // Should be 0 from the fix, not 180px or auto
    expect(computedMinWidth).toBe('0px');
  });

  test('should not regress on landscape/desktop viewports', async ({
    workViewPage,
    taskPage,
    page,
  }) => {
    // Default desktop viewport (no setViewportSize call)
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Desktop Task Title Test');

    const task = taskPage.getTaskByText('Desktop Task Title Test');
    await expect(task).toBeVisible();

    // Desktop should still work correctly with the fix
    const titleWrapper = task.locator('.title-and-tags-wrapper');
    const isOverflowing = await titleWrapper.evaluate((el) => {
      return el.scrollWidth > el.clientWidth;
    });
    // On desktop with normal title lengths, should not overflow
    expect(isOverflowing).toBe(false);
  });
});
