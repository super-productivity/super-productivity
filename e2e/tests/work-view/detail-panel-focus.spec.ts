import { expect, test } from '../../fixtures/test.fixture';
import { cssSelectors } from '../../constants/selectors';

const { DETAIL_PANEL } = cssSelectors;

/**
 * Detail Panel Focus Sync E2E Tests (#6578)
 *
 * Verifies that when the detail panel is open for one task and the user
 * focuses a different task, the panel updates to show the newly focused task.
 */
test.describe('Detail Panel Focus Sync', () => {
  test('should update detail panel when clicking a different task', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();

    // Create two tasks (newest appears first)
    await workViewPage.addTask('First Task');
    await workViewPage.addTask('Second Task');
    await expect(taskPage.getAllTasks()).toHaveCount(2);

    // Open detail panel for Second Task (first in list)
    const secondTask = taskPage.getTask(1);
    await taskPage.openTaskDetail(secondTask);

    // Verify detail panel shows Second Task
    const panelTitle = page.locator(`${DETAIL_PANEL} task-title`);
    await expect(panelTitle).toContainText(/Second Task/);

    // Click on First Task (second in list) to focus it
    const firstTask = taskPage.getTask(2);
    await firstTask.click();

    // Verify detail panel updates to show First Task
    await expect(panelTitle).toContainText(/First Task/);
  });

  test('should update detail panel when navigating with arrow keys', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();

    // Create two tasks (newest appears first)
    await workViewPage.addTask('Arrow Task A');
    await workViewPage.addTask('Arrow Task B');
    await expect(taskPage.getAllTasks()).toHaveCount(2);

    // Open detail panel for Arrow Task B (first in list)
    const taskB = taskPage.getTask(1);
    await taskPage.openTaskDetail(taskB);

    // Verify detail panel shows Arrow Task B
    const panelTitle = page.locator(`${DETAIL_PANEL} task-title`);
    await expect(panelTitle).toContainText(/Arrow Task B/);

    // Focus the task element, then press ArrowDown to navigate to next task
    await taskB.focus();
    await page.keyboard.press('ArrowDown');

    // Verify detail panel updates to show Arrow Task A
    await expect(panelTitle).toContainText(/Arrow Task A/);
  });

  test('should not open detail panel when clicking task if panel is closed', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();

    // Create two tasks
    await workViewPage.addTask('No Panel Task A');
    await workViewPage.addTask('No Panel Task B');
    await expect(taskPage.getAllTasks()).toHaveCount(2);

    // Click on a task without opening the detail panel first
    const taskA = taskPage.getTask(2);
    await taskA.click();

    // Verify no detail panel appeared
    await expect(page.locator(DETAIL_PANEL)).not.toBeVisible();
  });

  test('should keep focus in task list after panel switches', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();

    // Create two tasks
    await workViewPage.addTask('Focus Stay A');
    await workViewPage.addTask('Focus Stay B');
    await expect(taskPage.getAllTasks()).toHaveCount(2);

    // Open detail panel for Focus Stay B (first in list)
    const taskB = taskPage.getTask(1);
    await taskPage.openTaskDetail(taskB);

    const panelTitle = page.locator(`${DETAIL_PANEL} task-title`);
    await expect(panelTitle).toContainText(/Focus Stay B/);

    // Focus task B, then arrow down to task A
    await taskB.focus();
    await page.keyboard.press('ArrowDown');

    // Verify panel switched
    await expect(panelTitle).toContainText(/Focus Stay A/);

    // Verify focus is still in the task list, not stolen by the detail panel
    const activeElement = await page.evaluate(() => {
      const el = document.activeElement;
      return el?.tagName?.toLowerCase() ?? '';
    });
    expect(activeElement).toBe('task');
  });
});
