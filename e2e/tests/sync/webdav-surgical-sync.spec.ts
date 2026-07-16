import { test, expect } from '../../fixtures/webdav.fixture';
import type { APIRequestContext, Page } from '@playwright/test';
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
}

const readSurgicalOpsFile = async (
  request: APIRequestContext,
  url: string,
  authorization: string,
): Promise<SurgicalOpsFile> => {
  const response = await request.get(url, {
    headers: { Authorization: authorization },
  });
  expect(response.ok()).toBe(true);
  const encoded = await response.text();
  const prefixEnd = encoded.indexOf('__');
  if (prefixEnd < 0) {
    throw new Error('Surgical ops file is missing its format prefix');
  }
  return JSON.parse(encoded.slice(prefixEnd + 2)) as SurgicalOpsFile;
};

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
