import { test, expect } from '../../fixtures/test.fixture';
import { WorkViewPage } from '../../pages/work-view.page';

test.describe('Focus Mode - Break Controls (Issue #5995)', () => {
  test.beforeEach(async ({ page, testPrefix }) => {
    const workViewPage = new WorkViewPage(page, testPrefix);

    // Wait for task list and add a task
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('TestTask sd:today');

    // Wait for task to be visible
    const firstTask = page.locator('task').first();
    await expect(firstTask).toBeVisible();
  });

  // NOTE: Pause/resume break functionality is NOT tested in E2E because:
  // - E2E click events don't trigger NgRx store updates for this specific button
  // - This is a zone.js/NgRx integration issue in the E2E environment
  // - The functionality IS verified by 62 unit tests:
  //   - 48 reducer unit tests (focus-mode.reducer.spec.ts)
  //   - 14 component unit tests (focus-mode-break.component.spec.ts)

  test('should be able to exit break to planning and change timer mode', async ({
    page,
  }) => {
    // Locators
    const focusModeOverlay = page.locator('focus-mode-overlay');
    const focusModeBreak = page.locator('focus-mode-break');
    const focusModeMain = page.locator('focus-mode-main');
    const focusModeCountdown = page.locator('focus-mode-countdown');
    const mainFocusButton = page
      .getByRole('button')
      .filter({ hasText: 'center_focus_strong' });
    const pomodoroModeButton = page.locator('segmented-button-group button', {
      hasText: 'Pomodoro',
    });
    const flowtimeModeButton = page.locator('segmented-button-group button', {
      hasText: 'Flowtime',
    });
    const playButton = page.locator('focus-mode-main button.play-button');
    const completeSessionButton = page.locator(
      'focus-mode-main button.complete-session-btn',
    );
    const backToPlanningButton = page.getByRole('button', { name: 'Back to Planning' });
    const modeSelector = page.locator('focus-mode-main segmented-button-group');

    // Open focus mode overlay
    await mainFocusButton.click();
    await expect(focusModeOverlay).toBeVisible({ timeout: 5000 });

    // Select Pomodoro mode
    await pomodoroModeButton.click();

    // Start a focus session
    await playButton.click();

    // Wait for countdown animation to complete
    await expect(focusModeCountdown).not.toBeVisible({ timeout: 15000 });

    // Wait for session to be in progress, then complete it
    await expect(completeSessionButton).toBeVisible({ timeout: 20000 });
    await completeSessionButton.click();

    // Wait for session-done transition to complete before checking for break
    await expect(completeSessionButton).not.toBeVisible({ timeout: 10000 });

    // In Pomodoro mode, break auto-starts after session completion via effects chain
    await expect(focusModeBreak).toBeVisible({ timeout: 15000 });

    // Verify mode selector is NOT visible on break screen
    await expect(modeSelector).not.toBeVisible();

    // Click "Back to Planning" button
    await expect(backToPlanningButton).toBeVisible();
    await backToPlanningButton.click();

    // Verify we're back on the main screen
    await expect(focusModeMain).toBeVisible({ timeout: 5000 });
    await expect(focusModeBreak).not.toBeVisible();

    // Verify mode selector IS now visible
    await expect(modeSelector).toBeVisible();

    // Change mode to Flowtime
    await flowtimeModeButton.click();

    // Verify Flowtime mode is selected (uses aria-checked, not aria-pressed)
    await expect(flowtimeModeButton).toHaveAttribute('aria-checked', 'true');

    // Verify play button is visible (we're in preparation state)
    await expect(playButton).toBeVisible();
  });

  test('should show Back to Planning and Skip Break buttons during break', async ({
    page,
  }) => {
    // Locators
    const focusModeOverlay = page.locator('focus-mode-overlay');
    const focusModeBreak = page.locator('focus-mode-break');
    const focusModeCountdown = page.locator('focus-mode-countdown');
    const mainFocusButton = page
      .getByRole('button')
      .filter({ hasText: 'center_focus_strong' });
    const pomodoroModeButton = page.locator('segmented-button-group button', {
      hasText: 'Pomodoro',
    });
    const playButton = page.locator('focus-mode-main button.play-button');
    const completeSessionButton = page.locator(
      'focus-mode-main button.complete-session-btn',
    );
    const backToPlanningButton = page.getByRole('button', { name: 'Back to Planning' });
    const skipBreakButton = page.getByRole('button', { name: 'Skip Break' });

    // Open focus mode overlay
    await mainFocusButton.click();
    await expect(focusModeOverlay).toBeVisible({ timeout: 5000 });

    // Select Pomodoro mode and start session
    await pomodoroModeButton.click();
    await playButton.click();

    // Wait for countdown animation to complete
    await expect(focusModeCountdown).not.toBeVisible({ timeout: 15000 });

    // Complete the session
    await expect(completeSessionButton).toBeVisible({ timeout: 20000 });
    await completeSessionButton.click();

    // Wait for session-done transition to complete before checking for break
    await expect(completeSessionButton).not.toBeVisible({ timeout: 10000 });

    // In Pomodoro mode, break auto-starts after session completion via effects chain
    await expect(focusModeBreak).toBeVisible({ timeout: 15000 });

    // Verify both buttons are visible
    await expect(backToPlanningButton).toBeVisible();
    await expect(skipBreakButton).toBeVisible();
  });

  test('Skip Break should auto-start next session in Pomodoro mode', async ({ page }) => {
    // Locators
    const focusModeOverlay = page.locator('focus-mode-overlay');
    const focusModeBreak = page.locator('focus-mode-break');
    const focusModeMain = page.locator('focus-mode-main');
    const focusModeCountdown = page.locator('focus-mode-countdown');
    const mainFocusButton = page
      .getByRole('button')
      .filter({ hasText: 'center_focus_strong' });
    const pomodoroModeButton = page.locator('segmented-button-group button', {
      hasText: 'Pomodoro',
    });
    const playButton = page.locator('focus-mode-main button.play-button');
    const completeSessionButton = page.locator(
      'focus-mode-main button.complete-session-btn',
    );
    const skipBreakButton = page.getByRole('button', { name: 'Skip Break' });
    const modeSelector = page.locator('focus-mode-main segmented-button-group');

    // Open focus mode overlay
    await mainFocusButton.click();
    await expect(focusModeOverlay).toBeVisible({ timeout: 5000 });

    // Select Pomodoro mode and start session
    await pomodoroModeButton.click();
    await playButton.click();

    // Wait for countdown animation to complete
    await expect(focusModeCountdown).not.toBeVisible({ timeout: 15000 });

    // Complete the session
    await expect(completeSessionButton).toBeVisible({ timeout: 20000 });
    await completeSessionButton.click();

    // Wait for session-done transition to complete before checking for break
    await expect(completeSessionButton).not.toBeVisible({ timeout: 10000 });

    // In Pomodoro mode, break auto-starts after session completion via effects chain
    await expect(focusModeBreak).toBeVisible({ timeout: 15000 });

    // Skip the break
    await skipBreakButton.click();

    // Verify we're back on main screen and session auto-started
    // (mode selector should NOT be visible because we're in progress)
    await expect(focusModeMain).toBeVisible({ timeout: 5000 });
    await expect(modeSelector).not.toBeVisible();
    await expect(completeSessionButton).toBeVisible();
  });

  test('Back to Planning should NOT auto-start next session', async ({ page }) => {
    // Locators
    const focusModeOverlay = page.locator('focus-mode-overlay');
    const focusModeBreak = page.locator('focus-mode-break');
    const focusModeMain = page.locator('focus-mode-main');
    const focusModeCountdown = page.locator('focus-mode-countdown');
    const mainFocusButton = page
      .getByRole('button')
      .filter({ hasText: 'center_focus_strong' });
    const pomodoroModeButton = page.locator('segmented-button-group button', {
      hasText: 'Pomodoro',
    });
    const playButton = page.locator('focus-mode-main button.play-button');
    const completeSessionButton = page.locator(
      'focus-mode-main button.complete-session-btn',
    );
    const backToPlanningButton = page.getByRole('button', { name: 'Back to Planning' });
    const modeSelector = page.locator('focus-mode-main segmented-button-group');

    // Open focus mode overlay
    await mainFocusButton.click();
    await expect(focusModeOverlay).toBeVisible({ timeout: 5000 });

    // Select Pomodoro mode and start session
    await pomodoroModeButton.click();
    await playButton.click();

    // Wait for countdown animation to complete
    await expect(focusModeCountdown).not.toBeVisible({ timeout: 15000 });

    // Complete the session
    await expect(completeSessionButton).toBeVisible({ timeout: 20000 });
    await completeSessionButton.click();

    // Wait for session-done transition to complete before checking for break
    await expect(completeSessionButton).not.toBeVisible({ timeout: 10000 });

    // In Pomodoro mode, break auto-starts after session completion via effects chain
    await expect(focusModeBreak).toBeVisible({ timeout: 15000 });

    // Click Back to Planning
    await backToPlanningButton.click();

    // Verify we're back on main screen in PREPARATION state
    // (mode selector SHOULD be visible because we're NOT auto-starting)
    await expect(focusModeMain).toBeVisible({ timeout: 5000 });
    await expect(modeSelector).toBeVisible();
    await expect(playButton).toBeVisible();
    await expect(completeSessionButton).not.toBeVisible();
  });
});
