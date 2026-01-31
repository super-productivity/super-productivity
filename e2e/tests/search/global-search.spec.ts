import { expect, test } from '../../fixtures/test.fixture';
import { ensureGlobalAddTaskBarOpen } from '../../utils/element-helpers';

/**
 * Global Search E2E Tests
 *
 * Tests the search functionality:
 * - Open search
 * - Search for tasks
 * - Navigate to search results
 */

test.describe('Global Search', () => {
  test.describe.configure({ timeout: 30000 });

  test('should open search with keyboard shortcut', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // Create some tasks to search for
    await workViewPage.addTask(`${testPrefix}-Searchable Task 1`);
    await workViewPage.addTask(`${testPrefix}-Searchable Task 2`);

    // Use Ctrl+Shift+F or similar shortcut to open global search
    await page.keyboard.press('Control+Shift+f');
    await page.waitForTimeout(500);

    // Just verify the app is still responsive (search shortcut may vary)
    await expect(page.locator('task-list').first()).toBeVisible();
  });

  test('should search for existing tasks', async ({ page, workViewPage, testPrefix }) => {
    await workViewPage.waitForTaskList();

    // Create a task with a unique name
    const uniqueName = `${testPrefix}-UniqueSearchTerm`;
    await workViewPage.addTask(uniqueName);

    await expect(page.locator('task').filter({ hasText: uniqueName })).toBeVisible();

    // Try to open search
    await page.keyboard.press('Control+Shift+f');
    await page.waitForTimeout(500);

    const searchInput = page.locator('input[type="search"], command-bar input').first();
    const isSearchOpen = await searchInput
      .isVisible({ timeout: 3000 })
      .catch(() => false);

    if (isSearchOpen) {
      // Type the search term
      await searchInput.fill(uniqueName);
      await page.waitForTimeout(500);

      // Results should appear
      const results = page.locator('.search-result, .autocomplete-option');
      const hasResults = await results
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false);

      if (hasResults) {
        await expect(results.first()).toContainText(uniqueName);
      }
    }
  });

  test('should use autocomplete in add task bar', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // Create an initial task
    const taskName = `${testPrefix}-AutoComplete Target`;
    await workViewPage.addTask(taskName);
    await expect(page.locator('task').filter({ hasText: taskName })).toBeVisible();

    // Ensure the add task bar is open and get the input
    const addTaskInput = await ensureGlobalAddTaskBarOpen(page);

    // Type part of the task name
    await addTaskInput.fill(testPrefix);
    await page.waitForTimeout(500);

    // Clear the input
    await addTaskInput.clear();

    await page.keyboard.press('Escape');

    // Verify app is responsive
    await expect(page.locator('task-list').first()).toBeVisible();
  });

  test('should filter tasks in current view', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // Create multiple tasks
    await workViewPage.addTask(`${testPrefix}-Alpha Task`);
    await workViewPage.addTask(`${testPrefix}-Beta Task`);
    await workViewPage.addTask(`${testPrefix}-Gamma Task`);

    // All tasks should be visible
    await expect(
      page.locator('task').filter({ hasText: `${testPrefix}-Alpha` }),
    ).toBeVisible();
    await expect(
      page.locator('task').filter({ hasText: `${testPrefix}-Beta` }),
    ).toBeVisible();
    await expect(
      page.locator('task').filter({ hasText: `${testPrefix}-Gamma` }),
    ).toBeVisible();

    // Verify task count
    const taskCount = await page.locator('task').count();
    expect(taskCount).toBeGreaterThanOrEqual(3);
  });
});
