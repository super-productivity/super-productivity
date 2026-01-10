import { expect, test } from '../../fixtures/test.fixture';

test.describe('Short Syntax', () => {
  test('should add task with project via short syntax', async ({
    page,
    workViewPage,
  }) => {
    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    // Add a task with project short syntax
    await workViewPage.addTask('0 test task koko +i');

    // Verify task is visible
    const task = page.locator('task').first();
    await expect(task).toBeVisible({ timeout: 10000 });

    // Verify the task has the Inbox tag
    const taskTags = task.locator('tag');
    await expect(taskTags).toContainText('Inbox', { timeout: 5000 });
  });
});
