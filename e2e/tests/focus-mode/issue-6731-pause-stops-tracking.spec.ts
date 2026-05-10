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
 * This behavior requires the `isSyncSessionWithTracking` setting to be enabled,
 * which gates the syncSessionPauseToTracking$ effect in focus-mode.effects.ts.
 * The test now explicitly enables this setting before running the scenario.
 */

import { test, expect } from '../../fixtures/test.fixture';
import { Page } from '@playwright/test';

const enableSyncSessionWithTracking = async (page: Page): Promise<void> => {
  await page.goto('/#/config');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  // Navigate to Productivity tab
  const productivityTab = page.locator('[role="tab"]', { hasText: /Productivity/i });
  if (await productivityTab.isVisible({ timeout: 3000 }).catch(() => false)) {
    await productivityTab.click();
    await page.waitForTimeout(500);
  }

  // Find and expand the Focus Mode section
  const focusModeSection = page
    .locator('config-section')
    .filter({ hasText: 'Focus Mode' })
    .first();
  await focusModeSection.scrollIntoViewIfNeeded();

  const collapsible = focusModeSection.locator('collapsible');
  const isExpanded = await collapsible
    .evaluate((el) => el.classList.contains('isExpanded'))
    .catch(() => false);

  if (!isExpanded) {
    const header = collapsible.locator('.collapsible-header');
    await header.click();
    await page.waitForTimeout(500);
  }

  // Find and enable the toggle
  const toggle = page
    .locator('mat-slide-toggle')
    .filter({ hasText: 'Sync focus sessions with time tracking' })
    .first();
  await expect(toggle).toBeVisible({ timeout: 5000 });
  if (!(await toggle.getAttribute('class'))?.includes('mat-checked')) {
    await toggle.click();
    await page.waitForTimeout(300);
  }
};

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

    // Enable the setting that syncs focus sessions with time tracking
    await enableSyncSessionWithTracking(page);

    // Navigate back to work view
    await page.goto('/');
    await workViewPage.waitForTaskList();

    // Step 1+2 (setup): add a task and start tracking it. Focus mode now
    // requires a current task so the play button is enabled.
    await workViewPage.addTask('Issue6731Task');

    const firstTask = page.locator('task').first();
    await expect(firstTask).toBeVisible();
    await firstTask.hover();
    const trackingPlayBtn = page.locator('.play-btn.tour-playBtn').first();
    await trackingPlayBtn.waitFor({ state: 'visible' });
    await trackingPlayBtn.click();

    // Wait for navigation triggered by task tracking to complete
    await page.waitForURL(/#\/(tag|project)\/.+\/tasks/, { timeout: 10000 });
    await page.waitForTimeout(1000);

    // Step 1: start focus mode
    // Note: With isSyncSessionWithTracking enabled, the focus overlay auto-opens
    // when we start tracking. Verify it's open.
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

    // Wait for task list to be visible after closing overlay
    await workViewPage.waitForTaskList();

    // Expected: task is paused — no task carries the isCurrent class.
    const task = page.locator('task').first();
    await expect(task).toBeVisible({ timeout: 5000 });
    await expect(task).not.toHaveClass(/isCurrent/, { timeout: 5000 });
    await expect(page.locator('task.isCurrent')).toHaveCount(0);

    // The header focus-button should remain visible while the session is paused,
    // allowing the user to return to the paused session.
    await expect(mainFocusButton).toBeVisible({ timeout: 5000 });
  });
});
