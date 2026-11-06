import type { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/supersync.fixture';
import {
  archiveDoneTasks,
  closeClient,
  createSimulatedClient,
  createTestUser,
  getArchiveYoungTaskIds,
  getSuperSyncConfig,
  getTaskElement,
  markSubtaskDone,
  markTaskDoneByKey,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * Cross-batch archive vs `[TASK] LWW Update` — three clients.
 *
 * A concurrent SUBTASK edit used to escape the archive-wins rule: the
 * `moveToArchive` op declared only top-level ids, so the subtask's own conflict
 * was resolved by plain LWW and the winner snapshot was uploaded with a seq
 * AFTER the archive. Whether that snapshot resurrected the subtask then
 * depended purely on batching — a third client that had already downloaded the
 * archive received the LWW Update alone and recreated the subtask in active
 * state next to its archived copy (and again on every reload).
 *
 * Choreography (WebSocket + immediate upload are blocked by `setupSuperSync`,
 * so every transfer below is an explicit `syncAndWait()`):
 *   1. A creates parent P with subtask S, syncs; B and C sync (all three equal)
 *   2. B — without syncing — marks S done, marks P done, archives via Finish Day
 *   3. A — without syncing — renames S (its edit is newer than B's done-update)
 *   4. B syncs (uploads the done-updates + the archive)
 *   5. C syncs (receives them: P and S leave active state, enter the archive)
 *   6. A syncs (its update(S) conflicts; archive precedence must win)
 *   7. C syncs again — whatever A produced arrives ALONE in its own batch
 *
 * The fix is upstream: `moveToArchive.meta.entityIds` now declares the cascaded
 * subtask ids, so A's edit conflicts with the archive op itself and archive
 * precedence resolves it before any LWW Update exists. The outcome assertions
 * are the point; the intermediate op shapes are not observable from the UI and
 * are covered by the specs in `src/app/op-log/sync/` and `root-store/meta/`.
 *
 * Prerequisites: super-sync-server on localhost:1901 with TEST_MODE=true.
 */

/** Remote ops apply through an async pipeline — same window as sibling specs. */
const REMOTE_APPLY_TIMEOUT = 15000;

interface ActiveTask {
  id: string;
  title: string;
}

/**
 * Every task in the ACTIVE NgRx slice. Archived tasks never render, so the DOM
 * cannot distinguish "gone" from "archived"; only the store can.
 */
const getActiveTasks = (page: Page): Promise<ActiveTask[]> =>
  page.evaluate(() => {
    type TaskLike = { id: string; title: string };
    type StoreState = { tasks?: { entities?: Record<string, TaskLike | undefined> } };
    type StoreLike = {
      subscribe: (next: (state: StoreState) => void) => { unsubscribe: () => void };
    };
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) throw new Error('__e2eTestHelpers.store missing');

    let state: StoreState | undefined;
    store.subscribe((value) => (state = value)).unsubscribe();
    return Object.values(state?.tasks?.entities ?? {})
      .filter((task): task is TaskLike => !!task)
      .map((task) => ({ id: task.id, title: task.title }));
  });

const getActiveTaskIdByTitle = async (page: Page, marker: string): Promise<string> => {
  const matches = (await getActiveTasks(page)).filter((task) =>
    task.title.includes(marker),
  );
  expect(matches, `exactly one active task should match "${marker}"`).toHaveLength(1);
  return matches[0].id;
};

/**
 * Dispatch a persistent action straight into the store. Used for the subtask
 * rename because the `renameTask` helper cannot target a subtask: subtasks are
 * rendered INSIDE their parent's `<task>` element, so `task:has-text(<subtask>)`
 * matches both and trips Playwright's strict mode. The captured op is the same
 * one the title editor produces.
 */
const renameTaskViaStore = async (
  client: SimulatedE2EClient,
  taskId: string,
  title: string,
): Promise<void> => {
  const dispatched = await client.page.evaluate(
    ({ id, newTitle }) => {
      type StoreLike = { dispatch: (value: unknown) => void };
      const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
        .__e2eTestHelpers?.store;
      if (!store) return false;
      store.dispatch({
        type: '[Task Shared] updateTask',
        task: { id, changes: { title: newTitle } },
        meta: {
          isPersistent: true,
          entityType: 'TASK',
          entityId: id,
          opType: 'UPD',
        },
      });
      return true;
    },
    { id: taskId, newTitle: title },
  );
  expect(dispatched, 'store dispatch helper must be available').toBe(true);

  // Assert against the store: an uncaptured rename would never become an op.
  await expect
    .poll(async () => (await getActiveTasks(client.page)).map((task) => task.title))
    .toContain(title);
};

/**
 * Both tasks are live in ACTIVE state. Guards the later "gone" assertions
 * against passing vacuously on a client that never received them.
 */
const expectInActiveState = async (
  client: SimulatedE2EClient,
  ids: string[],
): Promise<void> => {
  await expect
    .poll(
      async () => {
        const activeIds = (await getActiveTasks(client.page)).map((task) => task.id);
        return ids.filter((id) => !activeIds.includes(id));
      },
      {
        timeout: REMOTE_APPLY_TIMEOUT,
        message: `Client ${client.clientName}: ids missing from active state`,
      },
    )
    .toEqual([]);
};

/**
 * No trace of the archived family in ACTIVE state — neither by id (a
 * resurrected entity) nor by title (a duplicate under a fresh id).
 */
const expectNoActiveTraceOf = async (
  client: SimulatedE2EClient,
  expected: { ids: string[]; titleMarkers: string[] },
): Promise<void> => {
  await expect
    .poll(
      async () => {
        const tasks = await getActiveTasks(client.page);
        return {
          byId: tasks.filter((task) => expected.ids.includes(task.id)).map((t) => t.id),
          byTitle: tasks
            .filter((task) => expected.titleMarkers.some((m) => task.title.includes(m)))
            .map((task) => task.title),
        };
      },
      {
        timeout: REMOTE_APPLY_TIMEOUT,
        message: `Client ${client.clientName}: archived tasks must not exist in active state`,
      },
    )
    .toEqual({ byId: [], byTitle: [] });
};

/** The durable young archive must hold every given id. */
const expectInDurableArchive = async (
  client: SimulatedE2EClient,
  ids: string[],
): Promise<void> => {
  await expect
    .poll(
      async () => {
        const archivedIds = await getArchiveYoungTaskIds(client.page);
        return ids.filter((id) => !archivedIds.includes(id));
      },
      {
        timeout: REMOTE_APPLY_TIMEOUT,
        message: `Client ${client.clientName}: ids missing from the durable archive`,
      },
    )
    .toEqual([]);
};

/** Re-arm the sync blocks a reload clears (they live on `globalThis`). */
const blockBackgroundSync = async (client: SimulatedE2EClient): Promise<void> => {
  await client.page.evaluate(() => {
    const e2eGlobal = globalThis as typeof globalThis & {
      __SP_E2E_BLOCK_IMMEDIATE_UPLOAD?: boolean;
      __SP_E2E_BLOCK_WS_DOWNLOAD?: boolean;
    };
    e2eGlobal.__SP_E2E_BLOCK_IMMEDIATE_UPLOAD = true;
    e2eGlobal.__SP_E2E_BLOCK_WS_DOWNLOAD = true;
  });
};

test.describe('@supersync Cross-batch archive vs LWW Update', () => {
  test('a late LWW Update for an archived subtask must not resurrect it @supersync', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(240000);
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let clientC: SimulatedE2EClient | null = null;

    const parentTitle = `${testRunId}-XBatchParent`;
    const subTitle = `${testRunId}-XBatchSub`;
    const renamedSubTitle = `${subTitle}-renamed`;
    const titleMarkers = [parentTitle, subTitle, renamedSubTitle];

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ===== PHASE 1: A seeds P + S; B and C download them =====
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      await clientA.workView.addTask(parentTitle);
      await clientA.workView.addSubTask(
        getTaskElement(clientA, parentTitle).first(),
        subTitle,
      );

      const parentId = await getActiveTaskIdByTitle(clientA.page, parentTitle);
      const subTaskId = await getActiveTaskIdByTitle(clientA.page, subTitle);
      const archivedIds = [parentId, subTaskId];
      await clientA.sync.syncAndWait();

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      await expectInActiveState(clientB, archivedIds);

      clientC = await createSimulatedClient(browser, baseURL!, 'C', testRunId);
      await clientC.sync.setupSuperSync(syncConfig);
      await clientC.sync.syncAndWait();
      await expectInActiveState(clientC, archivedIds);
      console.log('[XBatch] All three clients hold P + S');

      // ===== PHASE 2: B completes and archives the family (no sync) =====
      await markSubtaskDone(clientB, subTitle);
      await markTaskDoneByKey(clientB, parentTitle);
      await archiveDoneTasks(clientB);
      console.log('[XBatch] Client B archived P + S locally');

      // ===== PHASE 3: A renames S (no sync) — newer than B's done-update =====
      await renameTaskViaStore(clientA, subTaskId, renamedSubTitle);
      console.log('[XBatch] Client A renamed S locally');

      // ===== PHASE 4+5: B uploads, then C downloads the archive =====
      await clientB.sync.syncAndWait();
      await clientC.sync.syncAndWait();
      await expectNoActiveTraceOf(clientC, { ids: archivedIds, titleMarkers });
      await expectInDurableArchive(clientC, archivedIds);
      console.log('[XBatch] Client C archived P + S via sync (baseline)');

      // ===== PHASE 6: A syncs — its update(S) must lose to the archive =====
      // The second sync uploads anything conflict resolution re-created, so the
      // pre-fix `[TASK] LWW Update` for S definitely reaches the server.
      await clientA.sync.syncAndWait();
      await clientA.sync.syncAndWait();
      console.log('[XBatch] Client A synced (conflict resolved)');

      // ===== PHASE 7: C syncs again — A's ops arrive in their OWN batch =====
      // C is already up to date with B, so this download contains only what A
      // just uploaded. That isolation is what made the bug reachable.
      await clientC.sync.syncAndWait();
      await expectNoActiveTraceOf(clientC, { ids: archivedIds, titleMarkers });
      await expectInDurableArchive(clientC, archivedIds);
      console.log('[XBatch] Client C: no resurrection after the late batch');

      // ===== PHASE 8: the result must survive a reload =====
      // On boot the hydrator replays the local op tail; nothing in it may
      // recreate S.
      await clientC.page.reload();
      await clientC.workView.waitForTaskList();
      await blockBackgroundSync(clientC);
      await expectNoActiveTraceOf(clientC, { ids: archivedIds, titleMarkers });

      await clientC.sync.syncAndWait();
      await expectNoActiveTraceOf(clientC, { ids: archivedIds, titleMarkers });
      await expectInDurableArchive(clientC, archivedIds);
      console.log('[XBatch] Client C: still clean after reload + sync');

      // ===== PHASE 9: A converges the same way (archive wins over its edit) =====
      // A's rename is intentionally dropped — that is the archive-wins design.
      // If a future change makes the edit win, this assertion must be revisited
      // deliberately rather than silently.
      await clientA.sync.syncAndWait();
      await expectNoActiveTraceOf(clientA, { ids: archivedIds, titleMarkers });
      await expectInDurableArchive(clientA, archivedIds);
      console.log('[XBatch] Client A: edit dropped, nothing resurrected');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
      if (clientC) await closeClient(clientC);
    }
  });
});
