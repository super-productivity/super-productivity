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

  test('CRITICAL: Resuming paused break should continue break, not start next session', async ({
    page,
    workViewPage,
    testPrefix,
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
    const focusButton = page
      .getByRole('button')
      .filter({ hasText: 'center_focus_strong' });
    await focusButton.click();
    await page.waitForTimeout(500);

    const pomodoroButton = page.locator(
      'segmented-button-group button:has-text("Pomodoro")',
    );
    await pomodoroButton.click();
    await page.waitForTimeout(300);

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

    // Step 5: Close overlay to show banner
    const closeButton = page.locator('focus-mode-overlay button.close-btn');
    await closeButton.click();
    await page.waitForTimeout(500);

    // Verify banner is visible with break running
    const banner = page.locator('banner');
    await expect(banner).toBeVisible({ timeout: 3000 });
    await expect(banner).toContainText('Break', { timeout: 2000 });

    console.log('\n=== STEP: About to pause break ===');

    // Step 6: Pause the break
    const pauseBtn = banner.getByRole('button', { name: 'Pause' });
    await expect(pauseBtn).toBeVisible({ timeout: 2000 });
    await pauseBtn.click();
    await page.waitForTimeout(1000);

    console.log('\n=== STEP: Break paused, about to resume ===');

    // Step 7: Resume the break - THIS IS WHERE THE BUG HAPPENS
    const resumeBtn = banner.getByRole('button', { name: 'Resume' });
    await expect(resumeBtn).toBeVisible({ timeout: 2000 });
    await resumeBtn.click();

    // Wait for state to settle
    await page.waitForTimeout(2000);

    console.log('\n=== STEP: Checking result ===');

    // Step 8: CRITICAL ASSERTION
    // The banner should still show "Break" text (break is continuing)
    // If the bug exists, it will show work session text instead
    const bannerText = await banner.textContent();
    console.log(`\n>>> BANNER TEXT AFTER RESUME: "${bannerText}"`);

    // Check what's in the banner
    const hasBreakText = bannerText?.includes('Break');
    const hasSessionText =
      bannerText?.includes('Session') || bannerText?.includes('Pomodoro');

    console.log(`>>> Has 'Break' text: ${hasBreakText}`);
    console.log(`>>> Has 'Session' text: ${hasSessionText}`);

    // THE TEST: Break text should be present, session text should not
    expect(hasBreakText).toBe(true);
    expect(hasSessionText).toBe(false);

    // Additional verification: Open overlay and check we're on break screen
    await banner.getByRole('button', { name: /focus overlay/i }).click();
    await page.waitForTimeout(500);

    const breakScreen = page.locator('focus-mode-break');
    const mainScreen = page.locator('focus-mode-main');

    await expect(breakScreen).toBeVisible({ timeout: 2000 });
    await expect(mainScreen).not.toBeVisible();
  });
});

const enableSyncSetting = async (page: Page): Promise<void> => {
  console.log('\n=== STEP: Enabling sync setting ===');

  await page.goto('/#/config');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForURL(/\/#\/config/, { timeout: 10000 });

  // Navigate to Productivity tab
  const tabs = page.locator('[role="tab"]');
  const productivityTab = tabs.filter({ hasText: /Productivity/i });

  if ((await productivityTab.count()) > 0) {
    await productivityTab.click();
    await page.waitForTimeout(500);
  }

  // Find Focus Mode section
  const sections = page.locator('config-section');
  const focusModeSection = sections.filter({ hasText: 'Focus Mode' }).first();

  // Try to expand it
  const header = focusModeSection.locator('.section-header, h2, h3').first();
  if (await header.isVisible({ timeout: 2000 }).catch(() => false)) {
    await header.click();
    await page.waitForTimeout(500);
  }

  // Find and enable the sync toggle
  const syncText = 'Sync focus sessions with time tracking';
  const toggles = page.locator('mat-slide-toggle');
  const syncToggle = toggles.filter({ hasText: syncText }).first();

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
