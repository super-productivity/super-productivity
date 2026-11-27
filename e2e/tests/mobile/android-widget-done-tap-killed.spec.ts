import { type Page } from '@playwright/test';
import { expect, test as base } from '../../fixtures/test.fixture';
import { installAndroidTimerBridge } from '../focus-mode/android-timer-bridge';
import { skipOnboardingForE2E, waitForAppReady } from '../../utils/waits';
import {
  assertNoRuntimeBrowserErrors,
  attachPageErrorCollector,
  installDevErrorDialogHandler,
} from '../../utils/runtime-errors';

const QUEUE_KEY = 'test-native-widget-done';

type TaskState = { tasks: { entities: Record<string, { isDone: boolean }> } };
type WidgetWindow = Window & {
  __e2eTestHelpers: {
    store: {
      subscribe: (callback: (state: TaskState) => void) => { unsubscribe: () => void };
    };
  };
  SUPAndroid: { onWidgetDoneDrainRequest$: { next: () => void } };
};

/**
 * Native end of the widget done queue (WidgetDoneQueue.kt). localStorage
 * survives the reload the way SharedPreferences survive process death.
 */
const installWidgetDoneQueue = (): void => {
  if (window !== window.top) return;
  const KEY = 'test-native-widget-done';
  Object.assign((window as unknown as { SUPAndroid: object }).SUPAndroid, {
    getWidgetDoneQueue: (): string | null => {
      const queue = localStorage.getItem(KEY);
      localStorage.removeItem(KEY);
      return queue;
    },
    peekWidgetDoneQueue: (): string | null => localStorage.getItem(KEY),
    ackWidgetDoneQueue: (ackedJson: string): void => {
      const queue: Record<string, boolean> = JSON.parse(
        localStorage.getItem(KEY) || '{}',
      );
      const acked: Record<string, boolean> = JSON.parse(ackedJson);
      for (const [id, isDone] of Object.entries(acked)) {
        if (queue[id] === isDone) delete queue[id];
      }
      if (Object.keys(queue).length) {
        localStorage.setItem(KEY, JSON.stringify(queue));
      } else {
        localStorage.removeItem(KEY);
      }
    },
  });
};

// The native bridge must precede Angular bootstrap: Android detection is
// module-level.
const test = base.extend({
  page: async ({ isolatedContext }, use) => {
    const page = await isolatedContext.newPage();
    const errors = attachPageErrorCollector(page, 'android-widget');
    installDevErrorDialogHandler(page, 'android-widget');
    await page.addInitScript(skipOnboardingForE2E);
    await page.addInitScript(installAndroidTimerBridge);
    await page.addInitScript(installWidgetDoneQueue);
    try {
      await page.goto('/');
      await waitForAppReady(page);
      await use(page);
      assertNoRuntimeBrowserErrors(errors, 'android-widget');
    } finally {
      await page.close();
    }
  },
});

const readState = async (page: Page): Promise<TaskState> => {
  await page.waitForFunction(
    () => !!(window as unknown as WidgetWindow).__e2eTestHelpers,
  );
  return page.evaluate(() => {
    const store = (window as unknown as WidgetWindow).__e2eTestHelpers.store;
    let state!: TaskState;
    store.subscribe((value) => (state = value)).unsubscribe();
    return state;
  });
};

const isTaskDone = async (page: Page, taskId: string): Promise<boolean | undefined> =>
  (await readState(page)).tasks.entities[taskId]?.isDone;

const hasOpFor = (page: Page, taskId: string): Promise<boolean> =>
  page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('SUP_OPS');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      const ops = await new Promise<unknown[]>((resolve, reject) => {
        const r = db.transaction('ops').objectStore('ops').getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      return JSON.stringify(ops).includes(id);
    } finally {
      db.close();
    }
  }, taskId);

/**
 * Holds a write transaction over the whole op-log database until the page
 * goes away. This is what a tap on a frozen Android app looks like from JS
 * (emulator, docs/plans/2026-10-30-narrow-mobile-background-sync.md § 17):
 * dispatch and reducer run, the op write does not finish.
 */
const stallOpLogWrites = (page: Page): Promise<void> =>
  page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('SUP_OPS');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve) => {
      const store = db
        .transaction(Array.from(db.objectStoreNames), 'readwrite')
        .objectStore('ops');
      // A transaction commits once it has no pending request, so keep one open.
      const keepOpen = (): void => {
        store.count().onsuccess = () => {
          resolve();
          keepOpen();
        };
      };
      keepOpen();
    });
  });

test.describe('Android widget done tap', () => {
  test('survives a process kill before its op was written', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Widget tap on a frozen app');
    const taskId = Object.keys((await readState(page)).tasks.entities)[0];
    expect(taskId).toBeTruthy();
    // The task itself must be durable before writes are stalled.
    await expect.poll(() => hasOpFor(page, taskId)).toBe(true);

    await stallOpLogWrites(page);
    await page.evaluate(
      ([key, id]) => {
        localStorage.setItem(key, JSON.stringify({ [id]: true }));
        (window as unknown as WidgetWindow).SUPAndroid.onWidgetDoneDrainRequest$.next();
      },
      [QUEUE_KEY, taskId],
    );
    await expect.poll(() => isTaskDone(page, taskId)).toBe(true);

    // Process death: the in-memory change is gone, the native queue is not.
    await page.reload();
    await waitForAppReady(page);
    await expect.poll(() => isTaskDone(page, taskId)).toBe(true);

    // Acknowledged only once durable, so the next start no longer needs the queue.
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), QUEUE_KEY))
      .toBeNull();
    await page.reload();
    await waitForAppReady(page);
    await expect.poll(() => isTaskDone(page, taskId)).toBe(true);
  });

  // Legacy online mode loads this web app into an APK older than peek/ack.
  test('is applied by a native shell that only has the clearing read', async ({
    page,
    workViewPage,
  }) => {
    await page.addInitScript(() => {
      if (window !== window.top) return;
      const bridge = (window as unknown as { SUPAndroid: Record<string, unknown> })
        .SUPAndroid;
      delete bridge.peekWidgetDoneQueue;
      delete bridge.ackWidgetDoneQueue;
    });
    await page.reload();
    await waitForAppReady(page);
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Widget tap in an old shell');
    const taskId = Object.keys((await readState(page)).tasks.entities)[0];

    await page.evaluate(
      ([key, id]) => {
        localStorage.setItem(key, JSON.stringify({ [id]: true }));
        (window as unknown as WidgetWindow).SUPAndroid.onWidgetDoneDrainRequest$.next();
      },
      [QUEUE_KEY, taskId],
    );
    await expect.poll(() => isTaskDone(page, taskId)).toBe(true);
    expect(await page.evaluate((key) => localStorage.getItem(key), QUEUE_KEY)).toBeNull();
  });
});
