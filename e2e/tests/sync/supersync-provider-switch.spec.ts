import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  getLocalOpLogSummary,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import {
  WEBDAV_CONFIG_TEMPLATE,
  createSyncFolder,
  generateSyncFolderName,
  setupSyncClient,
  waitForSyncComplete,
} from '../../utils/sync-helpers';
import { SyncPage } from '../../pages/sync.page';
import { isWebDavServerUp } from '../../utils/check-webdav';
import { waitForAppReady } from '../../utils/waits';

/**
 * SuperSync Provider Switch E2E Tests
 *
 * Tests data preservation when switching sync providers between
 * WebDAV and SuperSync.
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - WebDAV server running on localhost:2345
 * - Frontend running on localhost:4242
 *
 * Tests are skipped if either server is unavailable.
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-provider-switch.spec.ts
 */

test.describe('@supersync Provider Switch (WebDAV ↔ SuperSync)', () => {
  /**
   * Scenario: SuperSync → WebDAV
   *
   * Tests that tasks created with SuperSync survive switching to WebDAV.
   *
   * Flow:
   * 1. Client A sets up SuperSync, creates tasks, syncs
   * 2. Client A disables SuperSync
   * 3. Client A enables WebDAV sync
   * 4. Client A syncs to WebDAV
   * 5. New Client B sets up WebDAV with same folder
   * 6. Verify Client B receives all tasks
   */
  test('Tasks and provider survive switching from SuperSync to WebDAV and restarting', async ({
    browser,
    baseURL,
    testRunId,
  }, testInfo) => {
    test.setTimeout(180000);

    // Skip if WebDAV server is not available
    const webdavAvailable = await isWebDavServerUp();
    if (!webdavAvailable && process.env.E2E_REQUIRE_WEBDAV === 'true') {
      throw new Error('WebDAV is required for provider-switch coverage.');
    }
    testInfo.skip(!webdavAvailable, 'WebDAV server not running on localhost:2345');

    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let contextB: Awaited<ReturnType<typeof browser.newContext>> | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Create tasks with SuperSync ============
      console.log('[ProviderSwitch] Phase 1: Create tasks with SuperSync');

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const task1 = `ProvSwitch-1-${testRunId}`;
      const task2 = `ProvSwitch-2-${testRunId}`;
      await clientA.workView.addTask(task1);
      await clientA.workView.addTask(task2);
      await clientA.sync.syncAndWait();
      console.log('[ProviderSwitch] Tasks created and synced via SuperSync');

      const snapshotSaved = await clientA.page.evaluate(async () => {
        const helpers = (
          window as unknown as {
            __e2eTestHelpers: { compact: () => Promise<boolean> };
          }
        ).__e2eTestHelpers;
        return helpers.compact();
      });
      expect(snapshotSaved).toBe(true);

      // ============ PHASE 2: Switch to WebDAV ============
      console.log('[ProviderSwitch] Phase 2: Switching to WebDAV');

      // Create WebDAV sync folder
      const syncFolderName = generateSyncFolderName(`e2e-provswitch-${testRunId}`);
      const webdavRequestContext = await browser.newContext();
      try {
        await createSyncFolder(webdavRequestContext.request, syncFolderName);
      } finally {
        await webdavRequestContext.close();
      }

      // Disable SuperSync and set up WebDAV
      const syncPageA = new SyncPage(clientA.page);
      await syncPageA.setupWebdavSync(
        {
          ...WEBDAV_CONFIG_TEMPLATE,
          syncFolderPath: `/${syncFolderName}`,
        },
        { isReconfigure: true },
      );
      console.log('[ProviderSwitch] Switched to WebDAV');

      await syncPageA.triggerSync();
      await waitForSyncComplete(clientA.page, syncPageA);

      const beforeRestart = await clientA.page.evaluate(async () => {
        await (
          window as unknown as {
            __e2eTestHelpers: { flushPendingWrites: () => Promise<void> };
          }
        ).__e2eTestHelpers.flushPendingWrites();
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('SUP_OPS');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          const tx = db.transaction(['state_cache', 'ops'], 'readonly');
          const snapshot = await new Promise<{
            lastAppliedOpSeq: number;
            state: { globalConfig: { sync: { syncProvider: string } } };
          }>((resolve, reject) => {
            const request = tx.objectStore('state_cache').get('current');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          const tail = await new Promise<{ seq: number; op: { o: string; e: string } }[]>(
            (resolve, reject) => {
              const request = tx
                .objectStore('ops')
                .getAll(IDBKeyRange.lowerBound(snapshot.lastAppliedOpSeq, true));
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            },
          );
          return {
            cachedProvider: snapshot.state.globalConfig.sync.syncProvider,
            tailTypes: tail.map((entry) => entry.op.o),
            tailEntities: tail.map((entry) => entry.op.e),
          };
        } finally {
          db.close();
        }
      });
      expect(beforeRestart.cachedProvider).toBe('SuperSync');
      expect(beforeRestart.tailEntities).toContain('GLOBAL_CONFIG');
      expect(beforeRestart.tailTypes.at(-1)).toBe('SYNC_IMPORT');

      const opsBeforeRestart = await getLocalOpLogSummary(clientA.page);
      for (let restart = 0; restart < 2; restart++) {
        await clientA.page.reload();
        await waitForAppReady(clientA.page);
        const providerAfterRestart = await clientA.page.evaluate(() => {
          let provider: string | undefined;
          const helpers = (
            window as unknown as {
              __e2eTestHelpers: {
                store: {
                  subscribe: (
                    callback: (state: {
                      globalConfig: { sync: { syncProvider: string } };
                    }) => void,
                  ) => { unsubscribe: () => void };
                };
              };
            }
          ).__e2eTestHelpers;
          const subscription = helpers.store.subscribe((state) => {
            provider = state.globalConfig.sync.syncProvider;
          });
          subscription.unsubscribe();
          return provider;
        });
        expect(providerAfterRestart).toBe('WebDAV');
        expect(await getLocalOpLogSummary(clientA.page)).toEqual(opsBeforeRestart);
      }

      // Verify tasks still exist on Client A
      await waitForTask(clientA.page, task1);
      await waitForTask(clientA.page, task2);
      console.log('[ProviderSwitch] ✓ Tasks survived provider switch on Client A');

      // ============ PHASE 3: New client joins via WebDAV ============
      console.log('[ProviderSwitch] Phase 3: New client joins via WebDAV');

      const clientB = await setupSyncClient(browser, appUrl);
      contextB = clientB.context;
      const pageB = clientB.page;

      const syncPageB = new SyncPage(pageB);
      await syncPageB.setupWebdavSync({
        ...WEBDAV_CONFIG_TEMPLATE,
        syncFolderPath: `/${syncFolderName}`,
      });
      console.log('[ProviderSwitch] Client B joined via WebDAV');

      await syncPageB.triggerSync();
      await waitForSyncComplete(pageB, syncPageB);

      // Verify tasks on Client B
      await waitForTask(pageB, task1);
      await waitForTask(pageB, task2);

      const taskLocator1 = pageB.locator(`task:has-text("${task1}")`);
      const taskLocator2 = pageB.locator(`task:has-text("${task2}")`);
      await expect(taskLocator1).toBeVisible();
      await expect(taskLocator2).toBeVisible();

      console.log('[ProviderSwitch] ✓ Client B received all tasks via WebDAV');
      console.log('[ProviderSwitch] ✓ SuperSync → WebDAV provider switch test PASSED!');
    } finally {
      if (contextB) await contextB.close().catch(() => {});
      if (clientA) await closeClient(clientA);
    }
  });
});
