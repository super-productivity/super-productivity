import { test, expect } from '../../fixtures/test.fixture';
import { WorkViewPage } from '../../pages/work-view.page';

test.describe('App Features - Focus Mode', () => {
  test('Focus mode controls hidden if feature is disabled', async ({
    page,
    testPrefix,
  }) => {
    // elements on main page
    const workViewPage = new WorkViewPage(page, testPrefix);
    const firstTask = page.locator('task').first();
    const mainFocusButton = page
      .getByRole('button')
      .filter({ hasText: 'center_focus_strong' });
    const taskContextStartFocus = page.getByRole('menuitem', {
      name: 'Start Focus Session',
    });
    const focusModeOverlay = page.locator('focus-mode-overlay');

    // elements on settings page
    const appFeaturesSection = page.locator('collapsible', { hasText: 'App Features' });
    const focusModeSwitch = page.getByRole('switch', {
      name: 'Focus Mode',
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

    // Ensure focus mode feature is enabled (default value)
    await expect(focusModeSwitch).toBeChecked();

    // Click toggle to disabled
    await focusModeSwitch.click();
    await expect(focusModeSwitch).not.toBeChecked();

    // Navigate to main view
    await page.goto('/#/tag/TODAY');
    // Focus Mode button in main button bar should not be present when feature is disabled
    await expect(mainFocusButton).not.toBeAttached();
    // Focus Mode in the task context menu should not be visible
    await firstTask.click({ button: 'right' });
    await expect(taskContextStartFocus).not.toBeAttached();

    // send shortcut for focus mode, ensure that focus overlay is not showing
    await page.keyboard.press('F');
    // Verify overlay doesn't appear after a brief moment
    await expect(focusModeOverlay).not.toBeAttached({ timeout: 1000 });

    // Re-enable the feature
    await page.goto('/#/config');

    // expand "App Features"
    await appFeaturesSection.click();

    // click toggle button to enable
    await focusModeSwitch.click();
    await expect(focusModeSwitch).toBeChecked();

    // Go back to main view and expect play button to be visible
    await page.goto('/#/tag/TODAY');
    await expect(mainFocusButton).toBeAttached();

    await firstTask.click({ button: 'right' });
    await expect(taskContextStartFocus).toBeAttached();

    // Close context menu to unblock actions
    await page.keyboard.press('Escape');

    // Start focus mode via main button to avoid shortcut timing flakiness
    await mainFocusButton.click();
    await expect(focusModeOverlay).toBeAttached({ timeout: 5000 });
  });
});
