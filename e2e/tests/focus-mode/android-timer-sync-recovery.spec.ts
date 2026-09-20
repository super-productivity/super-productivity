import { expect, test as base } from '../../fixtures/test.fixture';
import { installAndroidTimerBridge } from './android-timer-bridge';
import { skipOnboardingForE2E, waitForAppReady } from '../../utils/waits';

const HOUR = 60 * 60 * 1000;
const TWO_HOURS = 2 * HOUR;
const FOUR_HOURS = 4 * HOUR;

type TestWindow = Window & {
  SUPAndroid: {
    onPause$: { next: () => void };
    onResume$: { next: () => void };
    getFocusModeElapsed: () => string;
  };
  __e2eTestHelpers: {
    store: {
      dispatch: (action: { type: string; [key: string]: unknown }) => void;
      subscribe: (callback: (state: TestState) => void) => { unsubscribe: () => void };
    };
    hydrationState: {
      openSyncWindow: (failsafeMs: number) => void;
      closeSyncWindow: () => void;
      startApplyingRemoteOps: () => void;
      endApplyingRemoteOps: () => void;
      isInSyncWindow$: {
        subscribe: (callback: (value: boolean) => void) => { unsubscribe: () => void };
      };
    };
  };
};

type TestState = {
  tasks: {
    currentTaskId: string | null;
    entities: Record<string, { timeSpent: number }>;
  };
  focusMode: { timer: { isRunning: boolean } };
};

const test = base.extend({
  page: async ({ isolatedContext }, use) => {
    const page = await isolatedContext.newPage();
    const morning = new Date();
    morning.setHours(10, 0, 0, 0);
    await page.clock.install({ time: morning });
    await page.addInitScript(skipOnboardingForE2E);
    // Keep the native timer alive across reload but withhold its readback on
    // the second boot. This lets the test place a remote op inside the sync
    // window before requesting recovery; the app and IndexedDB remain real.
    await page.addInitScript({
      content: `(${installAndroidTimerBridge.toString()})();
        const bridge = window.SUPAndroid;
        const nativeRead = bridge.getFocusModeElapsed;
        bridge.getFocusModeElapsed = () =>
          sessionStorage.getItem('test-hold-focus-readback') === '1'
            ? 'null'
            : nativeRead();`,
    });
    try {
      await page.goto('/');
      await waitForAppReady(page);
      await use(page);
    } finally {
      await page.close();
    }
  },
});

const readState = (page: import('@playwright/test').Page): Promise<TestState> =>
  page.evaluate(() => {
    const store = (window as unknown as TestWindow).__e2eTestHelpers.store;
    let state!: TestState;
    store.subscribe((value) => (state = value)).unsubscribe();
    return state;
  });

test('native recovery adds its gap after a concurrent remote time op', async ({
  page,
  workViewPage,
}) => {
  await workViewPage.waitForTaskList();
  await workViewPage.addTask('Android native and remote time');
  await page.waitForFunction(() =>
    Boolean((window as unknown as TestWindow).__e2eTestHelpers),
  );
  const taskId = Object.keys((await readState(page)).tasks.entities)[0];
  expect(taskId).toBeTruthy();

  await page.evaluate((id) => {
    const store = (window as unknown as TestWindow).__e2eTestHelpers.store;
    store.dispatch({ type: '[Task] SetCurrentTask', id });
    store.dispatch({ type: '[FocusMode] Set Mode', mode: 'Flowtime' });
    store.dispatch({ type: '[FocusMode] Start Session', duration: 0, taskId: id });
  }, taskId);
  await expect
    .poll(async () => (await readState(page)).focusMode.timer.isRunning)
    .toBe(true);
  await page.clock.fastForward(HOUR);
  await expect
    .poll(async () => (await readState(page)).tasks.entities[taskId].timeSpent)
    .toBeGreaterThanOrEqual(HOUR - 15_000);

  const flushed = page.waitForEvent('console', (message) =>
    message.text().includes('Time tracking data flushed successfully'),
  );
  await page.evaluate(() => (window as unknown as TestWindow).SUPAndroid.onPause$.next());
  await flushed;
  await page.clock.fastForward(TWO_HOURS);
  await page.evaluate(() => sessionStorage.setItem('test-hold-focus-readback', '1'));
  await page.reload();
  await workViewPage.waitForTaskList();
  await page.waitForFunction(() =>
    Boolean((window as unknown as TestWindow).__e2eTestHelpers),
  );
  await expect
    .poll(async () => (await readState(page)).tasks.entities[taskId].timeSpent)
    .toBeGreaterThanOrEqual(HOUR - 15_000);
  expect((await readState(page)).focusMode.timer.isRunning).toBe(false);

  await page.evaluate(() =>
    (window as unknown as TestWindow).__e2eTestHelpers.hydrationState.openSyncWindow(0),
  );
  // toObservable updates asynchronously. Wait for the actual gate consumed by
  // waitForSyncWindow before requesting recovery, not merely the signal write.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const source = (window as unknown as TestWindow).__e2eTestHelpers.hydrationState
          .isInSyncWindow$;
        const subscription = source.subscribe((isOpen) => {
          if (isOpen) {
            queueMicrotask(() => subscription.unsubscribe());
            resolve();
          }
        });
      }),
  );
  await page.evaluate(() => {
    const win = window as unknown as TestWindow;
    sessionStorage.removeItem('test-hold-focus-readback');
    // Capture the native/local baseline while recovery is held by sync.
    win.SUPAndroid.onResume$.next();
  });
  await page.evaluate(
    ({ id, remoteDuration }) => {
      (window as unknown as TestWindow).__e2eTestHelpers.store.dispatch({
        type: '[TimeTracking] Sync time spent',
        taskId: id,
        date: new Date().toISOString().slice(0, 10),
        duration: remoteDuration,
        meta: {
          isPersistent: true,
          isRemote: true,
          entityType: 'TASK',
          entityId: id,
          opType: 'UPD',
        },
      });
    },
    { id: taskId, remoteDuration: HOUR },
  );
  await expect
    .poll(async () =>
      Math.abs((await readState(page)).tasks.entities[taskId].timeSpent - TWO_HOURS),
    )
    .toBeLessThan(15_000);
  expect((await readState(page)).focusMode.timer.isRunning).toBe(false);
  await page.evaluate(() =>
    (window as unknown as TestWindow).__e2eTestHelpers.hydrationState.closeSyncWindow(),
  );

  await expect
    .poll(async () => (await readState(page)).focusMode.timer.isRunning)
    .toBe(true);
  await expect.poll(async () => (await readState(page)).tasks.currentTaskId).toBe(taskId);
  await expect
    .poll(async () =>
      Math.abs((await readState(page)).tasks.entities[taskId].timeSpent - FOUR_HOURS),
    )
    .toBeLessThan(15_000);
});

