import { test, expect } from '../../fixtures/test.fixture';

test.describe('Tag CRUD Operations', () => {
  test('should create a new tag via sidebar', async ({
    page,
    workViewPage,
    tagPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    const tagName = `${testPrefix}-TestTag`;
    await tagPage.createTag(tagName);

    // Verify tag exists in sidebar
    const tagExists = await tagPage.tagExistsInSidebar(tagName);
    expect(tagExists).toBe(true);
  });

  test('should assign tag to task via context menu', async ({
    page,
    workViewPage,
    tagPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // Create a tag first
    const tagName = `${testPrefix}-AssignTag`;
    await tagPage.createTag(tagName);

    // Create a task
    const taskTitle = `${testPrefix}-Tagged Task`;
    await workViewPage.addTask(taskTitle);
    await page.waitForSelector('task', { state: 'visible' });

    // Get the task and assign tag
    const task = taskPage.getTaskByText(taskTitle);
    await tagPage.assignTagToTask(task, tagName);

    // Verify tag appears on task
    const hasTag = await tagPage.taskHasTag(task, tagName);
    expect(hasTag).toBe(true);
  });

  test('should remove tag from task via context menu', async ({
    page,
    workViewPage,
    tagPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // Create a tag
    const tagName = `${testPrefix}-RemoveTag`;
    await tagPage.createTag(tagName);

    // Create a task and assign the tag
    const taskTitle = `${testPrefix}-Task to untag`;
    await workViewPage.addTask(taskTitle);
    await page.waitForSelector('task', { state: 'visible' });

    const task = taskPage.getTaskByText(taskTitle);
    await tagPage.assignTagToTask(task, tagName);

    // Verify tag is assigned
    let hasTag = await tagPage.taskHasTag(task, tagName);
    expect(hasTag).toBe(true);

    // Remove the tag
    await tagPage.removeTagFromTask(task, tagName);

    // Verify tag is removed
    hasTag = await tagPage.taskHasTag(task, tagName);
    expect(hasTag).toBe(false);
  });

  test('should delete tag and update tasks', async ({
    page,
    workViewPage,
    tagPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // Create a tag
    const tagName = `${testPrefix}-DeleteTag`;
    await tagPage.createTag(tagName);

    // Create a task and assign the tag
    const taskTitle = `${testPrefix}-Task with deleted tag`;
    await workViewPage.addTask(taskTitle);
    await page.waitForSelector('task', { state: 'visible' });

    const task = taskPage.getTaskByText(taskTitle);
    await tagPage.assignTagToTask(task, tagName);

    // Verify tag is assigned
    let hasTag = await tagPage.taskHasTag(task, tagName);
    expect(hasTag).toBe(true);

    // Delete the tag
    await tagPage.deleteTag(tagName);

    // Verify tag no longer exists in sidebar
    const tagExists = await tagPage.tagExistsInSidebar(tagName);
    expect(tagExists).toBe(false);

    // Verify tag is removed from task
    hasTag = await tagPage.taskHasTag(task, tagName);
    expect(hasTag).toBe(false);
  });

  test('should navigate to tag view when clicking tag in sidebar', async ({
    page,
    workViewPage,
    tagPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // Create a tag
    const tagName = `${testPrefix}-NavTag`;
    await tagPage.createTag(tagName);

    // Create a task and assign the tag
    const taskTitle = `${testPrefix}-Task for nav`;
    await workViewPage.addTask(taskTitle);
    await page.waitForSelector('task', { state: 'visible' });

    const task = page.locator('task').first();
    await tagPage.assignTagToTask(task, tagName);

    // Ensure Tags section is expanded
    const tagsGroupBtn = tagPage.tagsGroup
      .locator('.g-multi-btn-wrapper nav-item button')
      .first();
    await tagsGroupBtn.waitFor({ state: 'visible', timeout: 5000 });

    const isExpanded = await tagsGroupBtn.getAttribute('aria-expanded');
    if (isExpanded !== 'true') {
      await tagsGroupBtn.click();
      await page.waitForTimeout(500);
    }

    // Click on the tag in sidebar to navigate
    const tagTreeItem = tagPage.tagsGroup
      .locator('[role="treeitem"]')
      .filter({ hasText: tagName })
      .first();
    await tagTreeItem.click();

    // Wait for navigation
    await page.waitForTimeout(500);

    // Verify URL contains tag
    await expect(page).toHaveURL(/tag/);

    // Verify the task is visible in the tag view
    await expect(page.locator('task').filter({ hasText: taskTitle })).toBeVisible();
  });
});
