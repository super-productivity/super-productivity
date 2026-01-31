/**
 * E2E tests for GitHub issue #6044
 * https://github.com/super-productivity/super-productivity/issues/6044
 *
 * Bug: Long break occurring after session 5 instead of 4
 *
 * Root Cause: Race condition in NgRx effects where autoStartBreakOnSessionComplete$
 * read the cycle value before incrementCycleOnSessionComplete$ had finished updating it.
 *
 * Fix: Changed autoStartBreakOnSessionComplete$ to listen to incrementCycle action
 * instead of completeFocusSession, ensuring the cycle is already incremented when
 * the break type is calculated.
 */

import { test, expect } from '../../fixtures/test.fixture';
import { Page, Locator } from '@playwright/test';
import { WorkViewPage } from '../../pages/work-view.page';

// Helper to open focus mode and select a task
const openFocusModeWithTask = async (
  page: Page,
  workViewPage: WorkViewPage,
  taskName: string,
): Promise<{ focusModeOverlay: Locator; task: Locator }> => {
  const focusModeOverlay = page.locator('focus-mode-overlay');
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

  // Click play button on task to start tracking (using class selector)
  const playButton = page.locator('.play-btn.tour-playBtn').first();
  await playButton.waitFor({ state: 'visible' });
  await playButton.click();

  // Verify task is now being tracked (has isCurrent class)
  await expect(task).toHaveClass(/isCurrent/, { timeout: 5000 });

  // Open focus mode
  await mainFocusButton.click();
  await expect(focusModeOverlay).toBeVisible({ timeout: 5000 });

  return { focusModeOverlay, task };
};

// Helper to select Pomodoro mode
const selectPomodoroMode = async (page: Page): Promise<void> => {
  const pomodoroButton = page.locator('segmented-button-group button', {
    hasText: 'Pomodoro',
  });
  await pomodoroButton.click();
  await expect(pomodoroButton).toHaveClass(/is-active/, { timeout: 2000 });
};

// Helper to start a focus session and wait for in-progress state
const startFocusSession = async (page: Page): Promise<void> => {
  const playButton = page.locator('focus-mode-main button.play-button');
  await expect(playButton).toBeVisible({ timeout: 2000 });
  await playButton.click();

  // Wait for countdown component to disappear if it appears
  const countdownComponent = page.locator('focus-mode-countdown');
  try {
    const isVisible = await countdownComponent.isVisible().catch(() => false);
    if (isVisible) {
      await expect(countdownComponent).not.toBeVisible({ timeout: 15000 });
    }
  } catch {
    // Countdown may be skipped in settings
  }

  // Wait for session to be in progress by checking for the complete-session-btn
  // This button only shows when mainState === FocusMainUIState.InProgress
  const completeSessionBtn = page.locator('focus-mode-main .complete-session-btn');
  await expect(completeSessionBtn).toBeVisible({ timeout: 10000 });
};

// Helper to complete a session
const completeSession = async (page: Page): Promise<void> => {
  const completeSessionBtn = page.locator('focus-mode-main .complete-session-btn');
  await expect(completeSessionBtn).toBeVisible({ timeout: 5000 });
  await completeSessionBtn.click();

  // Wait for the break screen to appear (auto-start is enabled in Pomodoro mode)
  const breakScreen = page.locator('focus-mode-break');
  await expect(breakScreen).toBeVisible({ timeout: 5000 });
};

// Helper to check if we're on a break screen and what type
const getBreakType = async (page: Page): Promise<'short' | 'long' | null> => {
  const breakScreen = page.locator('focus-mode-break');
  const isBreakVisible = await breakScreen.isVisible().catch(() => false);

  if (!isBreakVisible) {
    return null;
  }

  const breakText = await breakScreen.textContent();

  // Check for long break indicators
  if (breakText?.toLowerCase().includes('long break')) {
    return 'long';
  }

  // Check for short break indicators
  if (breakText?.toLowerCase().includes('short break')) {
    return 'short';
  }

  // If no explicit text, check the heading text
  const heading = breakScreen.locator('h1, h2, .heading').first();
  const headingText = await heading.textContent().catch(() => '');

  if (headingText?.toLowerCase().includes('long')) {
    return 'long';
  }

  // Default to short break if we're on a break screen but can't determine type
  return 'short';
};

