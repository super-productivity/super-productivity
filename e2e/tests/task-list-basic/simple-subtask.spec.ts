import { expect, test } from '../../fixtures/test.fixture';

test.describe('Simple Subtask', () => {
  test('should create subtask with keyboard shortcut', async ({
    workViewPage,
    taskPage,
  }) => {
    // Add parent task
    await workViewPage.addTask('Parent Task');

    const task = taskPage.getTaskByText('Parent Task');

    // '1.05m/2m' is 1m3s spent against a 2m estimate
    await workViewPage.addSubTask(task, 'SubTask 1 1.05m/2m');

    const subTask = task.locator('.sub-tasks task');
    await subTask.waitFor({ state: 'visible' });

    // Verify subtask was created with correct content
    const subtaskTitle = subTask.locator('task-title');
    await expect(subtaskTitle).toContainText('SubTask 1');

    // The parent row sums its sub tasks as 'Σ time spent / ⏳ time left'. Both cells
    // are rounded down and share a partial minute, so it used to be dropped twice and
    // the pair read '1m / 1m' against the 3m estimated. #9190
    await workViewPage.addSubTask(task, 'SubTask 2 1m');
    const timeCells = task.locator('.time-wrapper').first().locator('.time-val');
    await expect(timeCells).toHaveText([/\b1m\b/, /\b2m\b/]);
  });
});
