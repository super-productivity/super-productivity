import { test, expect } from '../../fixtures/test.fixture';

/**
 * Context Switching E2E Tests
 *
 * Tests navigation between different work contexts:
 * - Project to project
 * - Project to tag
 * - Tag to project
 * - Tag to tag (including TODAY)
 */

test.describe('Context Switching', () => {
  test('should switch between projects', async ({
    page,
    workViewPage,
    projectPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // Create two projects
    const project1 = `${testPrefix}-Project1`;
    const project2 = `${testPrefix}-Project2`;

    await projectPage.createProject(project1);
    await projectPage.createProject(project2);

    // Navigate to first project
    await projectPage.navigateToProjectByName(project1);
    await expect(page).toHaveURL(/project/);

    // Add a task in project 1
    await workViewPage.addTask(`${testPrefix}-Task in P1`);
    const task1 = page.locator('task').filter({ hasText: `${testPrefix}-Task in P1` });
    await expect(task1).toBeVisible({ timeout: 10000 });

    // Switch to second project
    await projectPage.navigateToProjectByName(project2);
    await page.waitForTimeout(500);

    // Task from project 1 should not be visible
    await expect(task1).not.toBeVisible();

    // Add a task in project 2
    await workViewPage.addTask(`${testPrefix}-Task in P2`);
    const task2 = page.locator('task').filter({ hasText: `${testPrefix}-Task in P2` });
    await expect(task2).toBeVisible({ timeout: 10000 });

    // Switch back to project 1
    await projectPage.navigateToProjectByName(project1);
    await page.waitForTimeout(500);

    // Task from project 1 should be visible again
    await expect(task1).toBeVisible();

    // Task from project 2 should not be visible
    await expect(task2).not.toBeVisible();
  });

  test('should switch from project to tag', async ({
    page,
    workViewPage,
    projectPage,
    tagPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // Create a project and add a task
    const projectName = `${testPrefix}-MyProject`;
    await projectPage.createProject(projectName);
    await projectPage.navigateToProjectByName(projectName);

    await workViewPage.addTask(`${testPrefix}-Project Task`);
    const projectTask = page
      .locator('task')
      .filter({ hasText: `${testPrefix}-Project Task` });
    await expect(projectTask).toBeVisible({ timeout: 10000 });

    // Create a tag
    const tagName = `${testPrefix}-MyTag`;
    await tagPage.createTag(tagName);

    // Navigate to the tag view by clicking in sidebar
    const tagsGroupBtn = tagPage.tagsGroup
      .locator('.g-multi-btn-wrapper nav-item button')
      .first();
    await tagsGroupBtn.waitFor({ state: 'visible', timeout: 5000 });

    // Ensure Tags section is expanded
    const isExpanded = await tagsGroupBtn.getAttribute('aria-expanded');
    if (isExpanded !== 'true') {
      await tagsGroupBtn.click();
      await page.waitForTimeout(500);
    }

    // Click on the tag
    const tagTreeItem = tagPage.tagsGroup
      .locator('[role="treeitem"]')
      .filter({ hasText: tagName })
      .first();
    await tagTreeItem.click();
    await page.waitForTimeout(500);

    // Verify URL changed to tag view
    await expect(page).toHaveURL(/tag/);

    // Project task should not be visible (unless also assigned to this tag)
    await expect(projectTask).not.toBeVisible();
  });

  test('should switch from tag to TODAY tag', async ({
    page,
    workViewPage,
    tagPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // Create a custom tag
    const tagName = `${testPrefix}-CustomTag`;
    await tagPage.createTag(tagName);

    // Navigate to the custom tag
    const tagsGroupBtn = tagPage.tagsGroup
      .locator('.g-multi-btn-wrapper nav-item button')
      .first();
    await tagsGroupBtn.waitFor({ state: 'visible', timeout: 5000 });

    const isExpanded = await tagsGroupBtn.getAttribute('aria-expanded');
    if (isExpanded !== 'true') {
      await tagsGroupBtn.click();
      await page.waitForTimeout(500);
    }

    const tagTreeItem = tagPage.tagsGroup
      .locator('[role="treeitem"]')
      .filter({ hasText: tagName })
      .first();
    await tagTreeItem.click();
    await page.waitForTimeout(500);

    // Verify on tag view
    await expect(page).toHaveURL(/tag/);

    // Navigate back to TODAY tag by clicking "Today" in sidebar
    await page.click('text=Today');
    await page.waitForLoadState('networkidle');

    // Verify URL is TODAY tag
    await expect(page).toHaveURL(/tag\/TODAY/);
  });

  test('should preserve tasks when switching contexts', async ({
    page,
    workViewPage,
    projectPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // Create a project
    const projectName = `${testPrefix}-TaskProject`;
    await projectPage.createProject(projectName);
    await projectPage.navigateToProjectByName(projectName);

    // Add multiple tasks
    await workViewPage.addTask(`${testPrefix}-Task A`);
    await workViewPage.addTask(`${testPrefix}-Task B`);
    await workViewPage.addTask(`${testPrefix}-Task C`);

    // Verify all tasks exist
    await expect(
      page.locator('task').filter({ hasText: `${testPrefix}-Task A` }),
    ).toBeVisible();
    await expect(
      page.locator('task').filter({ hasText: `${testPrefix}-Task B` }),
    ).toBeVisible();
    await expect(
      page.locator('task').filter({ hasText: `${testPrefix}-Task C` }),
    ).toBeVisible();

    // Navigate to TODAY tag
    await page.click('text=Today');
    await page.waitForLoadState('networkidle');

    // Navigate back to the project
    await projectPage.navigateToProjectByName(projectName);
    await page.waitForTimeout(500);

    // Verify all tasks are still there
    await expect(
      page.locator('task').filter({ hasText: `${testPrefix}-Task A` }),
    ).toBeVisible();
    await expect(
      page.locator('task').filter({ hasText: `${testPrefix}-Task B` }),
    ).toBeVisible();
    await expect(
      page.locator('task').filter({ hasText: `${testPrefix}-Task C` }),
    ).toBeVisible();

    // Verify task count
    const taskCount = await taskPage.getTaskCount();
    expect(taskCount).toBe(3);
  });

  test('should update URL when switching contexts', async ({
    page,
    workViewPage,
    projectPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // Start at TODAY tag
    await expect(page).toHaveURL(/tag\/TODAY/);

    // Create and navigate to a project
    const projectName = `${testPrefix}-URLProject`;
    await projectPage.createProject(projectName);
    await projectPage.navigateToProjectByName(projectName);

    // URL should contain 'project'
    await expect(page).toHaveURL(/project/);

    // Navigate to planner
    await page.goto('/#/planner');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/planner/);

    // Navigate to schedule
    await page.goto('/#/schedule');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/schedule/);

    // Dismiss any overlay that might be open
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Navigate back to TODAY via URL (more reliable than click)
    await page.goto('/#/tag/TODAY');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/tag\/TODAY/);
  });
});
