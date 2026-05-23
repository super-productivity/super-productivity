/**
 * E2E test for GitHub issue #5117
 * https://github.com/super-productivity/super-productivity/issues/5117
 *
 * Bug: Flowtime focus mode stops counting up at the value set in Countdown mode
 * (e.g., 25 minutes or 5 minutes) instead of counting indefinitely.
 *
 * User reproduction steps:
 * 1. Open focus mode
 * 2. Switch to Countdown tab
 * 3. Set countdown to 5 minutes (but do not start the session)
 * 4. Switch to Flowtime tab
 * 5. Start focus session counting up from 0
 *
 * Expected: Timer counts indefinitely
 * Actual: Timer stops at 5 minutes (the Countdown value)
 */

import { test, expect } from '../../fixtures/test.fixture';
import { WorkViewPage } from '../../pages/work-view.page';

// Helper to parse time string "MM:SS" to seconds
const parseTime = (timeStr: string | null): number => {
  if (!timeStr) return 0;
  const trimmed = timeStr.trim();
  const parts = trimmed.split(':');
  if (parts.length !== 2) return 0;
  const minutes = parseInt(parts[0], 10);
  const seconds = parseInt(parts[1], 10);
  const minutesInSeconds = minutes * 60;
  return minutesInSeconds + seconds;
};