test('remote task time received during focus survives native recovery after recreation', async ({
  page,
  workViewPage,
}) => {
  await workViewPage.waitForTaskList();
  await workViewPage.addTask('Android time received from another device');
  await page.waitForFunction(() =>
    Boolean((window as unknown as TestWindow).__e2eTestHelpers),
  );
  const taskId = Object.keys((await readState(page)).tasks.entities)[0];
  expect(taskId).toBeTruthy();

  await page.evaluate((id) => {
    const store = (window as unknown as TestWindow).__e2eTestHelpers.store;
    store.dispatch({ type: '[Task] SetCurrentTask', id });
    store.dispatch({ type: '[FocusMode] Set Mode', mode: 'Flowtime' });
    store.dispatch({ type: '[FocusMode] Start Session', duration: 0, taskId: id });
  }, taskId);
  await expect
    .poll(async () => (await readState(page)).focusMode.timer.isRunning)
    .toBe(true);
  await page.clock.fastForward(HOUR);
  await expect
    .poll(async () => (await readState(page)).tasks.entities[taskId].timeSpent)
    .toBeGreaterThanOrEqual(HOUR - 15_000);

  const flushed = page.waitForEvent('console', (message) =>
    message.text().includes('Time tracking data flushed successfully'),
  );
  await page.evaluate(
    ({ id, remoteDuration }) => {
      const win = window as unknown as TestWindow;
      const { store, hydrationState } = win.__e2eTestHelpers;
      const action = {
        type: '[TimeTracking] Sync time spent',
        taskId: id,
        date: new Date().toISOString().slice(0, 10),
        duration: remoteDuration,
        meta: {
          isPersistent: true,
          entityType: 'TASK',
          entityId: id,
          opType: 'UPD',
        },
      };
      // The real remote replay path applies the op through the bulk meta-reducer
      // while selector-based native mirroring is suppressed. Capture the same
      // additive operation as a local no-op so IndexedDB can replay it on boot.
      hydrationState.startApplyingRemoteOps();
      store.dispatch({
        type: '[OperationLog] Bulk Apply Operations',
        localClientId: 'this-test-client',
        operations: [
          {
            id: crypto.randomUUID(),
            actionType: action.type,
            opType: 'UPD',
            entityType: 'TASK',
            entityId: id,
            payload: {
              actionPayload: { taskId: id, date: action.date, duration: remoteDuration },
              entityChanges: [],
            },
            clientId: 'remoteTestClient',
            vectorClock: { remoteTestClient: 1 },
            timestamp: Date.now(),
            schemaVersion: 1,
          },
        ],
      });
      hydrationState.endApplyingRemoteOps();
      store.dispatch(action);
      win.SUPAndroid.onPause$.next();
    },
    { id: taskId, remoteDuration: HOUR },
  );
  await flushed;
  await expect
    .poll(async () =>
      Math.abs((await readState(page)).tasks.entities[taskId].timeSpent - TWO_HOURS),
    )
    .toBeLessThan(15_000);

  await page.clock.fastForward(TWO_HOURS);
  await page.evaluate(() => sessionStorage.setItem('test-hold-focus-readback', '1'));
  await page.reload();
  await workViewPage.waitForTaskList();
  await page.waitForFunction(() =>
    Boolean((window as unknown as TestWindow).__e2eTestHelpers),
  );
  // The replayed remote hour is durable. Recovery must add the two hours
  // elapsed by native since the local one-hour checkpoint.
  await expect
    .poll(async () =>
      Math.abs((await readState(page)).tasks.entities[taskId].timeSpent - TWO_HOURS),
    )
    .toBeLessThan(15_000);
  await page.evaluate(() => {
    sessionStorage.removeItem('test-hold-focus-readback');
    (window as unknown as TestWindow).SUPAndroid.onResume$.next();
  });
  await expect
    .poll(async () =>
      Math.abs((await readState(page)).tasks.entities[taskId].timeSpent - FOUR_HOURS),
    )
    .toBeLessThan(15_000);
});
