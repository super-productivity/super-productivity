import type { APIRequestContext, Browser, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/webdav.fixture';
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
import { waitForStatePersistence } from '../../utils/waits';
import {
  countWebdavWrites,
  hasEverAppeared,
  recordIfEverAppears,
} from '../../utils/audit-webdav-helpers';

const authorization = `Basic ${Buffer.from('admin:admin').toString('base64')}`;
const root = WEBDAV_CONFIG_TEMPLATE.baseUrl;
// This spec pins #10459, a v2-only race: pin the format so the v3 leg of the
// scheduled WebDAV job (E2E_WEBDAV_FORMAT=v3) still exercises the v2 path.
const V2_CONFIG = { ...WEBDAV_CONFIG_TEMPLATE, isUseSplitSyncFiles: false };

const remoteText = async (request: APIRequestContext, url: string): Promise<string> => {
  const response = await request.get(url, { headers: { Authorization: authorization } });
  expect(response.ok(), `Expected remote file: ${url}`).toBe(true);
  return response.text();
};

const parsePrefixed = <T>(encoded: string): T =>
  JSON.parse(encoded.slice(encoded.indexOf('__') + 2)) as T;

/** Only the test starts syncs after setup, so no automatic cycle interleaves. */
const keepSyncManual = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const helpers = (
      window as unknown as {
        __e2eTestHelpers: { store: { dispatch: (action: unknown) => void } };
      }
    ).__e2eTestHelpers;
    helpers.store.dispatch({
      type: '[Global Config] Update Global Config Section',
      sectionKey: 'sync',
      sectionCfg: { isManualSyncOnly: true },
    });
  });

/** The first-sync decision is showing; Cancel keeps both sides. */
const cancelSyncConflict = async (page: Page, sync: SyncPage): Promise<void> => {
  const dialog = page.locator('dialog-sync-conflict');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(sync.syncSpinner).toBeHidden();
};

/**
 * A deferred upload is not a dead end: the next sync downloads the remote data
 * first and, with local data on both sides, asks. Cancelling keeps both.
 */
const expectNextSyncToAskFirst = async (page: Page, sync: SyncPage): Promise<void> => {
  await expect(sync.syncErrorIcon).toBeHidden();
  await sync.triggerSync();
  expect(await waitForSyncComplete(page, sync, 30000, { expectConflict: true })).toBe(
    'conflict',
  );
  await cancelSyncConflict(page, sync);
};

/**
 * A synced device that moves to an empty folder seeds it with a
 * SERVER_MIGRATION SYNC_IMPORT: a snapshot-only v2 file (no retained ops).
 * Returns the moved-to folder's remote URL.
 */
const seedSnapshotOnlyFolder = async (
  browser: Browser,
  baseURL: string | undefined,
  request: APIRequestContext,
  seedFolder: string,
  seedTitle: string,
): Promise<string> => {
  const movedFolder = `${seedFolder}-moved`;
  await createSyncFolder(request, seedFolder);
  await createSyncFolder(request, movedFolder);
  const seed = await setupSyncClient(browser, baseURL);
  try {
    const work = new WorkViewPage(seed.page);
    const sync = new SyncPage(seed.page);
    await work.waitForTaskList();
    await work.addTask(seedTitle);
    await waitForStatePersistence(seed.page);
    await sync.setupWebdavSync({
      ...V2_CONFIG,
      syncFolderPath: `/${seedFolder}`,
    });
    expect(await waitForSyncComplete(seed.page, sync)).toBe('success');
    await sync.setupWebdavSync(
      { ...V2_CONFIG, syncFolderPath: `/${movedFolder}` },
      { isReconfigure: true },
    );
    expect(await waitForSyncComplete(seed.page, sync)).toBe('success');
  } finally {
    await closeContextsSafely(seed.context);
  }
  return `${root}${movedFolder}/DEV/`;
};

