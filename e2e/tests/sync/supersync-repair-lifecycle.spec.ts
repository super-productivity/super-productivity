import { expect, test } from '../../fixtures/supersync.fixture';
import type { Page, Response, Route } from '@playwright/test';
import { SuperSyncPage } from '../../pages/supersync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  parseSuperSyncRequestBody,
  renameTask,
  SUPERSYNC_BASE_URL,
  type SimulatedE2EClient,
  waitForTask,
} from '../../utils/supersync-helpers';
import { waitForAppReady } from '../../utils/waits';

interface SnapshotUploadRequest {
  opId?: string;
  repairBaseServerSeq?: number;
  snapshotOpType?: string;
}

interface SnapshotUploadResponse {
  accepted?: boolean;
  errorCode?: string;
  serverSeq?: number;
}

interface StoredRepairOperation {
  baseServerSeq?: number;
  id: string;
  rejectedAt?: number;
  source: 'local' | 'remote';
  syncedAt?: number;
}

interface ServerOperation {
  id: string;
  opType: string;
  serverSeq: number;
}

interface TaskSnapshot {
  id: string;
  tagIds: string[];
  title: string;
}

const getServerOperations = async (userId: number): Promise<ServerOperation[]> => {
  const response = await fetch(
    `${SUPERSYNC_BASE_URL}/api/test/user/${userId}/ops?limit=100`,
  );
  if (!response.ok) {
    throw new Error(
      `Failed to inspect server operations: ${response.status} ${await response.text()}`,
    );
  }
  const body = (await response.json()) as { ops: ServerOperation[] };
  return body.ops;
};

const getLatestServerSeq = async (userId: number): Promise<number> => {
  const operations = await getServerOperations(userId);
  return Math.max(0, ...operations.map(({ serverSeq }) => serverSeq));
};

const getTaskSnapshots = async (
  page: Page,
  exactTitle: string,
): Promise<TaskSnapshot[]> =>
  page.evaluate((title) => {
    type TaskLike = {
      id?: string;
      tagIds?: unknown;
      title?: string;
    };
    type StoreState = {
      task?: { entities?: Record<string, TaskLike | undefined> };
      tasks?: { entities?: Record<string, TaskLike | undefined> };
    };
    type StoreLike = {
      subscribe: (next: (state: StoreState) => void) => { unsubscribe: () => void };
    };

    const store = (
      window as unknown as {
        __e2eTestHelpers?: { store?: StoreLike };
      }
    ).__e2eTestHelpers?.store;
    if (!store) {
      throw new Error('__e2eTestHelpers.store missing');
    }

    let latestState: StoreState | undefined;
    const subscription = store.subscribe((state) => {
      latestState = state;
    });
    subscription.unsubscribe();

    const taskState = latestState?.tasks ?? latestState?.task;
    return Object.values(taskState?.entities ?? {}).flatMap((task) => {
      if (
        task?.title !== title ||
        typeof task.id !== 'string' ||
        !Array.isArray(task.tagIds) ||
        !task.tagIds.every((tagId) => typeof tagId === 'string')
      ) {
        return [];
      }
      return [
        {
          id: task.id,
          tagIds: task.tagIds as string[],
          title: task.title,
        },
      ];
    });
  }, exactTitle);

const addGhostTagReference = async (
  page: Page,
  taskTitle: string,
  ghostTagId: string,
): Promise<void> => {
  await page.evaluate(
    ({ title, tagId }) => {
      type TaskLike = {
        id?: string;
        tagIds?: string[];
        title?: string;
      };
      type StoreState = {
        task?: { entities?: Record<string, TaskLike | undefined> };
        tasks?: { entities?: Record<string, TaskLike | undefined> };
      };
      type StoreLike = {
        dispatch: (action: unknown) => void;
        subscribe: (next: (state: StoreState) => void) => { unsubscribe: () => void };
      };

      const store = (
        window as unknown as {
          __e2eTestHelpers?: { store?: StoreLike };
        }
      ).__e2eTestHelpers?.store;
      if (!store) {
        throw new Error('__e2eTestHelpers.store missing');
      }

      let latestState: StoreState | undefined;
      const subscription = store.subscribe((state) => {
        latestState = state;
      });
      subscription.unsubscribe();

      const taskState = latestState?.tasks ?? latestState?.task;
      const task = Object.values(taskState?.entities ?? {}).find(
        (candidate) => candidate?.title === title,
      );
      if (!task || typeof task.id !== 'string') {
        throw new Error(`Task not found: ${title}`);
      }

      store.dispatch({
        type: '[Task Shared] updateTask',
        task: {
          id: task.id,
          changes: {
            tagIds: [...(task.tagIds ?? []), tagId],
          },
        },
        isIgnoreShortSyntax: true,
        meta: {
          isPersistent: true,
          entityType: 'TASK',
          entityId: task.id,
          opType: 'UPD',
        },
      });
    },
    { title: taskTitle, tagId: ghostTagId },
  );

  await expect
    .poll(async () => (await getTaskSnapshots(page, taskTitle))[0]?.tagIds ?? [])
    .toContain(ghostTagId);
};

