import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  SUPERSYNC_BASE_URL,
  SUPERSYNC_SNAPSHOT_ROUTE,
  type SimulatedE2EClient,
  waitForTask,
} from '../../utils/supersync-helpers';
import { waitForAppReady } from '../../utils/waits';
import { allowDevErrorsInCurrentTest } from '../../utils/runtime-errors';

/** Wipes the account's sync data, so the next sync seeds it again (SERVER_MIGRATION). */
const wipeUserSyncData = async (token: string): Promise<void> => {
  const response = await fetch(`${SUPERSYNC_BASE_URL}/api/sync/data`, {
    method: 'DELETE',
    headers: { ['Content-Type']: 'application/json', Authorization: `Bearer ${token}` },
    body: '{}',
  });
  if (!response.ok) {
    throw new Error(`Failed to wipe sync data: HTTP ${response.status}`);
  }
};

/**
 * Persists what versions before v20.1.0 left behind after a snapshot upload
 * failed without a server verdict (#11673): the pending local full-state op
 * carries `rejectedAt`. Returns how many entries were marked.
 */
const markPendingFullStateRejected = (page: Page): Promise<number> =>
  page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('SUP_OPS');
      open.onsuccess = (): void => resolve(open.result);
      open.onerror = (): void => reject(open.error);
    });
    try {
      return await new Promise<number>((resolve, reject) => {
        const tx = db.transaction('ops', 'readwrite');
        const store = tx.objectStore('ops');
        const read = store.getAll();
        let marked = 0;
        read.onsuccess = (): void => {
          for (const entry of read.result as Array<{
            op: { o: string };
            source: string;
            syncedAt?: number;
            rejectedAt?: number;
          }>) {
            const isFullState = ['SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR'].includes(
              entry.op.o,
            );
            if (entry.source === 'local' && isFullState && entry.syncedAt === undefined) {
              entry.rejectedAt ??= Date.now();
              store.put(entry);
              marked++;
            }
          }
        };
        tx.oncomplete = (): void => resolve(marked);
        tx.onerror = (): void => reject(tx.error);
      });
    } finally {
      db.close();
    }
  });

/** Makes the next snapshot upload of this client fail the way #11671 reports. */
const failSnapshotUploads = (page: Page): Promise<void> =>
  page.route(SUPERSYNC_SNAPSHOT_ROUTE, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Token expired' }),
    });
  });

/**
 * Adds a tag id that exists nowhere to a task, as a real persistent update.
 * A client that receives this op repairs its state and so creates a REPAIR
 * full-state op it uploads as a snapshot.
 */
const addGhostTagReference = async (page: Page, title: string): Promise<void> => {
  const taskId = await page
    .locator('task', { hasText: title })
    .first()
    .getAttribute('data-task-id');
  expect(taskId).toBeTruthy();
  // The dangling tag reference is the corruption under test; the validator
  // reports it through devError().
  allowDevErrorsInCurrentTest(/tagId from task not existing/);
  await page.evaluate((id) => {
    const helpers = (
      window as unknown as {
        __e2eTestHelpers: {
          store: { dispatch: (action: unknown) => void };
          flushPendingWrites: () => Promise<void>;
        };
      }
    ).__e2eTestHelpers;
    helpers.store.dispatch({
      type: '[Task Shared] updateTask',
      task: { id, changes: { tagIds: ['ghost-tag-11671'] } },
      isIgnoreShortSyntax: true,
      meta: { isPersistent: true, entityType: 'TASK', entityId: id, opType: 'UPD' },
    });
    return helpers.flushPendingWrites();
  }, taskId!);
};

/** Reload so the persisted op log, not an in-memory cache, is what runs. */
const updateApp = async (client: SimulatedE2EClient): Promise<void> => {
  await client.page.reload();
  await waitForAppReady(client.page);
  await client.workView.waitForTaskList();
};

/** Both devices sync and end up with every title, with no sync error. */
const expectConverged = async (
  clients: SimulatedE2EClient[],
  titles: string[],
): Promise<void> => {
  for (const client of clients) {
    await client.sync.syncAndWait();
    await expect(client.sync.syncErrorIcon).toBeHidden();
  }
  for (const client of clients) {
    for (const title of titles) await waitForTask(client.page, title);
  }
};

