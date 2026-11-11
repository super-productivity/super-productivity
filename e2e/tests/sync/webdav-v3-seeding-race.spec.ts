import type { APIRequestContext, Page } from '@playwright/test';
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

/**
 * v3 counterpart of #10459 (webdav-late-snapshot.spec.ts pins the v2 guard).
 * Two live devices seed one empty v3 folder: the fresh device's first write is
 * held until the other device has seeded, through a first upload or a folder
 * move (the server-migration path). The fresh device's create-only tombstone
 * claim of sync-data.json then loses to the seeder's, so it asks instead of
 * overwriting (measured 2026-11, runs 43010702326 and 43014736805).
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

test.describe('@webdav two devices seeding one empty v3 folder', () => {
  test.beforeEach(async ({ webdavServerUp }) => {
    void webdavServerUp;
  });

  // Device S (one task) seeds an empty v3 folder while the first write of a
  // fresh device J (one pending task) is held. Both then sync again and a
  // third, empty device C joins. A conflict dialog is the app asking, not a
  // silent loss: no device may drop its own task without being asked, and a
  // new device must still get S's data.
  for (const seedBy of ['first upload', 'folder move'] as const) {
    test(`a seed by ${seedBy} racing a fresh device loses no task silently`, async ({
      browser,
      baseURL,
      request,
    }) => {
      const folder = generateSyncFolderName('v3-race');
      const sOwnFolder = `${folder}-own`;
      const remote = `${root}${folder}/DEV/`;
      const sTitle = `Seeder task ${folder}`;
      const jTitle = `Joiner task ${folder}`;
      await createSyncFolder(request, folder);
      await createSyncFolder(request, `${folder}/DEV`);
      if (seedBy === 'folder move') await createSyncFolder(request, sOwnFolder);

      const s = await setupSyncClient(browser, baseURL);
      const j = await setupSyncClient(browser, baseURL);
      let c: Awaited<ReturnType<typeof setupSyncClient>> | undefined;
      let jSetupError: string | undefined;
      const syncErrors: string[] = [];
      const asked = { s: 0, j: 0, c: 0 };
      const settle = async (
        key: keyof typeof asked,
        page: Page,
        sync: SyncPage,
      ): Promise<void> => {
        const dialog = page.locator('dialog-sync-conflict');
        if (await dialog.isVisible().catch(() => false)) asked[key]++;
        await cancelConflictIfAsked(page, sync);
      };
      const syncOnce = async (
        key: keyof typeof asked,
        page: Page,
        sync: SyncPage,
      ): Promise<void> => {
        await sync.triggerSync();
        // Recorded, not thrown: the summary below must still be printed.
        await waitForSyncComplete(page, sync, 30000, { expectConflict: true }).catch(
          (e: unknown) => {
            syncErrors.push(`${key}: ${String(e).slice(0, 300)}`);
          },
        );
        await settle(key, page, sync);
      };
      const holds = async (page: Page): Promise<{ s: boolean; j: boolean }> => {
        const titles = await page.locator('task').allTextContents();
        return {
          s: titles.some((t) => t.includes(sTitle)),
          j: titles.some((t) => t.includes(jTitle)),
        };
      };

      try {
        const sSync = new SyncPage(s.page);
        const jSync = new SyncPage(j.page);
        for (const [client, title] of [
          [s, sTitle],
          [j, jTitle],
        ] as const) {
          const work = new WorkViewPage(client.page);
          await work.waitForTaskList();
          await work.addTask(title);
          await waitForStatePersistence(client.page);
          await keepSyncManual(client.page);
        }
        if (seedBy === 'folder move') {
          await sSync.setupWebdavSync({ ...V3_CONFIG, syncFolderPath: `/${sOwnFolder}` });
          expect(await waitForSyncComplete(s.page, sSync)).toBe('success');
        }

        // Hold J's first write until S has seeded the folder.
        let release!: () => void;
        const released = new Promise<void>((resolve) => (release = resolve));
        let markHeld!: () => void;
        const held = new Promise<void>((resolve) => (markHeld = resolve));
        let isHeld = false;
        await j.page.route(`**/${folder}/DEV/**`, async (route) => {
          if (!isHeld && WRITE_METHODS.has(route.request().method())) {
            isHeld = true;
            markHeld();
            await released;
          }
          await route.continue();
        });
        const jSetup = jSync
          .setupWebdavSync({ ...V3_CONFIG, syncFolderPath: `/${folder}` })
          .catch((e: unknown) => {
            // A helper that rejects an unexpected dialog must not hide the outcome.
            jSetupError = String(e).slice(0, 300);
          });
        await held;

        // A folder move seeds through the server-migration path.
        await sSync.setupWebdavSync(
          { ...V3_CONFIG, syncFolderPath: `/${folder}` },
          { isReconfigure: seedBy === 'folder move' },
        );
        await expect(sSync.syncSpinner).toBeHidden({ timeout: 30000 });
        await settle('s', s.page, sSync);
        expect(await remoteState(request, remote), 'S seeded the folder').toContain(
          sTitle,
        );

        release();
        await jSetup;
        await expect(jSync.syncSpinner).toBeHidden({ timeout: 30000 });
        await settle('j', j.page, jSync);
        const afterJoin = await remoteState(request, remote).catch((e) => String(e));

        await syncOnce('s', s.page, sSync);
        await syncOnce('j', j.page, jSync);
        await syncOnce('s', s.page, sSync);

        c = await setupSyncClient(browser, baseURL);
        const cSync = new SyncPage(c.page);
        await new WorkViewPage(c.page).waitForTaskList();
        await keepSyncManual(c.page);
        await cSync.setupWebdavSync({ ...V3_CONFIG, syncFolderPath: `/${folder}` });
        await expect(cSync.syncSpinner).toBeHidden({ timeout: 30000 });
        await settle('c', c.page, cSync);
        const final = await remoteState(request, remote).catch((e) => String(e));

        const summary = {
          seedBy,
          asked,
          jSetupError,
          syncErrors,
          serverAfterJoin: {
            s: afterJoin.includes(sTitle),
            j: afterJoin.includes(jTitle),
          },
          serverFinal: { s: final.includes(sTitle), j: final.includes(jTitle) },
          s: await holds(s.page),
          j: await holds(j.page),
          c: await holds(c.page),
        };
        console.log(`V3_RACE_SUMMARY ${JSON.stringify(summary)}`);

        // Every dialog is answered with Cancel, which keeps both sides, so a
        // device holds its own task whether or not it was asked.
        expect.soft(summary.s.s, 'S kept its task').toBe(true);
        expect.soft(summary.j.j, 'J kept its task').toBe(true);
        expect.soft(syncErrors, 'no later sync ended in an error').toEqual([]);
        expect.soft(summary.serverFinal.s, "the server keeps S's task").toBe(true);
        expect.soft(summary.c.s, "a new device gets S's task").toBe(true);
      } finally {
        await closeContextsSafely(s.context, j.context, c?.context);
      }
    });
  }
});
