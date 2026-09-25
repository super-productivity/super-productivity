import { test, expect, type Page } from '@playwright/test';
import { uuidv7 } from 'uuidv7';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  getLocalOpLogSummary,
  seedSuperSyncCredentials,
  SUPERSYNC_BASE_URL,
  type SimulatedE2EClient,
  waitForTask,
} from '../../utils/supersync-helpers';
import {
  RELEASED_APP_URL,
  serveReleasedClientAssets,
  type ClientRelease,
} from '../../utils/released-client-assets';
import { waitForAppReady } from '../../utils/waits';

const oldAssets = process.env.COMPAT_OLD_ASSETS;
const newAssets = process.env.COMPAT_NEW_ASSETS;
const password = 'e2e-default-encryption-pw';

interface DownloadedOp {
  serverSeq: number;
  op: {
    id: string;
    clientId: string;
    opType: string;
    payload: unknown;
    vectorClock: Record<string, number>;
    schemaVersion: number;
    isPayloadEncrypted: boolean;
  };
}

// Reuse the actual initial ciphertext: it is the complete server history and
// cannot contain the offline task. This fixture does not synthesize app state.
const checkpointInitialState = async (token: string): Promise<string> => {
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  const download = await fetch(`${SUPERSYNC_BASE_URL}/api/sync/ops?sinceSeq=0`, {
    headers,
  });
  expect(download.ok).toBe(true);
  const { ops, latestSeq } = (await download.json()) as {
    ops: DownloadedOp[];
    latestSeq: number;
  };
  expect(ops).toHaveLength(1);
  expect(ops[0].op.opType).toBe('SYNC_IMPORT');
  expect(ops[0].op.isPayloadEncrypted).toBe(true);
  expect(ops[0].serverSeq).toBe(latestSeq);
  const opId = uuidv7();
  headers.set('Content-Type', 'application/json');
  const checkpoint = await fetch(`${SUPERSYNC_BASE_URL}/api/sync/snapshot`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      state: ops[0].op.payload,
      clientId: 'CHECKPOINT',
      reason: 'recovery',
      vectorClock: { ...ops[0].op.vectorClock, CHECKPOINT: 1 },
      schemaVersion: ops[0].op.schemaVersion,
      isPayloadEncrypted: true,
      opId,
      snapshotOpType: 'REPAIR',
      syncImportReason: 'REPAIR',
      repairBaseServerSeq: latestSeq,
    }),
  });
  expect(checkpoint.ok).toBe(true);
  expect(await checkpoint.json()).toMatchObject({
    accepted: true,
    serverSeq: latestSeq + 1,
  });
  return opId;
};

const selectRelease = async (page: Page, release: ClientRelease): Promise<void> => {
  await page
    .context()
    .addCookies([{ name: 'compat-release', value: release, url: RELEASED_APP_URL }]);
};

const pendingTaskOps = (page: Page): Promise<string[]> =>
  page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('SUP_OPS');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const rows = await new Promise<
        {
          source: string;
          syncedAt?: number;
          op: { id: string; e?: string; entityType?: string };
        }[]
      >((resolve, reject) => {
        const request = db.transaction('ops', 'readonly').objectStore('ops').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return rows
        .filter(
          (row) =>
            row.source === 'local' &&
            !row.syncedAt &&
            (row.op.e ?? row.op.entityType) === 'TASK',
        )
        .map((row) => row.op.id)
        .sort();
    } finally {
      db.close();
    }
  });

