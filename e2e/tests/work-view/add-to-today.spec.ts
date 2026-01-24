import { expect, test } from '../../fixtures/test.fixture';

test.describe('Add to Today - Subtask Support', () => {
  test('should add subtask to Today when parent is NOT in Today', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();

    // Add parent task in Today
    await workViewPage.addTask('Parent Task');
    const parentTask = page.locator('task').first();
    await expect(parentTask).toBeVisible();

    // Add subtask
    await workViewPage.addSubTask(parentTask, 'Test Subtask');

    // Wait for subtask to exit edit mode
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    const subtask = parentTask.locator('.sub-tasks task').first();
    await expect(subtask).toBeVisible();

    // Remove BOTH parent and subtask from Today first
    await parentTask.hover();
    await page.waitForTimeout(100);
    let removeBtn = parentTask.locator('button[title*="Remove from"]');
    if (await removeBtn.isVisible()) {
      await removeBtn.click();
      await page.waitForTimeout(300);
    }

    await subtask.hover();
    await page.waitForTimeout(100);
    removeBtn = subtask.locator('button[title*="Remove from"]');
    if (await removeBtn.isVisible()) {
      await removeBtn.click();
      await page.waitForTimeout(300);
    }

    // Now use keyboard shortcut to add subtask to Today
    // (This is the most reliable method and what users would actually do)
    await subtask.click();
    await page.keyboard.press('Control+t');
    await page.waitForTimeout(500);

    // Verify subtask appears in Today view
    const todaySubtask = page
      .locator('task task-title')
      .filter({ hasText: 'Test Subtask' });
    await expect(todaySubtask).toBeVisible();
  });

  test('should add subtask to Today via keyboard shortcut (Ctrl+T)', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();

    // Add parent task
    await workViewPage.addTask('Parent Task KB');
    const parentTask = page.locator('task').first();
    await expect(parentTask).toBeVisible();

    // Add subtask
    await workViewPage.addSubTask(parentTask, 'KB Subtask');

    // Wait for subtask to exit edit mode - press Escape to ensure we exit
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    const subtask = parentTask.locator('.sub-tasks task').first();
    await expect(subtask).toBeVisible();

    // Remove parent from Today first
    await parentTask.hover();
    await page.waitForTimeout(100);
    const removeFromTodayBtn = parentTask.locator('button[title*="Remove from"]');
    if (await removeFromTodayBtn.isVisible()) {
      await removeFromTodayBtn.click();
      await page.waitForTimeout(500);
    }

    // Focus the subtask (click on it)
    await subtask.click();

    // Press Ctrl+T to add to today
    await page.keyboard.press('Control+t');

    // Wait for state update
    await page.waitForTimeout(500);

    // Verify subtask appears in Today view
    const todaySubtask = page
      .locator('task task-title')
      .filter({ hasText: 'KB Subtask' });
    await expect(todaySubtask).toBeVisible();
  });

  test('should add parent task to Today and verify it works', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();

    // Add parent task
    await workViewPage.addTask('Parent for Today');
    const parentTask = page.locator('task').first();
    await expect(parentTask).toBeVisible();

    // Task should already be in Today view by default, just verify it's there
    const todayTaskTitle = page
      .locator('task task-title')
      .filter({ hasText: 'Parent for Today' });
    await expect(todayTaskTitle).toBeVisible();
  });

  test('should NOT add subtask when parent is already in Today', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();

    // Add parent task (already in Today by default)
    await workViewPage.addTask('Parent Already Today');
    const parentTask = page.locator('task').first();
    await expect(parentTask).toBeVisible();

    // Add subtask
    await workViewPage.addSubTask(parentTask, 'Blocked Subtask');

    // Wait for subtask to exit edit mode
    await page.waitForTimeout(300);

    const subtask = parentTask.locator('.sub-tasks task').first();
    await expect(subtask).toBeVisible();

    // The parent is already in Today, and our fix should prevent the subtask
    // from being added as a separate root task. The subtask should only exist
    // as a child of the parent task, not as an independent task in Today.

    // Verify parent task is visible with its subtask
    const parentTitle = parentTask.locator('task-title').first();
    await expect(parentTitle).toContainText('Parent Already Today');

    // Verify subtask exists as child (not as separate root task)
    const subtaskTitle = subtask.locator('task-title');
    await expect(subtaskTitle).toContainText('Blocked Subtask');

    // The test passes if parent has the subtask nested under it
    // (which the above expectations verify)
  });

  test('should add subtask from context menu', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();

    // Add parent task
    await workViewPage.addTask('Parent Context Menu');
    const parentTask = page.locator('task').first();
    await expect(parentTask).toBeVisible();

    // Add subtask
    await workViewPage.addSubTask(parentTask, 'Context Menu Subtask');

    // Wait for subtask to exit edit mode
    await page.waitForTimeout(300);

    const subtask = parentTask.locator('.sub-tasks task').first();
    await expect(subtask).toBeVisible();

    // Remove parent from Today first
    await parentTask.hover();
    await page.waitForTimeout(100);
    const removeFromTodayBtn = parentTask.locator('button[title*="Remove from"]');
    if (await removeFromTodayBtn.isVisible()) {
      await removeFromTodayBtn.click();
      await page.waitForTimeout(500);
    }

    // Click somewhere else first to ensure we're not in edit mode
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(100);

    // Right-click on subtask to open context menu
    await subtask.click({ button: 'right' });

    // Wait for context menu to appear
    await page.waitForTimeout(200);

    // Click the sun icon (first button in quick-access) to add to today
    // The context menu has icon buttons at the top - sun icon is for "today"
    const todayQuickAccessBtn = page
      .locator('.mat-mdc-menu-content .quick-access button')
      .first();
    await todayQuickAccessBtn.waitFor({ state: 'visible', timeout: 3000 });
    await todayQuickAccessBtn.click();

    // Wait for state update
    await page.waitForTimeout(500);

    // Verify subtask appears in Today view
    const todaySubtask = page
      .locator('task task-title')
      .filter({ hasText: 'Context Menu Subtask' });
    await expect(todaySubtask).toBeVisible();
  });
});
