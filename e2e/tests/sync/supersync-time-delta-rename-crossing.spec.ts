import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  recordTaskTimeDelta,
  expectExactTaskTime,
  renameTask,
  getTaskElement,
  getTaskTitleFromState,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { waitForAppReady } from '../../utils/waits';
import { TagPage } from '../../pages/tag.page';

/**
 * #10214 follow-up. A pending task-time delta crossing a concurrent remote edit
 * of the task's other fields (or a pending edit crossing a remote delta) is
 * applied without a conflict, but the pending op keeps a vector clock that
 * does not include the remote op. The server only lets two concurrent time
 * deltas through, so it rejected the pending op; the client then re-downloaded
 * the whole history from seq 0 and re-sent the task as an absolute LWW
 * snapshot, which overwrote time a third device tracked concurrently.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Only explicit syncs run, so every crossing happens in the stated order. */
const blockBackgroundSync = async (client: SimulatedE2EClient): Promise<void> => {
  await client.page.evaluate(() => {
    const flags = globalThis as typeof globalThis & Record<string, boolean>;
    flags['__SP_E2E_BLOCK_AUTO_SYNC'] = true;
    flags['__SP_E2E_BLOCK_WS_DOWNLOAD'] = true;
    flags['__SP_E2E_BLOCK_IMMEDIATE_UPLOAD'] = true;
  });
};

/** Fail on the dataset conflict dialog or an error instead of resolving it. */
const sync = async (client: SimulatedE2EClient): Promise<void> => {
  const downloaded = client.page.waitForResponse(
    (response) =>
      response.url().includes('/api/sync/ops') && response.request().method() === 'GET',
  );
  await client.sync.clickSyncBtn();
  expect((await downloaded).ok()).toBe(true);
  const outcome = async (): Promise<string> => {
    if (await client.sync.conflictDialog.isVisible()) return 'conflict-dialog';
    if (await client.sync.hasSyncError()) return 'error';
    const spinning = await client.sync.syncSpinner.isVisible();
    const checked = await client.sync.syncConfirmedIcon.isVisible();
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

/** Full-history downloads: the rejection handler's `forceFromSeq0` retry. */
const recordForcedDownloads = (clients: SimulatedE2EClient[]): string[] => {
  const forced: string[] = [];
  for (const client of clients) {
    client.page.on('request', (request) => {
      if (
        request.method() === 'GET' &&
        request.url().includes('/api/sync/ops?') &&
        new URL(request.url()).searchParams.get('sinceSeq') === '0'
      ) {
        forced.push(client.clientName);
      }
    });
  }
  return forced;
};

/** Full-state uploads, e.g. a REPAIR of state a receiver found invalid. */
const recordFullStateUploads = (clients: SimulatedE2EClient[]): string[] => {
  const uploads: string[] = [];
  for (const client of clients) {
    client.page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/api/sync/snapshot')) {
        uploads.push(client.clientName);
      }
    });
  }
  return uploads;
};

type TaskStep =
  | { kind: 'read' }
  | { kind: 'dueDay'; day: string }
  | { kind: 'plannerMove'; prevDay: string; newDay: string };

/**
 * Dispatches one real persistent action on the task through the store, or
 * only reads it, and returns the task's tag and planning fields afterwards.
 */
const onTask = async (
  client: SimulatedE2EClient,
  taskName: string,
  step: TaskStep,
): Promise<{ tagIds: string[]; dueDay: string | null }> =>
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
      const meta = (entityType: string, opType: string): Record<string, unknown> => ({
        isPersistent: true,
        entityType,
        entityId: task.id,
        opType,
      });
      if (taskStep.kind === 'dueDay') {
        store.dispatch({
          type: '[Task Shared] updateTask',
          task: { id: task.id, changes: { dueDay: taskStep.day } },
          meta: meta('TASK', 'UPD'),
        });
      } else if (taskStep.kind === 'plannerMove') {
        const now = new Date();
        const pad = (value: number): string => String(value).padStart(2, '0');
        store.dispatch({
          type: '[Planner] Transfer Task',
          task,
          prevDay: taskStep.prevDay,
          newDay: taskStep.newDay,
          targetIndex: 0,
          today: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
          meta: meta('PLANNER', 'MOV'),
        });
      }
      const current = await readTask();
      return {
        tagIds: [...((current.tagIds as string[] | undefined) ?? [])],
        dueDay: (current.dueDay as string | undefined) ?? null,
      };
    },
    { name: taskName, taskStep: step },
  );

