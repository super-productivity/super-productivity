import { expect, test } from '../../fixtures/test.fixture';
import { type Page } from '@playwright/test';

/**
 * "Start focus session" in a task's context menu starts the session right away
 * (no setup screen), tracks the task, and caps a countdown to the task's
 * remaining estimate without overwriting the user's usual countdown length.
 */

const MINUTE = 60 * 1000;

type ObservedState = {
  focusMode: { timer: { isRunning: boolean; purpose: string | null; duration: number } };
  tasks: { currentTaskId: string | null };
};
type HelperWindow = Window & {
  __e2eTestHelpers: {
    store: {
      subscribe: (cb: (state: ObservedState) => void) => { unsubscribe: () => void };
    };
  };
};

const readSession = async (
  page: Page,
): Promise<{
  isRunning: boolean;
  purpose: string | null;
  duration: number;
  isTracking: boolean;
}> => {
  await page.waitForFunction(
    () => !!(window as unknown as HelperWindow).__e2eTestHelpers,
  );
  return page.evaluate(() => {
    let state!: ObservedState;
    (window as unknown as HelperWindow).__e2eTestHelpers.store
      .subscribe((value) => (state = value))
      .unsubscribe();
    const { isRunning, purpose, duration } = state.focusMode.timer;
    return { isRunning, purpose, duration, isTracking: !!state.tasks.currentTaskId };
  });
};

test('context menu starts a countdown capped to the task estimate', async ({
  page,
  workViewPage,
}) => {
  const task = page.locator('task').first();
  const overlay = page.locator('focus-mode-overlay');

  await workViewPage.waitForTaskList();
  await workViewPage.addTask('QuickFocus 10m');
  await expect(task).toBeVisible();

  await task.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Start Focus Session' }).click();

  // the overlay opens on the running session, not the setup screen
  await expect(overlay.getByRole('button', { name: 'Pause session' })).toBeVisible();
  await expect
    .poll(() => readSession(page))
    .toEqual({
      isRunning: true,
      purpose: 'work',
      duration: 10 * MINUTE,
      isTracking: true,
    });

  // the capped length must not become the usual countdown
  const storedCountdown = await page.evaluate(() =>
    localStorage.getItem('LAST_COUNTDOWN_DURATION'),
  );
  expect(storedCountdown).not.toBe(String(10 * MINUTE));
});
