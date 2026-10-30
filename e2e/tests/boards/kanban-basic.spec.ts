import { test, expect } from '../../fixtures/test.fixture';
import { waitForStatePersistence } from '../../utils/waits';

/**
 * Boards/Kanban E2E Tests
 *
 * Tests the kanban board feature:
 * - Navigate to boards view
 * - Create and view boards
 * - Add tasks to board columns
 */

test.describe('Boards/Kanban', () => {
  test('should create a new board', async ({ page, workViewPage, testPrefix }) => {
    await workViewPage.waitForTaskList();
    const boardTitle = `${testPrefix}-Test Board`;

    // Navigate to boards view
    await page.goto('/#/boards');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('boards')).toBeVisible({ timeout: 10000 });
    const boardTab = page.getByRole('tab', { name: boardTitle, exact: true });
    await expect(boardTab).toHaveCount(0);

    // The last tab opens the inline add-board form.
    const addTab = page.locator('mat-tab-group [role="tab"]').last();
    await expect(addTab).toBeVisible();
    await addTab.click();

    const boardEditForm = page.locator('board-edit');
    await expect(boardEditForm).toBeVisible();
    await boardEditForm.getByRole('textbox', { name: 'Title' }).fill(boardTitle);

    const saveBtn = boardEditForm.getByRole('button', { name: 'Save' });
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();

    await expect(boardTab).toBeVisible();
    await expect(page).toHaveURL(/boards/);

    await waitForStatePersistence(page);
    await page.reload();

    await expect(page.locator('boards')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('tab', { name: boardTitle, exact: true })).toBeVisible();
  });

  test('should allow navigation back to work view from boards', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();

    // Navigate to boards view
    await page.goto('/#/boards');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('boards')).toBeVisible({ timeout: 10000 });

    // Navigate back to Today tag
    await page.click('text=Today');
    await page.waitForLoadState('networkidle');

    // Verify we're back at the work view
    await expect(page).toHaveURL(/tag\/TODAY/);
    await expect(page.locator('task-list').first()).toBeVisible();
  });
});
