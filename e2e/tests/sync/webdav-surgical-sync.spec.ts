import { test, expect } from '../../fixtures/webdav.fixture';
import type { APIRequestContext, Page, Request } from '@playwright/test';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import {
  closeContextsSafely,
  createSyncFolder,
  generateSyncFolderName,
  setupSyncClient,
  waitForSyncComplete,
  WEBDAV_CONFIG_TEMPLATE,
} from '../../utils/sync-helpers';
import { waitForAppReady, waitForStatePersistence } from '../../utils/waits';

interface SurgicalOpsFile {
  recentOps: Array<{ id: string }>;
  migration?: {
    status: string;
    legacyRev: string;
  };
}

interface SplitTombstone {
  version: number;
  format: string;
}

const readPrefixedFile = async <T>(
  request: APIRequestContext,
  url: string,
  authorization: string,
): Promise<T> => {
  const response = await request.get(url, {
    headers: { Authorization: authorization },
  });
  expect(response.ok()).toBe(true);
  const encoded = await response.text();
  const prefixEnd = encoded.indexOf('__');
  if (prefixEnd < 0) {
    throw new Error(`${url} is missing its format prefix`);
  }
  return JSON.parse(encoded.slice(prefixEnd + 2)) as T;
};

const readSurgicalOpsFile = (
  request: APIRequestContext,
  url: string,
  authorization: string,
): Promise<SurgicalOpsFile> =>
  readPrefixedFile<SurgicalOpsFile>(request, url, authorization);

const getLocalOperationState = async (
  page: Page,
  operationId: string,
): Promise<{ syncedAt?: number; rejectedAt?: number } | undefined> =>
  page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const openRequest = indexedDB.open('SUP_OPS');
      openRequest.onsuccess = (): void => resolve(openRequest.result);
      openRequest.onerror = (): void => reject(openRequest.error);
    });
    try {
      return await new Promise<{ syncedAt?: number; rejectedAt?: number } | undefined>(
        (resolve, reject) => {
          const tx = db.transaction('ops', 'readonly');
          const getRequest = tx.objectStore('ops').index('byId').get(id);
          getRequest.onsuccess = (): void =>
            resolve(
              getRequest.result as { syncedAt?: number; rejectedAt?: number } | undefined,
            );
          getRequest.onerror = (): void => reject(getRequest.error);
        },
      );
    } finally {
      db.close();
    }
  }, operationId);

