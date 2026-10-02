import type { Browser, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * #10438: one download brings a device two remote ops for a task it renamed
 * locally, an opaque `planTasksForToday` and a rename. Conflicts used to be
 * resolved per remote op, so the local rename, timed between the two, won
 * against the older op with a whole-task snapshot read before the batch and
 * lost to the newer one, which then applied after the snapshot on that device
 * only. The device and everyone else ended with different tasks for good.
 *
 * Now the LWW planner makes one decision per entity and batch
 * (`planLwwConflictResolutions`): the local side compares against all of the
 * entity's remote ops, so the same batch never both wins and loses one task.
 * - `newest: 'rename'` is the pinned fuzz trace's order (sync-fuzz-pinned-
 *   traces.json, class stale-local-win-snapshot): plan, local rename, remote
 *   rename. Before the fix C kept A's title and the others C's.
 * - `newest: 'plan'` is the other direction: remote rename, local rename,
 *   plan. Before the fix C kept B's plan and the others the old day. The plan
 *   is opaque, so a newer plan wins the whole task as it would alone
 *   (#10393 decision 6), with A's rename beside it.
 */

const SEED_TIME = new Date('2026-08-04T08:00:00');
const FIRST_TIME = new Date('2026-08-04T09:00:00');
const LOCAL_TIME = new Date('2026-08-04T09:01:00');
const LAST_TIME = new Date('2026-08-04T09:02:00');
const RESOLVE_TIME = new Date('2026-08-04T09:03:00');
const TODAY = '2026-08-04';
const FUTURE_DAY = '2026-08-08';

interface TaskView {
  title: string;
  dueDay: string | null;
}

/** Only explicit syncs run, so every crossing happens in the stated order. */
const blockBackgroundSync = async (client: SimulatedE2EClient): Promise<void> => {
  await client.page.evaluate(() => {
    const flags = globalThis as typeof globalThis & Record<string, boolean>;
    flags['__SP_E2E_BLOCK_AUTO_SYNC'] = true;
    flags['__SP_E2E_BLOCK_WS_DOWNLOAD'] = true;
    flags['__SP_E2E_BLOCK_IMMEDIATE_UPLOAD'] = true;
  });
};

const dispatchPersistentAction = async (
  page: Page,
  action: Record<string, unknown>,
): Promise<void> => {
  const dispatched = await page.evaluate((actionToDispatch) => {
    type StoreLike = { dispatch: (value: unknown) => void };
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) return false;
    store.dispatch(actionToDispatch);
    return true;
  }, action);
  expect(dispatched).toBe(true);
};

/** The task with this id, or the id of the task titled `title`. */
const readTask = async (
  page: Page,
  query: { id: string } | { title: string },
): Promise<TaskView & { id: string }> =>
  page.evaluate((q) => {
    type TaskLike = { id: string; title: string; dueDay?: string | null };
    type StoreLike = {
      subscribe: (next: (state: unknown) => void) => { unsubscribe: () => void };
    };
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) throw new Error('__e2eTestHelpers.store missing');
    let state: { tasks?: { entities?: Record<string, TaskLike | undefined> } } = {};
    store.subscribe((value) => (state = value as typeof state)).unsubscribe();
    const tasks = Object.values(state.tasks?.entities ?? {});
    const task = tasks.find((t) => ('id' in q ? t?.id === q.id : t?.title === q.title));
    if (!task) throw new Error(`Task not found: ${JSON.stringify(q)}`);
    return { id: task.id, title: task.title, dueDay: task.dueDay ?? null };
  }, query);

const rename = (page: Page, id: string, title: string): Promise<void> =>
  dispatchPersistentAction(page, {
    type: '[Task Shared] updateTask',
    task: { id, changes: { title } },
    meta: { isPersistent: true, entityType: 'TASK', entityId: id, opType: 'UPD' },
  });

const planForToday = (page: Page, id: string): Promise<void> =>
  dispatchPersistentAction(page, {
    type: '[Task Shared] planTasksForToday',
    taskIds: [id],
    today: TODAY,
    startOfNextDayDiffMs: 0,
    parentTaskMap: {},
    meta: {
      isPersistent: true,
      entityType: 'TASK',
      entityIds: [id],
      opType: 'UPD',
      isBulk: true,
    },
  });