// Helper to skip a break and start next session
const skipBreakAndStartNextSession = async (page: Page): Promise<void> => {
  const breakScreen = page.locator('focus-mode-break');
  await expect(breakScreen).toBeVisible({ timeout: 5000 });

  // Look for skip button (might be labeled differently)
  const skipButton = page.locator('focus-mode-break button', {
    hasText: /skip|start/i,
  });

  // If there's a skip button, click it
  const hasSkipButton = await skipButton.count();
  if (hasSkipButton > 0) {
    await skipButton.first().click();
  } else {
    // Otherwise, look for any primary action button on the break screen
    const primaryButton = page.locator('focus-mode-break button.mat-primary').first();
    await primaryButton.click();
  }

  // Wait for session to start
  await expect(breakScreen).not.toBeVisible({ timeout: 5000 });
  const completeSessionBtn = page.locator('focus-mode-main .complete-session-btn');
  await expect(completeSessionBtn).toBeVisible({ timeout: 10000 });
};

test.describe('Bug #6044: Pomodoro break timing', () => {
  test.describe('Long break timing fix', () => {
    test('should show long break after completing 4th session (cycle becomes 5)', async ({
      page,
      testPrefix,
    }) => {
      const workViewPage = new WorkViewPage(page, testPrefix);
      await openFocusModeWithTask(page, workViewPage, 'BreakTimingTest');
      await selectPomodoroMode(page);

      // Session 1
      await startFocusSession(page);
      await completeSession(page);

      // Should get a break (short)
      let breakType = await getBreakType(page);
      expect(breakType).not.toBeNull();
      if (breakType === 'short') {
        console.log('✓ Session 1 → Short break (correct)');
      }
      await skipBreakAndStartNextSession(page);

      // Session 2
      await completeSession(page);

      // Should get a break (short)
      breakType = await getBreakType(page);
      expect(breakType).not.toBeNull();
      if (breakType === 'short') {
        console.log('✓ Session 2 → Short break (correct)');
      }
      await skipBreakAndStartNextSession(page);

      // Session 3
      await completeSession(page);

      // Should get a break (short)
      breakType = await getBreakType(page);
      expect(breakType).not.toBeNull();
      if (breakType === 'short') {
        console.log('✓ Session 3 → Short break (correct)');
      }
      await skipBreakAndStartNextSession(page);

      // Session 4 - CRITICAL TEST: After session 4, cycle becomes 5,
      // We decrement cycle by 1 to get last cycle
      await completeSession(page);

      // Wait for break screen
      const breakScreen = page.locator('focus-mode-break');
      await expect(breakScreen).toBeVisible({ timeout: 5000 });

      // Verify it's a LONG break (cycle is now 5, and 5 - 1 % 4 === 0)
      breakType = await getBreakType(page);
      expect(breakType).toBe('long');
      console.log('✓ Session 4 → LONG break (correct - bug #6044 fixed!)');

      // Take a screenshot for verification
      await page.screenshot({
        path: 'e2e/screenshots/bug-6044-long-break-after-session-4.png',
      });
    });

    test('should show short break after completing 5th session (cycle becomes 6)', async ({
      page,
      testPrefix,
    }) => {
      const workViewPage = new WorkViewPage(page, testPrefix);
      await openFocusModeWithTask(page, workViewPage, 'Session4BreakTest');
      await selectPomodoroMode(page);

      // Complete sessions 1-4, skipping breaks
      for (let i = 1; i <= 4; i++) {
        if (i > 1) {
          await skipBreakAndStartNextSession(page);
        } else {
          await startFocusSession(page);
        }
        await completeSession(page);
        console.log(`✓ Completed session ${i}`);
      }

      // After session 4, cycle = 5, we should get a LONG break
      let breakType = await getBreakType(page);
      expect(breakType).toBe('long');
      console.log('✓ Session 4 → Long break (cycle=5)');

      // Skip the long break and start session 5
      await skipBreakAndStartNextSession(page);

      // Session 5 - After completion, cycle becomes 6, should trigger SHORT break
      await completeSession(page);

      // Wait for break screen
      const breakScreen = page.locator('focus-mode-break');
      await expect(breakScreen).toBeVisible({ timeout: 5000 });

      // Verify it's a SHORT break (cycle=6, 6 - 1 % 4 !== 0)
      breakType = await getBreakType(page);
      expect(breakType).toBe('short');
      console.log('✓ Session 5 → Short break (correct - bug #6044 fixed!)');

      // Take a screenshot for verification
      await page.screenshot({
        path: 'e2e/screenshots/bug-6044-short-break-after-session-5.png',
      });
    });

    test('should show long breaks after sessions 4 and 8 (cycles 5 and 9)', async ({
      page,
      testPrefix,
    }) => {
      const workViewPage = new WorkViewPage(page, testPrefix);
      await openFocusModeWithTask(page, workViewPage, 'Session7BreakTest');
      await selectPomodoroMode(page);

      // Complete sessions 1-7 quickly
      for (let i = 1; i <= 8; i++) {
        if (i > 1) {
          await skipBreakAndStartNextSession(page);
        } else {
          await startFocusSession(page);
        }
        await completeSession(page);

        // Check break type after sessions 4 and 8 (when cycle becomes 5 and 9)
        if (i === 4 || i === 8) {
          const breakType = await getBreakType(page);
          expect(breakType).toBe('long');
          console.log(`✓ Session ${i} → LONG break (cycle=${i + 1})`);
        }
      }

      // Take a screenshot for verification
      await page.screenshot({
        path: 'e2e/screenshots/bug-6044-long-break-after-session-8.png',
      });
    });
  });

  test.describe('Break cycle pattern verification', () => {
    test('should follow correct pattern: S S S L S S S L S', async ({
      page,
      testPrefix,
    }) => {
      const workViewPage = new WorkViewPage(page, testPrefix);
      await openFocusModeWithTask(page, workViewPage, 'BreakPatternTest');
      await selectPomodoroMode(page);

      // Correct pattern: Long break when cycle - 1 % 4 === 0
      // Session 1 → cycle 2 → short
      // Session 2 → cycle 3 → short
      // Session 3 → cycle 4 → short
      // Session 4 → cycle 5 → LONG (5 - 1 % 4 === 0)
      // Session 5 → cycle 6 → short
      // Session 6 → cycle 7 → short
      // Session 7 → cycle 8 → LONG (8 - 1 % 4 === 0)
      // Session 8 → cycle 9 → short
      const expectedPattern = [
        'short', // Session 1
        'short', // Session 2
        'short', //Session 3
        'long', // Session 4
        'short', // Session 5
        'short', // Session 6
        'short', // Session 7
        'long', // Session 8
        'short', // Session 9
      ];
      const actualPattern: string[] = [];

      for (let i = 1; i <= 9; i++) {
        if (i > 1) {
          await skipBreakAndStartNextSession(page);
        } else {
          await startFocusSession(page);
        }

        await completeSession(page);

        const breakType = await getBreakType(page);
        expect(breakType).not.toBeNull();
        actualPattern.push(breakType as string);

        console.log(`Session ${i} → ${breakType} break (cycle=${i + 1})`);
      }

      // Verify the entire pattern matches expectations
      expect(actualPattern).toEqual(expectedPattern);
      console.log('✓ Break pattern is correct: S S S L S S S L S');
    });
  });
});
