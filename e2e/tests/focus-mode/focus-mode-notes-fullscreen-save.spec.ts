import { test, expect } from '../../fixtures/test.fixture';
import { WorkViewPage } from '../../pages/work-view.page';
import { cssSelectors } from '../../constants/selectors';

/**
 * Repro for the Reddit report: notes written in focus mode's fullscreen
 * markdown editor vanish after clicking "Save".
 *
 * The fullscreen markdown dialog is a detached CDK overlay; it routes its
 * result back through the originating <inline-markdown> component's `changed`
 * output. When a focus session ends WHILE the dialog is open, the focus-mode
 * overlay swaps screens (Main → SessionDone) and destroys the <inline-markdown>
 * that opened the dialog. On Save, `changed` then emits into a dead listener
 * and the note is silently dropped — the data-loss the user reported.
 *
 * Test 1 guards the normal path (session still running). Test 2 reproduces the
 * actual bug: the session completes mid-edit.
 */
test.describe('Focus Mode - fullscreen notes save', () => {
  const NOTE_TEXT = 'My long plan list from focus mode';

  const startSessionInProgress = async (
    page: import('@playwright/test').Page,
    workViewPage: WorkViewPage,
    mode?: 'Pomodoro',
  ): Promise<void> => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Focus note task sd:today');

    const firstTask = page.locator('task').first();
    await expect(firstTask).toBeVisible();

    // Track the task so the focus-mode play button is enabled.
    await firstTask.hover();
    const taskPlayBtn = page.locator('.play-btn.tour-playBtn').first();
    await taskPlayBtn.waitFor({ state: 'visible' });
    await taskPlayBtn.click();
    await expect(firstTask).toHaveClass(/isCurrent/, { timeout: 5000 });

    const mainFocusButton = page
      .getByRole('button')
      .filter({ hasText: 'center_focus_strong' });
    await mainFocusButton.click();

    if (mode) {
      const modeButton = page.locator('focus-mode-main segmented-button-group button', {
        hasText: mode,
      });
      await modeButton.click();
    }

    const playButton = page.locator('focus-mode-main button.play-button');
    await expect(playButton).toBeVisible({ timeout: 5000 });
    await playButton.click();

    // Countdown animation runs, then the session is InProgress.
    await expect(page.locator('focus-mode-countdown')).not.toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator('focus-mode-main button.complete-session-btn')).toBeVisible(
      { timeout: 20000 },
    );
  };

  test('persists a note saved from the fullscreen editor', async ({
    page,
    testPrefix,
    taskPage,
  }) => {
    const workViewPage = new WorkViewPage(page, testPrefix);
    await startSessionInProgress(page, workViewPage);

    // Open the notes panel.
    await page.locator('focus-mode-main .show-additional-info-btn').click();
    const notesPanel = page.locator('focus-mode-main .notes-panel');
    await expect(notesPanel).toBeVisible();

    // Open the fullscreen markdown editor (the only UI with a Save button).
    await notesPanel.locator('button', { hasText: 'fullscreen' }).click();
    const dialog = page.locator('dialog-fullscreen-markdown');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Write the note and Save.
    const textarea = dialog.locator('textarea');
    await textarea.click();
    await textarea.fill(NOTE_TEXT);
    await page.locator('#T-save-note').click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Ground truth: the note must be persisted on the task. Hide the focus
    // overlay (keeps the session running) and read the task's real notes from
    // the work-view detail panel.
    await page.locator('focus-mode-overlay .close-btn').click();
    await expect(page.locator('focus-mode-overlay')).not.toBeVisible({
      timeout: 5000,
    });

    const task = taskPage.getTaskByText('Focus note task');
    await taskPage.openTaskDetail(task);
    await expect(page.locator(cssSelectors.DETAIL_PANEL)).toContainText(NOTE_TEXT, {
      timeout: 5000,
    });
  });

  // The real bug: while the fullscreen editor is open the focus session
  // auto-completes, the focus-mode overlay swaps screens and destroys the
  // editor, and Save must still persist the note. Shared by the Countdown and
  // Pomodoro variants (the two modes whose timer auto-completes; Flowtime never
  // does). Slow (~1min) because there is no sub-minute UI duration: we shrink
  // the timer to ~1 min and let it elapse with the dialog open.
  const expectNoteSurvivesMidEditCompletion = async (
    page: import('@playwright/test').Page,
    taskPage: import('../../pages/task.page').TaskPage,
    workViewPage: WorkViewPage,
    mode?: 'Pomodoro',
  ): Promise<void> => {
    await startSessionInProgress(page, workViewPage, mode);

    // Shrink the timer to ~1 min (default is 25 min, the time-adjust button
    // removes 1 min each) so it completes on its own shortly.
    const decreaseBtn = page.locator('focus-mode-main .time-adjust-btn--decrease');
    await expect(decreaseBtn).toBeVisible();
    for (let i = 0; i < 24; i++) {
      await decreaseBtn.click();
    }

    // Open notes → fullscreen → start writing.
    await page.locator('focus-mode-main .show-additional-info-btn').click();
    const notesPanel = page.locator('focus-mode-main .notes-panel');
    await expect(notesPanel).toBeVisible();
    await notesPanel.locator('button', { hasText: 'fullscreen' }).click();
    const dialog = page.locator('dialog-fullscreen-markdown');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    const textarea = dialog.locator('textarea');
    await textarea.click();
    await textarea.fill(NOTE_TEXT);

    // While we keep the dialog open, the focus session auto-completes: the
    // in-progress complete-session button detaches once it leaves InProgress.
    await expect(
      page.locator('focus-mode-main button.complete-session-btn'),
    ).not.toBeAttached({ timeout: 90000 });

    // Now save the long note.
    await page.locator('#T-save-note').click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // The note must be persisted on the task even though the session ended
    // mid-edit. Read the task's real notes from the detail panel.
    await page.locator('focus-mode-overlay .close-btn').click();
    await expect(page.locator('focus-mode-overlay')).not.toBeVisible({
      timeout: 5000,
    });
    const task = taskPage.getTaskByText('Focus note task');
    await taskPage.openTaskDetail(task);
    await expect(page.locator(cssSelectors.DETAIL_PANEL)).toContainText(NOTE_TEXT, {
      timeout: 5000,
    });
  };

  test('persists a note when a Countdown session completes while the fullscreen editor is open', async ({
    page,
    testPrefix,
    taskPage,
  }) => {
    test.setTimeout(120000);
    const workViewPage = new WorkViewPage(page, testPrefix);
    await expectNoteSurvivesMidEditCompletion(page, taskPage, workViewPage);
  });

  test('persists a note when a Pomodoro session completes while the fullscreen editor is open', async ({
    page,
    testPrefix,
    taskPage,
  }) => {
    test.setTimeout(120000);
    const workViewPage = new WorkViewPage(page, testPrefix);
    await expectNoteSurvivesMidEditCompletion(page, taskPage, workViewPage, 'Pomodoro');
  });
});
