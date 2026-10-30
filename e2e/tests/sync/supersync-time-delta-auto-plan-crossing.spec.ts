import type { Route } from '@playwright/test';
import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  expectExactTaskTime,
  getTaskTimeSpentFromState,
  startTimeTracking,
  stopTimeTracking,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { waitForAppReady } from '../../utils/waits';
import { serveReleasedClientAssets } from '../../utils/released-client-assets';

/**
 * #10378. Tracking time on an unscheduled task also plans it for today
 * (`planTasksForToday`, on by default via "auto-add worked-on tasks to Today").
 * That opaque op sat beside the `syncTimeSpent` delta, so two devices tracking
 * the same task concurrently fell to whole-entity LWW: the losing device's
 * delta was rejected and never uploaded (pending side lost), or its snapshot
 * overwrote the other device's delta (pending side won). Either way one
 * device's time was lost on every other device.
 */

/** Only explicit syncs run, so every crossing happens in the stated order. */
const blockBackgroundSync = async (client: SimulatedE2EClient): Promise<void> => {
  await client.page.evaluate(() => {
    const flags = globalThis as typeof globalThis & Record<string, boolean>;
    flags['__SP_E2E_BLOCK_AUTO_SYNC'] = true;
    flags['__SP_E2E_BLOCK_WS_DOWNLOAD'] = true;
    flags['__SP_E2E_BLOCK_IMMEDIATE_UPLOAD'] = true;
  });
};

/**
 * Fail on the dataset conflict dialog or an error instead of resolving it.
 * `whileSyncing` runs once the download has answered; with it, an upload
 * left pending by the cycle (rejected ops resolved for the next one) is also
 * accepted as settled.
 */
const sync = async (
  client: SimulatedE2EClient,
  whileSyncing?: () => Promise<void>,
): Promise<void> => {
  const downloaded = client.page.waitForResponse(
    (response) =>
      response.url().includes('/api/sync/ops') && response.request().method() === 'GET',
  );
  await client.sync.clickSyncBtn();
  expect((await downloaded).ok()).toBe(true);
  await whileSyncing?.();
  const outcome = async (): Promise<string> => {
    if (await client.sync.conflictDialog.isVisible()) return 'conflict-dialog';
    if (await client.sync.hasSyncError()) return 'error';
    const spinning = await client.sync.syncSpinner.isVisible();
    const checked = await client.sync.syncConfirmedIcon.isVisible();
    if (!spinning && whileSyncing) return 'in-sync';
    return !spinning && checked ? 'in-sync' : 'pending';
  };
  let observed = 'pending';
  await expect
    .poll(
      async () => {
        observed = await outcome();
        return observed;
      },
      { timeout: 30000 },
    )
    .not.toBe('pending');
  expect(observed).toBe('in-sync');
};

/**
 * Syncs `client` with its first upload held at the network until `during`
 * has run, so `during` can upload a concurrent edit after this client's
 * download and before its upload reaches the server.
 */
const syncWithUploadHeld = async (
  client: SimulatedE2EClient,
  during: () => Promise<void>,
): Promise<void> => {
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => (release = resolve));
  let markHeld = (): void => undefined;
  const held = new Promise<void>((resolve) => (markHeld = resolve));
  let isFirstUpload = true;
  const handler = async (route: Route): Promise<void> => {
    if (isFirstUpload && route.request().method() === 'POST') {
      isFirstUpload = false;
      markHeld();
      await released;
    }
    await route.continue();
  };
  await client.page.route('**/api/sync/ops*', handler);
  try {
    await sync(client, async () => {
      await held;
      await during();
      release();
    });
  } finally {
    release();
    await client.page.unroute('**/api/sync/ops*', handler);
  }
};

type TaskStep = 'read' | 'unschedule' | 'start' | 'stop';

/**
 * Dispatches one real action through the store and returns the task's id and
 * `dueDay` afterwards. 'start'/'stop' run the app's own tracking: the timer
 * ticks, the auto-plan effect and the delta flush all happen as for a user.
 */
