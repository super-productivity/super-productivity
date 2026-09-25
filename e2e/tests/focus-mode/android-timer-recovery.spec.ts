import { type Page } from '@playwright/test';
import { expect, test as base } from '../../fixtures/test.fixture';
import { installAndroidTimerBridge } from './android-timer-bridge';
import { skipOnboardingForE2E, waitForAppReady } from '../../utils/waits';
import {
  assertNoRuntimeBrowserErrors,
  attachPageErrorCollector,
  installDevErrorDialogHandler,
} from '../../utils/runtime-errors';

const HOUR = 60 * 60 * 1000;
const THREE_HOURS = 3 * HOUR;
const TEN_MINUTES = 10 * 60 * 1000;
const TOLERANCE = 15_000;

type TimerState = {
  tasks: {
    currentTaskId: string | null;
    isDataLoaded: boolean;
    entities: Record<string, { timeSpent: number }>;
  };
  focusMode: {
    isOverlayShown: boolean;
    pausedTaskId: string | null;
    timer: { isRunning: boolean; elapsed: number; purpose: string | null };
  };
};
type TimerWindow = Window & {
  __e2eTestHelpers: {
    store: {
      dispatch: (action: { type: string; [key: string]: unknown }) => void;
      subscribe: (callback: (state: TimerState) => void) => { unsubscribe: () => void };
    };
    hydrationState: { isApplyingRemoteOps: () => boolean };
  };
  SUPAndroid: {
    onPause$: { next: () => void };
    onResume$: { next: () => void };
    onFocusSkip$: { next: () => void };
    getFocusModeElapsed: () => string;
  };
};
type ObservedState = TimerState & {
  applying: boolean;
  nativeFocus: { remainingMs: number } | null;
  stoppedLiveFocus: number;
};

// Both the native bridge and clock must precede Angular bootstrap: Android
// detection is module-level, and RxJS timers must use the same clock throughout.
const test = base.extend({
  page: async ({ isolatedContext }, use) => {
    const page = await isolatedContext.newPage();
    const errors = attachPageErrorCollector(page, 'android-timer');
    installDevErrorDialogHandler(page, 'android-timer');
    const morning = new Date();
    morning.setHours(10, 0, 0, 0);
    await page.clock.install({ time: morning });
    await page.addInitScript(skipOnboardingForE2E);
    await page.addInitScript(installAndroidTimerBridge);
    try {
      await page.goto('/');
      await waitForAppReady(page);
      await use(page);
      assertNoRuntimeBrowserErrors(errors, 'android-timer');
    } finally {
      await page.close();
    }
  },
});

const readState = (page: Page): Promise<ObservedState> =>
  page.evaluate(() => {
    const win = window as unknown as TimerWindow;
    let state!: TimerState;
    win.__e2eTestHelpers.store.subscribe((value) => (state = value)).unsubscribe();
    return {
      tasks: state.tasks,
      focusMode: state.focusMode,
      applying: win.__e2eTestHelpers.hydrationState.isApplyingRemoteOps(),
      nativeFocus: JSON.parse(win.SUPAndroid.getFocusModeElapsed()) as {
        remainingMs: number;
      } | null,
      stoppedLiveFocus: Number(sessionStorage.getItem('test-stopped-live-focus')),
    };
  });

const dispatch = (
  page: Page,
  action: { type: string; [key: string]: unknown },
): Promise<void> =>
  page.evaluate(
    (value) => (window as unknown as TimerWindow).__e2eTestHelpers.store.dispatch(value),
    action,
  );

const pauseAndFlush = async (page: Page): Promise<void> => {
  // This message follows the real task accumulator AND operation-write flush.
  // Waiting for it prevents a reload from racing the test's own setup writes.
  const flushed = page.waitForEvent('console', (message) =>
    message.text().includes('Time tracking data flushed successfully'),
  );
  await page.evaluate(() =>
    (window as unknown as TimerWindow).SUPAndroid.onPause$.next(),
  );
  await flushed;
};

const resume = (page: Page): Promise<void> =>
  page.evaluate(() => (window as unknown as TimerWindow).SUPAndroid.onResume$.next());

const expectTaskTime = async (
  page: Page,
  taskId: string,
  expected: number,
): Promise<void> => {
  await expect
    .poll(async () =>
      Math.abs((await readState(page)).tasks.entities[taskId].timeSpent - expected),
    )
    .toBeLessThan(TOLERANCE);
};

