import { test, expect } from '../../fixtures/test.fixture';

/**
 * Boards/Kanban E2E Tests
 *
 * Tests the kanban board feature:
 * - Navigate to boards view
 *
 * Creating views from the side menu: views-sidebar.spec.ts.
 */

test.describe('Boards/Kanban', () => {
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
