import { test, expect } from '../../fixtures/test.fixture';

test.describe('Subtask inline input', () => {
  test('keeps the draft input focused for rapid subtask creation', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Parent task');

    const parentTask = taskPage.getTaskByText('Parent task');
    await expect(parentTask).toBeVisible();

    await parentTask.focus();
    await page.keyboard.press('a');

    const draftInput = parentTask.locator('.e2e-add-subtask-input');
    await expect(draftInput).toBeVisible();
    await expect(draftInput).toBeFocused();

    await draftInput.fill('1 subtask');
    await page.keyboard.press('Enter');

    await expect(parentTask.locator('.sub-tasks task')).toHaveCount(1);
    await expect(parentTask.locator('.sub-tasks task task-title')).toContainText([
      '1 subtask',
    ]);
    await expect(draftInput).toBeVisible();
    await expect(draftInput).toBeFocused();
    await expect(draftInput).toHaveValue('');

    await draftInput.fill('2 subtask');
    await page.keyboard.press('Enter');

    await expect(parentTask.locator('.sub-tasks task')).toHaveCount(2);
    await expect(parentTask.locator('.sub-tasks task task-title')).toContainText([
      '1 subtask',
      '2 subtask',
    ]);
    await expect(draftInput).toBeFocused();

    await page.keyboard.press('Escape');

    await expect(parentTask.locator('.e2e-add-subtask-input')).toHaveCount(0);
    await expect(parentTask.locator('.sub-tasks task')).toHaveCount(2);
  });

  test('cancels a typed draft subtask on Escape', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Parent task');

    const parentTask = taskPage.getTaskByText('Parent task');
    await expect(parentTask).toBeVisible();

    await parentTask.focus();
    await page.keyboard.press('a');

    const draftInput = parentTask.locator('.e2e-add-subtask-input');
    await expect(draftInput).toBeFocused();

    await draftInput.fill('Canceled subtask');
    await page.keyboard.press('Escape');

    await expect(parentTask.locator('.e2e-add-subtask-input')).toHaveCount(0);
    await expect(parentTask.locator('.sub-tasks task')).toHaveCount(0);
    await expect(parentTask).not.toContainText('Canceled subtask');
    // Escape returns focus to the task row so keyboard navigation continues.
    await expect(parentTask).toBeFocused();
  });

  test('returns focus to the originating subtask on Escape', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Parent task');

    const parentTask = taskPage.getTaskByText('Parent task');
    await expect(parentTask).toBeVisible();

    // Create one subtask, then close the draft input.
    await parentTask.focus();
    await page.keyboard.press('a');
    const draftInput = parentTask.locator('.e2e-add-subtask-input');
    await draftInput.fill('First subtask');
    await page.keyboard.press('Enter');
    await expect(parentTask.locator('.sub-tasks task')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(parentTask.locator('.e2e-add-subtask-input')).toHaveCount(0);

    // Now open the draft from the subtask, then cancel: focus must return to the
    // subtask it was opened from, not the parent row.
    const subTask = parentTask.locator('.sub-tasks task').first();
    await subTask.focus();
    await page.keyboard.press('a');
    await expect(parentTask.locator('.e2e-add-subtask-input')).toBeFocused();

    await page.keyboard.press('Escape');

    await expect(parentTask.locator('.e2e-add-subtask-input')).toHaveCount(0);
    await expect(subTask).toBeFocused();
  });

  // On desktop (this suite runs mouse-primary Chrome), click-away cancels the
  // draft — commit-on-blur is scoped to touch (#8791/#8856), where the
  // soft-keyboard Enter is unreliable. Desktop commits via Enter or the button.
  test('discards a typed draft when it loses focus on desktop', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Parent task');

    const parentTask = taskPage.getTaskByText('Parent task');
    await expect(parentTask).toBeVisible();

    await parentTask.focus();
    await page.keyboard.press('a');

    const draftInput = parentTask.locator('.e2e-add-subtask-input');
    await expect(draftInput).toBeFocused();

    await draftInput.fill('Blurred subtask');
    await page.locator('body').click({ position: { x: 10, y: 10 } });

    await expect(parentTask.locator('.e2e-add-subtask-input')).toHaveCount(0);
    await expect(parentTask.locator('.sub-tasks task')).toHaveCount(0);
    await expect(parentTask).not.toContainText('Blurred subtask');
  });
});
