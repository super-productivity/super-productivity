import { expect, test } from '../../fixtures/test.fixture';

/**
 * Issue #9829: on iOS in portrait mode (390px width), task title with long tag
 * would overflow because `.title-and-tags-wrapper` inherited `min-width: auto` from
 * the flex item default, preventing it from shrinking below min-content width.
 *
 * Fix: `min-width: 0` on the wrapper allows it to shrink and content to wrap.
 * Verify with geometry assertions that rows stay within viewport on portrait.
 *
 * Run: npm run e2e:file e2e/tests/mobile/task-title-portrait-overflow.spec.ts -- --retries=0
 */

const PORTRAIT = { width: 390, height: 844 };

test.describe('Task Title Portrait Overflow (Issue #9829)', () => {
  test('should not overflow task row when title wraps in portrait mode', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();

    // Create a task with a title long enough to wrap on portrait width
    const longTitle =
      'Very Long Task Title That Should Wrap in Portrait Mode Instead of Overflowing the Viewport';
    await workViewPage.addTask(longTitle);

    const task = taskPage.getTaskByText(longTitle);
    await expect(task).toBeVisible();

    // Set portrait viewport after task is created (matches #9750 pattern)
    await page.setViewportSize(PORTRAIT);

    // Wait for layout to settle
    await expect(task).toHaveCount(1);

    // Measure actual geometry: check that row and title elements stay in viewport
    const geometry = await page.evaluate(() => {
      const taskEl = document.querySelector('task') as HTMLElement;
      const rect = (sel: string): { left: number; right: number } | null => {
        const el = taskEl.querySelector(sel);
        if (!el) return null;
        const { left, right } = el.getBoundingClientRect();
        return { left, right };
      };
      const titleWrapper = taskEl.querySelector('.title-and-tags-wrapper') as HTMLElement;
      return {
        viewportWidth: window.innerWidth,
        row: rect('.title-and-left-btns-wrapper'),
        titleWrapper: rect('.title-and-tags-wrapper'),
        // Verify min-width: 0 allows wrapping (content width > client width means wrapped)
        isWrapped: titleWrapper
          ? titleWrapper.scrollWidth > titleWrapper.clientWidth
          : false,
      };
    });

    expect(geometry.row).not.toBeNull();
    expect(geometry.titleWrapper).not.toBeNull();

    // Critical: nothing starts left of viewport (issue symptom)
    expect(geometry.row!.left).toBeGreaterThanOrEqual(0);
    expect(geometry.titleWrapper!.left).toBeGreaterThanOrEqual(0);

    // Row must fit without overflow
    expect(geometry.row!.right).toBeLessThanOrEqual(geometry.viewportWidth);
  });

  test('should not regress on landscape/desktop viewports', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
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
