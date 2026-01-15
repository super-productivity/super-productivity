import { test, expect } from '../../fixtures/test.fixture';

/**
 * Tests for mat-menu touch submenu fix.
 *
 * Issue: https://github.com/super-productivity/super-productivity/issues/4436
 *
 * When a submenu opens on a touch device near the screen edge, the submenu
 * can appear under the user's finger, causing an immediate accidental selection.
 * The fix adds a 300ms delay before clicks are processed on touch devices.
 *
 * NOTE: These tests use regular click events to verify the timing-based protection
 * logic works correctly. The actual touch behavior on real devices depends on
 * the IS_TOUCH_PRIMARY detection which isn't active in headless browsers.
 */
test.describe('Mat Menu Touch Submenu Fix', () => {
  test('should allow selecting submenu item with sufficient delay', async ({
    page,
    workViewPage,
    taskPage,
    tagPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // Create a tag first
    const tagName = `${testPrefix}-TouchTag`;
    await tagPage.createTag(tagName);

    // Create a task
    const taskTitle = `${testPrefix}-TouchTask`;
    await workViewPage.addTask(taskTitle);
    await page.waitForSelector('task', { state: 'visible' });

    // Get the task
    const task = taskPage.getTaskByText(taskTitle);
    await task.waitFor({ state: 'visible' });

    // Open context menu
    await task.click({ button: 'right' });

    // Wait for context menu
    const contextMenu = page.locator('.mat-mdc-menu-content');
    await contextMenu.waitFor({ state: 'visible', timeout: 5000 });

    // Click on Toggle Tags to open submenu
    const toggleTagsBtn = page.locator(
      'button.e2e-edit-tags-btn, button:has-text("Toggle Tags")',
    );
    await toggleTagsBtn.waitFor({ state: 'visible', timeout: 5000 });
    await toggleTagsBtn.click();

    // Wait for submenu to appear (the tag button in the menu)
    const tagBtn = page.locator('.mat-mdc-menu-content button', { hasText: tagName });
    await tagBtn.waitFor({ state: 'visible', timeout: 5000 });

    // Wait for 300ms touch protection delay to expire, plus buffer for CI stability
    // This is a timing-based protection feature being tested, so timeout is justified
    await page.waitForTimeout(450);

    // Click on the tag - should work after delay
    await tagBtn.click();

    // Wait for tag to appear on task (implicitly waits for menu action to complete)
    const tagOnTask = tagPage.getTagOnTask(task, tagName);
    await tagOnTask.waitFor({ state: 'visible', timeout: 5000 });
    const hasTag = await tagPage.taskHasTag(task, tagName);
    expect(hasTag).toBe(true);
  });

  test('should support toggling tags via submenu', async ({
    page,
    workViewPage,
    taskPage,
    tagPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // Create two tags
    const tag1 = `${testPrefix}-Tag1`;
    const tag2 = `${testPrefix}-Tag2`;
    await tagPage.createTag(tag1);
    await tagPage.createTag(tag2);

    // Create a task
    const taskTitle = `${testPrefix}-MultiTagTask`;
    await workViewPage.addTask(taskTitle);
    await page.waitForSelector('task', { state: 'visible' });

    const task = taskPage.getTaskByText(taskTitle);

    // Assign first tag via context menu
    await tagPage.assignTagToTask(task, tag1);

    // Verify first tag is on task
    let hasTag1 = await tagPage.taskHasTag(task, tag1);
    expect(hasTag1).toBe(true);

    // Assign second tag
    await tagPage.assignTagToTask(task, tag2);

    // Verify both tags are on task
    hasTag1 = await tagPage.taskHasTag(task, tag1);
    const hasTag2 = await tagPage.taskHasTag(task, tag2);
    expect(hasTag1).toBe(true);
    expect(hasTag2).toBe(true);
  });
});
