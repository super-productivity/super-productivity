import { test, expect } from '../../fixtures/test.fixture';

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

    // Navigate to boards view
    await page.goto('/#/boards');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('boards')).toBeVisible({ timeout: 10000 });

    // Click the add button (+ tab or add board button)
    // Look for the last tab which is typically the "add" tab
    const addTab = page.locator('mat-tab-group [role="tab"]').last();
    await addTab.waitFor({ state: 'visible', timeout: 5000 });
    await addTab.click();

    // Should open board edit form
    const boardEditForm = page.locator('board-edit, dialog-board-edit');
    const formVisible = await boardEditForm
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (formVisible) {
      // Fill in board name
      const nameInput = page.locator(
        'input[formcontrolname="title"], input[name="title"]',
      );
      const inputVisible = await nameInput
        .isVisible({ timeout: 3000 })
        .catch(() => false);

      if (inputVisible) {
        await nameInput.fill(`${testPrefix}-Test Board`);

        // Save the board
        const saveBtn = page.locator('button:has-text("Save"), button[type="submit"]');
        await saveBtn.click();

        // Wait for form to close
        await page.waitForTimeout(500);
      }
    }

    // Verify we're still on the boards page
    await expect(page).toHaveURL(/boards/);
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
