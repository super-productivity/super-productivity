import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { waitForAppReady } from '../../utils/waits';

/**
 * #11099 on SuperSync: a client that loses its op log (`SUP_OPS`) but keeps its
 * sync credentials (`sup-sync`) and localStorage must get the account's data
 * back on the next sync.
 *
 * The download cursor (`super_sync_last_server_seq_<hash of url|token>`) lives
 * in localStorage. Re-entering the same token derives the same key, so a stale
 * cursor would download only ops newer than the loss and the client would never
 * see the data it lost. Unlike the file-based providers (see
 * webdav-reset-db-overwrite-11063.spec.ts) the remote is not overwritten, but
 * the client stays without its data.
 *
 * Run: npm run quiet -- e2e:supersync:file e2e/tests/sync/supersync-op-log-loss-stale-cursor-11099.spec.ts --retries=0
 */
const SEQ_KEY_PREFIX = 'super_sync_last_server_seq_';

/** Every SuperSync download cursor in localStorage. */
const readSeqCursors = (page: Page): Promise<Record<string, string>> =>
  page.evaluate((prefix) => {
    const cursors: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        cursors[key] = localStorage.getItem(key) ?? '';
      }
    }
    return cursors;
  }, SEQ_KEY_PREFIX);

/**
 * Deletes every IndexedDB database except the sync credentials while the app is
 * not running, keeping localStorage.
 */
const wipeOpLogKeepCredentials = async (page: Page): Promise<string[]> => {
  // Leave the app so it releases its DB connections (open ones block deletion).
  await page.goto('/assets/i18n/en.json');
  return page.evaluate(async () => {
    const names = (await indexedDB.databases())
      .map((db) => db.name)
      .filter((name): name is string => !!name && name !== 'sup-sync');
    for (const name of names) {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error(`deleteDatabase blocked: ${name}`));
      });
    }
    return names;
  });
};

test.describe('@supersync Op log lost, sync credentials kept (#11099)', () => {
  test('client downloads the account data again despite a stale cursor', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const appUrl = baseURL || 'http://localhost:4242';
    const realTask = `Real-Task-${Date.now()}`;
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.workView.addTask(realTask);
      await clientA.sync.syncAndWait();
      const cursorsBefore = await readSeqCursors(clientA.page);
      expect(Object.values(cursorsBefore).some((seq) => Number(seq) > 0)).toBe(true);

      // --- A loses its op log, keeps credentials + localStorage, restarts ---
      const deleted = await wipeOpLogKeepCredentials(clientA.page);
      expect(deleted).toContain('SUP_OPS');
      expect(deleted).not.toContain('sup-sync');
      await clientA.page.goto('/');
      await waitForAppReady(clientA.page);
      await expect(clientA.page.locator('task', { hasText: realTask })).toHaveCount(0);
      // The stale cursor outlived the op log.
      expect(await readSeqCursors(clientA.page)).toEqual(cursorsBefore);

      // --- The same account is configured again and syncs ---
      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.sync.syncAndWait();

      // CORE: the client has its data back.
      await waitForTask(clientA.page, realTask);

      // The account still holds the data for another device.
      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await waitForTask(clientB.page, realTask);
    } finally {
      if (clientB) {
        await closeClient(clientB);
      }
      if (clientA) {
        await closeClient(clientA);
      }
    }
  });
});
