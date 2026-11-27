import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  isFullStateOpType,
  SUPERSYNC_BASE_URL,
  SUPERSYNC_SNAPSHOT_ROUTE,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { readLocalOpEntries } from '../../utils/audit-error-paths-helpers';
import { waitForAppReady } from '../../utils/waits';

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

const rejectedPendingFullStateOps = async (
  page: Page,
): Promise<Array<{ opType: string; isRejected: boolean }>> =>
  (await readLocalOpEntries(page))
    .filter((op) => op.source === 'local' && isFullStateOpType(op.opType) && !op.isSynced)
    .map((op) => ({ opType: op.opType, isRejected: op.isRejected }));

const BLOCKED_LOG =
  /Upload remains blocked|snapshot was rejected|rejected full-state baseline/;

/**
 * #11671 reproduction, not a fix. Before v20.1.0 a SuperSync snapshot upload
 * that failed for an unrelated reason (here: a 401) marked the full-state op
 * rejected. v20.1.0 (#11673) stops new misclassifications, but a client that
 * is already marked keeps the upload barrier: the file-sync self-heal (#11445)
 * does not run for SuperSync.
 *
 * This spec asserts today's stuck behavior. When #11671 is fixed, invert the
 * expectations (sync succeeds, the task reaches B) and drop the log check.
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-stuck-rejected-snapshot-11671.spec.ts
 */
test.describe('@supersync #11671 a client already stuck on a rejected snapshot', () => {
  test('stays blocked across reloads and a sign-out/sign-in', async ({
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
      await clientA.page.route(SUPERSYNC_SNAPSHOT_ROUTE, async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Token expired' }),
        });
      });
      await wipeUserSyncData(user.token);
      await expect(clientA.sync.syncAndWait()).rejects.toThrow(/error state/);
      await clientA.page.unroute(SUPERSYNC_SNAPSHOT_ROUTE);

      // What a pre-v20.1.0 build left behind; then the user updates the app.
      expect(await markPendingFullStateRejected(clientA.page)).toBe(1);
      await clientA.page.reload();
      await waitForAppReady(clientA.page);
      await clientA.workView.waitForTaskList();

      const logs: string[] = [];
      clientA.page.on('console', (msg) => logs.push(msg.text()));

      const afterUpdate = `After-update-${testRunId}`;
      await clientA.workView.addTask(afterUpdate);
      await expect(clientA.sync.syncAndWait()).rejects.toThrow(/error state/);
      await expect(clientA.sync.syncErrorIcon).toBeVisible();
      expect(logs.some((line) => BLOCKED_LOG.test(line))).toBe(true);

      // Sign out and in again: disable sync, then set it up with the same account.
      await clientA.sync.disableSync();
      await clientA.sync.setupSuperSync(syncConfig);
      await expect(clientA.sync.syncAndWait()).rejects.toThrow(/error state/);
      expect(await rejectedPendingFullStateOps(clientA.page)).toEqual([
        { opType: 'SYNC_IMPORT', isRejected: true },
      ]);

      // Nothing A did after the failure reaches a second device.
      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      await expect(clientB.page.locator('task', { hasText: afterUpdate })).toHaveCount(0);
      await expect(clientB.page.locator('task', { hasText: beforeFault })).toHaveCount(0);
    } finally {
      if (clientA) {
        await clientA.page.unroute(SUPERSYNC_SNAPSHOT_ROUTE).catch(() => {});
        await closeClient(clientA);
      }
      if (clientB) await closeClient(clientB);
    }
  });
});
