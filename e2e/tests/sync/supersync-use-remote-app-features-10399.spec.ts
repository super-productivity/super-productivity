import type { Browser, Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test } from '../../fixtures/supersync.fixture';
import { ImportPage } from '../../pages/import.page';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getLocalOpLogSummary,
  getSuperSyncConfig,
  isFullStateOpType,
  markTaskDoneByKey,
  seedSuperSyncCredentials,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { waitForAppReady } from '../../utils/waits';

/**
 * #10399: "use remote data" on SuperSync rebuilds the device from the server
 * history (forceDownloadRemoteState). With no appFeatures config op in that
 * history, the rebuilt device keeps the app features it shows, before AND after
 * a restart, and a later backup (a full-state op) carries the same: the calm
 * new-install set (#10361) for a device that had it, every feature for a device
 * that had every feature, like every install from before #10361.
 *
 * Before the fix the persisted rebuild baseline carried DEFAULT_GLOBAL_CONFIG's
 * all-on appFeatures while the live store kept its own, so a restart switched
 * every feature on for a device with the new-install set.
 *
 * All clients start with the new-install feature set (`isNewInstallAppFeatures`),
 * unlike the rest of the E2E suite.
 *
 * Run with:
 *   npm run e2e:supersync:file e2e/tests/sync/supersync-use-remote-app-features-10399.spec.ts -- --retries=0
 */

const CRASH_STATE_KEY = 'e2e-10399-crash-state';
const CRASH_LOG = '[CrashResume] Simulating reload after remote baseline commit';
const REBUILD_COMMITTED_LOG =
  'OperationLogSyncService: Replaced local persistence with remote baseline.';
const RESUME_DETECTED_LOG =
  'OperationLogSyncService: Interrupted USE_REMOTE rebuild detected';

/** The features NEW_INSTALL_APP_FEATURES turns off, by their side-nav label. */
const HIDDEN_NAV_ITEMS = ['Schedule', 'Boards', 'Habits'];

const NEW_INSTALL_APP_FEATURES_OFF = {
  isSchedulerEnabled: false,
  isScheduleDayPanelEnabled: false,
  isBoardsEnabled: false,
  isHabitsEnabled: false,
  isIssuesPanelEnabled: false,
  isFinishDayEnabled: false,
  isFocusModeEnabled: false,
};

type SyncConfig = ReturnType<typeof getSuperSyncConfig>;

/**
 * A new-install client with the account's credentials seeded before boot, so
 * setup skips the encryption dialog and its SYNC_IMPORT: the server history has
 * no full-state op, like an account that never replaced its data. With one, the
 * rebuild replays that op's appFeatures and the baseline never shows.
 */
const createClient = (
  browser: Browser,
  baseURL: string,
  name: string,
  testRunId: string,
  syncConfig: SyncConfig,
): Promise<SimulatedE2EClient> =>
  createSimulatedClient(browser, baseURL, name, testRunId, {
    isNewInstallAppFeatures: true,
    seedBeforeBoot: (page) =>
      seedSuperSyncCredentials(page, {
        baseUrl: syncConfig.baseUrl,
        accessToken: syncConfig.accessToken,
        encryptKey: syncConfig.password!,
      }),
  });

const unencryptedSetup = (
  syncConfig: SyncConfig,
  waitForInitialSync = true,
): SyncConfig & { waitForInitialSync: boolean } => ({
  ...syncConfig,
  isEncryptionEnabled: false,
  waitForInitialSync,
});

/** After "use remote" the local op log is the server history. */
const expectNoFullStateOp = async (page: Page): Promise<void> => {
  const opTypes = (await getLocalOpLogSummary(page)).map((op) => op.opType);
  expect(opTypes.length).toBeGreaterThan(0);
  expect(opTypes.filter(isFullStateOpType)).toEqual([]);
};

type FeatureSet = 'new-install' | 'all-on';

const expectFeatures = async (
  page: Page,
  features: FeatureSet,
  context: string,
): Promise<void> => {
  const sideNav = page.locator('magic-side-nav');
  await expect(sideNav.getByText('Planner', { exact: true }), context).toBeVisible({
    timeout: 15000,
  });
  for (const label of HIDDEN_NAV_ITEMS) {
    await expect(
      sideNav.getByText(label, { exact: true }),
      `${context}: ${label}`,
    ).toHaveCount(features === 'new-install' ? 0 : 1);
  }
};

const expectNewInstallFeatures = (page: Page, context: string): Promise<void> =>
  expectFeatures(page, 'new-install', context);

const restart = async (page: Page): Promise<void> => {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForAppReady(page);
};