test.describe('@webdav @surgical WebDAV Surgical sync', () => {
  // Each case drives multiple app contexts through faulted WebDAV requests.
  test.describe.configure({ mode: 'serial' });

  test('recovers a v2 migration after the tombstone response is lost', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow();
    const appUrl = baseURL || 'http://localhost:4242';
    const folderName = generateSyncFolderName('e2e-surgical-v2');
    const folderUrl = `${WEBDAV_CONFIG_TEMPLATE.baseUrl}${folderName}/DEV/`;
    const legacyConfig = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${folderName}`,
      isUseSplitSyncFiles: false,
    };
    const splitConfig = {
      ...legacyConfig,
      isUseSplitSyncFiles: true,
    };
    const authorization =
      'Basic ' +
      Buffer.from(
        `${WEBDAV_CONFIG_TEMPLATE.username}:${WEBDAV_CONFIG_TEMPLATE.password}`,
      ).toString('base64');

    await createSyncFolder(request, folderName);

    let migratingClient: Awaited<ReturnType<typeof setupSyncClient>> | null = null;
    let legacyClient: Awaited<ReturnType<typeof setupSyncClient>> | null = null;
    let legacyRequestListener: ((webDavRequest: Request) => void) | null = null;

    try {
      migratingClient = await setupSyncClient(browser, appUrl);
      const sync = new SyncPage(migratingClient.page);
      const workView = new WorkViewPage(migratingClient.page);

      await sync.setupWebdavSync(legacyConfig);

      const firstLegacyTask = `Legacy-first-${folderName}`;
      await workView.addTask(firstLegacyTask);
      await waitForStatePersistence(migratingClient.page);
      await sync.triggerSync();
      await waitForSyncComplete(migratingClient.page, sync);

      // A second v2 upload rotates the first primary into sync-data.json.bak,
      // giving the migration a real stale backup that must be neutralized.
      const secondLegacyTask = `Legacy-second-${folderName}`;
      await workView.addTask(secondLegacyTask);
      await waitForStatePersistence(migratingClient.page);
      await sync.triggerSync();
      await waitForSyncComplete(migratingClient.page, sync);

      const legacyPrimary = await readPrefixedFile<{ version: number }>(
        request,
        `${folderUrl}sync-data.json`,
        authorization,
      );
      const legacyBackup = await readPrefixedFile<{ version: number }>(
        request,
        `${folderUrl}sync-data.json.bak`,
        authorization,
      );
      expect(legacyPrimary.version).toBe(2);
      expect(legacyBackup.version).toBe(2);

      const pendingTask = `Pending-during-migration-${folderName}`;
      await workView.addTask(pendingTask);
      await waitForStatePersistence(migratingClient.page);

      let faultActive = true;
      let tombstoneCommitted = false;
      let tombstoneResponseDropped = false;
      await migratingClient.page.route('**/sync-data.json', async (route) => {
        const body = route.request().postData() ?? '';
        const prefixEnd = body.indexOf('__');
        const uploaded =
          prefixEnd >= 0
            ? (JSON.parse(body.slice(prefixEnd + 2)) as Partial<SplitTombstone>)
            : null;
        const isSplitTombstone = uploaded?.version === 3 && uploaded.format === 'split';

        if (route.request().method() === 'PUT' && faultActive && isSplitTombstone) {
          if (!tombstoneCommitted) {
            const response = await route.fetch();
            expect(response.ok()).toBe(true);
            tombstoneCommitted = true;
          }
          tombstoneResponseDropped = true;
          await route.abort('failed');
          return;
        }
        await route.continue();
      });

      // Reconfiguration can schedule its own first sync, so fault interception
      // must already be active before the setting flips.
      await sync.setupWebdavSync(splitConfig, { isReconfigure: true });
      await expect.poll(() => tombstoneResponseDropped).toBe(true);
      await sync.syncSpinner.waitFor({ state: 'hidden', timeout: 20000 });
      expect(tombstoneCommitted).toBe(true);

      // The remote commit happened even though the client saw a network error.
      const committedPrimary = await readPrefixedFile<SplitTombstone>(
        request,
        `${folderUrl}sync-data.json`,
        authorization,
      );
      const pendingMigrationOps = await readSurgicalOpsFile(
        request,
        `${folderUrl}sync-ops.json`,
        authorization,
      );
      expect(committedPrimary).toMatchObject({ version: 3, format: 'split' });
      expect(pendingMigrationOps.migration).toMatchObject({ status: 'pending' });
      expect(pendingMigrationOps.migration?.legacyRev).toBeTruthy();

      // Restart before allowing another write so recovery comes from the
      // persisted migration marker rather than the failed call's memory.
      faultActive = false;
      await migratingClient.page.reload({ waitUntil: 'domcontentloaded' });
      await waitForAppReady(migratingClient.page);
      await sync.triggerSync();
      await waitForSyncComplete(migratingClient.page, sync);

      await expect(
        migratingClient.page.locator('task', { hasText: firstLegacyTask }),
      ).toBeVisible();
      await expect(
        migratingClient.page.locator('task', { hasText: secondLegacyTask }),
      ).toBeVisible();
      await expect(
        migratingClient.page.locator('task', { hasText: pendingTask }),
      ).toHaveCount(1);

      const recoveredPrimary = await readPrefixedFile<SplitTombstone>(
        request,
        `${folderUrl}sync-data.json`,
        authorization,
      );
      const recoveredBackup = await readPrefixedFile<SplitTombstone>(
        request,
        `${folderUrl}sync-data.json.bak`,
        authorization,
      );
      const recoveredOps = await readSurgicalOpsFile(
        request,
        `${folderUrl}sync-ops.json`,
        authorization,
      );
      expect(recoveredPrimary).toMatchObject({ version: 3, format: 'split' });
      expect(recoveredBackup).toMatchObject({ version: 3, format: 'split' });
      expect(recoveredOps.migration).toBeUndefined();

      // A client that has not opted into split files must remain in the
      // persistent error state without writing v2 back over the tombstone.
      legacyClient = await setupSyncClient(browser, appUrl);
      const legacySync = new SyncPage(legacyClient.page);
      let legacyPutCount = 0;
      legacyRequestListener = (webDavRequest: Request): void => {
        if (
          webDavRequest.method() === 'PUT' &&
          webDavRequest.url().startsWith(folderUrl)
        ) {
          legacyPutCount++;
        }
      };
      legacyClient.page.on('request', legacyRequestListener);
      await legacySync.setupWebdavSync(legacyConfig);
      await expect(legacySync.syncBtn).toHaveAccessibleName(
        'Sync problem — click to retry',
        { timeout: 20000 },
      );

      // Retry once explicitly to prove the guard is stable beyond setup's
      // automatic first sync.
      const tombstoneDownload = legacyClient.page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' &&
          response.url() === `${folderUrl}sync-data.json` &&
          response.ok(),
        { timeout: 20000 },
      );
      await legacySync.syncBtn.click({ noWaitAfter: true });
      await tombstoneDownload;
      await expect(legacyClient.page.locator('snack-custom .message')).toContainText(
        /split-file format.*(?:Enable|Turn on).*Surgical sync.*Sync settings/i,
        { timeout: 20000 },
      );
      await expect(legacySync.syncBtn).toHaveAccessibleName(
        'Sync problem — click to retry',
      );
      expect(legacyPutCount).toBe(0);

      const primaryAfterLegacyAttempt = await readPrefixedFile<SplitTombstone>(
        request,
        `${folderUrl}sync-data.json`,
        authorization,
      );
      expect(primaryAfterLegacyAttempt).toMatchObject({
        version: 3,
        format: 'split',
      });
    } finally {
      if (migratingClient) {
        await migratingClient.page.unroute('**/sync-data.json').catch(() => {});
      }
      if (legacyClient && legacyRequestListener) {
        legacyClient.page.off('request', legacyRequestListener);
      }
      await closeContextsSafely(migratingClient?.context, legacyClient?.context);
    }
  });

  test('survives a committed ops response loss and restart', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow();
    const appUrl = baseURL || 'http://localhost:4242';
    const folderName = generateSyncFolderName('e2e-surgical');
    const folderUrl = `${WEBDAV_CONFIG_TEMPLATE.baseUrl}${folderName}/DEV/`;
    const config = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${folderName}`,
      isUseSplitSyncFiles: true,
    };
    const authorization =
      'Basic ' +
      Buffer.from(
        `${WEBDAV_CONFIG_TEMPLATE.username}:${WEBDAV_CONFIG_TEMPLATE.password}`,
      ).toString('base64');

    await createSyncFolder(request, folderName);

    let clientA: Awaited<ReturnType<typeof setupSyncClient>> | null = null;
    let clientB: Awaited<ReturnType<typeof setupSyncClient>> | null = null;

    try {
      clientA = await setupSyncClient(browser, appUrl);
      clientB = await setupSyncClient(browser, appUrl);
      const syncA = new SyncPage(clientA.page);
      const syncB = new SyncPage(clientB.page);
      const workViewA = new WorkViewPage(clientA.page);
      const workViewB = new WorkViewPage(clientB.page);

      await syncA.setupWebdavSync(config);
      const taskA = `Surgical-A-${folderName}`;
      await workViewA.addTask(taskA);
      await waitForStatePersistence(clientA.page);
      await syncA.triggerSync();
      await waitForSyncComplete(clientA.page, syncA);

      const opsFile = await request.get(`${folderUrl}sync-ops.json`, {
        headers: { Authorization: authorization },
      });
      const stateFile = await request.get(`${folderUrl}sync-state.json`, {
        headers: { Authorization: authorization },
      });
      expect(opsFile.ok()).toBe(true);
      expect(stateFile.ok()).toBe(true);

      await syncB.setupWebdavSync(config);
      await syncB.triggerSync();
      await waitForSyncComplete(clientB.page, syncB);
      await expect(clientB.page.locator('task', { hasText: taskA })).toBeVisible();

      const baselineOps = await readSurgicalOpsFile(
        request,
        `${folderUrl}sync-ops.json`,
        authorization,
      );
      const baselineOpIds = new Set(
        baselineOps.recentOps.map((operation) => operation.id),
      );

      let requestPhase: 'fault' | 'restart' = 'fault';
      const faultRequests: string[] = [];
      const restartRequests: string[] = [];
      let committedOpsWrite = false;
      let responseDropped = false;
      let restartOpsWrites = 0;
      const recordWebDavRequest = (url: string): void => {
        if (url.startsWith(folderUrl)) {
          const requests = requestPhase === 'fault' ? faultRequests : restartRequests;
          requests.push(new URL(url).pathname);
        }
      };
      const requestListener = (webDavRequest: { url(): string }): void =>
        recordWebDavRequest(webDavRequest.url());
      clientB.page.on('request', requestListener);
      await clientB.page.route('**/sync-ops.json', async (route) => {
        if (route.request().method() === 'PUT') {
          if (requestPhase === 'fault') {
            if (!committedOpsWrite) {
              const response = await route.fetch();
              expect(response.ok()).toBe(true);
              committedOpsWrite = true;
            }
            await route.abort('failed');
            responseDropped = true;
            return;
          }
          restartOpsWrites++;
        }
        await route.continue();
      });

      const taskB = `Surgical-B-${folderName}`;
      await workViewB.addTask(taskB);
      await waitForStatePersistence(clientB.page);
      await syncB.triggerSync();
      await expect.poll(() => responseDropped).toBe(true);
      await syncB.syncSpinner.waitFor({ state: 'hidden', timeout: 20000 });

      expect(committedOpsWrite).toBe(true);
      expect(faultRequests.some((path) => path.endsWith('/sync-ops.json'))).toBe(true);
      expect(faultRequests.some((path) => path.includes('/sync-state'))).toBe(false);

      const committedOps = await readSurgicalOpsFile(
        request,
        `${folderUrl}sync-ops.json`,
        authorization,
      );
      const newlyCommittedIds = committedOps.recentOps
        .map((operation) => operation.id)
        .filter((id) => !baselineOpIds.has(id));
      expect(newlyCommittedIds).toHaveLength(1);
      const committedOperationId = newlyCommittedIds[0];
      expect(
        (await getLocalOperationState(clientB.page, committedOperationId))?.syncedAt,
        'the lost response must leave the committed operation pending',
      ).toBeUndefined();

      // The ops PUT committed remotely, but its response never reached the
      // client. Reload before retrying to exercise persisted cursor/revision
      // recovery rather than only an in-memory retry.
      requestPhase = 'restart';
      await clientB.page.reload({ waitUntil: 'domcontentloaded' });
      await waitForAppReady(clientB.page);
      await syncB.triggerSync();
      await waitForSyncComplete(clientB.page, syncB);
      await expect
        .poll(
          async () =>
            (await getLocalOperationState(clientB.page, committedOperationId))?.syncedAt,
        )
        .not.toBeUndefined();
      await expect(clientB.page.locator('task', { hasText: taskB })).toHaveCount(1);
      expect(restartRequests.some((path) => path.endsWith('/sync-ops.json'))).toBe(true);
      expect(restartRequests.some((path) => path.includes('/sync-state'))).toBe(false);
      expect(restartRequests.some((path) => path.endsWith('/sync-data.json'))).toBe(
        false,
      );
      expect(restartOpsWrites).toBe(0);

      const recoveredOps = await readSurgicalOpsFile(
        request,
        `${folderUrl}sync-ops.json`,
        authorization,
      );
      expect(
        recoveredOps.recentOps.filter(
          (operation) => operation.id === committedOperationId,
        ),
      ).toHaveLength(1);

      await syncA.triggerSync();
      await waitForSyncComplete(clientA.page, syncA);
      await expect(clientA.page.locator('task', { hasText: taskB })).toBeVisible();
      await expect(clientB.page.locator('task', { hasText: taskA })).toBeVisible();
      await expect(clientB.page.locator('task', { hasText: taskB })).toBeVisible();
      clientB.page.off('request', requestListener);
    } finally {
      if (clientB) {
        await clientB.page.unroute('**/sync-ops.json').catch(() => {});
      }
      await closeContextsSafely(clientA?.context, clientB?.context);
    }
  });
});
