import { expect, test } from '../../fixtures/test.fixture';

test.describe('Task Title Portrait Overflow (Issue #9829)', () => {
  // Landscape mode test - verify layout works on wider viewports (no regression from #9750)
  test('should maintain proper layout in landscape mode', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await page.setViewportSize({ width: 844, height: 390 });

    await workViewPage.waitForTaskList();
    const longTitle = 'Long task title for landscape orientation testing';
    await workViewPage.addTask(longTitle);

    const task = taskPage.getTaskByText(longTitle);
    await expect(task).toBeVisible();

    // Landscape should work fine (no regression from #9750)
    const titleWrapper = task.locator('.title-and-tags-wrapper');
    const scrollWidth = await titleWrapper.evaluate((el) => el.scrollWidth);
    const clientWidth = await titleWrapper.evaluate((el) => el.clientWidth);

    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  // Core test: Verify the CSS constraint was removed by checking min-width is not set to 180px
  test('should not have fixed min-width constraint on title-and-tags-wrapper', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Test task for CSS verification');

    const task = taskPage.getTaskByText('Test task for CSS verification');
    await expect(task).toBeVisible();

    // Verify the wrapper doesn't have the problematic min-width: 180px
    const titleWrapper = task.locator('.title-and-tags-wrapper');
    const computedMinWidth = await titleWrapper.evaluate((el) => {
      return window.getComputedStyle(el).minWidth;
    });

    // Should not be 180px - the fix removes this constraint
    expect(computedMinWidth).not.toBe('180px');
    // When not constrained, should inherit min-width: 0 (or similar) from parent flex container
    console.log(`Computed min-width: ${computedMinWidth}`);
  });

  // Test to verify flex properties allow proper wrapping
  test('should have proper flex properties for text wrapping', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    const longTaskTitle =
      'This is a very long task title that tests wrapping behavior without fixed width';
    await workViewPage.addTask(longTaskTitle);

    const task = taskPage.getTaskByText(longTaskTitle);
    await expect(task).toBeVisible();

    const titleWrapper = task.locator('.title-and-tags-wrapper');
    const styles = await titleWrapper.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return {
        flexGrow: computed.flexGrow,
        flexShrink: computed.flexShrink,
        minWidth: computed.minWidth,
      };
    });

    // Verify flex child properties are set correctly for wrapping
    // The wrapper is a flex child with grow/shrink for proper layout
    expect(styles.flexGrow).toBe('1');
    expect(styles.flexShrink).toBe('1');
    // Most importantly, min-width should not be 180px - should be auto or 0
    expect(styles.minWidth).not.toBe('180px');
    expect(['auto', '0px']).toContain(styles.minWidth);
  });

  // Desktop viewport regression test - verify no overflow on default viewport
  test('should maintain normal layout on desktop viewport', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    // Uses default desktop viewport (no setViewportSize call)
    await workViewPage.waitForTaskList();
    const taskTitle = 'Desktop task title test without min-width constraint';
    await workViewPage.addTask(taskTitle);

    const task = taskPage.getTaskByText(taskTitle);
    await expect(task).toBeVisible();

    // Desktop should not show overflow - verify the fix didn't break desktop layout
    const titleWrapper = task.locator('.title-and-tags-wrapper');
    const isOverflowing = await titleWrapper.evaluate((el) => {
      return el.scrollWidth > el.clientWidth;
    });
    expect(isOverflowing).toBe(false);
  });
});
