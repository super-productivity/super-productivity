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
const TEN_MINUTES = 10 * 60 * 1000;
const TOLERANCE = 15_000;

type TrackingState = {
  tasks: {
    currentTaskId: string | null;
    entities: Record<string, { timeSpent: number }>;
  };
};
type TrackingWindow = Window & {
  __e2eTestHelpers: {
    store: {
      dispatch: (action: { type: string; [key: string]: unknown }) => void;
      subscribe: (callback: (state: TrackingState) => void) => {
        unsubscribe: () => void;
      };
    };
  };
  SUPAndroid: {
    onPause$: { next: () => void };
    getTrackingElapsed: () => string;
  };
};

// The native bridge and clock must precede Angular bootstrap: Android
// detection is module-level, and RxJS timers must use the same clock throughout.
const test = base.extend({
  page: async ({ isolatedContext }, use) => {
    const page = await isolatedContext.newPage();
    const errors = attachPageErrorCollector(page, 'android-tracking');
    installDevErrorDialogHandler(page, 'android-tracking');
    const morning = new Date();
    morning.setHours(10, 0, 0, 0);
    await page.clock.install({ time: morning });
    await page.addInitScript(skipOnboardingForE2E);
    await page.addInitScript(installAndroidTimerBridge);
    try {
      await page.goto('/');
      await waitForAppReady(page);
      await use(page);
      assertNoRuntimeBrowserErrors(errors, 'android-tracking');
    } finally {
      await page.close();
    }
  },
});

const readState = (page: Page): Promise<TrackingState> =>
  page.evaluate(() => {
    const store = (window as unknown as TrackingWindow).__e2eTestHelpers.store;
    let state!: TrackingState;
    store.subscribe((value) => (state = value)).unsubscribe();
    return state;
  });

const pauseAndFlush = async (page: Page): Promise<void> => {
  // Logged after the task accumulator AND the operation-write flush, so a
  // reload cannot race the test's own writes.
  const flushed = page.waitForEvent('console', (message) =>
    message.text().includes('Time tracking data flushed successfully'),
  );
  await page.evaluate(() =>
    (window as unknown as TrackingWindow).SUPAndroid.onPause$.next(),
  );
  await flushed;
};

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

test.describe('Android tracking recovery on a cold start', () => {
  // Startup loads the snapshot, then replays the ops written after it. Recovery
  // credits "native total minus task time", so crediting against the snapshot
  // before the tail replay would count the tail's tracked time twice.
  test('credits time tracked after the startup snapshot exactly once', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Android cold start tracking');
    await page.waitForFunction(
      () => !!(window as unknown as TrackingWindow).__e2eTestHelpers,
    );
    const taskId = Object.keys((await readState(page)).tasks.entities)[0];
    expect(taskId).toBeTruthy();

    // A boot without a snapshot replays every op and saves one, so the time
    // tracked below lands in the op-log tail after that snapshot.
    await page.reload();
    await workViewPage.waitForTaskList();

    await page.evaluate(
      (id) =>
        (window as unknown as TrackingWindow).__e2eTestHelpers.store.dispatch({
          type: '[Task] SetCurrentTask',
          id,
        }),
      taskId,
    );
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as TrackingWindow).SUPAndroid.getTrackingElapsed(),
        ),
      )
      .not.toBe('null');
    await page.clock.fastForward(HOUR);
    await expectTaskTime(page, taskId, HOUR);
    await pauseAndFlush(page);

    // The native service keeps counting while the WebView is gone.
    await page.clock.fastForward(TEN_MINUTES);
    await page.reload();
    await workViewPage.waitForTaskList();

    await expect
      .poll(async () => (await readState(page)).tasks.currentTaskId)
      .toBe(taskId);
    await expectTaskTime(page, taskId, HOUR + TEN_MINUTES);
  });
});