/** The appFeatures a backup exported from this device carries. */
const exportedAppFeatures = async (page: Page): Promise<Record<string, unknown>> => {
  const importPage = new ImportPage(page);
  await importPage.navigateToImportPage();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Data', exact: true }).click();
  const download = await downloadPromise;
  const backupPath = path.join(os.tmpdir(), `sp-10399-${Date.now()}.json`);
  await download.saveAs(backupPath);
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8')) as {
    data?: { globalConfig?: { appFeatures?: Record<string, unknown> } };
    globalConfig?: { appFeatures?: Record<string, unknown> };
  };
  fs.unlinkSync(backupPath);
  await page.goto('/#/tag/TODAY/tasks');
  return (backup.data ?? backup).globalConfig?.appFeatures ?? {};
};

/** test-backup.json, with its appFeatures replaced (undefined keeps the fixture's all-on set). */
const writeBackupFixture = (
  testRunId: string,
  appFeatures?: Record<string, boolean>,
): string => {
  const backup = JSON.parse(
    fs.readFileSync(ImportPage.getFixturePath('test-backup.json'), 'utf8'),
  ) as { data: { globalConfig: { appFeatures: Record<string, boolean> } } };
  if (appFeatures) {
    backup.data.globalConfig.appFeatures = {
      ...backup.data.globalConfig.appFeatures,
      ...appFeatures,
    };
  }
  const fixturePath = path.join(os.tmpdir(), `sp-10399-backup-${testRunId}.json`);
  fs.writeFileSync(fixturePath, JSON.stringify(backup));
  return fixturePath;
};

/** A fresh install joining the account, the reference for what "use remote" yields. */
const expectFreshInstallMatches = async (
  browser: Browser,
  baseURL: string,
  testRunId: string,
  syncConfig: SyncConfig,
  remoteTask: string,
  clients: SimulatedE2EClient[],
): Promise<void> => {
  const fresh = await createClient(browser, baseURL, 'Fresh', testRunId, syncConfig);
  clients.push(fresh);
  await fresh.workView.waitForTaskList();
  await fresh.sync.setupSuperSync(unencryptedSetup(syncConfig));
  await waitForTask(fresh.page, remoteTask);
  await expectNewInstallFeatures(fresh.page, 'fresh install');
};

