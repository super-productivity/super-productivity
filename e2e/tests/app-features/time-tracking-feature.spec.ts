import { test, expect } from '../../fixtures/test.fixture';
import { WorkViewPage } from '../../pages/work-view.page';

test.describe('App Features - Time Tracking', () => {
  test('play buttons hidden if feature is disabled', async ({ page, testPrefix }) => {
    // elements on main page
    const workViewPage = new WorkViewPage(page, testPrefix);
    const firstTask = page.locator('task').first();
    const firstTaskHandle = firstTask.locator('.drag-handle');
    const taskPlayButton = page
      .locator('task')
      .getByRole('button', { name: 'Start tracking time' });
    const mainPlayButton = page.getByRole('button').filter({ hasText: 'play_arrow' });

    // elements on settings page
    const appFeaturesSection = page.locator('collapsible', { hasText: 'App Features' });
    const timeTrackingSwitch = page.getByRole('switch', {
      name: 'Stopwatch Time Tracking',
    });

    // Wait for task list and add a task
    // Use sd:today to set dueDay so task appears in TODAY view
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('TestTask sd:today');
    await expect(firstTask).toBeVisible();

    // Go to settings page
    await page.goto('/#/config');

    // expand "App Features"
    await appFeaturesSection.click();

    // Ensure timeTracking is enabled (default value)
    await expect(timeTrackingSwitch).toBeChecked();

    // Click toggle to disabled
    await timeTrackingSwitch.click();
    await expect(timeTrackingSwitch).not.toBeChecked();

    // Navigate to main view
    await page.goto('/#/tag/TODAY');
    // Play button in main button bar should not be present when feature is disabled
    await expect(mainPlayButton).not.toBeAttached();
    // Play button in the task hover menu should not be visible
    await firstTask.hover();
    await expect(taskPlayButton).not.toBeAttached();
    // select task and send PlayPause shortcut, ensure tracking is not started
    await firstTaskHandle.click();
    await expect(firstTask).toBeFocused();
    await page.keyboard.press('Y');
    // With feature disabled, pressing Y should NOT start tracking (no isCurrent class)
    // Use a short timeout since we're testing that nothing happens
    await expect(firstTask).not.toHaveClass(/isCurrent/, { timeout: 1000 });

    // Re-enable the feature
    await page.goto('/#/config');

    // expand "App Features"
    await appFeaturesSection.click();

    // click toggle button to enable
    await timeTrackingSwitch.click();
    await expect(timeTrackingSwitch).toBeChecked();

    // Go back to main view and expect play button to be visible
    await page.goto('/#/tag/TODAY');
    await expect(mainPlayButton).toBeAttached();

    await firstTask.hover();
    await expect(taskPlayButton).toBeAttached();
    // select task and send PlayPause shortcut, ensure tracking is started
    await firstTaskHandle.click();
    await expect(firstTask).toBeFocused();
    await page.keyboard.press('Y');
    // With feature enabled, pressing Y should start tracking (adds isCurrent class)
    await expect(firstTask).toHaveClass(/isCurrent/);
  });
});