const onTask = async (
  client: SimulatedE2EClient,
  taskName: string,
  step: TaskStep,
): Promise<{ id: string; dueDay: string | null }> =>
  client.page.evaluate(
    async ({ name, taskStep }) => {
      type Subscription = { unsubscribe: () => void };
      type StoreLike = {
        subscribe: (next: (state: unknown) => void) => Subscription;
        dispatch: (action: unknown) => void;
      };
      const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
        .__e2eTestHelpers?.store;
      if (!store) {
        throw new Error('E2E store helper is unavailable');
      }
      const readTask = (): Promise<Record<string, unknown>> =>
        new Promise((resolve, reject) => {
          const ref: { current?: Subscription } = {};
          ref.current = store.subscribe((state) => {
            window.setTimeout(() => ref.current?.unsubscribe());
            const root = state as Record<string, { entities?: Record<string, unknown> }>;
            const entities = (root.tasks ?? root.task)?.entities ?? {};
            const task = Object.values(entities).find(
              (value) =>
                typeof value === 'object' &&
                value !== null &&
                String((value as Record<string, unknown>).title).includes(name),
            );
            if (task) {
              resolve(task as Record<string, unknown>);
            } else {
              reject(new Error(`Task not found: ${name}`));
            }
          });
        });
      const task = await readTask();
      if (taskStep === 'unschedule') {
        store.dispatch({
          type: '[Task Shared] unscheduleTask',
          id: task.id,
          isSkipToast: true,
          meta: {
            isPersistent: true,
            entityType: 'TASK',
            entityId: task.id,
            opType: 'UPD',
          },
        });
      } else if (taskStep === 'start') {
        store.dispatch({ type: '[Task] SetCurrentTask', id: task.id });
      } else if (taskStep === 'stop') {
        store.dispatch({ type: '[Task] UnsetCurrentTask' });
      }
      const current = await readTask();
      return {
        id: String(current.id),
        dueDay: (current.dueDay as string | undefined) ?? null,
      };
    },
    { name: taskName, taskStep: step },
  );

/** Tracks the task for a few timer ticks and returns the time it added. */
const track = async (client: SimulatedE2EClient, taskName: string): Promise<number> => {
  const before = (await getTaskTimeSpentFromState(client, taskName)) ?? 0;
  await onTask(client, taskName, 'start');
  await expect
    .poll(
      async () => ((await getTaskTimeSpentFromState(client, taskName)) ?? 0) - before,
      {
        timeout: 15000,
      },
    )
    .toBeGreaterThanOrEqual(2000);
  await onTask(client, taskName, 'stop');
  // Auto-add to Today (the default) planned the unscheduled task.
  await expect
    .poll(async () => (await onTask(client, taskName, 'read')).dueDay)
    .not.toBeNull();
  const added = ((await getTaskTimeSpentFromState(client, taskName)) ?? 0) - before;
  expect(added).toBeGreaterThan(0);
  return added;
};