test.describe('@webdav a late snapshot-only v2 file is loaded before uploading', () => {
  test.beforeEach(async ({ webdavServerUp }) => {
    void webdavServerUp;
  });

  // A fresh client's download found an empty folder. If another device seeds
  // the folder before the fresh client's upload reads it, that upload must not
  // build on data the client never loaded. With retained ops the #10256 guard
  // already defers it; a snapshot-only file has no ops to trip that guard.
  test('does not merge over a snapshot-only file appearing after empty-folder discovery', async ({
    browser,
    baseURL,
    request,
  }) => {
    const seedFolder = generateSyncFolderName('late-snapshot-v2');
    const folder = `${seedFolder}-target`;
    const remote = `${root}${folder}/DEV/`;
    const seedTitle = `Seeded snapshot task ${folder}`;
    const movedRemote = await seedSnapshotOnlyFolder(
      browser,
      baseURL,
      request,
      seedFolder,
      seedTitle,
    );
    const snapshotOnly = await remoteText(request, `${movedRemote}sync-data.json`);
    const seeded = parsePrefixed<{
      version: number;
      recentOps: unknown[];
      state: unknown;
    }>(snapshotOnly);
    expect(seeded.version).toBe(2);
    expect(seeded.recentOps).toEqual([]);
    expect(JSON.stringify(seeded.state)).toContain(seedTitle);

    await createSyncFolder(request, folder);
    await createSyncFolder(request, `${folder}/DEV`);
    const joining = await setupSyncClient(browser, baseURL);
    try {
      const sync = new SyncPage(joining.page);
      const work = new WorkViewPage(joining.page);
      await work.waitForTaskList();
      const localTitle = `Pending joiner task ${folder}`;
      await work.addTask(localTitle);
      await waitForStatePersistence(joining.page);
      await keepSyncManual(joining.page);
      let legacyReads = 0;
      let appWrites = 0;
      // Every write into the folder, not only to the routed file: a v3 file or
      // an immutable snapshot would also merge over the seed.
      const syncFilePuts = countWebdavWrites(joining.page, `${folder}/DEV`);
      let published = false;
      await joining.page.route(`**/${folder}/DEV/sync-data.json`, async (route) => {
        if (route.request().method() === 'PUT') appWrites++;
        if (route.request().method() === 'GET' && ++legacyReads === 6) {
          // Download and migration-check discovery/reads plus upload discovery
          // saw no file. The other device's seed lands before the final upload read.
          const put = await request.put(`${remote}sync-data.json`, {
            headers: { Authorization: authorization },
            data: snapshotOnly,
          });
          expect(put.ok()).toBe(true);
          published = true;
        }
        await route.continue();
      });
      await recordIfEverAppears(joining.page, 'setup-conflict', 'dialog-sync-conflict');
      await sync.setupWebdavSync(
        { ...WEBDAV_CONFIG_TEMPLATE, syncFolderPath: `/${folder}` },
        { useProductFormatDefault: true },
      );
      await expect.poll(() => published).toBe(true);
      await expect(sync.syncSpinner).toBeHidden();
      // The upload was deferred silently; the question comes on the next sync.
      expect(await hasEverAppeared(joining.page, 'setup-conflict')).toBe(false);
      // Read counts pinned (measured 2026-11) to catch unexpected extra
      // round-trips; the real guards are the zero writes and the seed file.
      expect(legacyReads).toBe(6);

      // The seed's state is still the folder's state, and the app never wrote
      // the file (a write before the seed landed would be hidden by it).
      expect(appWrites).toBe(0);
      expect(await remoteText(request, `${remote}sync-data.json`)).toBe(snapshotOnly);
      await expect(
        joining.page.locator('task').filter({ hasText: localTitle }),
      ).toBeVisible();

      // A restart drops the staged download and the cycle cache. The startup
      // sync must still load the seed and ask before anything is uploaded,
      // because this client never applied the seed's revision.
      await joining.page.reload();
      await work.waitForTaskList();
      await cancelSyncConflict(joining.page, sync);
      await expect(
        joining.page.locator('task').filter({ hasText: localTitle }),
      ).toBeVisible();
      expect(appWrites).toBe(0);
      expect(await remoteText(request, `${remote}sync-data.json`)).toBe(snapshotOnly);

      await expectNextSyncToAskFirst(joining.page, sync);
      expect(appWrites).toBe(0);
      expect(syncFilePuts()).toBe(0);
      expect(await remoteText(request, `${remote}sync-data.json`)).toBe(snapshotOnly);
      expect(legacyReads).toBe(9);
    } finally {
      await closeContextsSafely(joining.context);
    }
  });

  // A synced device moves to an empty folder. Its download finds nothing, so
  // the server-migration check reads the folder again before seeding it. If
  // another device's seed lands in between, that check skips seeding, and the
  // upload's own check asks before replacing the server data; Cancel promises
  // to download the server's data instead. That must hold even when the answer
  // comes after the 30 s cycle cache expired.
  test('does not merge over a seed after a late answer to the server-migration prompt', async ({
    browser,
    baseURL,
    request,
  }) => {
    const seedFolder = generateSyncFolderName('migration-prompt-v2');
    const ownFolder = `${seedFolder}-own`;
    const folder = `${seedFolder}-target`;
    const remote = `${root}${folder}/DEV/`;
    const movedRemote = await seedSnapshotOnlyFolder(
      browser,
      baseURL,
      request,
      seedFolder,
      `Seeded prompt task ${folder}`,
    );
    const seededFile = await remoteText(request, `${movedRemote}sync-data.json`);

    await createSyncFolder(request, ownFolder);
    await createSyncFolder(request, folder);
    await createSyncFolder(request, `${folder}/DEV`);
    const mover = await setupSyncClient(browser, baseURL);
    try {
      const sync = new SyncPage(mover.page);
      const work = new WorkViewPage(mover.page);
      await work.waitForTaskList();
      await keepSyncManual(mover.page);
      await work.addTask(`Mover synced task ${folder}`);
      await waitForStatePersistence(mover.page);
      await sync.setupWebdavSync({
        ...V2_CONFIG,
        syncFolderPath: `/${ownFolder}`,
      });
      expect(await waitForSyncComplete(mover.page, sync)).toBe('success');
      const localTitle = `Mover pending task ${folder}`;
      await work.addTask(localTitle);
      await waitForStatePersistence(mover.page);

      let primaryReads = 0;
      let published = false;
      const syncFilePuts = countWebdavWrites(mover.page, `${folder}/DEV`);
      await mover.page.route(`**/${folder}/DEV/sync-data.json`, async (route) => {
        if (route.request().method() === 'GET' && ++primaryReads === 2) {
          // The download found no data; the seed lands before the
          // server-migration check reads the folder.
          const put = await request.put(`${remote}sync-data.json`, {
            headers: { Authorization: authorization },
            data: seededFile,
          });
          expect(put.ok()).toBe(true);
          published = true;
        }
        await route.continue();
      });
      await sync.setupWebdavSync(
        { ...V2_CONFIG, syncFolderPath: `/${folder}` },
        { isReconfigure: true },
      );
      const prompt = mover.page.locator('dialog-server-migration-confirm');
      await expect(prompt).toBeVisible();
      expect(published).toBe(true);
      // Pinned read counts (measured 2026-11).
      expect(primaryReads).toBe(3);

      // Answer after the cycle cache expired.
      await mover.page.clock.setFixedTime(new Date(Date.now() + 31_000));
      await prompt.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(prompt).toBeHidden();
      await expect(sync.syncSpinner).toBeHidden();

      expect(await remoteText(request, `${remote}sync-data.json`)).toBe(seededFile);
      await expect(
        mover.page.locator('task').filter({ hasText: localTitle }),
      ).toBeVisible();

      await expectNextSyncToAskFirst(mover.page, sync);
      expect(await remoteText(request, `${remote}sync-data.json`)).toBe(seededFile);
      // Cancel promised a download: nothing was ever written to the folder.
      expect(syncFilePuts()).toBe(0);
      expect(primaryReads).toBe(5);
    } finally {
      await closeContextsSafely(mover.context);
    }
  });
});