/** A local calendar day `offset` days from today, as the app stores it. */
const dayFromToday = (offset: number): string => {
  const day = new Date();
  day.setDate(day.getDate() + offset);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
};

const recordRejections = (clients: SimulatedE2EClient[]): string[] => {
  const rejections: string[] = [];
  for (const client of clients) {
    client.page.on('response', async (response) => {
      if (
        response.request().method() !== 'POST' ||
        !response.url().includes('/api/sync/ops')
      ) {
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      const results = isRecord(body) && Array.isArray(body.results) ? body.results : [];
      for (const result of results) {
        if (isRecord(result) && result.accepted === false) {
          rejections.push(`${client.clientName}:${String(result.errorCode)}`);
        }
      }
    });
  }
  return rejections;
};

test.describe('@supersync time delta crossing a concurrent task edit', () => {
  // 'delta': A's pending delta crosses B's rename that reached the server first.
  // 'rename': B's pending rename crosses A's delta that reached the server first.
  // C tracks time concurrently in both, so an absolute re-send would lose time.
  for (const pendingSide of ['delta', 'rename'] as const) {
    test(`pending ${pendingSide} crossing keeps time additive without a full re-download`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      test.setTimeout(300000);

      const taskDate = '2026-07-13';
      const initialTime = 10000;
      const deltaA = 3000;
      const deltaC = 5000;
      const expectedTime = initialTime + deltaA + deltaC;
      const taskName = `DeltaCrossing-${pendingSide}-${Date.now()}`;
      const renamedTitle = `${taskName}-Renamed`;
      const clients: SimulatedE2EClient[] = [];

      try {
        const syncConfig = getSuperSyncConfig(await createTestUser(testRunId));
        const clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
        clients.push(clientA);
        await clientA.sync.setupSuperSync(syncConfig);
        await clientA.workView.addTask(taskName);
        await waitForTask(clientA.page, taskName);
        await recordTaskTimeDelta(clientA, taskName, taskDate, initialTime);
        await clientA.sync.syncAndWait();

        const clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
        clients.push(clientB);
        const clientC = await createSimulatedClient(browser, baseURL!, 'C', testRunId);
        clients.push(clientC);
        for (const client of [clientB, clientC]) {
          await client.sync.setupSuperSync(syncConfig);
          await client.sync.syncAndWait();
          await waitForTask(client.page, taskName);
          await expectExactTaskTime(client, taskName, initialTime);
        }

        for (const client of clients) {
          await blockBackgroundSync(client);
        }
        const forcedDownloads = recordForcedDownloads(clients);
        const rejections = recordRejections(clients);

        if (pendingSide === 'delta') {
          await recordTaskTimeDelta(clientA, taskName, taskDate, deltaA);
          await recordTaskTimeDelta(clientC, taskName, taskDate, deltaC);
          await renameTask(clientB, taskName, renamedTitle);
          await sync(clientB);
          await sync(clientA);
        } else {
          await renameTask(clientB, taskName, renamedTitle);
          await recordTaskTimeDelta(clientC, taskName, taskDate, deltaC);
          await recordTaskTimeDelta(clientA, taskName, taskDate, deltaA);
          await sync(clientA);
          await sync(clientB);
        }
        // C's pending delta crosses both the rename and A's delta.
        await sync(clientC);
        for (let round = 0; round < 2; round++) {
          for (const client of clients) {
            await sync(client);
          }
        }

        const expectConverged = async (): Promise<void> => {
          for (const client of clients) {
            await expectExactTaskTime(client, taskName, expectedTime);
            await expect
              .poll(() => getTaskTitleFromState(client, taskName), { timeout: 30000 })
              .toBe(renamedTitle);
          }
        };
        await expectConverged();
        expect(forcedDownloads).toEqual([]);
        expect(rejections).toContain(
          pendingSide === 'delta' ? 'A:CONFLICT_CONCURRENT' : 'B:CONFLICT_CONCURRENT',
        );

        // Replay from the persisted op log must reach the same state: a
        // re-appended copy of a delta would count the tracked time twice here.
        for (const client of clients) {
          await client.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
          await waitForAppReady(client.page);
          await waitForTask(client.page, taskName);
        }
        await expectConverged();

        test.info().annotations.push({
          type: 'server rejections',
          description: rejections.join(', ') || 'none',
        });
      } finally {
        for (const client of clients) {
          await closeClient(client);
        }
      }
    });
  }

  // Boot rebuilds the durable clock from the state cache plus the op tail. A
  // rebased op the cache already covers must not hand its counter to the next
  // local op, or receivers drop that op as already applied.
  test('time tracked after a reload follows a rebased delta the state cache covers', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(300000);

    const taskDate = '2026-07-13';
    const taskName = `DeltaCrossingReload-${Date.now()}`;
    const clients: SimulatedE2EClient[] = [];
    const reload = async (client: SimulatedE2EClient): Promise<void> => {
      await client.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      await waitForAppReady(client.page);
      await waitForTask(client.page, taskName);
    };

    try {
      const syncConfig = getSuperSyncConfig(await createTestUser(testRunId));
      const clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      clients.push(clientA);
      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.workView.addTask(taskName);
      await waitForTask(clientA.page, taskName);
      // More than ten ops, so the next reload's replay saves a state cache.
      for (let i = 0; i < 12; i++) {
        await recordTaskTimeDelta(clientA, taskName, taskDate, 1000);
      }
      await clientA.sync.syncAndWait();

      const clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      clients.push(clientB);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskName);
      await expectExactTaskTime(clientB, taskName, 12000);
      for (const client of clients) {
        await blockBackgroundSync(client);
      }
      const rejections = recordRejections(clients);

      await recordTaskTimeDelta(clientA, taskName, taskDate, 3000);
      await renameTask(clientB, taskName, `${taskName}-Renamed`);
      await sync(clientB);
      // The replay caches state covering A's pending delta; the sync then
      // rebases that delta past B's rename.
      await reload(clientA);
      await clientA.sync.syncAndWait();
      expect(rejections).toContain('A:CONFLICT_CONCURRENT');
      await sync(clientB);
      await expectExactTaskTime(clientB, taskName, 15000);

      await reload(clientA);
      await blockBackgroundSync(clientA);
      await recordTaskTimeDelta(clientA, taskName, taskDate, 4000);
      await clientA.sync.syncAndWait();
      await sync(clientB);

      const clientC = await createSimulatedClient(browser, baseURL!, 'C', testRunId);
      clients.push(clientC);
      await clientC.sync.setupSuperSync(syncConfig);
      await clientC.sync.syncAndWait();
      await waitForTask(clientC.page, taskName);
      for (const client of clients) {
        await expectExactTaskTime(client, taskName, 19000);
      }
    } finally {
      for (const client of clients) {
        await closeClient(client);
      }
    }
  });

  // Against B's crossing delta the server rejects A's first rename but accepts
  // A's own delta and A's second rename, which dominates it. Moving the first
  // rename past the second would leave every other device on the first title.
  test('a rejected rename does not overtake a later rename the server accepted', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(300000);

    const taskDate = '2026-07-13';
    const taskName = `DeltaCrossingOrder-${Date.now()}`;
    const clients: SimulatedE2EClient[] = [];

    try {
      const syncConfig = getSuperSyncConfig(await createTestUser(testRunId));
      const clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      clients.push(clientA);
      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.workView.addTask(taskName);
      await waitForTask(clientA.page, taskName);
      await recordTaskTimeDelta(clientA, taskName, taskDate, 10000);
      await clientA.sync.syncAndWait();

      const clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      clients.push(clientB);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskName);
      await expectExactTaskTime(clientB, taskName, 10000);
      for (const client of clients) {
        await blockBackgroundSync(client);
      }
      const rejections = recordRejections(clients);

      await renameTask(clientA, taskName, `${taskName}-First`);
      await recordTaskTimeDelta(clientA, taskName, taskDate, 2000);
      await renameTask(clientA, `${taskName}-First`, `${taskName}-Second`);
      await recordTaskTimeDelta(clientB, taskName, taskDate, 3000);
      await sync(clientB);
      await sync(clientA);
      expect(rejections).toContain('A:CONFLICT_CONCURRENT');
      await sync(clientB);

      for (const client of clients) {
        await expectExactTaskTime(client, taskName, 15000);
        await expect
          .poll(() => getTaskTitleFromState(client, taskName), { timeout: 30000 })
          .toBe(`${taskName}-Second`);
      }
    } finally {
      for (const client of clients) {
        await closeClient(client);
      }
    }
  });

  // Ops of other entity types also write task fields, unseen by the task-level
  // checks: deleting a tag rewrites `tagIds`, a planner move rewrites `dueDay`.
  // A rejected task op moved past this device's own later such op lands after
  // it on every receiver: a deleted tag comes back, an old day wins.
  for (const crossEntityWrite of ['tag deletion', 'planner move'] as const) {
    test(`a rejected task op is not moved past this device's ${crossEntityWrite}`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      test.setTimeout(300000);

      const taskDate = '2026-07-13';
      const taskName = `DeltaCrossingCascade-${Date.now()}`;
      const tagName = `CascadeTag-${Date.now()}`;
      const [firstDay, secondDay] = [dayFromToday(2), dayFromToday(3)];
      const clients: SimulatedE2EClient[] = [];

      try {
        const syncConfig = getSuperSyncConfig(await createTestUser(testRunId));
        const clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
        clients.push(clientA);
        await clientA.sync.setupSuperSync(syncConfig);
        await clientA.workView.addTask(taskName);
        await waitForTask(clientA.page, taskName);
        await recordTaskTimeDelta(clientA, taskName, taskDate, 10000);
        const tagPageA = new TagPage(clientA.page);
        if (crossEntityWrite === 'tag deletion') {
          await tagPageA.createTag(tagName);
        }
        await clientA.sync.syncAndWait();

        const clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
        clients.push(clientB);
        await clientB.sync.setupSuperSync(syncConfig);
        await clientB.sync.syncAndWait();
        await waitForTask(clientB.page, taskName);
        await expectExactTaskTime(clientB, taskName, 10000);
        for (const client of clients) {
          await blockBackgroundSync(client);
        }
        const rejections = recordRejections(clients);
        const fullStateUploads = recordFullStateUploads(clients);

        // A, before syncing: a field write other entity types also write, time,
        // then its own later write of that field through such an entity type.
        if (crossEntityWrite === 'tag deletion') {
          await tagPageA.assignTagToTask(
            getTaskElement(clientA, taskName).first(),
            tagName,
          );
          await recordTaskTimeDelta(clientA, taskName, taskDate, 3000);
          await tagPageA.deleteTag(tagName);
        } else {
          await onTask(clientA, taskName, { kind: 'dueDay', day: firstDay });
          await recordTaskTimeDelta(clientA, taskName, taskDate, 3000);
          await onTask(clientA, taskName, {
            kind: 'plannerMove',
            prevDay: firstDay,
            newDay: secondDay,
          });
        }
        const expected = await onTask(clientA, taskName, { kind: 'read' });
        if (crossEntityWrite === 'tag deletion') {
          expect(expected.tagIds).toEqual([]);
        } else {
          expect(expected.dueDay).toBe(secondDay);
        }
        // B's rename reaches the server first, so A's task ops are rejected.
        await renameTask(clientB, taskName, `${taskName}-Renamed`);
        await sync(clientB);
        await sync(clientA);
        expect(rejections).toContain('A:CONFLICT_CONCURRENT');
        for (let round = 0; round < 2; round++) {
          for (const client of clients) {
            await sync(client);
          }
        }

        for (const client of clients) {
          await expect
            .poll(() => onTask(client, taskName, { kind: 'read' }), { timeout: 30000 })
            .toEqual(expected);
          await expectExactTaskTime(client, taskName, 13000);
          await expect
            .poll(() => getTaskTitleFromState(client, taskName), { timeout: 30000 })
            .toBe(`${taskName}-Renamed`);
        }
        // No receiver had to repair state it found invalid (a revived deleted tag).
        expect(fullStateUploads).toEqual([]);
      } finally {
        for (const client of clients) {
          await closeClient(client);
        }
      }
    });
  }
});