test.describe('@supersync time tracked concurrently on an unscheduled task (#10378)', () => {
  // 'pending loses': B tracks first, A later and uploads first, so on B the
  // remote side wins and B's own delta must still upload.
  // 'pending wins': A tracks first and uploads first, B tracks later, so on B
  // the local side wins and its snapshot must still count A's delta.
  // 'no-pending crossing': B tracks first and downloads, A tracks later and
  // uploads before B's upload arrives. The server accepts B's delta beside
  // A's ops, so A meets it with its own auto-plan and delta already synced.
  // There A's later side won whole-task LWW and its snapshot dropped B's time.
  for (const direction of [
    'pending loses',
    'pending wins',
    'no-pending crossing',
  ] as const) {
    test(`both devices' time survives when the ${direction}, also after a restart`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      test.setTimeout(300000);

      const taskName = `AutoPlanTracking-${direction.replaceAll(' ', '-')}-${Date.now()}`;
      const clients: SimulatedE2EClient[] = [];

      try {
        const syncConfig = getSuperSyncConfig(await createTestUser(testRunId));
        const clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
        clients.push(clientA);
        await clientA.sync.setupSuperSync(syncConfig);
        await clientA.workView.addTask(taskName);
        await waitForTask(clientA.page, taskName);
        await onTask(clientA, taskName, 'unschedule');
        await expect
          .poll(async () => (await onTask(clientA, taskName, 'read')).dueDay)
          .toBeNull();
        await clientA.sync.syncAndWait();

        const clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
        clients.push(clientB);
        const clientC = await createSimulatedClient(browser, baseURL!, 'C', testRunId);
        clients.push(clientC);
        for (const client of [clientB, clientC]) {
          await client.sync.setupSuperSync(syncConfig);
          await client.sync.syncAndWait();
          await expect
            .poll(async () => (await onTask(client, taskName, 'read')).dueDay)
            .toBeNull();
          await expectExactTaskTime(client, taskName, 0);
        }
        for (const client of clients) {
          await blockBackgroundSync(client);
        }

        let trackedA = 0;
        let trackedB: number;
        if (direction === 'pending loses') {
          trackedB = await track(clientB, taskName);
          trackedA = await track(clientA, taskName);
        } else if (direction === 'pending wins') {
          trackedA = await track(clientA, taskName);
          trackedB = await track(clientB, taskName);
        } else {
          trackedB = await track(clientB, taskName);
          await syncWithUploadHeld(clientB, async () => {
            trackedA = await track(clientA, taskName);
            await sync(clientA);
          });
        }
        if (direction !== 'no-pending crossing') {
          await sync(clientA);
          await sync(clientB);
        }
        for (let round = 0; round < 2; round++) {
          for (const client of clients) {
            await sync(client);
          }
        }

        // Exactly the sum: a lost delta shows less, a double count more.
        const expected = trackedA + trackedB;
        const expectConverged = async (): Promise<void> => {
          for (const client of clients) {
            await expectExactTaskTime(client, taskName, expected);
          }
          const dueDays = await Promise.all(
            clients.map(
              async (client) => (await onTask(client, taskName, 'read')).dueDay,
            ),
          );
          expect(new Set(dueDays).size).toBe(1);
          expect(dueDays[0]).not.toBeNull();
        };
        await expectConverged();

        // Replay from the persisted op log must reach the same state, and
        // nothing may upload again: a re-sent copy would count time twice.
        for (const client of clients) {
          await client.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
          await waitForAppReady(client.page);
          await waitForTask(client.page, taskName);
          await blockBackgroundSync(client);
        }
        await expectConverged();
        for (const client of clients) {
          await sync(client);
        }
        await expectConverged();

        const clientD = await createSimulatedClient(browser, baseURL!, 'D', testRunId);
        clients.push(clientD);
        await clientD.sync.setupSuperSync(syncConfig);
        await clientD.sync.syncAndWait();
        await waitForTask(clientD.page, taskName);
        await expectConverged();
      } finally {
        for (const client of clients) {
          await closeClient(client);
        }
      }
    });
  }
});

/**
 * The time a released device's own `syncTimeSpent` ops booked on the task,
 * read from its op log: v19.1.0 exposes no store helper.
 */
const ownTrackedTime = async (
  client: SimulatedE2EClient,
  taskId: string,
): Promise<number> =>
  client.page.evaluate(
    (id) =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open('SUP_OPS');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const all = request.result
            .transaction('ops', 'readonly')
            .objectStore('ops')
            .getAll();
          all.onerror = () => reject(all.error);
          all.onsuccess = () => {
            let sum = 0;
            for (const entry of all.result as {
              source?: string;
              op?: { a?: string; d?: string; p?: Record<string, unknown> };
            }[]) {
              const { op } = entry;
              if (entry.source !== 'local' || op?.a !== 'KT' || op.d !== id) continue;
              const args = (op.p?.actionPayload ?? op.p) as { duration?: unknown };
              sum += typeof args.duration === 'number' ? args.duration : 0;
            }
            resolve(sum);
          };
        };
      }),
    taskId,
  );