const getStoredRepairOperations = async (page: Page): Promise<StoredRepairOperation[]> =>
  page.evaluate(async () => {
    type CompactRepairEntry = {
      op?: {
        b?: number;
        id?: string;
        o?: string;
      };
      rejectedAt?: number;
      source?: 'local' | 'remote';
      syncedAt?: number;
    };

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('SUP_OPS');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    try {
      if (!db.objectStoreNames.contains('ops')) {
        return [];
      }
      const entries = await new Promise<CompactRepairEntry[]>((resolve, reject) => {
        const transaction = db.transaction('ops', 'readonly');
        const request = transaction.objectStore('ops').getAll();
        request.onsuccess = () => resolve(request.result as CompactRepairEntry[]);
        request.onerror = () => reject(request.error);
      });

      return entries.flatMap((entry) => {
        if (
          entry.op?.o !== 'REPAIR' ||
          typeof entry.op.id !== 'string' ||
          (entry.source !== 'local' && entry.source !== 'remote')
        ) {
          return [];
        }
        return [
          {
            id: entry.op.id,
            source: entry.source,
            ...(entry.op.b !== undefined ? { baseServerSeq: entry.op.b } : {}),
            ...(entry.syncedAt !== undefined ? { syncedAt: entry.syncedAt } : {}),
            ...(entry.rejectedAt !== undefined ? { rejectedAt: entry.rejectedAt } : {}),
          },
        ];
      });
    } finally {
      db.close();
    }
  });

const forwardResponse = async (
  route: Route,
  response: Response,
): Promise<SnapshotUploadResponse> => {
  const body = await response.body();
  const decoded = JSON.parse(body.toString('utf8')) as SnapshotUploadResponse;
  await route.fulfill({ response, body });
  return decoded;
};

const expectConvergedTask = async (
  client: SimulatedE2EClient,
  taskTitle: string,
  ghostTagId: string,
): Promise<void> => {
  await waitForTask(client.page, taskTitle);
  await expect
    .poll(() => getTaskSnapshots(client.page, taskTitle), {
      message: `${client.clientName} did not converge to exactly one repaired task`,
    })
    .toHaveLength(1);
  expect((await getTaskSnapshots(client.page, taskTitle))[0].tagIds).not.toContain(
    ghostTagId,
  );
};