test.describe('Android Focus timer recovery after WebView recreation', () => {
  test('ordinary background/resume and closing the overlay preserve recorded time', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Android timer control');
    const taskId = await startFlowtime(page);
    await accrueFirstHour(page, taskId);
    await pauseAndFlush(page);
    await page.clock.fastForward(2 * HOUR);
    await resume(page);
    await expectTaskTime(page, taskId, THREE_HOURS);

    await page.locator('focus-mode-overlay button.close-btn').click();
    const closed = await readState(page);
    expect(closed.focusMode.isOverlayShown).toBe(false);
    expect(closed.focusMode.timer.isRunning).toBe(true);
    expect(closed.tasks.currentTaskId).toBe(taskId);

    await pauseAndFlush(page);
    await page.reload();
    await workViewPage.waitForTaskList();
    await expectTaskTime(page, taskId, THREE_HOURS);
  });

  test('startup must not stop a surviving native Focus session', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Surviving Android timer');
    const taskId = await startFlowtime(page);
    await accrueFirstHour(page, taskId);
    await pauseAndFlush(page);
    await page.clock.fastForward(2 * HOUR);
    const before = await readState(page);
    expect(before.nativeFocus?.remainingMs).toBeGreaterThanOrEqual(THREE_HOURS);
    expect(before.stoppedLiveFocus).toBe(0);

    await page.reload();
    await workViewPage.waitForTaskList();
    const after = await readState(page);
    expect(after.tasks.entities[taskId].timeSpent).toBeGreaterThanOrEqual(HOUR);
    // Assert the erroneous command, not the result of its scheduling race.
    expect(after.stoppedLiveFocus).toBe(0);
  });

  test('operation-log startup marks restored tasks ready for Android recovery', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Android readiness');
    const taskId = await startFlowtime(page);
    await pauseAndFlush(page);
    await page.reload();
    await workViewPage.waitForTaskList();
    const loaded = await readState(page);
    expect(loaded.tasks.entities[taskId]).toBeDefined();
    expect(loaded.applying).toBe(false);
    await expect.poll(async () => (await readState(page)).tasks.isDataLoaded).toBe(true);
  });

  test('recreation restores the running task and all three hours, then keeps recording', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Android recovered task time');
    const taskId = await startFlowtime(page);
    await accrueFirstHour(page, taskId);
    await pauseAndFlush(page);
    await page.clock.fastForward(2 * HOUR);
    expect((await readState(page)).nativeFocus?.remainingMs).toBeGreaterThanOrEqual(
      THREE_HOURS,
    );

    await page.reload();
    await workViewPage.waitForTaskList();
    // Recovery must work without a second, post-hydration resume. Android's
    // initial onResume can precede bridge setup or data loading.
    await expect.soft
      .poll(async () => (await readState(page)).focusMode.timer.isRunning)
      .toBe(true);
    await expect.soft
      .poll(async () => (await readState(page)).tasks.currentTaskId)
      .toBe(taskId);
    await expectTaskTime(page, taskId, THREE_HOURS);

    await page.clock.fastForward(TEN_MINUTES);
    await expectTaskTime(page, taskId, THREE_HOURS + TEN_MINUTES);
    await pauseAndFlush(page);
    await page.reload();
    await workViewPage.waitForTaskList();
    // The recovered interval and subsequent tracking must survive another reload.
    await expectTaskTime(page, taskId, THREE_HOURS + TEN_MINUTES);
  });

  test('recreation keeps a paused task frozen and resumes that same task', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Android paused task');
    const taskId = await startFlowtime(page);
    await accrueFirstHour(page, taskId);
    await dispatch(page, { type: '[FocusMode] Pause Session', pausedTaskId: taskId });
    await expect.poll(async () => (await readState(page)).tasks.currentTaskId).toBeNull();
    await pauseAndFlush(page);
    await page.clock.fastForward(2 * HOUR);

    await page.reload();
    await workViewPage.waitForTaskList();
    expect((await readState(page)).focusMode.timer.isRunning).toBe(false);
    expect((await readState(page)).tasks.currentTaskId).toBeNull();
    await expectTaskTime(page, taskId, HOUR);

    await dispatch(page, { type: '[FocusMode] Resume Session' });
    await expect
      .poll(async () => (await readState(page)).tasks.currentTaskId)
      .toBe(taskId);
    await page.clock.fastForward(TEN_MINUTES);
    await expectTaskTime(page, taskId, HOUR + TEN_MINUTES);
  });

  test('recreation during a break retains the task to resume without counting break time', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Android task on break');
    await dispatch(page, {
      type: '[Global Config] Update Global Config Section',
      sectionKey: 'flowtime',
      sectionCfg: { isBreakEnabled: true },
      isSkipSnack: true,
    });
    const taskId = await startFlowtime(page);
    await accrueFirstHour(page, taskId);
    await dispatch(page, {
      type: '[FocusMode] End Flowtime Session',
      pausedTaskId: taskId,
    });
    await expect
      .poll(async () => (await readState(page)).focusMode.timer.purpose)
      .toBe('break');
    await pauseAndFlush(page);
    await page.clock.fastForward(60_000);
    await page.reload();
    await workViewPage.waitForTaskList();

    await expect
      .poll(async () => (await readState(page)).focusMode.pausedTaskId)
      .toBe(taskId);
    expect((await readState(page)).tasks.currentTaskId).toBeNull();
    await expectTaskTime(page, taskId, HOUR);
    await page.evaluate(() =>
      (window as unknown as TimerWindow).SUPAndroid.onFocusSkip$.next(),
    );
    await expect
      .poll(async () => (await readState(page)).tasks.currentTaskId)
      .toBe(taskId);
    await page.clock.fastForward(TEN_MINUTES);
    await expectTaskTime(page, taskId, HOUR + TEN_MINUTES);
  });
});

const startFlowtime = async (page: Page): Promise<string> => {
  await page.waitForFunction(() => !!(window as unknown as TimerWindow).__e2eTestHelpers);
  const taskId = Object.keys((await readState(page)).tasks.entities)[0];
  expect(taskId).toBeTruthy();
  await dispatch(page, { type: '[Task] SetCurrentTask', id: taskId });
  await dispatch(page, { type: '[FocusMode] Show Overlay' });
  await page.locator('focus-mode-main').waitFor();
  await dispatch(page, { type: '[FocusMode] Set Mode', mode: 'Flowtime' });
  await dispatch(page, { type: '[FocusMode] Start Session', duration: 0, taskId });
  await expect
    .poll(async () => (await readState(page)).focusMode.timer.isRunning)
    .toBe(true);
  await expect.poll(async () => (await readState(page)).nativeFocus).not.toBeNull();
  return taskId;
};

const accrueFirstHour = async (page: Page, taskId: string): Promise<void> => {
  await page.clock.fastForward(HOUR);
  await expectTaskTime(page, taskId, HOUR);
  expect((await readState(page)).focusMode.timer.elapsed).toBeGreaterThanOrEqual(HOUR);
};
