import { test, expect } from '../../fixtures/webdav.fixture';
import type { APIRequestContext, Browser, Page, Request } from '@playwright/test';
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
  version: number;
  syncVersion: number;
  recentOps: Array<{
    id: string;
    p?: {
      actionPayload?: {
        task?: {
          title?: string | null;
        };
      };
    };
  }>;
  snapshotRef: {
    rev?: string;
  };
  migration?: {
    status: string;
    legacyRev: string;
  };
}

interface SplitTombstone {
  version: number;
  format: string;
}

interface SplitStateFile {
  version: number;
  syncVersion: number;
  state: unknown;
}

interface RemoteSyncFile {
  version: number;
  syncVersion?: number;
  format?: string;
  state?: unknown;
}

type MigrationResponseLossStage =
  | 'pending-marker'
  | 'state'
  | 'backup-tombstone'
  | 'primary-tombstone'
  | 'final-marker';

interface MigrationResponseLossScenario {
  stage: MigrationResponseLossStage;
  title: string;
  stateCommitted: boolean;
  backupTombstoned: boolean;
  primaryTombstoned: boolean;
  markerPending: boolean;
}

interface MigrationUploadBody {
  version?: number;
  syncVersion?: number;
  format?: string;
  state?: unknown;
  recentOps?: Array<{ id?: string }>;
  snapshotRef?: {
    rev?: string;
    syncVersion?: number;
  };
  migration?: {
    status?: string;
    legacyRev?: string;
  };
}

const MIGRATION_RESPONSE_LOSS_SCENARIOS: readonly MigrationResponseLossScenario[] = [
  {
    stage: 'pending-marker',
    title:
      'recovers when the pending sync-ops migration marker commits but its response is lost',
    stateCommitted: false,
    backupTombstoned: false,
    primaryTombstoned: false,
    markerPending: true,
  },
  {
    stage: 'state',
    title: 'recovers when sync-state commits during migration but its response is lost',
    stateCommitted: true,
    backupTombstoned: false,
    primaryTombstoned: false,
    markerPending: true,
  },
  {
    stage: 'backup-tombstone',
    title:
      'recovers when backup neutralization commits during migration but its response is lost',
    stateCommitted: true,
    backupTombstoned: true,
    primaryTombstoned: false,
    markerPending: true,
  },
  {
    stage: 'primary-tombstone',
    title: 'recovers a v2 migration after the tombstone response is lost',
    stateCommitted: true,
    backupTombstoned: true,
    primaryTombstoned: true,
    markerPending: true,
  },
  {
    stage: 'final-marker',
    title:
      'recovers when the final sync-ops marker clear commits but its response is lost',
    stateCommitted: true,
    backupTombstoned: true,
    primaryTombstoned: true,
    markerPending: false,
  },
];

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

const decodeMigrationUpload = (request: Request): MigrationUploadBody | undefined => {
  const body = request.postData();
  if (!body) {
    return undefined;
  }
  const prefixEnd = body.indexOf('__');
  if (prefixEnd < 0) {
    return undefined;
  }
  return JSON.parse(body.slice(prefixEnd + 2)) as MigrationUploadBody;
};

const isScenarioUpload = (
  request: Request,
  scenario: MigrationResponseLossScenario,
  legacySyncVersion: number,
  pendingOperationId: string,
): boolean => {
  if (request.method() !== 'PUT') {
    return false;
  }

  const path = new URL(request.url()).pathname;
  const uploaded = decodeMigrationUpload(request);
  if (!uploaded || uploaded.version !== 3) {
    return false;
  }

  switch (scenario.stage) {
    case 'pending-marker':
      return (
        path.endsWith('/sync-ops.json') &&
        uploaded.syncVersion === legacySyncVersion &&
        uploaded.migration?.status === 'pending' &&
        !!uploaded.migration.legacyRev &&
        uploaded.snapshotRef?.syncVersion === legacySyncVersion &&
        uploaded.snapshotRef.rev === undefined &&
        uploaded.recentOps?.every((operation) => operation.id !== pendingOperationId) ===
          true
      );
    case 'state':
      return (
        path.endsWith('/sync-state.json') &&
        uploaded.syncVersion === legacySyncVersion &&
        uploaded.state !== undefined
      );
    case 'backup-tombstone':
      return path.endsWith('/sync-data.json.bak') && uploaded.format === 'split';
    case 'primary-tombstone':
      return path.endsWith('/sync-data.json') && uploaded.format === 'split';
    case 'final-marker':
      return (
        path.endsWith('/sync-ops.json') &&
        uploaded.syncVersion === legacySyncVersion &&
        uploaded.migration === undefined &&
        !!uploaded.snapshotRef?.rev &&
        uploaded.recentOps?.every((operation) => operation.id !== pendingOperationId) ===
          true
      );
  }
};