test.describe('@supersync REPAIR lifecycle', () => {
  test.describe.configure({ mode: 'serial' });

  test('rebases a stale repair, retries it after reload, and converges all clients', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(240000);

    const appUrl = baseURL || 'http://localhost:4242';
    const taskTitle = `A-${testRunId}-RepairLifecycle`;
    const renamedTaskTitle = `${taskTitle}-RenamedByB`;
    const ghostTagId = `ghost-tag-${testRunId}`;
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let clientC: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.workView.waitForTaskList();
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.workView.waitForTaskList();
      await clientB.sync.setupSuperSync(syncConfig);

      await clientA.workView.addTask(taskTitle);
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, taskTitle);

      await addGhostTagReference(clientB.page, taskTitle, ghostTagId);
      const serverSeqBeforeCorruption = await getLatestServerSeq(user.userId);
      await clientB.sync.syncAndWait();
      const corruptionServerSeq = await getLatestServerSeq(user.userId);
      expect(corruptionServerSeq).toBeGreaterThan(serverSeqBeforeCorruption);

      let firstRepairRequest: SnapshotUploadRequest | undefined;
      let firstRepairResponse: SnapshotUploadResponse | undefined;
      let replacementRepairRequest: SnapshotUploadRequest | undefined;
      let replacementAcceptedResponse: SnapshotUploadResponse | undefined;
      let replacementAbortCount = 0;
      let replacementRetryCount = 0;
      let allowReplacementCommit = false;

      let markFirstRepairSeen!: () => void;
      const firstRepairSeen = new Promise<void>((resolve) => {
        markFirstRepairSeen = resolve;
      });
      let releaseFirstRepair!: () => void;
      const firstRepairRelease = new Promise<void>((resolve) => {
        releaseFirstRepair = resolve;
      });
      let markReplacementAborted!: () => void;
      const replacementAborted = new Promise<void>((resolve) => {
        markReplacementAborted = resolve;
      });
      let markReplacementAccepted!: () => void;
      const replacementAccepted = new Promise<void>((resolve) => {
        markReplacementAccepted = resolve;
      });

      await clientA.page.route('**/api/sync/snapshot', async (route) => {
        const request = parseSuperSyncRequestBody<SnapshotUploadRequest>(route.request());
        if (request.snapshotOpType !== 'REPAIR' || !request.opId) {
          await route.continue();
          return;
        }

        if (!firstRepairRequest) {
          firstRepairRequest = request;
          markFirstRepairSeen();
          await firstRepairRelease;
          const response = await route.fetch();
          firstRepairResponse = await forwardResponse(route, response);
          return;
        }

        if (request.opId === firstRepairRequest.opId) {
          throw new Error(`Stale REPAIR ${request.opId} was uploaded more than once`);
        }

        if (!replacementRepairRequest) {
          replacementRepairRequest = request;
        } else {
          expect(request.opId).toBe(replacementRepairRequest.opId);
          expect(request.repairBaseServerSeq).toBe(
            replacementRepairRequest.repairBaseServerSeq,
          );
        }

        if (!allowReplacementCommit) {
          if (replacementAbortCount === 0) {
            replacementAbortCount++;
            await route.abort('failed');
            markReplacementAborted();
            return;
          }
          // The provider retries one transport failure itself. Keep that retry
          // away from the server with a retryable HTTP response so the one
          // explicit abort still leaves the replacement pending for reload.
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Temporary test outage' }),
          });
          return;
        }

        replacementRetryCount++;
        const response = await route.fetch();
        replacementAcceptedResponse = await forwardResponse(route, response);
        markReplacementAccepted();
      });

      await clientA.sync.syncBtn.click();
      await firstRepairSeen;
      await expect(clientA.sync.syncSpinner).toBeVisible();
      expect(firstRepairRequest?.repairBaseServerSeq).toBe(corruptionServerSeq);

      await renameTask(clientB, taskTitle, renamedTaskTitle);
      await clientB.sync.syncAndWait();
      const concurrentServerSeq = await getLatestServerSeq(user.userId);
      expect(concurrentServerSeq).toBeGreaterThan(corruptionServerSeq);

      releaseFirstRepair();
      await replacementAborted;
      await clientA.sync.syncSpinner.waitFor({ state: 'hidden', timeout: 30000 });

      expect(firstRepairResponse).toMatchObject({
        accepted: false,
        errorCode: 'REPAIR_STALE',
      });
      expect(replacementAbortCount).toBe(1);
      expect(replacementRepairRequest?.opId).not.toBe(firstRepairRequest?.opId);
      expect(replacementRepairRequest?.repairBaseServerSeq).toBe(concurrentServerSeq);

      const repairsBeforeReload = await getStoredRepairOperations(clientA.page);
      const staleRepairBeforeReload = repairsBeforeReload.find(
        ({ id }) => id === firstRepairRequest?.opId,
      );
      const replacementBeforeReload = repairsBeforeReload.find(
        ({ id }) => id === replacementRepairRequest?.opId,
      );
      expect(staleRepairBeforeReload).toMatchObject({
        source: 'local',
        baseServerSeq: corruptionServerSeq,
      });
      expect(staleRepairBeforeReload?.rejectedAt).toBeDefined();
      expect(staleRepairBeforeReload?.syncedAt).toBeUndefined();
      expect(replacementBeforeReload).toMatchObject({
        source: 'local',
        baseServerSeq: concurrentServerSeq,
      });
      expect(replacementBeforeReload?.rejectedAt).toBeUndefined();
      expect(replacementBeforeReload?.syncedAt).toBeUndefined();

      await clientA.page.addInitScript(() => {
        const e2eGlobal = globalThis as typeof globalThis & {
          __SP_E2E_BLOCK_AUTO_SYNC?: boolean;
          __SP_E2E_BLOCK_IMMEDIATE_UPLOAD?: boolean;
          __SP_E2E_BLOCK_WS_DOWNLOAD?: boolean;
        };
        e2eGlobal.__SP_E2E_BLOCK_AUTO_SYNC = true;
        e2eGlobal.__SP_E2E_BLOCK_IMMEDIATE_UPLOAD = true;
        e2eGlobal.__SP_E2E_BLOCK_WS_DOWNLOAD = true;
      });
      await clientA.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      clientA.workView = new WorkViewPage(clientA.page, `A-${testRunId}`);
      clientA.sync = new SuperSyncPage(clientA.page);
      await waitForAppReady(clientA.page);
      await clientA.workView.waitForTaskList();

      allowReplacementCommit = true;
      await clientA.sync.syncAndWait({ timeout: 60000 });
      await replacementAccepted;
      expect(replacementRetryCount).toBe(1);
      expect(replacementAcceptedResponse?.accepted).toBe(true);
      expect(replacementAcceptedResponse?.serverSeq).toBeGreaterThan(concurrentServerSeq);

      const repairsAfterRetry = await getStoredRepairOperations(clientA.page);
      expect(repairsAfterRetry).toHaveLength(2);
      const retriedReplacement = repairsAfterRetry.find(
        ({ id }) => id === replacementRepairRequest?.opId,
      );
      expect(retriedReplacement?.syncedAt).toBeDefined();
      expect(retriedReplacement?.rejectedAt).toBeUndefined();

      const repairRequestCountBeforeNoop =
        1 + replacementAbortCount + replacementRetryCount;
      await clientA.sync.syncAndWait();
      expect(1 + replacementAbortCount + replacementRetryCount).toBe(
        repairRequestCountBeforeNoop,
      );
      expect(await getStoredRepairOperations(clientA.page)).toHaveLength(2);

      const serverRepairOperations = (await getServerOperations(user.userId)).filter(
        ({ opType }) => opType === 'REPAIR',
      );
      expect(serverRepairOperations).toHaveLength(1);
      expect(serverRepairOperations[0].id).toBe(replacementRepairRequest?.opId);
      expect(
        serverRepairOperations.some(({ id }) => id === firstRepairRequest?.opId),
      ).toBe(false);

      await clientB.sync.syncAndWait();
      await expectConvergedTask(clientA, renamedTaskTitle, ghostTagId);
      await expectConvergedTask(clientB, renamedTaskTitle, ghostTagId);

      let clientCRepairUploads = 0;
      clientC = await createSimulatedClient(browser, appUrl, 'C', testRunId);
      await clientC.workView.waitForTaskList();
      await clientC.page.route('**/api/sync/snapshot', async (route) => {
        const request = parseSuperSyncRequestBody<SnapshotUploadRequest>(route.request());
        if (request.snapshotOpType === 'REPAIR') {
          clientCRepairUploads++;
        }
        await route.continue();
      });
      await clientC.sync.setupSuperSync(syncConfig);
      await clientC.sync.syncAndWait();
      await expectConvergedTask(clientC, renamedTaskTitle, ghostTagId);
      expect(clientCRepairUploads).toBe(0);

      for (const client of [clientA, clientB, clientC]) {
        const pendingLocalRepairs = (await getStoredRepairOperations(client.page)).filter(
          ({ rejectedAt, source, syncedAt }) =>
            source === 'local' && rejectedAt === undefined && syncedAt === undefined,
        );
        expect(pendingLocalRepairs).toEqual([]);
      }
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
      if (clientC) await closeClient(clientC);
    }
  });
});

