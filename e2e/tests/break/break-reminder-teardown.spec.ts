import { expect, test } from '../../fixtures/test.fixture';
import type { Page } from '@playwright/test';

/**
 * The break reminder's teardown used to hang off `_triggerReset$` only, while
 * focus-mode breaks zeroed the counter through `otherNoBreakTIme$` and never
 * reached it — so taking a break left the "you have been working for X" banner
 * on screen (and, on Electron, left the lock-screen / fullscreen-blocker
 * subjects latched at `true` for the rest of the session).
 *
 * The sibling spec in this folder only exercises settings navigation; its own
 * header notes that timing tests "would require waiting for real time". The
 * store bridge removes that constraint — the reminder threshold is shrunk to a
 * couple of seconds so the real banner can be driven end to end.
 *
 * See #9305.
 */

const dispatch = async (page: Page, action: Record<string, unknown>): Promise<void> => {
  await expect
    .poll(
      () =>
        page.evaluate((a) => {
          const store = (
            window as unknown as {
              __e2eTestHelpers?: { store?: { dispatch: (a: unknown) => void } };
            }
          ).__e2eTestHelpers?.store;
          if (!store) return false;
          store.dispatch(a);
          return true;
        }, action),
      { timeout: 10000 },
    )
    .toBe(true);
};

test.describe('Break reminder teardown', () => {
  test('dismisses the reminder banner when a focus-mode break starts', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();

    // remind after 2s of tracked work rather than the default hour
    await dispatch(page, {
      type: '[Global Config] Update Global Config Section',
      sectionKey: 'takeABreak',
      sectionCfg: { isTakeABreakEnabled: true, takeABreakMinWorkingTime: 2000 },
      isSkipSnack: true,
    });

    await workViewPage.addTask('Break reminder task');
    const task = taskPage.getTaskByText('Break reminder task');
    await expect(task).toBeVisible();
    const taskId = await task.getAttribute('data-task-id');
    expect(taskId).toBeTruthy();

    // start tracking via the store rather than the UI affordance: the play
    // control lives behind a hover/context menu and is not what is under test
    await dispatch(page, { type: '[Task] SetCurrentTask', id: taskId });

    // NOTE: assert on DOM presence, not visibility. `startBreak` opens the
    // focus-mode overlay, which would hide the banner without dismissing it —
    // a visibility assertion would pass for the wrong reason.
    const reminder = page.locator('banner mat-icon', { hasText: 'free_breakfast' });
    await expect(reminder).toHaveCount(1, { timeout: 20000 });

    // the reset path that used to zero the counter without tearing down the reminder
    await dispatch(page, { type: '[FocusMode] Start Break' });

    await expect(reminder).toHaveCount(0, { timeout: 10000 });
  });
});