const runCrossing = async (
  {
    browser,
    baseURL,
    testRunId,
  }: { browser: Browser; baseURL?: string; testRunId: string },
  newest: 'rename' | 'plan',
): Promise<void> => {
  const appUrl = baseURL || 'http://localhost:4242';
  const titleA = `Renamed on A ${testRunId}`;
  const titleC = `Renamed on C ${testRunId}`;
  const clients: SimulatedE2EClient[] = [];

  try {
    const syncConfig = getSuperSyncConfig(await createTestUser(testRunId));
    const join = async (name: string): Promise<SimulatedE2EClient> => {
      const client = await createSimulatedClient(browser, appUrl, name, testRunId);
      clients.push(client);
      await client.page.clock.setFixedTime(SEED_TIME);
      await client.page.reload();
      await client.workView.waitForTaskList();
      await client.sync.setupSuperSync(syncConfig);
      return client;
    };

    // A creates the task on a future day, so a plan for today changes it.
    const clientA = await join('A');
    await clientA.workView.addTask('Crossing');
    const { id } = await readTask(clientA.page, { title: `A-${testRunId}-Crossing` });
    const seeded = await readTask(clientA.page, { id });
    await dispatchPersistentAction(clientA.page, {
      type: '[Planner] Plan Task for Day',
      task: seeded,
      day: FUTURE_DAY,
      meta: { isPersistent: true, entityType: 'PLANNER', entityId: id, opType: 'UPD' },
    });
    await expect
      .poll(async () => (await readTask(clientA.page, { id })).dueDay)
      .toBe(FUTURE_DAY);
    await clientA.sync.syncAndWait();
    const clientB = await join('B');
    await clientB.sync.syncAndWait();
    const clientC = await join('C');
    await clientC.sync.syncAndWait();
    expect(await readTask(clientC.page, { id })).toEqual({
      id,
      title: seeded.title,
      dueDay: FUTURE_DAY,
    });
    for (const client of clients) await blockBackgroundSync(client);

    // The remote ops that reach C in one download, around C's own rename.
    const remoteRename = async (at: Date): Promise<void> => {
      await clientA.page.clock.setFixedTime(at);
      await clientA.sync.syncAndWait();
      await rename(clientA.page, id, titleA);
      await clientA.sync.syncAndWait();
    };
    const remotePlan = async (at: Date): Promise<void> => {
      await clientB.page.clock.setFixedTime(at);
      await clientB.sync.syncAndWait();
      await planForToday(clientB.page, id);
      await expect
        .poll(async () => (await readTask(clientB.page, { id })).dueDay)
        .toBe(TODAY);
      await clientB.sync.syncAndWait();
    };
    const localRename = async (): Promise<void> => {
      await clientC.page.clock.setFixedTime(LOCAL_TIME);
      await rename(clientC.page, id, titleC);
      await expect
        .poll(async () => (await readTask(clientC.page, { id })).title)
        .toBe(titleC);
    };
    if (newest === 'rename') {
      await remotePlan(FIRST_TIME);
      await localRename();
      await remoteRename(LAST_TIME);
    } else {
      await remoteRename(FIRST_TIME);
      await localRename();
      await remotePlan(LAST_TIME);
    }

    // C resolves both in one batch; then everyone takes what C uploaded.
    for (const client of clients) await client.page.clock.setFixedTime(RESOLVE_TIME);
    await clientC.sync.syncAndWait();
    await clientC.sync.syncAndWait();
    await clientA.sync.syncAndWait();
    await clientB.sync.syncAndWait();

    // The latest write wins: A's rename over C's older one, or B's newer
    // opaque plan over C's whole local side; A's rename applies either way.
    const expected: TaskView & { id: string } = { id, title: titleA, dueDay: TODAY };
    for (const client of clients) {
      expect(await readTask(client.page, { id }), client.clientName).toEqual(expected);
    }

    // A restart replays each op log to the same task.
    for (const client of clients) {
      await client.page.reload();
      await client.workView.waitForTaskList();
      expect(await readTask(client.page, { id }), client.clientName).toEqual(expected);
    }
  } finally {
    for (const client of clients) await closeClient(client);
  }
};

test.describe('@supersync one LWW decision per entity and batch', () => {
  test.describe.configure({ mode: 'serial' });

  test('a local rename between an older plan and a newer remote rename converges on the newer rename (#10438)', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(240000);
    await runCrossing({ browser, baseURL, testRunId }, 'rename');
  });

  test('a local rename between an older remote rename and a newer plan converges on the plan', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(240000);
    await runCrossing({ browser, baseURL, testRunId }, 'plan');
  });
});