test.describe('@supersync REPAIR with an offline client', () => {
  /**
   * A causal REPAIR is automatic, so it must never reach the explicit
   * import/restore conflict dialog. It used to: `SyncImportConflictGateService`
   * matched on `FULL_STATE_OP_TYPES`, which includes REPAIR, so a device
   * returning with pending work after another device's background repair was
   * prompted with "replaces this device's data with the server's and discards N
   * local change(s)" — and every answer lost something. Traced: the returning
   * device issued no ops upload at all, so its work reached neither the server
   * nor its own repaired state (#9773).
   *
   * Exempting REPAIR from the gate would have been worse than the prompt:
   * applying a full-state op replaces the whole store and nothing replays local
   * unsynced ops afterwards, so it would trade the dialog for silent
   * divergence. The fix defers instead — a device holding pending work skips
   * the incoming snapshot and heals its own copy of the same corruption, which
   * is why a second REPAIR here is expected rather than a regression.
   */
  test('keeps an offline client’s pending work and does not resurrect what the REPAIR removed', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(240000);

    const appUrl = baseURL || 'http://localhost:4242';
    const sharedTaskTitle = `A-${testRunId}-RepairOfflineShared`;
    const offlineTaskTitle = `A-${testRunId}-RepairOfflineWork`;
    const ghostTagId = `ghost-tag-offline-${testRunId}`;
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.workView.waitForTaskList();
      await clientA.sync.setupSuperSync(syncConfig);

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.workView.waitForTaskList();
      await clientB.sync.setupSuperSync(syncConfig);

      await clientA.workView.addTask(sharedTaskTitle);
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, sharedTaskTitle);

      // B seeds the corruption that A will repair, then stops syncing. Both
      // clients only ever sync through syncAndWait(), so B is simply offline
      // from here on.
      await addGhostTagReference(clientB.page, sharedTaskTitle, ghostTagId);
      await clientB.sync.syncAndWait();
      const corruptionServerSeq = await getLatestServerSeq(user.userId);

      // Offline work A's repair snapshot cannot know about.
      await clientB.workView.addTask(offlineTaskTitle);

      // A downloads the corruption, auto-repairs, and uploads a causal REPAIR.
      await clientA.sync.syncAndWait({ timeout: 60000 });
      await clientA.sync.syncAndWait({ timeout: 60000 });
      await expect
        .poll(
          async () =>
            (await getServerOperations(user.userId)).filter(
              ({ opType }) => opType === 'REPAIR',
            ).length,
          { message: 'client A never uploaded a causal REPAIR', timeout: 60000 },
        )
        .toBe(1);
      const repairOperation = (await getServerOperations(user.userId)).find(
        ({ opType }) => opType === 'REPAIR',
      );
      expect(repairOperation?.serverSeq).toBeGreaterThan(corruptionServerSeq);
      await expectConvergedTask(clientA, sharedTaskTitle, ghostTagId);

      // B comes back with a cursor below the REPAIR and pending local work.
      await clientB.sync.syncAndWait({ timeout: 60000 });

      // B keeps both its own offline task and the repaired shared task.
      await waitForTask(clientB.page, offlineTaskTitle);
      await expectConvergedTask(clientB, sharedTaskTitle, ghostTagId);

      // The offline work reached the server and replays on top of the repair
      // for everyone else, and the repair's removal is not undone by it.
      await clientA.sync.syncAndWait({ timeout: 60000 });
      await waitForTask(clientA.page, offlineTaskTitle);
      await expectConvergedTask(clientA, sharedTaskTitle, ghostTagId);

      // One more round each so B's own repair — if it uploaded one after
      // healing itself — is on the server and applied by A.
      await clientB.sync.syncAndWait({ timeout: 60000 });
      await clientA.sync.syncAndWait({ timeout: 60000 });
      await expectConvergedTask(clientA, sharedTaskTitle, ghostTagId);
      await expectConvergedTask(clientB, sharedTaskTitle, ghostTagId);
      await waitForTask(clientA.page, offlineTaskTitle);
      await waitForTask(clientB.page, offlineTaskTitle);
      await waitForTask(clientA.page, sharedTaskTitle);
      await waitForTask(clientB.page, sharedTaskTitle);

      // A's repair, plus at most B's own after it healed its local copy.
      // Anything beyond that is the two clients trading repairs.
      const repairOperations = (await getServerOperations(user.userId)).filter(
        ({ opType }) => opType === 'REPAIR',
      );
      expect(repairOperations.length).toBeGreaterThanOrEqual(1);
      expect(repairOperations.length).toBeLessThanOrEqual(2);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
