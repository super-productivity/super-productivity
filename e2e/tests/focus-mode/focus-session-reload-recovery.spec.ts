import { type Page } from '@playwright/test';
import { expect, test as base } from '../../fixtures/test.fixture';
import { skipOnboardingForE2E, waitForAppReady } from '../../utils/waits';

/**
 * iOS may kill the backgrounded WebView. The app then starts fresh, and a
 * running Pomodoro used to be lost together with its task tracking. A page
 * reload reproduces the same "WebView recreated with an idle store" situation
 * in the browser; Capacitor's custom-platform hook makes the app treat it as iOS.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const FIVE_MINUTES = 5 * MINUTE;
const SEVEN_MINUTES = 7 * MINUTE;
const POMODORO = 25 * MINUTE;
const TOLERANCE = 15_000;

type ObservedState = {
  tasks: {
    currentTaskId: string | null;
    entities: Record<string, { timeSpent: number }>;
  };
  focusMode: {
    lastCompletedDuration: number;
    timer: { isRunning: boolean; elapsed: number; purpose: string | null };
  };
};
type HelperWindow = Window & {
  __e2eTestHelpers: {
    store: {
      dispatch: (action: { type: string; [key: string]: unknown }) => void;
      subscribe: (cb: (state: ObservedState) => void) => { unsubscribe: () => void };
    };
  };
};

// The fake clock must precede Angular bootstrap so RxJS timers and Date.now()
// share one clock across reloads.
const testOn = (platform: 'ios' | 'web'): typeof base =>
  base.extend({
    page: async ({ isolatedContext }, use) => {
      const page = await isolatedContext.newPage();
      const morning = new Date();
      morning.setHours(10, 0, 0, 0);
      await page.clock.install({ time: morning });
      await page.addInitScript(skipOnboardingForE2E);
      if (platform === 'ios') {
        await page.addInitScript(() => {
          (
            window as unknown as { CapacitorCustomPlatform: { name: string } }
          ).CapacitorCustomPlatform = { name: 'ios' };
        });
      }
      try {
        await page.goto('/');
        await waitForAppReady(page);
        await use(page);
      } finally {
        await page.close();
      }
    },
  });
const test = testOn('ios');
const webTest = testOn('web');

const readState = async (page: Page): Promise<ObservedState> => {
  await page.waitForFunction(
    () => !!(window as unknown as HelperWindow).__e2eTestHelpers,
  );
  return page.evaluate(() => {
    let state!: ObservedState;
    (window as unknown as HelperWindow).__e2eTestHelpers.store
      .subscribe((value) => (state = value))
      .unsubscribe();
    return { tasks: state.tasks, focusMode: state.focusMode };
  });
};

const dispatch = (
  page: Page,
  action: { type: string; [key: string]: unknown },
): Promise<void> =>
  page.evaluate(
    (value) => (window as unknown as HelperWindow).__e2eTestHelpers.store.dispatch(value),
    action,
  );

const startPomodoro = async (page: Page): Promise<string> => {
  await page.waitForFunction(
    () => !!(window as unknown as HelperWindow).__e2eTestHelpers,
  );
  const taskId = Object.keys((await readState(page)).tasks.entities)[0];
  expect(taskId).toBeTruthy();
  await dispatch(page, { type: '[FocusMode] Show Overlay' });
  await page.locator('focus-mode-main').waitFor();
  await dispatch(page, { type: '[FocusMode] Set Mode', mode: 'Pomodoro' });
  await dispatch(page, { type: '[FocusMode] Start Session', duration: POMODORO, taskId });
  await expect.poll(async () => (await readState(page)).tasks.currentTaskId).toBe(taskId);
  return taskId;
};

const reload = async (
  page: Page,
  waitForTaskList: () => Promise<void>,
): Promise<void> => {
  await page.reload();
  await waitForTaskList();
  await page.waitForFunction(
    () => !!(window as unknown as HelperWindow).__e2eTestHelpers,
  );
};

// Leaving the app (pagehide) and returning later models the OS killing it in
// the background, with a deterministic gap before the app boots again.
const reopenAfter = async (
  page: Page,
  awayMs: number,
  waitForTaskList: () => Promise<void>,
): Promise<void> => {
  await page.goto('about:blank');
  await page.clock.fastForward(awayMs);
  await page.goto('/');
  await waitForTaskList();
};

test.describe('Focus session recovery after the WebView is recreated', () => {
  test('a running Pomodoro keeps counting and keeps tracking its task', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Pomodoro survives reload');
    const taskId = await startPomodoro(page);
    await page.clock.fastForward(5 * MINUTE);

    await reload(page, () => workViewPage.waitForTaskList());
    await page.clock.fastForward(2 * MINUTE);

    await expect
      .poll(async () => (await readState(page)).focusMode.timer.isRunning)
      .toBe(true);
    const restored = await readState(page);
    expect(restored.focusMode.timer.purpose).toBe('work');
    expect(Math.abs(restored.focusMode.timer.elapsed - SEVEN_MINUTES)).toBeLessThan(
      TOLERANCE,
    );
    expect(restored.tasks.currentTaskId).toBe(taskId);

    const timeBefore = restored.tasks.entities[taskId].timeSpent;
    await page.clock.fastForward(5 * MINUTE);
    await expect
      .poll(async () => (await readState(page)).tasks.entities[taskId].timeSpent)
      .toBeGreaterThanOrEqual(timeBefore + FIVE_MINUTES - TOLERANCE);
  });

  test('a Pomodoro that ended while the app was gone completes', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Pomodoro ends while away');
    await startPomodoro(page);
    await page.clock.fastForward(5 * MINUTE);
    // The app was gone for longer than the remaining 20 minutes.
    await reopenAfter(page, 30 * MINUTE, () => workViewPage.waitForTaskList());

    await expect
      .poll(async () => (await readState(page)).focusMode.lastCompletedDuration)
      .toBeGreaterThanOrEqual(POMODORO - TOLERANCE);
    // The session lasted 25 minutes, not the 35 minutes since it started.
    expect((await readState(page)).focusMode.lastCompletedDuration).toBeLessThan(
      POMODORO + TOLERANCE,
    );
    expect((await readState(page)).focusMode.timer.purpose).not.toBe('work');
  });

  test('a session abandoned for hours is not restored', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Pomodoro abandoned');
    await startPomodoro(page);
    await dispatch(page, { type: '[FocusMode] Pause Session' });
    await reopenAfter(page, 5 * HOUR, () => workViewPage.waitForTaskList());
    await page.clock.fastForward(MINUTE);

    expect((await readState(page)).focusMode.timer.purpose).toBeNull();
  });

  test('a cancelled session stays cancelled after reload', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Pomodoro cancelled');
    await startPomodoro(page);
    await page.clock.fastForward(MINUTE);
    await dispatch(page, { type: '[FocusMode] Cancel Session' });
    await expect
      .poll(async () => (await readState(page)).focusMode.timer.purpose)
      .toBeNull();

    await reload(page, () => workViewPage.waitForTaskList());
    await page.clock.fastForward(MINUTE);
    expect((await readState(page)).focusMode.timer.purpose).toBeNull();
  });
});

// On desktop/web, closing the app is a deliberate end of the session.
webTest(
  'outside iOS a reload does not restore the session',
  async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Pomodoro on the web');
    await startPomodoro(page);
    await page.clock.fastForward(MINUTE);

    await reload(page, () => workViewPage.waitForTaskList());
    await page.clock.fastForward(MINUTE);
    expect((await readState(page)).focusMode.timer.purpose).toBeNull();
  },
);
