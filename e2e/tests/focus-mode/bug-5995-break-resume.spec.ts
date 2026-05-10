/**
 * E2E test for Bug #5995 - Resuming paused break starts next session
 *
 * This test will FAIL if the bug exists and PASS if it's fixed.
 *
 * Bug: When you pause a break from the banner and then resume it,
 * the break gets skipped and the next Pomodoro work session starts.
 *
 * Expected: The break should continue from where it was paused.
 */

import { test, expect } from '../../fixtures/test.fixture';
import { Page } from '@playwright/test';
import { waitForAppReady } from '../../utils/waits';

test.describe('Bug #5995: Resume paused break (CRITICAL BUG TEST)', () => {
  let consoleLogs: string[] = [];

  test.beforeEach(async ({ page }) => {
    // Capture console logs for debugging
    consoleLogs = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (
        text.includes('DEBUG Bug #5995') ||
        text.includes('[a]') ||
        text.includes('FocusMode')
      ) {
        consoleLogs.push(text);
        console.log(`CONSOLE: ${text}`);
      }
    });
  });

  test.afterEach(() => {
    if (consoleLogs.length > 0) {
      console.log('\n========== ALL CONSOLE LOGS ==========');
      consoleLogs.forEach((log) => console.log(log));
      console.log('======================================\n');
    }
  });

  // The break pause/resume buttons are available in the focus-mode-break component.
  // This test verifies that resuming a paused break continues the break instead of
  // starting the next work session (the original bug).
  test('CRITICAL: Resuming paused break should continue break, not start next session', async ({
    page,
    workViewPage,
  }) => {
    // Step 1: Enable the critical setting
    await enableSyncSetting(page);

    // Navigate back to work view
    await page.goto('/');
    await waitForAppReady(page);

    // Step 2: Create and track a task using page objects
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Bug5995CriticalTest');

    // Start tracking the task
    const task = page.locator('task').first();
    await expect(task).toBeVisible();
    await task.hover();
    const playBtn = page.locator('.play-btn.tour-playBtn').first();
    await expect(playBtn).toBeVisible({ timeout: 5000 });
    await playBtn.click();

    // Wait for navigation triggered by task tracking to complete
    await page.waitForURL(/#\/(tag|project)\/.+\/tasks/, { timeout: 10000 });

    // Step 3: Start Pomodoro session
    // Note: With isSyncSessionWithTracking enabled, the focus overlay may auto-open
    // when we start tracking. Check if it's already open before clicking the button.
    const focusOverlay = page.locator('focus-mode-overlay');
    const isOverlayAlreadyOpen = await focusOverlay.isVisible().catch(() => false);

    if (!isOverlayAlreadyOpen) {
      const focusButton = page
        .getByRole('button')
        .filter({ hasText: 'center_focus_strong' });
      await focusButton.click();
      await page.waitForTimeout(500);
    }

    // Ensure overlay is visible
    await expect(focusOverlay).toBeVisible({ timeout: 5000 });

    const pomodoroButton = page.locator(
      'segmented-button-group button:has-text("Pomodoro")',
    );
    // Check if Pomodoro is already selected
    const isPomodoroActive = await pomodoroButton
      .evaluate((el) => el.classList.contains('is-active'))
      .catch(() => false);

    if (!isPomodoroActive) {
      await pomodoroButton.click();
      await page.waitForTimeout(300);
    }

    const playButton = page.locator('focus-mode-main button.play-button');
    await playButton.click();

    // Wait for session to start
    await page.waitForTimeout(5000);

    // Step 4: Complete session to trigger break
    const completeButton = page.locator('focus-mode-main .complete-session-btn');
    await expect(completeButton).toBeVisible({ timeout: 10000 });
    await completeButton.click();

    // Wait for break to start
    await page.waitForTimeout(2000);

    // Step 5: Verify we're on the break screen
    const breakScreen = page.locator('focus-mode-break');
    await expect(breakScreen).toBeVisible({ timeout: 5000 });
    // The break screen shows "Short break" or "Long break" (lowercase)
    await expect(breakScreen).toContainText('break', { timeout: 2000 });

    console.log('\n=== STEP: About to pause break ===');

    // Step 6: Pause the break using the pause button in focus-mode-break
    const pauseBtn = breakScreen.locator(
      'button.pause-resume-btn mat-icon:has-text("pause")',
    );
    await expect(pauseBtn).toBeVisible({ timeout: 2000 });
    await pauseBtn.click();
    await page.waitForTimeout(1000);

    console.log('\n=== STEP: Break paused, about to resume ===');

    // Step 7: Resume the break - THIS IS WHERE THE BUG HAPPENS
    const resumeBtn = breakScreen.locator(
      'button.pause-resume-btn mat-icon:has-text("play_arrow")',
    );
    await expect(resumeBtn).toBeVisible({ timeout: 2000 });
    await resumeBtn.click();

    // Wait for state to settle
    await page.waitForTimeout(2000);

    console.log('\n=== STEP: Checking result ===');

    // Step 8: CRITICAL ASSERTION
    // The break screen should still be visible (break is continuing)
    // If the bug exists, it will switch to focus-mode-main (work session)
    await expect(breakScreen).toBeVisible({ timeout: 2000 });

    const mainScreen = page.locator('focus-mode-main');
    await expect(mainScreen).not.toBeVisible();

    // Verify the break screen still shows break content
    const breakText = await breakScreen.textContent();
    console.log(`\n>>> BREAK SCREEN TEXT AFTER RESUME: "${breakText}"`);

    const hasBreakText = breakText?.toLowerCase().includes('break');
    console.log(`>>> Has 'break' text: ${hasBreakText}`);

    // THE TEST: Break text should be present
    expect(hasBreakText).toBe(true);
  });
});

const enableSyncSetting = async (page: Page): Promise<void> => {
  console.log('\n=== STEP: Enabling sync setting ===');

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

  // Find and enable the sync toggle
  const syncToggle = page
    .locator('mat-slide-toggle')
    .filter({ hasText: 'Sync focus sessions with time tracking' })
    .first();

  if (await syncToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
    const classes = await syncToggle.getAttribute('class');
    if (!classes?.includes('mat-checked')) {
      console.log('>>> Enabling sync setting...');
      await syncToggle.click();
      await page.waitForTimeout(500);
    } else {
      console.log('>>> Sync setting already enabled');
    }
  } else {
    console.log('>>> Sync setting toggle not found - may already be enabled by default');
  }
};
