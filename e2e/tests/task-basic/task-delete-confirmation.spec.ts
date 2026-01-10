import { test, expect } from '../../fixtures/test.fixture';

/**
 * Tests for Issue #5942: Prevent Unintended Task Deletions via Backspace
 * Tests the confirmation dialog when deleting tasks
 */
test.describe('Task Delete Confirmation', () => {
  test('should show confirmation dialog when deleting task via context menu (default setting)', async ({
    page,
    workViewPage,
  }) => {
    // Setup: Create a task
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Task to delete');
    await expect(page.locator('task')).toHaveCount(1);

    // Act: Right-click and select delete
    await page.locator('task').first().click({ button: 'right' });
    await page.locator('.mat-mdc-menu-content button.color-warn').click();

    // Assert: Confirmation dialog should appear (isConfirmBeforeTaskDelete defaults to true)
    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible({ timeout: 3000 });

    // Verify dialog content mentions the task title
    await expect(dialog).toContainText('Task to delete');

    // Verify confirm button exists
    const confirmBtn = page.locator('[e2e="confirmBtn"]');
    await expect(confirmBtn).toBeVisible();
  });

  test('should delete task when confirmation is accepted', async ({
    page,
    workViewPage,
  }) => {
    // Setup: Create a task
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Task to delete');
    await expect(page.locator('task')).toHaveCount(1);

    // Act: Right-click, select delete, and confirm
    await page.locator('task').first().click({ button: 'right' });
    await page.locator('.mat-mdc-menu-content button.color-warn').click();

    // Wait for dialog and confirm
    const confirmBtn = page.locator('[e2e="confirmBtn"]');
    await confirmBtn.waitFor({ state: 'visible', timeout: 3000 });
    await confirmBtn.click();

    // Assert: Task should be deleted
    await expect(page.locator('task')).toHaveCount(0, { timeout: 5000 });
  });

  test('should NOT delete task when confirmation is cancelled', async ({
    page,
    workViewPage,
  }) => {
    // Setup: Create a task
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Task to keep');
    await expect(page.locator('task')).toHaveCount(1);

    // Act: Right-click, select delete, but cancel
    await page.locator('task').first().click({ button: 'right' });
    await page.locator('.mat-mdc-menu-content button.color-warn').click();

    // Wait for dialog and cancel
    const dialog = page.locator('mat-dialog-container');
    await dialog.waitFor({ state: 'visible', timeout: 3000 });

    // Click cancel button (first button in dialog actions)
    const cancelBtn = dialog.locator('button').first();
    await cancelBtn.click();

    // Assert: Task should NOT be deleted
    await expect(page.locator('task')).toHaveCount(1);
    await expect(page.locator('task')).toContainText('Task to keep');
  });

  test('should delete task via keyboard shortcut with confirmation', async ({
    page,
    workViewPage,
  }) => {
    // Setup: Create a task
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Task to delete with keyboard');
    await expect(page.locator('task')).toHaveCount(1);

    // Focus the task
    await page.locator('task').first().click();

    // Act: Press Backspace (default delete shortcut)
    await page.keyboard.press('Backspace');

    // Assert: Confirmation dialog should appear
    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible({ timeout: 3000 });

    // Confirm deletion
    const confirmBtn = page.locator('[e2e="confirmBtn"]');
    await confirmBtn.click();

    // Task should be deleted
    await expect(page.locator('task')).toHaveCount(0, { timeout: 5000 });
  });

  test('should show undo snackbar after confirmed deletion', async ({
    page,
    workViewPage,
  }) => {
    // Setup: Create a task
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Task with undo');
    await expect(page.locator('task')).toHaveCount(1);

    // Act: Delete with confirmation
    await page.locator('task').first().click({ button: 'right' });
    await page.locator('.mat-mdc-menu-content button.color-warn').click();

    const confirmBtn = page.locator('[e2e="confirmBtn"]');
    await confirmBtn.waitFor({ state: 'visible', timeout: 3000 });
    await confirmBtn.click();

    // Assert: Undo snackbar should appear
    const snackbar = page.locator('mat-snack-bar-container');
    await expect(snackbar).toBeVisible({ timeout: 3000 });
  });
});