test.describe('@supersync #10399 "use remote" keeps the app features through a restart', () => {
  // Red without the fix: new-install (the restart turns every feature on).
  // all-on passes without it too and pins that a device with every feature
  // keeps them, rather than taking the new-install set from the rebuild.
  for (const backupFeatures of ['new-install', 'all-on'] as const) {
    test(`SYNC_IMPORT dialog, backup with ${backupFeatures} features: use remote, then restart`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      test.slow();
      const clients: SimulatedE2EClient[] = [];
      const backupPath = writeBackupFixture(
        testRunId,
        backupFeatures === 'new-install' ? NEW_INSTALL_APP_FEATURES_OFF : undefined,
      );
      try {
        const syncConfig = getSuperSyncConfig(await createTestUser(testRunId));
        const remoteTask = `Remote-10399-${testRunId}`;

        const clientA = await createClient(browser, baseURL!, 'A', testRunId, syncConfig);
        clients.push(clientA);
        await clientA.workView.waitForTaskList();
        await clientA.sync.setupSuperSync(unencryptedSetup(syncConfig));
        await clientA.workView.addTask(remoteTask);
        await clientA.sync.syncAndWait();
        await expectNewInstallFeatures(clientA.page, 'A');

        // B restores a backup locally (a local BACKUP_IMPORT), so its first sync
        // asks which side to keep.
        const clientB = await createClient(browser, baseURL!, 'B', testRunId, syncConfig);
        clients.push(clientB);
        const importPage = new ImportPage(clientB.page);
        await importPage.navigateToImportPage();
        await importPage.importBackupFile(backupPath);
        await clientB.page.goto('/#/tag/TODAY/tasks');
        await clientB.sync.setupSuperSync(unencryptedSetup(syncConfig, false));
        await expect(clientB.sync.syncImportConflictDialog).toBeVisible({
          timeout: 30000,
        });
        await clientB.sync.chooseSyncImportUseRemote();
        await waitForTask(clientB.page, remoteTask);
        await clientB.sync.syncAndWait();
        await expectNoFullStateOp(clientB.page);

        // The server history has no appFeatures op: B keeps what it shows.
        await expectFeatures(clientB.page, backupFeatures, 'B after use remote');
        await restart(clientB.page);
        await waitForTask(clientB.page, remoteTask);
        await expectFeatures(clientB.page, backupFeatures, 'B after restart');
        const exported = await exportedAppFeatures(clientB.page);
        for (const [key, isOffForNewInstall] of Object.entries(
          NEW_INSTALL_APP_FEATURES_OFF,
        )) {
          expect(exported[key], `exported ${key}`).toBe(
            backupFeatures === 'new-install' ? isOffForNewInstall : true,
          );
        }

        await clientA.sync.syncAndWait();
        await expectNewInstallFeatures(clientA.page, 'A after B synced');
        if (backupFeatures === 'new-install') {
          await expectFreshInstallMatches(
            browser,
            baseURL!,
            testRunId,
            syncConfig,
            remoteTask,
            clients,
          );
        }
      } finally {
        for (const client of clients) {
          await closeClient(client);
        }
        fs.rmSync(backupPath, { force: true });
      }
    });
  }

  // The crash failpoint of supersync-use-remote-crash-resume.spec.ts: B reloads
  // right after the baseline commits, so the reload hydrates that baseline and
  // the resume rebuilds from it. Red without the fix already after the reload.
  test('crash after the baseline commits: reload, resume, then restart', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(240000);
    const clients: SimulatedE2EClient[] = [];
    const backupPath = writeBackupFixture(testRunId, NEW_INSTALL_APP_FEATURES_OFF);
    try {
      const syncConfig = getSuperSyncConfig(await createTestUser(testRunId));
      const remoteTask = `Remote-10399-${testRunId}`;

      const clientA = await createClient(browser, baseURL!, 'A', testRunId, syncConfig);
      clients.push(clientA);
      await clientA.workView.waitForTaskList();
      await clientA.sync.setupSuperSync(unencryptedSetup(syncConfig));
      await clientA.workView.addTask(remoteTask);
      await clientA.sync.syncAndWait();

      const clientB = await createClient(browser, baseURL!, 'B', testRunId, syncConfig);
      clients.push(clientB);
      await clientB.page.addInitScript(
        ({ crashLog, crashStateKey, rebuildCommittedLog }) => {
          const e2eGlobal = globalThis as typeof globalThis & {
            __SP_E2E_BLOCK_AUTO_SYNC?: boolean;
            __SP_E2E_BLOCK_IMMEDIATE_UPLOAD?: boolean;
            __SP_E2E_BLOCK_WS_DOWNLOAD?: boolean;
          };
          e2eGlobal.__SP_E2E_BLOCK_AUTO_SYNC =
            sessionStorage.getItem(crashStateKey) === 'crashed';
          e2eGlobal.__SP_E2E_BLOCK_IMMEDIATE_UPLOAD = true;
          e2eGlobal.__SP_E2E_BLOCK_WS_DOWNLOAD = true;
          const originalLog = console.log.bind(console);
          console.log = (...args: unknown[]): void => {
            originalLog(...args);
            if (
              sessionStorage.getItem(crashStateKey) === 'armed' &&
              args.map(String).join(' ').includes(rebuildCommittedLog)
            ) {
              sessionStorage.setItem(crashStateKey, 'crashed');
              originalLog(crashLog);
              throw new Error(crashLog);
            }
          };
        },
        {
          crashLog: CRASH_LOG,
          crashStateKey: CRASH_STATE_KEY,
          rebuildCommittedLog: REBUILD_COMMITTED_LOG,
        },
      );
      await clientB.page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitForAppReady(clientB.page);

      const importPage = new ImportPage(clientB.page);
      await importPage.navigateToImportPage();
      await importPage.importBackupFile(backupPath);
      await clientB.page.goto('/#/tag/TODAY/tasks');
      await clientB.page.evaluate(
        (key) => sessionStorage.setItem(key, 'armed'),
        CRASH_STATE_KEY,
      );
      await clientB.sync.setupSuperSync(unencryptedSetup(syncConfig, false));
      await expect(clientB.sync.syncImportConflictDialog).toBeVisible({
        timeout: 30000,
      });

      const crashObserved = clientB.page.waitForEvent('console', {
        predicate: (message) => message.text().includes(CRASH_LOG),
        timeout: 30000,
      });
      await clientB.sync.chooseSyncImportUseRemote();
      await crashObserved;
      await clientB.page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitForAppReady(clientB.page);
      expect(
        await clientB.page.evaluate(
          (key) => sessionStorage.getItem(key),
          CRASH_STATE_KEY,
        ),
      ).toBe('crashed');
      await expectNewInstallFeatures(clientB.page, 'B after crash reload');

      const resumeDetected = clientB.page.waitForEvent('console', {
        predicate: (message) => message.text().includes(RESUME_DETECTED_LOG),
        timeout: 30000,
      });
      await clientB.sync.syncAndWait({ timeout: 60000 });
      await resumeDetected;
      await waitForTask(clientB.page, remoteTask);
      await expectNewInstallFeatures(clientB.page, 'B after resume');

      await restart(clientB.page);
      await waitForTask(clientB.page, remoteTask);
      await expectNewInstallFeatures(clientB.page, 'B after restart');
    } finally {
      for (const client of clients) {
        await closeClient(client);
      }
      fs.rmSync(backupPath, { force: true });
    }
  });

  // Passes without the fix too: both devices set up sync concurrently, and the
  // resulting [GLOBAL_CONFIG] LWW Update carries the winner's whole config,
  // appFeatures included, so the replay overwrites the baseline's. It checks the
  // same rebuild through the stop's dialog; the SYNC_IMPORT tests above are the
  // reproduction.
  test('whole-dataset dialog after a sync stop: use remote, then restart', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.slow();
    const clients: SimulatedE2EClient[] = [];
    try {
      const syncConfig = getSuperSyncConfig(await createTestUser(testRunId));
      const remoteOnlyTask = `RemoteOnly-10399-${testRunId}`;
      const titles = [`ArchA-${testRunId}`, `ArchB-${testRunId}`];

      // The stop from supersync-conflict-dialog-helper.spec.ts: two overlapping
      // pending bulk archives on `local` against `remote`'s edit of one of them.
      const local = await createClient(browser, baseURL!, 'Local', testRunId, syncConfig);
      clients.push(local);
      const remote = await createClient(
        browser,
        baseURL!,
        'Remote',
        testRunId,
        syncConfig,
      );
      clients.push(remote);

      await local.workView.waitForTaskList();
      await local.sync.setupSuperSync(unencryptedSetup(syncConfig));
      await blockBackgroundSync(local.page);
      for (const title of titles) {
        await local.workView.addTask(title);
      }
      await local.sync.syncAndWait();
      await local.page.route('**/api/sync/**', (route) => route.abort());

      await remote.workView.waitForTaskList();
      await remote.sync.setupSuperSync(unencryptedSetup(syncConfig));
      await remote.sync.syncAndWait();
      await blockBackgroundSync(remote.page);
      for (const title of titles) {
        await waitForTask(remote.page, title);
      }
      await markTaskDoneByKey(remote, titles[0]);
      await remote.workView.addTask(remoteOnlyTask);
      await remote.sync.syncAndWait();

      await archiveTasks(local, titles);
      for (const title of titles) {
        await restoreFromArchive(local.page, title);
      }
      await archiveTasks(local, titles);
      await expect(local.sync.syncSpinner).not.toBeVisible({ timeout: 30000 });
      await local.page.unroute('**/api/sync/**');

      await local.sync.syncAndWait({ conflictDialog: 'remote', timeout: 60000 });
      await waitForTask(local.page, remoteOnlyTask);
      await expectNoFullStateOp(local.page);
      await expectNewInstallFeatures(local.page, 'local after use remote');

      await restart(local.page);
      await waitForTask(local.page, remoteOnlyTask);
      await expectNewInstallFeatures(local.page, 'local after restart');
      expect(await exportedAppFeatures(local.page)).toEqual(
        expect.objectContaining(NEW_INSTALL_APP_FEATURES_OFF),
      );

      await expectNewInstallFeatures(remote.page, 'remote');
      await expectFreshInstallMatches(
        browser,
        baseURL!,
        testRunId,
        syncConfig,
        remoteOnlyTask,
        clients,
      );
    } finally {
      for (const client of clients) {
        await closeClient(client);
      }
    }
  });
});

