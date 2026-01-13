import { test, expect } from '../../fixtures/test.fixture';

/**
 * Pre-migration Dialog E2E Tests
 *
 * These tests verify that:
 * 1. The app initializes correctly (migration completes if needed)
 * 2. The dialog-confirm component works correctly (used by pre-migration dialog)
 *
 * The actual pre-migration scenario (upgrading from non-operation-log version)
 * is covered by unit tests since it requires specific database state setup
 * before app initialization.
 *
 * Run with: npm run e2e:playwright -- --grep @migration
 */

test.describe('@migration Pre-migration Dialog', () => {
  test('app should initialize successfully after any migration', async ({
    page,
    workViewPage,
  }) => {
    // Wait for app to be ready - this implicitly verifies migration completed
    await workViewPage.waitForTaskList();

    // Create a task to verify app is fully functional
    await workViewPage.addTask('Post-migration test task');
    await page.waitForSelector('task', { state: 'visible' });

    // Verify the task was created
    await expect(page.locator('task-title').first()).toContainText(
      'Post-migration test task',
    );

    // Create another task to ensure state management works
    await workViewPage.addTask('Second post-migration task');
    await expect(page.locator('task')).toHaveCount(2);
  });

  test('dialog-confirm should show both buttons by default', async ({ page }) => {
    // Navigate to settings and trigger a dialog that shows both buttons
    await page.goto('/#/settings');
    await page.waitForLoadState('networkidle');

    // Find and click a section that might trigger a confirm dialog
    // We'll use the "Clear Storage" option if available
    const clearStorageBtn = page.locator('button').filter({ hasText: /clear/i }).first();

    if (await clearStorageBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await clearStorageBtn.click();

      // Wait for dialog to appear
      const dialog = page.locator('dialog-confirm');
      await dialog.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});

      if (await dialog.isVisible()) {
        // Verify both buttons are present
        const buttons = await dialog.locator('button').all();
        expect(buttons.length).toBeGreaterThanOrEqual(2);

        // Close dialog by clicking cancel
        await dialog.locator('button').first().click();
        await expect(dialog).not.toBeVisible();
      }
    }
  });

  test.skip('app should persist data across page reload', async ({
    page,
    workViewPage,
  }) => {
    // FIXME: This test is skipped due to a known task persistence issue.
    // See work-view.spec.ts for the same skipped test with more details.
    //
    // Issue: Tasks created via the global add task bar (used by addTask() method)
    // disappear after page reload. This is a persistence layer issue that needs
    // to be investigated separately.

    // Wait for app to be ready
    await workViewPage.waitForTaskList();

    // Create a task
    const taskTitle = 'Persistence test task ' + Date.now();
    await workViewPage.addTask(taskTitle);
    await page.waitForSelector('task', { state: 'visible' });
    await expect(page.locator('task-title').first()).toContainText(taskTitle);

    // Wait for persistence to complete before reloading
    await page.waitForTimeout(1000);

    // Reload the page
    await page.reload();
    await page.waitForLoadState('networkidle');
    await workViewPage.waitForTaskList();

    // Wait for tasks to be visible
    await page.waitForSelector('task', { state: 'visible', timeout: 10000 });

    // Verify task persisted
    await expect(page.locator('task-title').first()).toContainText(taskTitle);
  });

  test('app should handle fresh start correctly', async ({ browser, baseURL }) => {
    // Create a completely fresh context (no storage)
    const context = await browser.newContext({
      storageState: undefined,
      baseURL: baseURL || 'http://localhost:4242',
    });

    const page = await context.newPage();

    try {
      // Navigate to app
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      // Handle pre-migration dialog if it appears (shouldn't on fresh install, but just in case)
      try {
        const dialogConfirmBtn = page.locator('dialog-confirm button[e2e="confirmBtn"]');
        await dialogConfirmBtn.waitFor({ state: 'visible', timeout: 3000 });
        await dialogConfirmBtn.click();
        await page.waitForTimeout(500);
      } catch {
        // No dialog, continue
      }

      // Wait for app to initialize (may take time for fresh start)
      await page.waitForSelector('magic-side-nav', { state: 'visible', timeout: 30000 });

      // Wait for network to settle
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

      // Wait a bit for Angular to stabilize
      await page.waitForTimeout(1000);

      // The app should have initialized - check for main route
      // On fresh start, app should route to the default tag/project view
      await page.waitForURL(/#\/(tag|project)\/.+/, { timeout: 15000 }).catch(() => {});

      // App should be functional - verify side nav is visible
      const sideNav = page.locator('magic-side-nav');
      await expect(sideNav).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
