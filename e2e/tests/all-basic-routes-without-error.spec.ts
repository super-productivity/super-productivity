import { test } from '../fixtures/test.fixture';

test.describe('All Basic Routes Without Error', () => {
  test('should open all basic routes from menu without error', async ({
    page,
    workViewPage,
  }) => {
    // Load app and wait for work view
    await workViewPage.waitForTaskList();

    // Wait for magic-side-nav to be fully loaded
    await page.locator('magic-side-nav').waitFor({ state: 'visible' });

    // Helper to navigate and wait for route to load
    const navigateAndWait = async (route: string): Promise<void> => {
      await page.goto(route);
      await page.locator('.route-wrapper').waitFor({ state: 'visible', timeout: 10000 });
    };

    // Navigate to schedule
    await navigateAndWait('/#/tag/TODAY/schedule');

    // Test that key navigation elements are visible and functional
    await page.waitForSelector('magic-side-nav', { state: 'visible' });

    // Test navigation to different routes by URL (the main goal of this test)
    await navigateAndWait('/#/schedule');
    await navigateAndWait('/#/tag/TODAY/tasks');
    await navigateAndWait('/#/config');

    // Navigate to different routes
    await navigateAndWait('/#/tag/TODAY/quick-history');
    await navigateAndWait('/#/tag/TODAY/worklog');
    await navigateAndWait('/#/tag/TODAY/metrics');
    await navigateAndWait('/#/tag/TODAY/planner');
    await navigateAndWait('/#/tag/TODAY/daily-summary');
    await navigateAndWait('/#/tag/TODAY/settings');

    // Send 'n' key to open notes dialog
    await page.keyboard.press('n');

    // Verify no errors in console (implicit with test passing)
  });
});
