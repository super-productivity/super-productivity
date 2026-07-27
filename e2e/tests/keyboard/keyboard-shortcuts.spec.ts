import { expect, test } from '../../fixtures/test.fixture';
import { cssSelectors } from '../../constants/selectors';
import { waitForStatePersistence } from '../../utils/waits';

/**
 * Keyboard Shortcuts E2E Tests
 *
 * Tests keyboard navigation and shortcuts:
 * - Add task via keyboard
 * - Navigate via keyboard
 * - Mark task done via keyboard
 */

const { ADD_TASK_INPUT, DETAIL_PANEL } = cssSelectors;

test.describe('Keyboard Shortcuts', () => {
  test('should focus add task input with Shift+A', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();

    const addTaskInput = page.locator(ADD_TASK_INPUT);
    await expect(addTaskInput).toHaveCount(0);

    await page.keyboard.press('Shift+A');
    await expect(addTaskInput).toBeFocused();
  });

  test('should persist and apply a remapped add-task shortcut', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.goto('/#/config?section=keyboard');

    const shortcutInput = page.getByRole('textbox', {
      name: 'Add new task',
      exact: true,
    });
    await expect(shortcutInput).toHaveValue('Shift+A');
    await shortcutInput.focus();
    await page.keyboard.press('Shift+V');
    await expect(shortcutInput).toHaveValue('Shift+V');

    await waitForStatePersistence(page);
    await page.reload();
    await expect(shortcutInput).toHaveValue('Shift+V');

    await page.goto('/#/tag/TODAY/tasks');
    await workViewPage.waitForTaskList();
    const addTaskInput = page.locator(ADD_TASK_INPUT);
    await expect(addTaskInput).toHaveCount(0);

    await page.keyboard.press('Shift+V');
    await expect(addTaskInput).toBeFocused();
  });

  test('should move task focus with J and K', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    const olderTaskTitle = `${testPrefix}-Task One`;
    const newerTaskTitle = `${testPrefix}-Task Two`;
    await workViewPage.addTask(olderTaskTitle);
    await workViewPage.addTask(newerTaskTitle);

    const newerTask = taskPage.getTaskByText(newerTaskTitle);
    const olderTask = taskPage.getTaskByText(olderTaskTitle);
    await newerTask.focus();
    await expect(newerTask).toBeFocused();

    await page.keyboard.press('j');
    await expect(olderTask).toBeFocused();

    await page.keyboard.press('k');
    await expect(newerTask).toBeFocused();
  });

  test('should mark a focused task done with D', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    const taskName = `${testPrefix}-Keyboard Done Task`;
    await workViewPage.addTask(taskName);

    const task = taskPage.getTaskByText(taskName);
    await task.focus();
    await expect(task).toBeFocused();

    await page.keyboard.press('d');
    const doneTask = page
      .locator('.task-list-inner[data-id="DONE"] > task.isDone')
      .filter({ hasText: taskName });
    await expect(doneTask).toHaveCount(1);
  });

  test('should open the focused task detail panel with I', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    const taskName = `${testPrefix}-Detail Task`;
    await workViewPage.addTask(taskName);

    const task = taskPage.getTaskByText(taskName);
    await task.focus();
    await expect(task).toBeFocused();

    await page.keyboard.press('i');

    const detailPanel = page.locator(DETAIL_PANEL);
    await expect(detailPanel).toBeVisible();
    await expect(detailPanel.locator('task-title')).toContainText(taskName);
  });
});
