import { expect, test } from '../../fixtures/test.fixture';
import { type Page } from '@playwright/test';

/**
 * Start plays a short rocket launch before the session begins. Pressing Escape
 * (or the close button) during that launch used to hide the overlay and drop
 * the session, so nothing was running or tracked afterwards.
 */

type ObservedState = {
  focusMode: { timer: { isRunning: boolean; purpose: string | null } };
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
): Promise<{ isRunning: boolean; purpose: string | null; isTracking: boolean }> => {
  await page.waitForFunction(
    () => !!(window as unknown as HelperWindow).__e2eTestHelpers,
  );
  return page.evaluate(() => {
    let state!: ObservedState;
    (window as unknown as HelperWindow).__e2eTestHelpers.store
      .subscribe((value) => (state = value))
      .unsubscribe();
    const { isRunning, purpose } = state.focusMode.timer;
    return { isRunning, purpose, isTracking: !!state.tasks.currentTaskId };
  });
};

test('Escape during the start launch keeps the focus session', async ({
  page,
  workViewPage,
}) => {
  const overlay = page.locator('focus-mode-overlay');

  await workViewPage.waitForTaskList();
  await workViewPage.addTask('EscapeLaunch');

  await page.locator('focus-button button').click();
  await overlay.locator('.select-task-cta').click();
  await page.locator('focus-mode-task-selector input').fill('EscapeLaunch');
  await page.locator('mat-option').filter({ hasText: 'EscapeLaunch' }).first().click();
  await expect(page.locator('focus-mode-task-selector')).toHaveCount(0);

  await overlay.locator('.play-button').click();
  await page.keyboard.press('Escape');

  await expect(overlay).toHaveCount(0);
  await expect
    .poll(() => readSession(page))
    .toEqual({ isRunning: true, purpose: 'work', isTracking: true });
  await expect(page.locator('focus-button .focus-running-label')).toBeVisible();
});
