import { expect, test } from '../../fixtures/test.fixture';

test.describe('Simple Subtask', () => {
  test('should create subtask with keyboard shortcut', async ({ page, workViewPage }) => {
    // Add parent task
    await workViewPage.addTask('Parent Task');

    const task = page.locator('task');

    await workViewPage.addSubTask(task, 'SubTask 1');

    // Due to "keep subtask creation open" logic, a second empty subtask is spawned.
    // We use .first() to avoid strict mode violation and target our added subtask.
    const subTask = task.locator('.sub-tasks task').first();
    await subTask.waitFor({ state: 'visible' });

    // Verify subtask was created with correct content
    const subtaskTitle = subTask.locator('task-title');
    await expect(subtaskTitle).toContainText('SubTask 1');
  });
});