/**
 * #11671: before v20.1.0 a SuperSync snapshot upload that failed for an
 * unrelated reason (here: a 401) marked the full-state op rejected, and the
 * client stayed blocked even after updating. Each scenario recreates that
 * leftover, updates the app (reload) and expects the client to sync again
 * and both devices to converge, in both directions.
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-stuck-rejected-snapshot-11671.spec.ts
 */
test.describe('@supersync #11671 a client stuck on a pre-v20.1.0 rejected snapshot', () => {
  test('syncs again when it has to seed a wiped account', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(240000);
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);
      const beforeFault = `Before-fault-${testRunId}`;
      await clientA.workView.addTask(beforeFault);
      await clientA.sync.syncAndWait();

      // A has to seed the wiped account again; that snapshot upload fails.
      await failSnapshotUploads(clientA.page);
      await wipeUserSyncData(user.token);
      await expect(clientA.sync.syncAndWait()).rejects.toThrow(/error state/);
      await clientA.page.unroute(SUPERSYNC_SNAPSHOT_ROUTE);

      // What a pre-v20.1.0 build left behind; then the user updates the app.
      expect(await markPendingFullStateRejected(clientA.page)).toBe(1);
      await updateApp(clientA);

      const afterUpdate = `After-update-${testRunId}`;
      await clientA.workView.addTask(afterUpdate);
      await clientA.sync.syncAndWait();
      await expect(clientA.sync.syncErrorIcon).toBeHidden();

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      const fromB = `From-B-${testRunId}`;
      await clientB.workView.addTask(fromB);
      await expectConverged([clientB, clientA], [beforeFault, afterUpdate, fromB]);
    } finally {
      if (clientA) {
        await clientA.page.unroute(SUPERSYNC_SNAPSHOT_ROUTE).catch(() => {});
        await closeClient(clientA);
      }
      if (clientB) await closeClient(clientB);
    }
  });

  test('syncs again when its rejected REPAIR blocks uploads to a seeded account', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(240000);
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);
      const shared = `Shared-${testRunId}`;
      await clientA.workView.addTask(shared);
      await clientA.sync.syncAndWait();

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await waitForTask(clientB.page, shared);

      // B uploads an op whose application makes A repair its state; A's
      // REPAIR snapshot upload then fails.
      await addGhostTagReference(clientB.page, shared);
      await clientB.sync.syncAndWait();
      let refusedSnapshots = 0;
      clientA.page.on('request', (req) => {
        if (req.method() === 'POST' && req.url().includes('/api/sync/snapshot')) {
          refusedSnapshots++;
        }
      });
      await failSnapshotUploads(clientA.page);
      await clientA.sync.syncAndWait().catch(() => undefined);
      await expect.poll(() => refusedSnapshots, { timeout: 30000 }).toBeGreaterThan(0);
      await clientA.page.unroute(SUPERSYNC_SNAPSHOT_ROUTE);

      // What a pre-v20.1.0 build left behind: the REPAIR is marked rejected.
      expect(await markPendingFullStateRejected(clientA.page)).toBe(1);
      const whileStuck = `While-stuck-${testRunId}`;
      await clientA.workView.addTask(whileStuck);

      // B moves the account on meanwhile, so A heals on top of newer data.
      const fromB = `From-B-${testRunId}`;
      await clientB.workView.addTask(fromB);
      await clientB.sync.syncAndWait();

      await updateApp(clientA);
      await expectConverged([clientA, clientB], [shared, whileStuck, fromB]);

      // A's uploads stay unblocked afterwards.
      const afterHeal = `After-heal-${testRunId}`;
      await clientA.workView.addTask(afterHeal);
      await expectConverged([clientA, clientB], [shared, whileStuck, fromB, afterHeal]);
    } finally {
      if (clientA) {
        await clientA.page.unroute(SUPERSYNC_SNAPSHOT_ROUTE).catch(() => {});
        await closeClient(clientA);
      }
      if (clientB) await closeClient(clientB);
    }
  });
});
