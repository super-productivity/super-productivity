import { type Page } from '@playwright/test';
import { expect, test as base } from '../../fixtures/test.fixture';
import {
  flushPendingWrites,
  skipOnboardingForE2E,
  waitForAppReady,
} from '../../utils/waits';
import {
  assertNoRuntimeBrowserErrors,
  attachPageErrorCollector,
  installDevErrorDialogHandler,
} from '../../utils/runtime-errors';

type Stamps = Record<string, Record<string, { s?: number; e?: number }>>;
type ObservedState = {
  timeTracking: { tag: Stamps; project: Stamps };
  tasks: {
    currentTaskId: string | null;
    entities: Record<string, { timeSpent: number; projectId: string }>;
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

// Install before Angular so Date.now() and RxJS tracking timers share one clock.
const test = base.extend({
  page: async ({ isolatedContext }, use) => {
    const page = await isolatedContext.newPage();
    const errors = attachPageErrorCollector(page, 'tracking-reload');
    installDevErrorDialogHandler(page, 'tracking-reload');
    const morning = new Date();
    morning.setHours(10, 0, 0, 0);
    await page.clock.install({ time: morning });
    await page.addInitScript(skipOnboardingForE2E);
    try {
      await page.goto('/');
      await waitForAppReady(page);
      await use(page);
      assertNoRuntimeBrowserErrors(errors, 'tracking-reload');
    } finally {
      await page.close();
    }
  },
});

const readState = async (page: Page): Promise<ObservedState> => {
  await page.waitForFunction(
    () => !!(window as unknown as HelperWindow).__e2eTestHelpers,
  );
  return page.evaluate(() => {
    let state!: ObservedState;
    (window as unknown as HelperWindow).__e2eTestHelpers.store
      .subscribe((value) => (state = value))
      .unsubscribe();
    return { tasks: state.tasks, timeTracking: state.timeTracking };
  });
};

// Only a hidden page can await IndexedDB before it goes away. Reloading a
// visible tab directly is best effort: the browser does not wait for the
// write, so CI can lose the whole batch there.
test('hidden tracking keeps duration and context stamps after reload', async ({
  page,
  workViewPage,
}, testInfo) => {
  await workViewPage.waitForTaskList();
  await workViewPage.addTask('Reload durability fixture');
  const taskId = Object.keys((await readState(page)).tasks.entities)[0];
  await page.evaluate(
    (id) =>
      (window as unknown as HelperWindow).__e2eTestHelpers.store.dispatch({
        type: '[Task] SetCurrentTask',
        id,
      }),
    taskId,
  );
  // One minute boundary makes both start and end stamps observable.
  await page.clock.runFor(1000);
  await page.clock.fastForward(64000);
  const before = await readState(page);
  expect(before.tasks.currentTaskId).toBe(taskId);
  expect(before.tasks.entities[taskId].timeSpent).toBeGreaterThanOrEqual(65000);
  expect(Object.keys(before.timeTracking.tag['TODAY'])).toHaveLength(1);
  expect(Object.keys(before.timeTracking.project)).toHaveLength(1);
  expect(Object.keys(before.timeTracking.tag)).toHaveLength(1);
  // Drain captured setup writes, without stopping or flushing tracking.
  await flushPendingWrites(page);
  // Headless Chromium does not hide tabs on bringToFront(). Deliver the
  // browser lifecycle event, then wait for its asynchronous write queue.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await flushPendingWrites(page);
  expect((await readState(page)).tasks.currentTaskId).toBe(taskId);
  await page.reload();
  await waitForAppReady(page);
  const after = await readState(page);
  await testInfo.attach('tracking-reload-evidence', {
    body: JSON.stringify(
      {
        durationBefore: before.tasks.entities[taskId].timeSpent,
        durationAfter: after.tasks.entities[taskId].timeSpent,
        stampsBefore: before.timeTracking,
        stampsAfter: after.timeTracking,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  expect(after.tasks.entities[taskId].timeSpent).toBeGreaterThanOrEqual(
    before.tasks.entities[taskId].timeSpent,
  );
  expect(after.timeTracking).toEqual(before.timeTracking);
});