/** Only the test may start a sync cycle: no automatic sync, upload or download. */
const blockBackgroundSync = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const flags = globalThis as unknown as Record<string, unknown>;
    flags.__SP_E2E_BLOCK_AUTO_SYNC = true;
    flags.__SP_E2E_BLOCK_IMMEDIATE_UPLOAD = true;
    flags.__SP_E2E_BLOCK_WS_DOWNLOAD = true;
  });

const archiveTasks = async (
  client: SimulatedE2EClient,
  titles: string[],
): Promise<void> => {
  for (const title of titles) {
    await markTaskDoneByKey(client, title);
  }
  // archiveDoneTasks() clicks the Finish Day button, which the new-install
  // features hide; the route itself stays reachable.
  await client.page.goto('/#/tag/TODAY/daily-summary');
  const saveAndGoHomeBtn = client.page.locator(
    'daily-summary button[mat-flat-button]:has(mat-icon:has-text("wb_sunny"))',
  );
  await Promise.all([
    client.page.waitForURL(/tag\/TODAY(?!\/daily-summary)/),
    saveAndGoHomeBtn.click(),
  ]);
  await expect(client.page.locator('task')).toHaveCount(0);
};

const restoreFromArchive = async (page: Page, title: string): Promise<void> => {
  await page.goto('/#/tag/TODAY/history');
  await page.locator('history .week-row .day-toggle').first().click();
  const row = page.locator('.task-summary-table tr', { hasText: title });
  await row.getByRole('button', { name: 'Restore task from archive' }).click();
  await page.getByRole('button', { name: 'Do it!' }).click();
  await expect(page.locator('task', { hasText: title })).toBeVisible();
};
