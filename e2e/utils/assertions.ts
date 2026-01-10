import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { TaskPage } from '../pages/task.page';
import type { DialogPage } from '../pages/dialog.page';

/**
 * Assert that the task list has the expected number of tasks.
 */
export const expectTaskCount = async (
  taskPage: TaskPage,
  count: number,
): Promise<void> => {
  await expect(taskPage.getAllTasks()).toHaveCount(count);
};

/**
 * Assert that a task with the given text is visible.
 */
export const expectTaskVisible = async (
  taskPage: TaskPage,
  text: string,
): Promise<void> => {
  const task = taskPage.getTaskByText(text);
  await expect(task).toBeVisible();
};

/**
 * Assert that a dialog is currently visible.
 */
export const expectDialogVisible = async (dialogPage: DialogPage): Promise<void> => {
  const dialog = await dialogPage.waitForDialog();
  await expect(dialog).toBeVisible();
};

/**
 * Assert that no global error alert is displayed.
 */
export const expectNoGlobalError = async (page: Page): Promise<void> => {
  const error = page.locator('.global-error-alert');
  await expect(error).not.toBeVisible();
};

/**
 * Assert that a task is marked as done.
 */
export const expectTaskDone = async (taskPage: TaskPage, text: string): Promise<void> => {
  const task = taskPage.getTaskByText(text);
  await expect(task).toHaveClass(/isDone/);
};

/**
 * Assert that the done task count matches expected.
 */
export const expectDoneTaskCount = async (
  taskPage: TaskPage,
  count: number,
): Promise<void> => {
  await expect(taskPage.getDoneTasks()).toHaveCount(count);
};
