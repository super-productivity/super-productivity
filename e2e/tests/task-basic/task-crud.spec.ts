import { test, expect } from '../../fixtures/test.fixture';

const TASK = 'task';
const TASK_TITLE = 'task task-title';
const FIRST_TASK = 'task:first-child';
const SECOND_TASK = 'task:nth-child(2)';
const TASK_DONE_BTN = '.task-done-btn';

test.describe('Task CRUD Operations', () => {
  test('should create, edit and delete tasks', async ({ page, workViewPage }) => {
    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    // Create first task
    await workViewPage.addTask('First task');
    await page.waitForSelector(TASK, { state: 'visible' });
    await expect(page.locator(TASK_TITLE).first()).toContainText(/First task/);

    // Create second task
    await workViewPage.addTask('Second task');
    await expect(page.locator(`${FIRST_TASK} task-title`)).toContainText(/Second task/);
    await expect(page.locator(`${SECOND_TASK} task-title`)).toContainText(/First task/);

    // Edit first task (newest)
    await page.click(`${FIRST_TASK} task-title`);
    await page.waitForSelector(`${FIRST_TASK} textarea`, { state: 'visible' });
    await page.fill(`${FIRST_TASK} textarea`, 'Edited second task');
    await page.keyboard.press('Tab'); // Blur to save
    await expect(page.locator(`${FIRST_TASK} task-title`)).toContainText(
      /Edited second task/,
    );

    // Mark first task as done
    await page.hover(FIRST_TASK);
    await page.waitForSelector(`${FIRST_TASK} ${TASK_DONE_BTN}`, { state: 'visible' });
    await page.click(`${FIRST_TASK} ${TASK_DONE_BTN}`);

    // Verify task is marked as done
    await expect(page.locator(`${FIRST_TASK}.isDone`)).toBeVisible();

    // Verify we have one done task and one undone task
    await expect(page.locator(`${TASK}.isDone`)).toHaveCount(1);
    await expect(page.locator(`${TASK}:not(.isDone)`)).toHaveCount(1);
  });

  test('should handle task title updates', async ({ page, workViewPage }) => {
    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    // Create a task
    await workViewPage.addTask('Original title');
    await page.waitForSelector(TASK, { state: 'visible' });

    // Update the task title multiple times
    await page.click(`${FIRST_TASK} task-title`);
    await page.waitForSelector(`${FIRST_TASK} textarea`, { state: 'visible' });
    await page.fill(`${FIRST_TASK} textarea`, 'Updated title 1');
    await page.keyboard.press('Tab');
    await expect(page.locator(`${FIRST_TASK} task-title`)).toContainText(
      /Updated title 1/,
    );

    // Update again
    await page.click(`${FIRST_TASK} task-title`);
    await page.waitForSelector(`${FIRST_TASK} textarea`, { state: 'visible' });
    await page.fill(`${FIRST_TASK} textarea`, 'Final title');
    await page.keyboard.press('Tab');
    await expect(page.locator(`${FIRST_TASK} task-title`)).toContainText(/Final title/);
  });

  test('should restore deleted task when clicking undo', async ({
    page,
    workViewPage,
  }) => {
    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    // Create a task
    const taskTitle = 'Task to delete and restore';
    await workViewPage.addTask(taskTitle);
    await page.waitForSelector(TASK, { state: 'visible' });
    await expect(page.locator(TASK_TITLE).first()).toContainText(taskTitle);

    // Count tasks before delete
    const countBefore = await page.locator(TASK).count();

    // Delete the task via context menu
    await page.click(FIRST_TASK, { button: 'right' });
    await page.locator('.mat-mdc-menu-item').filter({ hasText: 'Delete' }).click();

    // Handle confirmation dialog if present
    const confirmBtn = page.locator('[e2e="confirmBtn"]');
    if (await confirmBtn.isVisible()) {
      await confirmBtn.click();
    }

    // Verify task is deleted
    await expect(page.locator(`${TASK}:has-text("${taskTitle}")`)).not.toBeVisible();

    // Click Undo in the snackbar (appears for 5 seconds)
    // The snackbar uses snack-custom component with a button.action
    const undoButton = page.locator(
      'snack-custom button.action, .mat-mdc-snack-bar-container button',
    );
    await undoButton.waitFor({ state: 'visible', timeout: 5000 });
    await undoButton.click();

    // Wait for restore to complete
    await page.waitForTimeout(500);

    // Verify task is restored
    await expect(page.locator(`${TASK}:has-text("${taskTitle}")`)).toBeVisible();

    // Verify task count is back to original
    const countAfter = await page.locator(TASK).count();
    expect(countAfter).toBe(countBefore);
  });
});