const getLocalPendingOperationIds = async (page: Page): Promise<string[]> =>
  page.evaluate(async () => {
    interface StoredOperation {
      op?: {
        id?: string;
      };
      syncedAt?: number;
      rejectedAt?: number;
    }

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const openRequest = indexedDB.open('SUP_OPS');
      openRequest.onsuccess = (): void => resolve(openRequest.result);
      openRequest.onerror = (): void => reject(openRequest.error);
    });
    try {
      const entries = await new Promise<StoredOperation[]>((resolve, reject) => {
        const tx = db.transaction('ops', 'readonly');
        const getRequest = tx.objectStore('ops').getAll();
        getRequest.onsuccess = (): void =>
          resolve(getRequest.result as StoredOperation[]);
        getRequest.onerror = (): void => reject(getRequest.error);
      });
      return entries.flatMap((entry) =>
        entry.syncedAt === undefined &&
        entry.rejectedAt === undefined &&
        typeof entry.op?.id === 'string'
          ? [entry.op.id]
          : [],
      );
    } finally {
      db.close();
    }
  });

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

  const runMigrationResponseLossScenario = async (
    browser: Browser,
    baseURL: string | undefined,
    request: APIRequestContext,
    scenario: MigrationResponseLossScenario,
  ): Promise<void> => {
    const appUrl = baseURL || 'http://localhost:4242';
    const folderName = generateSyncFolderName(`e2e-surgical-v2-${scenario.stage}`);
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
    let freshSplitClient: Awaited<ReturnType<typeof setupSyncClient>> | null = null;
    let legacyRequestListener: ((webDavRequest: Request) => void) | null = null;
    const migrationRoute = `**/${folderName}/DEV/**`;

    try {
      migratingClient = await setupSyncClient(browser, appUrl);
      const sync = new SyncPage(migratingClient.page);
      const workView = new WorkViewPage(migratingClient.page);
      await workView.waitForTaskList();

      await sync.setupWebdavSync(legacyConfig);

      const firstLegacyTask = `Legacy-first-${folderName}`;
      await workView.addTask(firstLegacyTask);
      await waitForStatePersistence(migratingClient.page);
      await sync.triggerSync();
      await waitForSyncComplete(migratingClient.page, sync);

      // The second v2 upload creates a populated legacy backup so every
      // interruption proves that stale recovery data is neutralized safely.
      const secondLegacyTask = `Legacy-second-${folderName}`;
      await workView.addTask(secondLegacyTask);
      await waitForStatePersistence(migratingClient.page);
      await sync.triggerSync();
      await waitForSyncComplete(migratingClient.page, sync);

      const legacyPrimary = await readPrefixedFile<RemoteSyncFile>(
        request,
        `${folderUrl}sync-data.json`,
        authorization,
      );
      const legacyBackup = await readPrefixedFile<RemoteSyncFile>(
        request,
        `${folderUrl}sync-data.json.bak`,
        authorization,
      );
      expect(legacyPrimary.version).toBe(2);
      expect(legacyBackup.version).toBe(2);
      const legacyPrimaryState = JSON.stringify(legacyPrimary.state);
      const legacyBackupState = JSON.stringify(legacyBackup.state);
      expect(legacyPrimaryState).toContain(firstLegacyTask);
      expect(legacyPrimaryState).toContain(secondLegacyTask);
      expect(legacyBackupState).toContain(firstLegacyTask);
      expect(legacyBackupState).not.toContain(secondLegacyTask);
      const legacySyncVersion = legacyPrimary.syncVersion;
      if (legacySyncVersion === undefined) {
        throw new Error('Legacy primary is missing its syncVersion');
      }

      const pendingIdsBefore = new Set(
        await getLocalPendingOperationIds(migratingClient.page),
      );
      const pendingTask = `Pending-during-migration-${folderName}`;
      await workView.addTask(pendingTask);
      await waitForStatePersistence(migratingClient.page);
      const newPendingIds = (
        await getLocalPendingOperationIds(migratingClient.page)
      ).filter((id) => !pendingIdsBefore.has(id));
      expect(newPendingIds).toHaveLength(1);
      const pendingOperationId = newPendingIds[0];

      let faultActive = true;
      let stageCommitted = false;
      await migratingClient.page.route(migrationRoute, async (route) => {
        const webDavRequest = route.request();
        if (faultActive && stageCommitted && webDavRequest.method() === 'PUT') {
          await route.abort('failed');
          return;
        }
        if (
          faultActive &&
          isScenarioUpload(webDavRequest, scenario, legacySyncVersion, pendingOperationId)
        ) {
          const response = await route.fetch();
          expect(response.ok()).toBe(true);
          stageCommitted = true;
          await route.abort('failed');
          return;
        }
        await route.continue();
      });

      // Reconfiguration may schedule the migration immediately, so interception
      // is installed before Surgical sync is enabled.
      await sync.setupWebdavSync(splitConfig, { isReconfigure: true });
      await expect.poll(() => stageCommitted).toBe(true);
      await sync.syncSpinner.waitFor({ state: 'hidden', timeout: 20000 });

      // Read the exact durable boundary before reload. Later PUTs remain blocked,
      // so these assertions cannot accidentally observe an in-memory retry.
      const interruptedOps = await readSurgicalOpsFile(
        request,
        `${folderUrl}sync-ops.json`,
        authorization,
      );
      if (scenario.markerPending) {
        expect(interruptedOps.migration).toMatchObject({ status: 'pending' });
        expect(interruptedOps.migration?.legacyRev).toBeTruthy();
      } else {
        expect(interruptedOps.migration).toBeUndefined();
      }
      expect(interruptedOps.syncVersion).toBe(legacySyncVersion);
      if (scenario.markerPending) {
        expect(interruptedOps.snapshotRef.rev).toBeUndefined();
      } else {
        expect(interruptedOps.snapshotRef.rev).toBeTruthy();
      }
      expect(
        interruptedOps.recentOps.filter(
          (operation) => operation.id === pendingOperationId,
        ),
      ).toHaveLength(0);
      const pendingLocalOperation = await getLocalOperationState(
        migratingClient.page,
        pendingOperationId,
      );
      expect(pendingLocalOperation).toBeDefined();
      expect(pendingLocalOperation?.syncedAt).toBeUndefined();
      expect(pendingLocalOperation?.rejectedAt).toBeUndefined();

      const stateUrl = `${folderUrl}sync-state.json`;
      if (scenario.stateCommitted) {
        const interruptedState = await readPrefixedFile<SplitStateFile>(
          request,
          stateUrl,
          authorization,
        );
        expect(interruptedState).toMatchObject({
          version: 3,
          syncVersion: legacySyncVersion,
        });
        expect(JSON.stringify(interruptedState.state)).toContain(firstLegacyTask);
        expect(JSON.stringify(interruptedState.state)).toContain(secondLegacyTask);
        expect(JSON.stringify(interruptedState.state)).not.toContain(pendingTask);
      } else {
        const missingState = await request.get(stateUrl, {
          headers: { Authorization: authorization },
        });
        expect(missingState.status()).toBe(404);
      }

      const interruptedPrimary = await readPrefixedFile<RemoteSyncFile>(
        request,
        `${folderUrl}sync-data.json`,
        authorization,
      );
      const interruptedBackup = await readPrefixedFile<RemoteSyncFile>(
        request,
        `${folderUrl}sync-data.json.bak`,
        authorization,
      );
      if (scenario.primaryTombstoned) {
        expect(interruptedPrimary).toMatchObject({ version: 3, format: 'split' });
      } else {
        expect(interruptedPrimary).toEqual(legacyPrimary);
      }
      if (scenario.backupTombstoned) {
        expect(interruptedBackup).toMatchObject({ version: 3, format: 'split' });
      } else {
        expect(interruptedBackup).toEqual(legacyBackup);
      }

      // Before the primary tombstone, sync-ops fences split-disabled clients;
      // afterward, the tombstone does.
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

      const guardFile = scenario.primaryTombstoned ? 'sync-data.json' : 'sync-ops.json';
      const guardedFormatDownload = legacyClient.page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' &&
          response.url() === `${folderUrl}${guardFile}` &&
          response.ok(),
        { timeout: 20000 },
      );
      await legacySync.syncBtn.click({ noWaitAfter: true });
      await guardedFormatDownload;
      await expect(legacyClient.page.locator('snack-custom .message')).toContainText(
        /split-file format.*(?:Enable|Turn on).*Surgical sync.*Sync settings/i,
        { timeout: 20000 },
      );
      await expect(legacySync.syncBtn).toHaveAccessibleName(
        'Sync problem — click to retry',
      );
      expect(legacyPutCount).toBe(0);

      const opsAfterLegacyAttempt = await readSurgicalOpsFile(
        request,
        `${folderUrl}sync-ops.json`,
        authorization,
      );
      const primaryAfterLegacyAttempt = await readPrefixedFile<RemoteSyncFile>(
        request,
        `${folderUrl}sync-data.json`,
        authorization,
      );
      expect(opsAfterLegacyAttempt).toEqual(interruptedOps);
      expect(primaryAfterLegacyAttempt).toEqual(interruptedPrimary);

      // Release the fault at the reload boundary so the new document recovers
      // from the remote marker and the locally persisted pending operation.
      faultActive = false;
      await migratingClient.page.reload({ waitUntil: 'domcontentloaded' });
      await waitForAppReady(migratingClient.page);
      await sync.triggerSync();
      await waitForSyncComplete(migratingClient.page, sync);

      for (const taskTitle of [firstLegacyTask, secondLegacyTask, pendingTask]) {
        await expect(
          migratingClient.page.locator('task', { hasText: taskTitle }),
        ).toHaveCount(1);
      }

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
      const recoveredState = await readPrefixedFile<SplitStateFile>(
        request,
        `${folderUrl}sync-state.json`,
        authorization,
      );
      expect(recoveredPrimary).toMatchObject({ version: 3, format: 'split' });
      expect(recoveredBackup).toMatchObject({ version: 3, format: 'split' });
      expect(recoveredOps.migration).toBeUndefined();
      expect(recoveredOps.syncVersion).toBeGreaterThan(legacySyncVersion);
      const recoveredPendingOperations = recoveredOps.recentOps.filter(
        (operation) => operation.id === pendingOperationId,
      );
      expect(recoveredPendingOperations).toHaveLength(1);
      expect(recoveredPendingOperations[0]?.p).toMatchObject({
        actionPayload: {
          task: {
            title: pendingTask,
          },
        },
      });
      const recoveredLocalOperation = await getLocalOperationState(
        migratingClient.page,
        pendingOperationId,
      );
      expect(recoveredLocalOperation).toBeDefined();
      expect(recoveredLocalOperation?.syncedAt).toBeDefined();
      expect(recoveredLocalOperation?.rejectedAt).toBeUndefined();
      expect(recoveredState).toMatchObject({
        version: 3,
        syncVersion: legacySyncVersion,
      });
      expect(JSON.stringify(recoveredState.state)).toContain(firstLegacyTask);
      expect(JSON.stringify(recoveredState.state)).toContain(secondLegacyTask);
      expect(JSON.stringify(recoveredState.state)).not.toContain(pendingTask);

      // Every fault stage reaches the same healed split files. Exercise a fresh
      // baseline-plus-tail download once without multiplying this slow setup by five.
      if (scenario.stage === 'final-marker') {
        freshSplitClient = await setupSyncClient(browser, appUrl);
        const freshSync = new SyncPage(freshSplitClient.page);
        await freshSync.setupWebdavSync(splitConfig);
        await freshSync.triggerSync();
        await waitForSyncComplete(freshSplitClient.page, freshSync);

        for (const taskTitle of [firstLegacyTask, secondLegacyTask, pendingTask]) {
          await expect(
            freshSplitClient.page.locator('task', { hasText: taskTitle }),
          ).toHaveCount(1);
        }
      }
    } finally {
      if (migratingClient) {
        await migratingClient.page.unroute(migrationRoute).catch(() => {});
      }
      if (legacyClient && legacyRequestListener) {
        legacyClient.page.off('request', legacyRequestListener);
      }
      await closeContextsSafely(
        migratingClient?.context,
        legacyClient?.context,
        freshSplitClient?.context,
      );
    }
  };

  for (const scenario of MIGRATION_RESPONSE_LOSS_SCENARIOS) {
    test(scenario.title, async ({ browser, baseURL, request }) => {
      test.slow();
      await runMigrationResponseLossScenario(browser, baseURL, request, scenario);
    });
  }

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