test.describe('Published-client upgrade requirement (#9962)', () => {
  test.skip(!oldAssets || !newAssets, 'Set COMPAT_OLD_ASSETS and COMPAT_NEW_ASSETS');
  let assets: Awaited<ReturnType<typeof serveReleasedClientAssets>>;

  test.beforeAll(async () => {
    // Test endpoints create users and operations. Never target a remote server.
    expect(new URL(SUPERSYNC_BASE_URL).hostname).toBe('127.0.0.1');
    assets = await serveReleasedClientAssets({ old: oldAssets!, new: newAssets! });
  });
  test.afterAll(async () => assets?.close());

  for (const scenario of ['returning old client', 'same-ID downgrade'] as const) {
    test(`${scenario}: pending edits survive re-upgrade and a stored checkpoint`, async ({
      browser,
    }, testInfo) => {
      const runId = `compat-${Date.now()}-${testInfo.testId}`;
      const user = await createTestUser(runId);
      const config = getSuperSyncConfig(user);
      const clients: SimulatedE2EClient[] = [];
      try {
        const client = await createSimulatedClient(
          browser,
          RELEASED_APP_URL,
          'Legacy',
          runId,
          {
            serviceWorkers: 'block',
            seedBeforeBoot: async (page) => {
              await selectRelease(page, scenario === 'same-ID downgrade' ? 'new' : 'old');
            },
          },
        );
        clients.push(client);
        await client.workView.waitForTaskList();
        await client.sync.setupSuperSync(config);

        let blockedRequests = 0;
        let blockedUploads = 0;
        let rejectDownloads = true;
        const requestingClientIds = new Set<string>();
        const reportedVersions = new Set<string | null>();
        client.page.on('request', (request) => {
          if (
            request.method() === 'GET' &&
            request.url().startsWith(`${SUPERSYNC_BASE_URL}/api/sync/ops?`)
          ) {
            const query = new URL(request.url()).searchParams;
            requestingClientIds.add(query.get('excludeClient') ?? 'missing');
            reportedVersions.add(query.get('appVersion'));
          }
        });
        await client.page.route(`${SUPERSYNC_BASE_URL}/api/sync/**`, async (route) => {
          if (route.request().method() === 'GET' && !rejectDownloads) {
            await route.continue();
            return;
          }
          blockedRequests++;
          if (route.request().method() === 'POST') blockedUploads++;
          await route.fulfill({
            status: 426,
            contentType: 'application/json',
            body: JSON.stringify({
              error: 'Upgrade required before syncing this account',
              errorCode: 'CLIENT_UPGRADE_REQUIRED',
            }),
          });
        });
        const task = `Pending-${runId}`;
        await client.workView.addTask(task);
        await expect
          .poll(async () => (await pendingTaskOps(client.page)).length)
          .toBeGreaterThan(0);
        const pendingBefore = await pendingTaskOps(client.page);
        expect(pendingBefore.every((id) => typeof id === 'string')).toBe(true);
        const attemptsBefore = blockedRequests;
        await client.sync.clickSyncBtn();
        await expect.poll(() => blockedRequests).toBeGreaterThan(attemptsBefore);
        await expect(client.sync.syncSpinner).toBeHidden({ timeout: 30000 });
        expect(await pendingTaskOps(client.page)).toEqual(pendingBefore);
        await waitForTask(client.page, task);

        // Exercise upload rejection while downloads still return only the known
        // initial state. Once the checkpoint exists, every sync request is denied.
        rejectDownloads = false;
        await client.sync.clickSyncBtn();
        await expect.poll(() => blockedUploads).toBeGreaterThan(0);
        await expect(client.sync.syncSpinner).toBeHidden({ timeout: 30000 });
        expect(await pendingTaskOps(client.page)).toEqual(pendingBefore);
        rejectDownloads = true;
        const checkpointId = await checkpointInitialState(user.token);

        // Persisted operations must survive a restart while sync is still denied.
        await client.page.reload();
        await waitForAppReady(client.page);
        expect(await pendingTaskOps(client.page)).toEqual(pendingBefore);
        await waitForTask(client.page, task);

        if (scenario === 'same-ID downgrade') {
          // v18.14.0 cannot open v19.0.1's IndexedDB schema (7 vs 11).
          // Do not forge a database downgrade to manufacture a sync request.
          const databaseError = client.page.waitForEvent('console', {
            predicate: (message) => message.text().includes('VersionError'),
          });
          const errorDialog = client.page.waitForEvent('dialog', {
            predicate: (dialog) => dialog.type() === 'alert',
          });
          await selectRelease(client.page, 'old');
          await client.page.reload();
          await databaseError;
          const dialog = await errorDialog;
          expect(dialog.message()).toMatch(/database|IndexedDB/i);
          await dialog.dismiss();
          expect(await pendingTaskOps(client.page)).toEqual(pendingBefore);
        }

        // Actual bundle upgrade, preserving the browser context and IndexedDB.
        await selectRelease(client.page, 'new');
        await client.page.reload();
        await waitForAppReady(client.page);
        expect(await pendingTaskOps(client.page)).toEqual(pendingBefore);
        const checkpointDownloaded = client.page.waitForResponse(async (response) => {
          if (
            !response.url().startsWith(`${SUPERSYNC_BASE_URL}/api/sync/ops?`) ||
            !response.ok()
          )
            return false;
          const body = (await response.json()) as { ops: DownloadedOp[] };
          return body.ops.some(({ op }) => op.id === checkpointId);
        });
        await client.page.unroute(`${SUPERSYNC_BASE_URL}/api/sync/**`);
        await Promise.all([client.sync.syncAndWait(), checkpointDownloaded]);
        await expect.poll(() => pendingTaskOps(client.page)).toEqual([]);
        expect([...requestingClientIds]).toHaveLength(1);
        expect(requestingClientIds.has('missing')).toBe(false);
        expect(reportedVersions.has('19.0.1')).toBe(true);
        if (scenario === 'returning old client')
          expect(reportedVersions.has(null)).toBe(true);

        const observer = await createSimulatedClient(
          browser,
          RELEASED_APP_URL,
          'Observer',
          runId,
          {
            serviceWorkers: 'block',
            seedBeforeBoot: (page) =>
              seedSuperSyncCredentials(page, {
                baseUrl: SUPERSYNC_BASE_URL,
                accessToken: user.token,
                encryptKey: password,
              }),
          },
        );
        clients.push(observer);
        await observer.workView.waitForTaskList();
        await observer.sync.setupSuperSync({ ...config, isEncryptionEnabled: false });
        await observer.sync.syncAndWait();
        await waitForTask(observer.page, task);
      } catch (error) {
        for (const client of clients) {
          console.log(
            'Local operation summary',
            await getLocalOpLogSummary(client.page).catch(() => 'unavailable'),
          );
          await client.page
            .screenshot({ path: testInfo.outputPath(`${client.clientName}.png`) })
            .catch(() => {});
        }
        throw error;
      } finally {
        for (const client of clients) await closeClient(client);
      }
    });
  }
});
