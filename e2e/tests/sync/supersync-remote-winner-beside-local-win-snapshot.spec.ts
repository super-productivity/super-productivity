import type { Browser, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  getTaskElement,
  recordTaskTimeDelta,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { serveReleasedClientAssets } from '../../utils/released-client-assets';

/**
 * #10438: C renamed a task. One download brings it B's older, opaque
 * `planTasksForToday` (with tracked time) and A's newer edit of the task,
 * followed by time A tracked. Conflicts are resolved per remote op, so C's
 * rename beats the plan with a whole-task snapshot read before the batch and
 * loses to A's edit, which applies after the snapshot on C only.
 *
 * A's later time delta is folded into the snapshot together with its clock,
 * which also covers A's edit. So the server accepts the snapshot instead of
 * rejecting it as concurrent (which would rebuild it from post-batch state),
 * and every other device takes it without A's edit; C keeps the edit.
 *
 * The snapshot now carries the plain fields (title, notes) of its task's
 * remote winners, which follow it (`buildTimeAwareResolutionBatches`).
 * - `remoteEdit: 'title'` is the pinned fuzz trace (sync-fuzz-pinned-
 *   traces.json, class stale-local-win-snapshot): A's newer rename wins the
 *   title. Before the fix C showed A's title, the others C's.
 * - `remoteEdit: 'notes'` is the other direction: C's rename keeps the title
 *   and A's newer notes edit wins its field. Before the fix C showed A's
 *   notes, the others none.
 * In both, C's rename beat the older plan whole-task (#10393 decision 6).
 */

const SEED_TIME = new Date('2026-08-04T08:00:00');
const PLAN_TIME = new Date('2026-08-04T09:00:00');
const LOCAL_TIME = new Date('2026-08-04T09:01:00');
const REMOTE_EDIT_TIME = new Date('2026-08-04T09:02:00');
const RESOLVE_TIME = new Date('2026-08-04T09:03:00');
const TODAY = '2026-08-04';
const TRACKED_MS = 60000;
const TRACKED_MS_A = 30000;
const FUTURE_DAY = '2026-08-08';

interface TaskView {
  title: string;
  notes: string | null;
  dueDay: string | null;
  timeSpent: number;
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
    type TaskLike = {
      id: string;
      title: string;
      notes?: string;
      dueDay?: string | null;
      timeSpent?: number;
    };
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
    return {
      id: task.id,
      title: task.title,
      notes: task.notes || null,
      dueDay: task.dueDay ?? null,
      timeSpent: task.timeSpent ?? 0,
    };
  }, query);

