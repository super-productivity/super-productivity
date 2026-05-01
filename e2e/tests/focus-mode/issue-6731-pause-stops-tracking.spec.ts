/**
 * Regression test for issue #6731 — pausing the focus mode session
 * must also stop time tracking on the current task.
 *
 * Reproduction (from the issue report):
 *   1. start focus mode
 *   2. start a task
 *   3. click "pause"
 *   4. exit focus mode
 *   expected: task is paused (current task cleared)
 *
 * Before the always-sync rework this only worked when the user had toggled
 * `isSyncSessionWithTracking`. Now sync is unconditional, so this test
 * locks the fix in place.
 */

import { test, expect } from '../../fixtures/test.fixture';

test.describe('Issue #6731: Pause in focus mode stops task time tracking', () => {
  test('pause + close overlay clears the current task', async ({
    page,
    workViewPage,
  }) => {
    const focusModeOverlay = page.locator('focus-mode-overlay');
    const focusModeMain = page.locator('focus-mode-main');
    const focusModeCountdown = page.locator('focus-mode-countdown');
    const mainFocusButton = page
      .getByRole('button')
      .filter({ hasText: 'center_focus_strong' });
    const playButton = page.locator('focus-mode-main button.play-button');
    const pauseButton = page.locator('focus-mode-main button.pause-resume-btn');
    const completeSessionButton = page.locator(
      'focus-mode-main button.complete-session-btn',
    );
    const closeOverlayButton = page.locator('focus-mode-overlay button.close-btn');

    // Step 1+2 (setup): add a task and start tracking it. Focus mode now
    // requires a current task so the play button is enabled.
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Issue6731Task');

    const firstTask = page.locator('task').first();
    await expect(firstTask).toBeVisible();
    await firstTask.hover();
    const trackingPlayBtn = page.locator('.play-btn.tour-playBtn').first();
    await trackingPlayBtn.waitFor({ state: 'visible' });
    await trackingPlayBtn.click();
    await expect(firstTask).toHaveClass(/isCurrent/, { timeout: 5000 });

    // Step 1: start focus mode
    await mainFocusButton.click();
    await expect(focusModeOverlay).toBeVisible({ timeout: 5000 });

    // Start the focus session and wait through the prep countdown.
    await expect(playButton).toBeEnabled();
    await playButton.click();
    await expect(focusModeCountdown).not.toBeVisible({ timeout: 15000 });

    // In-progress state: pause + complete buttons surface.
    await expect(completeSessionButton).toBeVisible({ timeout: 20000 });
    await expect(pauseButton).toBeVisible();

    // Step 3: click pause.
    await pauseButton.click();

    // Step 4: exit focus mode (close overlay — session stays paused, but
    // the sync effect must have cleared the current task by now).
    await closeOverlayButton.click();
    await expect(focusModeMain).not.toBeVisible();

    // Expected: task is paused — no task carries the isCurrent class.
    await expect(firstTask).not.toHaveClass(/isCurrent/, { timeout: 5000 });
    await expect(page.locator('task.isCurrent')).toHaveCount(0);
  });
});
