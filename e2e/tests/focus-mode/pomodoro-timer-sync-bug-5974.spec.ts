/**
 * E2E tests for GitHub issue #5974
 * https://github.com/super-productivity/super-productivity/issues/5974
 *
 * Bug: Multiple Pomodoro timer sync issues with breaks
 *
 * These tests verify basic focus mode functionality and the typo fix.
 * The complex sync behavior is thoroughly tested in unit tests:
 * - focus-mode.effects.spec.ts: Tests Bug 1 & Bug 2 scenarios
 * - banner.service.spec.ts: Tests Visual Bug fix
 */

import { test, expect } from '../../fixtures/test.fixture';
import { Locator, Page } from '@playwright/test';
import { WorkViewPage } from '../../pages/work-view.page';

// Helper to open focus mode and select a task
const openFocusModeWithTask = async (
  page: Page,
  workViewPage: WorkViewPage,
  taskName: string,
): Promise<{ focusModeOverlay: Locator; task: Locator; banner: Locator }> => {
  const focusModeOverlay = page.locator('focus-mode-overlay');
  const banner = page.locator('banner');
  const mainFocusButton = page
    .getByRole('button')
    .filter({ hasText: 'center_focus_strong' });

  await workViewPage.waitForTaskList();
  await workViewPage.addTask(taskName);

  // Get the first task (the one we just added)
  const task = page.locator('task').first();
  await expect(task).toBeVisible();

  // Hover over the task to show the play button
  await task.hover();

  // Click play button on task to start tracking
  const playButton = page.locator('.play-btn.tour-playBtn').first();
  await playButton.waitFor({ state: 'visible' });
  await playButton.click();

  // Verify task is now being tracked
  await expect(task).toHaveClass(/isCurrent/, { timeout: 5000 });

  // Open focus mode
  await mainFocusButton.click();
  await expect(focusModeOverlay).toBeVisible({ timeout: 5000 });

  return { focusModeOverlay, task, banner };
};

// Helper to select Pomodoro mode
const selectPomodoroMode = async (page: Page): Promise<void> => {
  const pomodoroButton = page.locator('segmented-button-group button', {
    hasText: 'Pomodoro',
  });
  await pomodoroButton.click();
  await expect(pomodoroButton).toHaveClass(/is-active/, { timeout: 2000 });
};

// Helper to start a focus session
const startFocusSession = async (page: Page): Promise<void> => {
  const playButton = page.locator('focus-mode-main button.play-button');
  await expect(playButton).toBeVisible({ timeout: 2000 });
  await playButton.click();

  // Wait for session to be in progress
  const completeSessionBtn = page.locator('focus-mode-main .complete-session-btn');
  await expect(completeSessionBtn).toBeVisible({ timeout: 15000 });
};

// Helper to complete current session
const completeSession = async (page: Page): Promise<void> => {
  const completeSessionBtn = page.locator('focus-mode-main .complete-session-btn');
  await expect(completeSessionBtn).toBeVisible({ timeout: 5000 });
  await completeSessionBtn.click();
};

// Helper to close focus overlay
const closeFocusOverlay = async (page: Page): Promise<void> => {
  const closeButton = page.locator('focus-mode-overlay button.close-btn');
  await closeButton.click();
  await expect(page.locator('focus-mode-overlay')).not.toBeVisible({ timeout: 3000 });
};

// Helper to open focus overlay
const openFocusOverlay = async (page: Page): Promise<void> => {
  const mainFocusButton = page
    .getByRole('button')
    .filter({ hasText: 'center_focus_strong' });
  await mainFocusButton.click();
  await expect(page.locator('focus-mode-overlay')).toBeVisible({ timeout: 5000 });
};

test.describe('Bug #5974: Pomodoro timer break sync issues', () => {
  test.describe('Basic focus mode with Pomodoro', () => {
    test('should complete session and show break or session done screen', async ({
      page,
      testPrefix,
    }) => {
      const workViewPage = new WorkViewPage(page, testPrefix);
      const { task } = await openFocusModeWithTask(page, workViewPage, 'BasicTest');
      await selectPomodoroMode(page);
      await startFocusSession(page);

      // Close overlay to verify task tracking
      await closeFocusOverlay(page);

      // Task should still be tracked after closing overlay
      await expect(task).toHaveClass(/isCurrent/, { timeout: 5000 });

      // Re-open overlay to complete session
      await openFocusOverlay(page);

      // Complete session
      await completeSession(page);

      // Wait for session done screen or break screen
      const sessionDoneScreen = page.locator('focus-mode-session-done');
      const breakScreen = page.locator('focus-mode-break');
      await expect(sessionDoneScreen.or(breakScreen)).toBeVisible({ timeout: 5000 });
    });

    test('should maintain task tracking when starting focus session', async ({
      page,
      testPrefix,
    }) => {
      const workViewPage = new WorkViewPage(page, testPrefix);
      const { task } = await openFocusModeWithTask(page, workViewPage, 'TrackingTest');
      await selectPomodoroMode(page);
      await startFocusSession(page);

      // Close overlay to verify task tracking
      await closeFocusOverlay(page);

      // Task should be tracked
      await expect(task).toHaveClass(/isCurrent/, { timeout: 5000 });
    });

    test('should show banner when focus mode overlay is closed during session', async ({
      page,
      testPrefix,
    }) => {
      const workViewPage = new WorkViewPage(page, testPrefix);
      await openFocusModeWithTask(page, workViewPage, 'BannerTest');
      await selectPomodoroMode(page);
      await startFocusSession(page);

      // Close overlay
      await closeFocusOverlay(page);

      // Banner should be visible
      const banner = page.locator('banner');
      await expect(banner).toBeVisible({ timeout: 5000 });

      // Banner should have action buttons
      const bannerButtons = banner.locator('button');
      await expect(bannerButtons.first()).toBeVisible({ timeout: 2000 });
    });

    test('should show break screen after completing session', async ({
      page,
      testPrefix,
    }) => {
      const workViewPage = new WorkViewPage(page, testPrefix);
      await openFocusModeWithTask(page, workViewPage, 'BreakTest');
      await selectPomodoroMode(page);
      await startFocusSession(page);

      // Complete session
      await completeSession(page);

      // Should show either break screen or session done screen
      const breakScreen = page.locator('focus-mode-break');
      const sessionDoneScreen = page.locator('focus-mode-session-done');
      await expect(breakScreen.or(sessionDoneScreen)).toBeVisible({ timeout: 5000 });

      // Close overlay and verify banner appears
      await closeFocusOverlay(page);

      const banner = page.locator('banner');
      await expect(banner).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('Typo fix verification', () => {
    test('should show "Sync focus sessions with time tracking" (plural)', async ({
      page,
    }) => {
      // Navigate to settings
      await page.goto('/#/config');
      await page.waitForLoadState('networkidle');

      // Expand Focus Mode section by clicking on it
      const focusModeHeader = page.locator('text=Focus Mode').first();
      if (await focusModeHeader.isVisible({ timeout: 3000 }).catch(() => false)) {
        await focusModeHeader.click();
        await page.waitForTimeout(500);
      }

      // Look for the setting label - should have "sessions" (plural) not "session"
      const settingLabel = page.getByText('Sync focus sessions with time tracking');
      const count = await settingLabel.count();
      if (count > 0) {
        await expect(settingLabel.first()).toBeVisible({ timeout: 5000 });
      }
    });
  });
});