/** `TaskService.update`'s action, as the title and notes editors dispatch it. */
const updateTask = (
  page: Page,
  id: string,
  changes: { title: string } | { notes: string },
): Promise<void> =>
  dispatchPersistentAction(page, {
    type: '[Task Shared] updateTask',
    task: { id, changes },
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

/** The planner's own action, with the full task entity it reads. */
const planForFutureDay = async (page: Page, id: string): Promise<void> => {
  const dispatched = await page.evaluate(
    ({ taskId, day }) => {
      type StoreLike = {
        subscribe: (next: (state: unknown) => void) => { unsubscribe: () => void };
        dispatch: (value: unknown) => void;
      };
      const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
        .__e2eTestHelpers?.store;
      if (!store) return false;
      let state: { tasks?: { entities?: Record<string, unknown> } } = {};
      store.subscribe((value) => (state = value as typeof state)).unsubscribe();
      const task = state.tasks?.entities?.[taskId];
      if (!task) return false;
      store.dispatch({
        type: '[Planner] Plan Task for Day',
        task,
        day,
        meta: {
          isPersistent: true,
          entityType: 'PLANNER',
          entityId: taskId,
          opType: 'UPD',
        },
      });
      return true;
    },
    { taskId: id, day: FUTURE_DAY },
  );
  expect(dispatched).toBe(true);
};

const runCrossing = async (
  {
    browser,
    baseURL,
    testRunId,
  }: { browser: Browser; baseURL?: string; testRunId: string },
  remoteEdit: 'title' | 'notes',
  releasedUrl?: string,
): Promise<void> => {
  const appUrl = baseURL || 'http://localhost:4242';
  const editA = `Written on A ${testRunId}`;
  const titleC = `Renamed on C ${testRunId}`;
  const clients: SimulatedE2EClient[] = [];
  const releasedClients: SimulatedE2EClient[] = [];

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
    await planForFutureDay(clientA.page, id);
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
      notes: null,
      dueDay: FUTURE_DAY,
      timeSpent: 0,
    });
    for (const client of clients) await blockBackgroundSync(client);
    // A released (v19.1.0) receiver of C's snapshot; it reads in its UI.
    let released: SimulatedE2EClient | undefined;
    if (releasedUrl) {
      released = await createSimulatedClient(browser, releasedUrl, 'D', testRunId, {
        serviceWorkers: 'block',
      });
      releasedClients.push(released);
      await released.sync.setupSuperSync(syncConfig);
      await released.sync.syncAndWait();
    }

    // B tracks time on the task, which also plans it for today; C renames
    // it; A edits it: each later than the last.
    await clientB.page.clock.setFixedTime(PLAN_TIME);
    await clientB.sync.syncAndWait();
    await planForToday(clientB.page, id);
    await expect
      .poll(async () => (await readTask(clientB.page, { id })).dueDay)
      .toBe(TODAY);
    await recordTaskTimeDelta(clientB, seeded.title, TODAY, TRACKED_MS);
    await expect
      .poll(async () => (await readTask(clientB.page, { id })).timeSpent)
      .toBe(TRACKED_MS);
    await clientB.sync.syncAndWait();

    await clientC.page.clock.setFixedTime(LOCAL_TIME);
    await updateTask(clientC.page, id, { title: titleC });
    await expect
      .poll(async () => (await readTask(clientC.page, { id })).title)
      .toBe(titleC);

    await clientA.page.clock.setFixedTime(REMOTE_EDIT_TIME);
    await clientA.sync.syncAndWait();
    await updateTask(
      clientA.page,
      id,
      remoteEdit === 'title' ? { title: editA } : { notes: editA },
    );
    const titleOnA = (await readTask(clientA.page, { id })).title;
    await recordTaskTimeDelta(clientA, titleOnA, TODAY, TRACKED_MS_A);
    await expect
      .poll(async () => (await readTask(clientA.page, { id })).timeSpent)
      .toBe(TRACKED_MS + TRACKED_MS_A);
    await clientA.sync.syncAndWait();

    // C resolves both in one batch; then everyone takes what C uploaded.
    for (const client of clients) await client.page.clock.setFixedTime(RESOLVE_TIME);
    await clientC.sync.syncAndWait();
    await clientC.sync.syncAndWait();
    await clientA.sync.syncAndWait();
    await clientB.sync.syncAndWait();

    // Each field takes its latest write, and each tracked time counts once.
    // The plan is opaque, so where C's rename beat it the day is C's
    // snapshot's; every device must agree on it.
    const { dueDay } = await readTask(clientC.page, { id });
    const expected: TaskView & { id: string } = {
      id,
      title: remoteEdit === 'title' ? editA : titleC,
      notes: remoteEdit === 'notes' ? editA : null,
      dueDay,
      timeSpent: TRACKED_MS + TRACKED_MS_A,
    };
    for (const client of clients) {
      expect(await readTask(client.page, { id }), client.clientName).toEqual(expected);
    }
    if (released) {
      await released.sync.syncAndWait();
      for (let restart = 0; restart < 2; restart++) {
        if (restart) await released.page.reload();
        await released.page.goto('/#/project/INBOX_PROJECT/tasks');
        await expect(getTaskElement(released, expected.title).first()).toBeVisible();
      }
    }

    // A restart replays each op log to the same task.
    for (const client of clients) {
      await client.page.reload();
      await client.workView.waitForTaskList();
      expect(await readTask(client.page, { id }), client.clientName).toEqual(expected);
    }
  } finally {
    for (const client of [...clients, ...releasedClients]) await closeClient(client);
  }
};

test.describe('@supersync remote winner beside a local-win snapshot of its task', () => {
  test.describe.configure({ mode: 'serial' });

  test('a remote rename newer than a local one, beside an older plan, converges (#10438)', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(240000);
    await runCrossing({ browser, baseURL, testRunId }, 'title');
  });

  test('a remote notes edit newer than a local rename, beside an older plan, converges', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(240000);
    await runCrossing({ browser, baseURL, testRunId }, 'notes');
  });
});

// Supply the untouched released web assets (COMPAT_OLD_ASSETS, see
// e2e/README.md). The fix changes only the values of C's replace row, a shape
// v19.1.0 already applies; this checks that a released device takes them.
test.describe('@supersync released receiver of a local-win snapshot with remote-winner fields', () => {
  test.describe.configure({ mode: 'serial' });
  const oldAssets = process.env.COMPAT_OLD_ASSETS;
  test.skip(!oldAssets, 'Set COMPAT_OLD_ASSETS to the unmodified released assets');
  let assets: Awaited<ReturnType<typeof serveReleasedClientAssets>>;
  test.beforeAll(async () => {
    assets = await serveReleasedClientAssets({ old: oldAssets!, new: oldAssets! }, 0);
  });
  test.afterAll(async () => assets?.close());

  for (const remoteEdit of ['title', 'notes'] as const) {
    test(`a released device takes the snapshot beside a remote ${remoteEdit} edit`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      test.setTimeout(300000);
      await runCrossing({ browser, baseURL, testRunId }, remoteEdit, assets.url);
    });
  }
});
