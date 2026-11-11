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
import { recordIfEverAppears } from '../../utils/audit-webdav-helpers';

/**
 * v3 counterpart of #10459 (webdav-late-snapshot.spec.ts pins the v2 guard).
 * A fresh v3 client finds an empty folder; another device seeds the folder
 * just before the fresh client's first write. Whatever the client then does
 * (defer, ask, or merge after loading the seed), the seed's data must survive
 * on the server and the client must keep its own pending task.
 *
 * Known gap, tracked in #10395 (v3 readiness; #10370 targets this race): the
 * fresh client's unconditional sync-state.json PUT replaces the seed's
 * snapshot, leaving sync-ops.json pointing at a snapshot whose clock no longer
 * matches (run 42976947219). Readers detect the mismatch and signal a gap.
 * Un-fixme when the v3 readiness batch lands.
 */

const authorization = `Basic ${Buffer.from('admin:admin').toString('base64')}`;
const root = WEBDAV_CONFIG_TEMPLATE.baseUrl;
const V3_CONFIG = { ...WEBDAV_CONFIG_TEMPLATE, isUseSplitSyncFiles: true };
const MAIN_FILE = 'sync-ops.json';
const WRITE_METHODS = new Set(['PUT', 'MOVE', 'COPY', 'DELETE']);

const remoteText = async (request: APIRequestContext, url: string): Promise<string> => {
  const response = await request.get(url, { headers: { Authorization: authorization } });
  expect(response.ok(), `Expected remote file: ${url}`).toBe(true);
  return response.text();
};

const parsePrefixed = <T>(encoded: string): T =>
  JSON.parse(encoded.slice(encoded.indexOf('__') + 2)) as T;

const snapshotFileOf = (mainText: string): string =>
  parsePrefixed<{ snapshotRef?: { file?: string } }>(mainText).snapshotRef?.file ??
  'sync-state.json';

/** The remote as a fresh client reads it: main file plus referenced snapshot. */
const remoteState = async (
  request: APIRequestContext,
  remote: string,
): Promise<string> => {
  const main = await remoteText(request, `${remote}${MAIN_FILE}`);
  const snapshot = await remoteText(request, `${remote}${snapshotFileOf(main)}`);
  return `${main}\n${snapshot}`;
};

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

/** Cancel keeps both sides when the client asks before replacing anything. */
const cancelConflictIfAsked = async (page: Page, sync: SyncPage): Promise<void> => {
  const dialog = page.locator('dialog-sync-conflict');
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
  }
  await expect(sync.syncSpinner).toBeHidden();
};

/**
 * A synced v3 device that moves to an empty folder seeds it with a
 * SERVER_MIGRATION import. Returns the seeded main file and its snapshot.
 */
const seedV3Folder = async (
  browser: Browser,
  baseURL: string | undefined,
  request: APIRequestContext,
  seedFolder: string,
  seedTitle: string,
): Promise<{ main: string; snapshotFile: string; snapshot: string }> => {
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
    await sync.setupWebdavSync({ ...V3_CONFIG, syncFolderPath: `/${seedFolder}` });
    expect(await waitForSyncComplete(seed.page, sync)).toBe('success');
    await sync.setupWebdavSync(
      { ...V3_CONFIG, syncFolderPath: `/${movedFolder}` },
      { isReconfigure: true },
    );
    expect(await waitForSyncComplete(seed.page, sync)).toBe('success');
  } finally {
    await closeContextsSafely(seed.context);
  }
  const movedRemote = `${root}${movedFolder}/DEV/`;
  const main = await remoteText(request, `${movedRemote}${MAIN_FILE}`);
  const snapshotFile = snapshotFileOf(main);
  const snapshot = await remoteText(request, `${movedRemote}${snapshotFile}`);
  expect(`${main}${snapshot}`).toContain(seedTitle);
  return { main, snapshotFile, snapshot };
};

test.describe('@webdav a late v3 seed survives a fresh client first write', () => {
  test.beforeEach(async ({ webdavServerUp }) => {
    void webdavServerUp;
  });

  test.fixme('keeps the seed when it lands just before the fresh client writes', async ({
    browser,
    baseURL,
    request,
  }) => {
    const seedFolder = generateSyncFolderName('late-seed-v3');
    const folder = `${seedFolder}-target`;
    const remote = `${root}${folder}/DEV/`;
    const seedTitle = `Seeded v3 task ${folder}`;
    const seeded = await seedV3Folder(browser, baseURL, request, seedFolder, seedTitle);

    await createSyncFolder(request, folder);
    await createSyncFolder(request, `${folder}/DEV`);
    const joining = await setupSyncClient(browser, baseURL);
    try {
      const sync = new SyncPage(joining.page);
      const work = new WorkViewPage(joining.page);
      await work.waitForTaskList();
      const localTitle = `Pending v3 joiner task ${folder}`;
      await work.addTask(localTitle);
      await waitForStatePersistence(joining.page);
      await keepSyncManual(joining.page);

      let published = false;
      await joining.page.route(`**/${folder}/DEV/**`, async (route) => {
        if (!published && WRITE_METHODS.has(route.request().method())) {
          // The client found the folder empty and is about to write. The other
          // device's seed lands first: snapshot, then the main file naming it.
          published = true;
          for (const [file, data] of [
            [seeded.snapshotFile, seeded.snapshot],
            [MAIN_FILE, seeded.main],
          ]) {
            const put = await request.put(`${remote}${file}`, {
              headers: { Authorization: authorization },
              data,
            });
            expect(put.ok(), `seed ${file}`).toBe(true);
          }
        }
        await route.continue();
      });
      await recordIfEverAppears(joining.page, 'setup-conflict', 'dialog-sync-conflict');
      await sync.setupWebdavSync({ ...V3_CONFIG, syncFolderPath: `/${folder}` });
      await expect.poll(() => published).toBe(true);
      await cancelConflictIfAsked(joining.page, sync);

      // No loss: the seed's task is still in the state a fresh client reads,
      // and the joiner kept its own task.
      expect(await remoteState(request, remote)).toContain(seedTitle);
      await expect(
        joining.page.locator('task').filter({ hasText: localTitle }),
      ).toBeVisible();

      // The next sync must not lose it either.
      await sync.triggerSync();
      await waitForSyncComplete(joining.page, sync, 30000, {
        expectConflict: true,
      }).catch(() => undefined);
      await cancelConflictIfAsked(joining.page, sync);
      expect(await remoteState(request, remote)).toContain(seedTitle);
      await expect(
        joining.page.locator('task').filter({ hasText: localTitle }),
      ).toBeVisible();
    } finally {
      await closeContextsSafely(joining.context);
    }
  });
});
