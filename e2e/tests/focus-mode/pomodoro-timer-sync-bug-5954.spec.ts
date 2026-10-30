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
import { Page } from '@playwright/test';
import { WorkViewPage } from '../../pages/work-view.page';
import { waitForAngularStability } from '../../utils/waits';

// Helper to select Pomodoro mode
const selectPomodoroMode = async (page: Page): Promise<void> => {
  const pomodoroButton = page.locator('segmented-button-group button', {
    hasText: 'Pomodoro',
  });
  await pomodoroButton.click();
  await expect(pomodoroButton).toHaveClass(/is-active/, { timeout: 2000 });
};

test.describe('Bug #5954: Pomodoro timer sync issues', () => {
  test.describe('No valid task available (Bug #5954 comment)', () => {
    /**
     * Tests for the scenario where user starts focus mode but all tasks are done.
     * The fix ensures the focus overlay appears so user can select/create a task.
     * https://github.com/super-productivity/super-productivity/issues/5954#issuecomment-3753395324
     */
    test('should keep overlay visible and disable play button when all tasks done', async ({
      page,
      testPrefix,
      taskPage,
    }) => {
      const workViewPage = new WorkViewPage(page, testPrefix);
      const focusModeOverlay = page.locator('focus-mode-overlay');
      const mainFocusButton = page
        .getByRole('button')
        .filter({ hasText: 'center_focus_strong' });

      // Navigate to work view
      await page.goto('/');

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

      // Step 3: Select Pomodoro mode
      await selectPomodoroMode(page);

      // Step 4: Verify the overlay remains visible (fix for bug #5954) and
      // the play button is disabled because no task is tracked. Focus mode
      // now requires a current task — the user is prompted to pick one.
      await expect(focusModeOverlay).toBeVisible({ timeout: 5000 });

      const playButton = page.locator('focus-mode-main button.play-button');
      await expect(playButton).toBeVisible({ timeout: 2000 });
      await expect(playButton).toBeDisabled();

      // The "select task to focus" placeholder gives the user a way out.
      const taskPlaceholder = page.locator('focus-mode-main .task-title-placeholder');
      await expect(taskPlaceholder).toBeVisible({ timeout: 2000 });
    });

    test('should keep overlay visible and disable play button when last tracked task was completed', async ({
      page,
      testPrefix,
    }) => {
      const workViewPage = new WorkViewPage(page, testPrefix);
      const focusModeOverlay = page.locator('focus-mode-overlay');
      const mainFocusButton = page
        .getByRole('button')
        .filter({ hasText: 'center_focus_strong' });

      // Navigate to work view
      await page.goto('/');

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

      // Wait for navigation triggered by task tracking to complete
      await page.waitForURL(/#\/(tag|project)\/.+\/tasks/, { timeout: 10000 });
      await page.waitForTimeout(1000);

      // Wait for task list to be visible
      await workViewPage.waitForTaskList();

      // Re-locate the task after navigation
      const trackedTask = page.locator('task').first();
      await expect(trackedTask).toBeVisible({ timeout: 5000 });
      await expect(trackedTask).toHaveClass(/isCurrent/, { timeout: 5000 });

      // Wait for Angular to finish re-rendering the task hover controls
      // When isCurrent changes, the hover controls switch from play to pause button
      await waitForAngularStability(page);

      // Step 2: Mark task as done using keyboard shortcut
      // This bypasses the button click issue caused by continuous re-renders
      // from the progress bar while tracking is active
      await trackedTask.focus();
      await page.keyboard.press('d'); // Keyboard shortcut for toggle done
      await expect(trackedTask).toHaveClass(/isDone/, { timeout: 5000 });
      await expect(trackedTask).not.toHaveClass(/isCurrent/, { timeout: 5000 });

      // Step 3: Open focus mode
      await mainFocusButton.click();
      await expect(focusModeOverlay).toBeVisible({ timeout: 5000 });

      await selectPomodoroMode(page);

      // Step 4: Verify overlay stays visible (fix for bug #5954) and the
      // play button is disabled because no task is current. Focus mode
      // requires a current task — the user is prompted to pick one.
      await expect(focusModeOverlay).toBeVisible({ timeout: 5000 });

      const sessionPlayButton = page.locator('focus-mode-main button.play-button');
      await expect(sessionPlayButton).toBeVisible({ timeout: 2000 });
      await expect(sessionPlayButton).toBeDisabled();

      const taskPlaceholder = page.locator('focus-mode-main .task-title-placeholder');
      await expect(taskPlaceholder).toBeVisible({ timeout: 2000 });
    });
  });
});