/**
 * A released (v19.1.0) device tracks the same task through its real UI and
 * uploads first; the current device resolves in either direction. Receivers
 * see only `syncTimeSpent` deltas and an LWW snapshot, shapes v19.1.0 applies.
 */
test.describe('@supersync released time tracked concurrently on an unscheduled task (#10378)', () => {
  test.describe.configure({ mode: 'serial' });
  const oldAssets = process.env.COMPAT_OLD_ASSETS;
  test.skip(!oldAssets, 'Set COMPAT_OLD_ASSETS to the unmodified released assets');
  let assets: Awaited<ReturnType<typeof serveReleasedClientAssets>>;
  test.beforeAll(async () => {
    // A free port: other released suites may serve their bundle concurrently.
    assets = await serveReleasedClientAssets({ old: oldAssets!, new: oldAssets! }, 0);
  });
  test.afterAll(async () => assets?.close());

  for (const direction of ['pending loses', 'pending wins'] as const) {
    test(`a released tracker's and the current device's time both survive when the current ${direction}`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      test.setTimeout(300000);

      const taskName = `ReleasedAutoPlan-${direction.replace(' ', '-')}-${Date.now()}`;
      const clients: SimulatedE2EClient[] = [];

      try {
        const syncConfig = getSuperSyncConfig(await createTestUser(testRunId));
        const current = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
        clients.push(current);
        await current.sync.setupSuperSync(syncConfig);
        await current.workView.addTask(taskName);
        await waitForTask(current.page, taskName);
        const { id: taskId } = await onTask(current, taskName, 'unschedule');
        await expect
          .poll(async () => (await onTask(current, taskName, 'read')).dueDay)
          .toBeNull();
        await current.sync.syncAndWait();

        const released = await createSimulatedClient(
          browser,
          assets.url,
          'Released',
          testRunId,
          { serviceWorkers: 'block' },
        );
        clients.push(released);
        await released.sync.setupSuperSync(syncConfig);
        await released.sync.syncAndWait();
        for (const client of clients) {
          await blockBackgroundSync(client);
        }
        // The unscheduled task is listed in the Inbox project.
        await released.page.goto(`${assets.url}/#/project/INBOX_PROJECT/tasks`);
        await waitForTask(released.page, taskName);
        const trackReleased = async (): Promise<void> => {
          await startTimeTracking(released, taskName);
          // Tracking needs elapsed time; the delta op is written when it stops.
          await released.page.waitForTimeout(2500);
          await stopTimeTracking(released, taskName);
          await expect
            .poll(() => ownTrackedTime(released, taskId), { timeout: 15000 })
            .toBeGreaterThan(0);
        };

        let trackedCurrent: number;
        if (direction === 'pending loses') {
          // The released device tracks later, so its side wins on the current one.
          trackedCurrent = await track(current, taskName);
          await trackReleased();
          await sync(released);
          await sync(current);
        } else {
          await trackReleased();
          await sync(released);
          trackedCurrent = await track(current, taskName);
          await sync(current);
        }
        for (let round = 0; round < 2; round++) {
          for (const client of clients) {
            await sync(client);
          }
        }
        const expected = trackedCurrent + (await ownTrackedTime(released, taskId));

        await expectExactTaskTime(current, taskName, expected);
        await current.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await waitForAppReady(current.page);
        await waitForTask(current.page, taskName);
        await expectExactTaskTime(current, taskName, expected);

        // What the released device received: a fresh device reads the same
        // server stream, and the released device's own replay reaches it too.
        const fresh = await createSimulatedClient(browser, baseURL!, 'D', testRunId);
        clients.push(fresh);
        await fresh.sync.setupSuperSync(syncConfig);
        await fresh.sync.syncAndWait();
        await waitForTask(fresh.page, taskName);
        await expectExactTaskTime(fresh, taskName, expected);
        await released.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await waitForAppReady(released.page, { ensureRoute: false });
        await waitForTask(released.page, taskName);
        await expectExactTaskTime(released, taskName, expected);
      } finally {
        for (const client of clients) {
          await closeClient(client);
        }
      }
    });
  }
});
