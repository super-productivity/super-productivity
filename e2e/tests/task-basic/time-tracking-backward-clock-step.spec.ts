import { type Page } from '@playwright/test';
import { expect, test as base } from '../../fixtures/test.fixture';
import { skipOnboardingForE2E, waitForAppReady } from '../../utils/waits';
import {
  assertNoRuntimeBrowserErrors,
  attachPageErrorCollector,
  installDevErrorDialogHandler,
} from '../../utils/runtime-errors';

/**
 * Tracking reads elapsed time from the wall clock. When the system clock steps
 * back (a manual change or an NTP step), the next tick's difference is negative
 * and used to be subtracted from the task's recorded time.
 */

const MINUTE = 60 * 1000;

type ObservedState = {
  tasks: {
    currentTaskId: string | null;
    entities: Record<string, { timeSpent: number }>;
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
// share one clock.
const test = base.extend({
  page: async ({ isolatedContext }, use) => {
    const page = await isolatedContext.newPage();
    const errors = attachPageErrorCollector(page, 'clock-step');
    installDevErrorDialogHandler(page, 'clock-step');
    const morning = new Date();
    morning.setHours(10, 0, 0, 0);
    await page.clock.install({ time: morning });
    await page.addInitScript(skipOnboardingForE2E);
    try {
      await page.goto('/');
      await waitForAppReady(page);
      await use(page);
      assertNoRuntimeBrowserErrors(errors, 'clock-step');
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
    return { tasks: state.tasks };
  });
};

test('a backward clock step does not subtract tracked time', async ({
  page,
  workViewPage,
}) => {
  await workViewPage.waitForTaskList();
  await workViewPage.addTask('Tracked across a clock step');
  const taskId = Object.keys((await readState(page)).tasks.entities)[0];
  await page.evaluate(
    (id) =>
      (window as unknown as HelperWindow).__e2eTestHelpers.store.dispatch({
        type: '[Task] SetCurrentTask',
        id,
      }),
    taskId,
  );
  await expect.poll(async () => (await readState(page)).tasks.currentTaskId).toBe(taskId);

  await page.clock.fastForward(2 * MINUTE);
  const tracked = (await readState(page)).tasks.entities[taskId].timeSpent;
  expect(tracked).toBeGreaterThan(MINUTE);

  // Step the clock back a minute without running timers, then let ticks run.
  const now = await page.evaluate(() => Date.now());
  await page.clock.setSystemTime(now - MINUTE);
  await page.clock.fastForward(5000);

  expect((await readState(page)).tasks.entities[taskId].timeSpent).toBeGreaterThanOrEqual(
    tracked,
  );
});
