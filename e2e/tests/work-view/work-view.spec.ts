import { expect, test } from '../../fixtures/test.fixture';

test.describe('Work View', () => {
  test('should add task via key combo', async ({ page, workViewPage }) => {
    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    // Add a task
    await workViewPage.addTask('0 test task koko');

    // Verify task is visible
    const task = page.locator('task').first();
    await expect(task).toBeVisible();

    // Verify task content (accounting for test prefix)
    const taskTitle = task.locator('task-title');
    await expect(taskTitle).toContainText(/.*0 test task koko/);
  });

  test('should still show created task after reload', async ({ page, workViewPage }) => {
    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    // Add a task
    await workViewPage.addTask('0 test task lolo');

    // Verify task is visible
    const task = page.locator('task').first();
    await expect(task).toBeVisible();

    // Verify task content using task-title (same as first test)
    const taskTitle = task.locator('task-title');
    await expect(taskTitle).toContainText(/.*0 test task lolo/);

    // Wait for the task to be persisted to IndexedDB
    // NgRx effects write outside Angular's zone, so we need an explicit wait
    await page.waitForTimeout(1000);

    // Reload the page
    await page.reload();

    // Wait for work view to be ready again
    await workViewPage.waitForTaskList();

    // Re-define task locator after reload to avoid stale element reference
    const allTasks = page.locator('task');
    const taskCount = await allTasks.count();

    if (taskCount === 0) {
      // If no active tasks, check if task might be in done section
      const doneTasksToggle = page.locator('done-tasks');
      if (await doneTasksToggle.isVisible()) {
        await doneTasksToggle.click();
        await page.waitForTimeout(500);
      }
    }

    // Verify task persisted after reload
    const finalTask = page.locator('task').first();
    await expect(finalTask).toBeVisible();
    const finalTaskTitle = finalTask.locator('task-title');
    await expect(finalTaskTitle).toContainText(/.*0 test task lolo/);
  });

  test('should add multiple tasks from header button', async ({ page, workViewPage }) => {
    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    // Click the add button in the header to open global add task input
    const headerAddBtn = page.locator('.tour-addBtn');
    await headerAddBtn.waitFor({ state: 'visible', timeout: 10000 });
    await headerAddBtn.click();

    // Wait for global input to be visible
    await workViewPage.addTaskGlobalInput.waitFor({ state: 'visible', timeout: 10000 });

    // Add first task
    await workViewPage.addTaskGlobalInput.clear();
    await workViewPage.addTaskGlobalInput.fill('4 test task hohoho');
    await page.keyboard.press('Enter');

    // Wait for first task to be created
    await page.locator('task').first().waitFor({ state: 'visible', timeout: 10000 });

    // Add second task
    await workViewPage.addTaskGlobalInput.clear();
    await workViewPage.addTaskGlobalInput.fill('5 some other task xoxo');
    await page.keyboard.press('Enter');

    // Wait for second task to be created
    await page.waitForFunction(() => document.querySelectorAll('task').length >= 2, {
      timeout: 10000,
    });

    // Close the input by clicking backdrop
    const backdropVisible = await workViewPage.backdrop.isVisible().catch(() => false);
    if (backdropVisible) {
      await workViewPage.backdrop.click();
      await workViewPage.backdrop
        .waitFor({ state: 'hidden', timeout: 2000 })
        .catch(() => {});
    }

    // Verify both tasks are visible
    const tasks = page.locator('task');
    await expect(tasks).toHaveCount(2, { timeout: 10000 });

    // NOTE: global adds to top rather than bottom
    await expect(tasks.nth(0).locator('task-title')).toContainText(
      '5 some other task xoxo',
      { timeout: 5000 },
    );
    await expect(tasks.nth(1).locator('task-title')).toContainText('4 test task hohoho', {
      timeout: 5000,
    });
  });

  test('should add 2 tasks from initial bar', async ({ page, workViewPage }) => {
    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    // Add two tasks - the addTask method now properly waits for each one
    await workViewPage.addTask('test task hihi');

    // Wait for first task to be visible before adding second
    await page.locator('task').first().waitFor({ state: 'visible', timeout: 10000 });

    await workViewPage.addTask('some other task here');

    // Verify both tasks are visible with better error reporting
    const tasks = page.locator('task');

    // Wait for the expected number of tasks
    await expect(tasks).toHaveCount(2, { timeout: 15000 });

    // Verify both tasks exist (order doesn't matter)
    const allTasksText = await tasks.allTextContents();
    const hasHihi = allTasksText.some((text) => text.includes('hihi'));
    const hasOther = allTasksText.some((text) => text.includes('other task'));

    expect(hasHihi).toBe(true);
    expect(hasOther).toBe(true);
  });
});
