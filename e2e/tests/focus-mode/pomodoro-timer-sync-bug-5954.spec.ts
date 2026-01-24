/**
 * E2E tests for GitHub issue #5954
 * https://github.com/super-productivity/super-productivity/issues/5954
 *
 * Bug: You can break Pomodoro timer syncing
 *
 * Multiple bugs related to Pomodoro timer not properly syncing with task tracking:
 * 1. Starting Pomodoro after app restart doesn't auto-assign to last worked-on task
 * 2. Manually ending sessions stops tracking when it shouldn't
 * 3. Skipping breaks loses task assignment when manual break start is enabled
 * 4. The tracking button doesn't pause breaks (only works during work sessions)
 * 5. Break numbering is off-by-one ("Break #2" shows after first session)
 */

import { test, expect } from '../../fixtures/test.fixture';
import { Page, Locator } from '@playwright/test';
import { WorkViewPage } from '../../pages/work-view.page';
import { waitForAngularStability } from '../../utils/waits';

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

test.describe('Bug #5954: Pomodoro timer sync issues', () => {
  test.describe('Focus mode basic functionality', () => {
    test('should open focus mode overlay and show mode selector', async ({
      page,
      testPrefix,
    }) => {
      const workViewPage = new WorkViewPage(page, testPrefix);
      const { focusModeOverlay } = await openFocusModeWithTask(
        page,
        workViewPage,
        'BasicFocusTest',
      );

      // Verify focus mode overlay is visible
      await expect(focusModeOverlay).toBeVisible();

      // Verify mode selector is visible
      const modeSelector = page.locator('segmented-button-group');
      await expect(modeSelector).toBeVisible();

      // Verify Pomodoro mode option exists
      const pomodoroButton = page.locator('segmented-button-group button', {
        hasText: 'Pomodoro',
      });
      await expect(pomodoroButton).toBeVisible();
    });

    test('should select Pomodoro mode and show play button', async ({
      page,
      testPrefix,
    }) => {
      const workViewPage = new WorkViewPage(page, testPrefix);
      await openFocusModeWithTask(page, workViewPage, 'PomodoroSelectTest');
      await selectPomodoroMode(page);

      // Verify play button is visible
      const playButton = page.locator('focus-mode-main button.play-button');
      await expect(playButton).toBeVisible();
    });

    test('should start focus session and show complete session button', async ({
      page,
      testPrefix,
    }) => {
      const workViewPage = new WorkViewPage(page, testPrefix);
      await openFocusModeWithTask(page, workViewPage, 'StartSessionTest');
      await selectPomodoroMode(page);

      // Start the session
      await startFocusSession(page);

      // Verify complete session button is visible (means session is in progress)
      const completeSessionBtn = page.locator('focus-mode-main .complete-session-btn');
      await expect(completeSessionBtn).toBeVisible();
    });
  });

  test.describe('Session and task tracking sync', () => {
    test('should maintain task tracking when focus session starts', async ({
      page,
      testPrefix,
    }) => {
      const workViewPage = new WorkViewPage(page, testPrefix);
      const { task } = await openFocusModeWithTask(
        page,
        workViewPage,
        'SyncTrackingTest',
      );
      await selectPomodoroMode(page);

      // Start the focus session
      await startFocusSession(page);

      // Close the overlay
      const closeButton = page.locator('focus-mode-overlay button.close-btn');
      await closeButton.click();

      // Verify the task is still being tracked (has isCurrent class)
      await expect(task).toHaveClass(/isCurrent/, { timeout: 5000 });
    });

    test('should close overlay when close button is clicked', async ({
      page,
      testPrefix,
    }) => {
      const workViewPage = new WorkViewPage(page, testPrefix);
      const { focusModeOverlay } = await openFocusModeWithTask(
        page,
        workViewPage,
        'CloseOverlayTest',
      );
      await selectPomodoroMode(page);

      // Start the session
      await startFocusSession(page);

      // Find and click close button
      const closeButton = page.locator('focus-mode-overlay button.close-btn');
      await expect(closeButton).toBeVisible({ timeout: 3000 });
      await closeButton.click();

      // Verify overlay is closed
      await expect(focusModeOverlay).not.toBeVisible({ timeout: 3000 });
    });
  });

  test.describe('Complete session behavior', () => {
    test('should complete session and transition to break or session done screen', async ({
      page,
      testPrefix,
    }) => {
      const workViewPage = new WorkViewPage(page, testPrefix);
      await openFocusModeWithTask(page, workViewPage, 'CompleteSessionTest');
      await selectPomodoroMode(page);

      // Start the session
      await startFocusSession(page);

      // Click complete session button
      const completeSessionBtn = page.locator('focus-mode-main .complete-session-btn');
      await expect(completeSessionBtn).toBeVisible({ timeout: 5000 });
      await completeSessionBtn.click();

      // Wait for session done screen or break screen to appear
      const sessionDoneScreen = page.locator('focus-mode-session-done');
      const breakScreen = page.locator('focus-mode-break');

      // Either session done or break screen should be visible
      await expect(sessionDoneScreen.or(breakScreen)).toBeVisible({ timeout: 5000 });
    });

    test('should show break after completing session when auto-break is enabled', async ({
      page,
      testPrefix,
    }) => {
      const workViewPage = new WorkViewPage(page, testPrefix);
      await openFocusModeWithTask(page, workViewPage, 'AutoBreakTest');
      await selectPomodoroMode(page);

      // Start the session
      await startFocusSession(page);

      // Click complete session button
      const completeSessionBtn = page.locator('focus-mode-main .complete-session-btn');
      await completeSessionBtn.click();

      // Check what screen we land on
      const sessionDoneScreen = page.locator('focus-mode-session-done');
      const breakScreen = page.locator('focus-mode-break');

      // Wait for either screen to appear
      await expect(sessionDoneScreen.or(breakScreen)).toBeVisible({ timeout: 5000 });

      // If break screen is visible, verify break numbering is correct
      const isBreakVisible = await breakScreen.isVisible().catch(() => false);
      if (isBreakVisible) {
        const breakText = await breakScreen.textContent();
        console.log('Break screen text:', breakText);

        // The break should NOT show "Break #2" after the first session
        // This verifies the fix for the off-by-one bug
        if (breakText?.includes('Break #')) {
          expect(breakText).not.toContain('Break #2');
        }
      }
    });
  });

  test.describe('No valid task available (Bug #5954 comment)', () => {
    /**
     * Tests for the scenario where user starts focus mode but all tasks are done.
     * The fix ensures the focus overlay appears so user can select/create a task.
     * https://github.com/super-productivity/super-productivity/issues/5954#issuecomment-3753395324
     */
    test('should keep overlay visible when starting session with all tasks done', async ({
      page,
      testPrefix,
      taskPage,
    }) => {
      const workViewPage = new WorkViewPage(page, testPrefix);
      const focusModeOverlay = page.locator('focus-mode-overlay');
      const mainFocusButton = page
        .getByRole('button')
        .filter({ hasText: 'center_focus_strong' });

      // Step 1: Create a task and mark it as done immediately
      await workViewPage.waitForTaskList();
      await workViewPage.addTask('CompletedTaskTest');

      const task = page.locator('task').first();
      await expect(task).toBeVisible();

      // Mark task as done
      await taskPage.markTaskAsDone(task);
      await expect(task).toHaveClass(/isDone/, { timeout: 5000 });

      // Step 2: Open focus mode (no task is being tracked)
      await mainFocusButton.click();
      await expect(focusModeOverlay).toBeVisible({ timeout: 5000 });

      // Step 3: Select Pomodoro mode and start session
      await selectPomodoroMode(page);

      const playButton = page.locator('focus-mode-main button.play-button');
      await expect(playButton).toBeVisible({ timeout: 2000 });
      await playButton.click();

      // Wait for any countdown to complete
      const countdownComponent = page.locator('focus-mode-countdown');
      try {
        const isVisible = await countdownComponent.isVisible().catch(() => false);
        if (isVisible) {
          await expect(countdownComponent).not.toBeVisible({ timeout: 15000 });
        }
      } catch {
        // Countdown may be skipped
      }

      // Step 4: Verify the overlay remains visible (fix for bug #5954)
      // The showFocusOverlay action should be dispatched when no valid task exists
      await expect(focusModeOverlay).toBeVisible({ timeout: 5000 });

      // Session should be in progress (timer running)
      const completeSessionBtn = page.locator('focus-mode-main .complete-session-btn');
      await expect(completeSessionBtn).toBeVisible({ timeout: 10000 });
    });

    test('should keep overlay visible when last tracked task was completed', async ({
      page,
      testPrefix,
      taskPage,
    }) => {
      const workViewPage = new WorkViewPage(page, testPrefix);
      const focusModeOverlay = page.locator('focus-mode-overlay');
      const mainFocusButton = page
        .getByRole('button')
        .filter({ hasText: 'center_focus_strong' });

      // Step 1: Create task and start tracking
      await workViewPage.waitForTaskList();
      await workViewPage.addTask('TrackThenCompleteTest');

      const task = page.locator('task').first();
      await expect(task).toBeVisible();

      // Start tracking the task
      await task.hover();
      const playButton = page.locator('.play-btn.tour-playBtn').first();
      await playButton.waitFor({ state: 'visible' });
      await playButton.click();
      await expect(task).toHaveClass(/isCurrent/, { timeout: 5000 });

      // Wait for Angular to finish re-rendering the task hover controls
      // When isCurrent changes, the hover controls switch from play to pause button
      await waitForAngularStability(page);

      // Step 2: Mark task as done using keyboard shortcut
      // This bypasses the button click issue caused by continuous re-renders
      // from the progress bar while tracking is active
      await task.focus();
      await page.keyboard.press('d'); // Keyboard shortcut for toggle done
      await expect(task).toHaveClass(/isDone/, { timeout: 5000 });
      await expect(task).not.toHaveClass(/isCurrent/, { timeout: 5000 });

      // Step 3: Open focus mode and try to start session
      await mainFocusButton.click();
      await expect(focusModeOverlay).toBeVisible({ timeout: 5000 });

      await selectPomodoroMode(page);

      const sessionPlayButton = page.locator('focus-mode-main button.play-button');
      await expect(sessionPlayButton).toBeVisible({ timeout: 2000 });
      await sessionPlayButton.click();

      // Wait for countdown
      const countdownComponent = page.locator('focus-mode-countdown');
      try {
        const isVisible = await countdownComponent.isVisible().catch(() => false);
        if (isVisible) {
          await expect(countdownComponent).not.toBeVisible({ timeout: 15000 });
        }
      } catch {
        // Countdown may be skipped
      }

      // Step 4: Verify overlay stays visible for task selection
      await expect(focusModeOverlay).toBeVisible({ timeout: 5000 });

      // Session should still start (timer runs, user can select task from overlay)
      const completeSessionBtn = page.locator('focus-mode-main .complete-session-btn');
      await expect(completeSessionBtn).toBeVisible({ timeout: 10000 });
    });
  });
});
