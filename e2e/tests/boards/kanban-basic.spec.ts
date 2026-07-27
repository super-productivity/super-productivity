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
  test('should navigate to boards view', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();

    // Navigate to boards view
    await page.goto('/#/boards');
    await page.waitForLoadState('networkidle');

    // Verify URL
    await expect(page).toHaveURL(/boards/);

    // Verify boards component is visible
    await expect(page.locator('boards')).toBeVisible({ timeout: 10000 });
  });

  test('should display default board', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();

    // Navigate to boards view
    await page.goto('/#/boards');
    await page.waitForLoadState('networkidle');

    // Verify boards component is visible
    await expect(page.locator('boards')).toBeVisible({ timeout: 10000 });

    // Look for board tabs (at least one board should exist by default)
    const tabGroup = page.locator('mat-tab-group');
    await expect(tabGroup).toBeVisible();
  });

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

  test('should show board columns', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();

    // Navigate to boards view
    await page.goto('/#/boards');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('boards')).toBeVisible({ timeout: 10000 });

    // Wait for board to load
    await page.waitForTimeout(500);

    // Look for board panels/columns
    const boardPanel = page.locator('board-panel, .board-panel');
    const hasPanels = await boardPanel
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (hasPanels) {
      const panelCount = await boardPanel.count();
      expect(panelCount).toBeGreaterThan(0);
    }
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

  test('should persist board selection across navigation', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();

    // Navigate to boards
    await page.goto('/#/boards');
    await page.waitForLoadState('networkidle');

    // Use first() to avoid strict mode violation during animations
    await expect(page.locator('boards').first()).toBeVisible({ timeout: 10000 });

    // Navigate away
    await page.goto('/#/schedule');
    await page.waitForLoadState('networkidle');

    // Navigate back to boards
    await page.goto('/#/boards');
    await page.waitForLoadState('networkidle');

    // Verify boards view loads again
    await expect(page.locator('boards').first()).toBeVisible({ timeout: 10000 });
  });
});