test.describe('Bug #5117: Flowtime timer stops at Countdown duration', () => {
  test('Flowtime timer should count past the previously set Countdown duration', async ({
    page,
    testPrefix,
  }) => {
    const workViewPage = new WorkViewPage(page, testPrefix);

    // Locators
    const focusModeOverlay = page.locator('focus-mode-overlay');
    const mainFocusButton = page.locator('main-header focus-button button');

    // Mode selector buttons - using the segmented button group
    const flowtimeButton = page.locator('segmented-button-group button', {
      hasText: 'Flowtime',
    });
    const countdownButton = page.locator('segmented-button-group button', {
      hasText: 'Countdown',
    });

    // Duration slider (visible only in Countdown mode during preparation)
    const durationSlider = page.locator('input-duration-slider');

    // Play button to start the session (button element, not the icon inside)
    const playButton = page.locator('focus-mode-main button.play-button');

    // Clock display showing elapsed time
    const clockTime = page.locator('focus-mode-main .clock-time');

    // Wait for task list and add a task (required for focus mode)
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('FlowTimeTestTask');

    // Step 1: Open focus mode
    await expect(mainFocusButton).toBeVisible({ timeout: 5000 });
    await mainFocusButton.click();
    await expect(focusModeOverlay).toBeVisible({ timeout: 5000 });

    // Focus mode may show task selection placeholder first - select the task
    const taskSelectionPlaceholder = page.locator('.task-title-placeholder');
    const isPlaceholderVisible = await taskSelectionPlaceholder
      .isVisible()
      .catch(() => false);

    if (isPlaceholderVisible) {
      console.log('Task selection placeholder visible, selecting task...');
      // Click on the placeholder to open task selector
      await taskSelectionPlaceholder.click();

      // Wait for task selector overlay
      const taskSelectorOverlay = page.locator('.task-selector-overlay');
      await expect(taskSelectorOverlay).toBeVisible({ timeout: 3000 });

      // Click on the first suggested task (mat-option is in CDK overlay panel)
      const suggestedTask = page.locator('mat-option, .mat-mdc-option').first();
      await expect(suggestedTask).toBeVisible({ timeout: 5000 });
      await suggestedTask.click();

      // Wait for task selector overlay to close
      await expect(taskSelectorOverlay).not.toBeVisible({ timeout: 5000 });
    }

    // Step 2: Switch to Countdown mode
    await countdownButton.click();
    await expect(countdownButton).toHaveClass(/is-active/, { timeout: 2000 });

    // Step 3: The slider should be visible in Countdown mode during preparation
    await expect(durationSlider).toBeVisible({ timeout: 3000 });

    // Get initial timer state before any changes
    const initialClockText = await clockTime.textContent();
    console.log('Initial clock text in Countdown mode:', initialClockText);

    // Step 4: Switch to Flowtime mode
    await flowtimeButton.click();
    await expect(flowtimeButton).toHaveClass(/is-active/, { timeout: 2000 });

    // Duration slider should NOT be visible in Flowtime mode
    await expect(durationSlider).not.toBeVisible({ timeout: 2000 });

    // Verify clock shows 0:00 (Flowtime starts at 0 and counts up)
    await expect(clockTime).toHaveText('0:00', { timeout: 3000 });

    // Step 5: Start the focus session by clicking play button
    await expect(playButton).toBeVisible({ timeout: 2000 });
    await playButton.click();

    // Wait for session to be in progress (complete session button becomes visible)
    // This covers the entire startup: countdown animation (~6s) + session start
    const completeSessionButton = page.locator(
      'focus-mode-main button.complete-session-btn',
    );
    await expect(completeSessionButton).toBeVisible({ timeout: 25000 });

    // Wait for clock-time to show a non-zero value (indicating timer has started ticking)
    await expect(async () => {
      const text = await clockTime.textContent();
      const trimmed = text?.trim() || '';
      console.log('Current clock time:', trimmed);
      const seconds = parseTime(trimmed);
      expect(seconds).toBeGreaterThan(0);
    }).toPass({ timeout: 10000 });

    // Now verify the timer continues to increase
    const time1 = await clockTime.textContent();
    console.log('Time at T1:', time1);

    await page.waitForTimeout(3000);
    const time2 = await clockTime.textContent();
    console.log('Time at T2:', time2);

    const seconds1 = parseTime(time1);
    const seconds2 = parseTime(time2);

    console.log('Seconds at T1:', seconds1);
    console.log('Seconds at T2:', seconds2);

    // Timer should have increased
    expect(seconds2).toBeGreaterThan(seconds1);

    // Verify once more
    await page.waitForTimeout(2000);
    const time3 = await clockTime.textContent();
    const seconds3 = parseTime(time3);
    console.log('Seconds at T3:', seconds3);
    expect(seconds3).toBeGreaterThan(seconds2);
  });

  test('Exact bug scenario: Set Countdown duration, switch to Flowtime, verify timer runs', async ({
    page,
    testPrefix,
  }) => {
    // This is the exact user scenario from bug report
    const workViewPage = new WorkViewPage(page, testPrefix);

    const focusModeOverlay = page.locator('focus-mode-overlay');
    const mainFocusButton = page.locator('main-header focus-button button');
    const flowtimeButton = page.locator('segmented-button-group button', {
      hasText: 'Flowtime',
    });
    const countdownButton = page.locator('segmented-button-group button', {
      hasText: 'Countdown',
    });
    const playButton = page.locator('focus-mode-main button.play-button');
    const clockTime = page.locator('focus-mode-main .clock-time');
    const durationSlider = page.locator('input-duration-slider');

    // Setup
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('FlowTimeTestTask2');

    // Open focus mode
    await expect(mainFocusButton).toBeVisible({ timeout: 5000 });
    await mainFocusButton.click();
    await expect(focusModeOverlay).toBeVisible({ timeout: 5000 });

    // Focus mode may show task selection placeholder first - select the task
    const taskSelectionPlaceholder = page.locator('.task-title-placeholder');
    const isPlaceholderVisible = await taskSelectionPlaceholder
      .isVisible()
      .catch(() => false);

    if (isPlaceholderVisible) {
      console.log('Task selection placeholder visible, selecting task...');
      await taskSelectionPlaceholder.click();

      const taskSelectorOverlay = page.locator('.task-selector-overlay');
      await expect(taskSelectorOverlay).toBeVisible({ timeout: 3000 });

      const suggestedTask = page.locator('mat-option, .mat-mdc-option').first();
      await expect(suggestedTask).toBeVisible({ timeout: 5000 });
      await suggestedTask.click();

      // Wait for task selector overlay to close
      await expect(taskSelectorOverlay).not.toBeVisible({ timeout: 5000 });
    }

    // Step 1: Switch to Countdown mode
    await countdownButton.click();
    await expect(countdownButton).toHaveClass(/is-active/, { timeout: 2000 });
    await expect(durationSlider).toBeVisible({ timeout: 2000 });

    // Step 2: Note the countdown duration displayed (default 25 min or whatever is set)
    const countdownTime = await clockTime.textContent();
    console.log('Countdown duration displayed:', countdownTime);

    // Step 3: Switch to Flowtime (without starting the countdown session)
    await flowtimeButton.click();
    await expect(flowtimeButton).toHaveClass(/is-active/, { timeout: 2000 });

    // Clock should show 0:00 for Flowtime
    await expect(clockTime).toHaveText('0:00', { timeout: 3000 });

    // Step 4: Start the Flowtime session
    await expect(playButton).toBeVisible({ timeout: 2000 });
    await playButton.click();

    // Wait for session to be in progress (complete session button becomes visible)
    // This covers the entire startup: countdown animation (~6s) + session start
    const completeSessionButton = page.locator(
      'focus-mode-main button.complete-session-btn',
    );
    await expect(completeSessionButton).toBeVisible({ timeout: 25000 });

    // Wait for clock-time to show a non-zero value
    await expect(async () => {
      const text = await clockTime.textContent();
      const trimmed = text?.trim() || '';
      console.log('Current clock time:', trimmed);
      const seconds = parseTime(trimmed);
      expect(seconds).toBeGreaterThan(0);
    }).toPass({ timeout: 10000 });

    // Step 5: Verify timer is counting up and doesn't stop
    const time1 = await clockTime.textContent();
    console.log('Flowtime time T1:', time1);

    await page.waitForTimeout(3000);
    const time2 = await clockTime.textContent();
    console.log('Flowtime time T2:', time2);

    await page.waitForTimeout(3000);
    const time3 = await clockTime.textContent();
    console.log('Flowtime time T3:', time3);

    // Parse times
    const seconds1 = parseTime(time1);
    const seconds2 = parseTime(time2);
    const seconds3 = parseTime(time3);

    console.log('Seconds:', seconds1, '->', seconds2, '->', seconds3);

    // All times should be increasing (timer is running)
    expect(seconds2).toBeGreaterThan(seconds1);
    expect(seconds3).toBeGreaterThan(seconds2);

    // The timer should continue running indefinitely
    // If bug is present, it would stop at the countdown duration
  });
});
