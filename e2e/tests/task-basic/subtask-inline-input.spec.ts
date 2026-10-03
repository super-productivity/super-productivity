import { test, expect } from '../../fixtures/test.fixture';

test.describe('Subtask inline input', () => {
  test('offers visible subtask creation and progress that survives collapsing', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Progress parent');
    const parent = taskPage.getTaskByText('Progress parent');
    await parent.focus();
    await page.keyboard.press('a');
    const draft = parent.locator('.e2e-add-subtask-input');
    await draft.fill('First child');
    await draft.press('Enter');
    await draft.press('Escape');
    await expect(parent.locator('.subtask-progress')).toHaveText('0/1');
    await expect(parent.locator('.add-subtask-action button')).toHaveClass(
      /task-list-add-action/,
    );
    await parent
      .locator('.add-subtask-action')
      .getByRole('button', { name: 'Add subtask', exact: true })
      .click();
    await expect(draft).toBeFocused();
    await draft.fill('Second child');
    await draft.press('Enter');
    await draft.press('Escape');
    await expect(parent.locator('.subtask-progress')).toHaveText('0/2');
    await parent.locator('.sub-tasks task').first().locator('done-toggle').click();
    await expect(parent.locator('.subtask-progress')).toHaveText('1/2');
    await expect(
      parent.getByRole('img', { name: 'Completed subtasks: 1/2' }),
    ).toBeVisible();
    await parent.locator('.toggle-sub-tasks-btn').click();
    await expect(parent.locator('.subtask-progress')).toBeVisible();
    await expect(parent.locator('.subtask-progress')).toHaveText('1/2');
    await expect(
      parent.getByRole('img', { name: 'Completed subtasks: 1/2' }),
    ).toBeVisible();
    await parent.locator('.toggle-sub-tasks-btn').click();
    await expect(
      parent.locator('.sub-tasks task').filter({ hasText: 'Second child' }),
    ).toBeHidden();
    await parent.locator('.toggle-sub-tasks-btn').click();
    await parent
      .locator('.sub-tasks task')
      .filter({ hasText: 'Second child' })
      .locator('done-toggle')
      .click();
    await expect(parent.locator('.subtask-progress')).toContainText('2/2');
    await expect(parent.locator('.subtask-progress mat-icon')).toHaveText('check');
  });

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

  // On desktop (this suite runs mouse-primary Chrome), click-away neither
  // commits nor discards a draft with text: commit-on-blur is scoped to touch
  // (#8791/#8856), and losing focus must not throw typed text away.
  test('keeps a typed draft when it loses focus on desktop', async ({
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

    await expect(draftInput).toHaveValue('Blurred subtask');
    await expect(draftInput).not.toBeFocused();
    await expect(parentTask.locator('.sub-tasks task')).toHaveCount(0);

    // ...and the draft can still be committed after coming back to it.
    await draftInput.click();
    await page.keyboard.press('Enter');
    await expect(parentTask.locator('.sub-tasks task')).toHaveCount(1);
  });

  test('discards an empty draft when it loses focus on desktop', async ({
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
    await expect(parentTask.locator('.e2e-add-subtask-input')).toBeFocused();

    await page.locator('body').click({ position: { x: 10, y: 10 } });

    await expect(parentTask.locator('.e2e-add-subtask-input')).toHaveCount(0);
    await expect(parentTask.locator('.sub-tasks task')).toHaveCount(0);
  });
});
