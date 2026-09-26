import { expect, test } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import {
  closeContextsSafely,
  createSyncFolder,
  generateSyncFolderName,
  readPrefixedFile,
  setupSyncClient,
  waitForSyncComplete,
  WEBDAV_CONFIG_TEMPLATE,
} from '../../utils/sync-helpers';
import { waitForAppReady, waitForStatePersistence } from '../../utils/waits';

const authorization = `Basic ${Buffer.from('admin:admin').toString('base64')}`;

test.describe('@webdav automatic file format rollout', () => {
  test.beforeEach(async ({ webdavServerUp }) => {
    void webdavServerUp;
  });

  test('defaults an empty folder to v3 and hydrates a second default client', async ({
    browser,
    baseURL,
    request,
  }) => {
    const folder = generateSyncFolderName('rollout-empty');
    const remote = `${WEBDAV_CONFIG_TEMPLATE.baseUrl}${folder}/DEV/`;
    const config = { ...WEBDAV_CONFIG_TEMPLATE, syncFolderPath: `/${folder}` };
    await createSyncFolder(request, folder);
    const a = await setupSyncClient(browser, baseURL);
    let b: Awaited<ReturnType<typeof setupSyncClient>> | undefined;
    try {
      const work = new WorkViewPage(a.page);
      const sync = new SyncPage(a.page);
      await work.waitForTaskList();
      const title = `Default v3 task ${folder}`;
      await work.addTask(title);
      await waitForStatePersistence(a.page);
      await sync.setupWebdavSync(config, { useProductFormatDefault: true });
      await waitForSyncComplete(a.page, sync);

      // Assert the real commit point before checking reload or another client.
      // On S6A, the untouched product setting writes only sync-data.json (v2).
      const ops = await readPrefixedFile<{
        version: number;
        snapshotRef: { file: string };
      }>(request, `${remote}sync-ops.json`, authorization);
      expect(ops.version).toBe(3);
      const marker = await readPrefixedFile<{ version: number; format: string }>(
        request,
        `${remote}sync-data.json`,
        authorization,
      );
      expect(marker).toMatchObject({ version: 3, format: 'split' });
      expect(ops.snapshotRef.file).toMatch(/^sync-state__/);
      const snapshot = await readPrefixedFile<{ version: number; state: unknown }>(
        request,
        `${remote}${ops.snapshotRef.file}`,
        authorization,
      );
      expect(snapshot.version).toBe(3);
      expect(JSON.stringify(snapshot.state)).toContain(title);

      await a.page.reload();
      await waitForAppReady(a.page);
      await expect(a.page.locator('task').filter({ hasText: title })).toBeVisible();
      await sync.triggerSync();
      await waitForSyncComplete(a.page, sync);
      b = await setupSyncClient(browser, baseURL);
      const syncB = new SyncPage(b.page);
      await new WorkViewPage(b.page).waitForTaskList();
      await syncB.setupWebdavSync(config, { useProductFormatDefault: true });
      await waitForSyncComplete(b.page, syncB);
      await expect(b.page.locator('task').filter({ hasText: title })).toBeVisible();
    } finally {
      await closeContextsSafely(a.context, b?.context);
    }
  });

  for (const choice of ['default', 'v2', 'migrate'] as const) {
    test(`joins existing v2 with ${choice} settings`, async ({
      browser,
      baseURL,
      request,
    }) => {
      const folder = generateSyncFolderName(`rollout-${choice}`);
      const remote = `${WEBDAV_CONFIG_TEMPLATE.baseUrl}${folder}/DEV/`;
      const config = { ...WEBDAV_CONFIG_TEMPLATE, syncFolderPath: `/${folder}` };
      await createSyncFolder(request, folder);
      const a = await setupSyncClient(browser, baseURL);
      let b: Awaited<ReturnType<typeof setupSyncClient>> | undefined;
      try {
        const syncA = new SyncPage(a.page);
        const workA = new WorkViewPage(a.page);
        await workA.waitForTaskList();
        const original = `Existing v2 ${folder}`;
        await workA.addTask(original);
        await waitForStatePersistence(a.page);
        await syncA.setupWebdavSync({ ...config, isUseSplitSyncFiles: false });
        await waitForSyncComplete(a.page, syncA);
        const legacy = await readPrefixedFile<{
          version: number;
          state: { globalConfig: { sync: { isUseSplitSyncFiles?: boolean } } };
        }>(request, `${remote}sync-data.json`, authorization);
        expect(legacy.version).toBe(2);
        // An older persisted config can lack the optional format field entirely.
        if (choice === 'default') {
          delete legacy.state.globalConfig.sync.isUseSplitSyncFiles;
          const response = await request.put(`${remote}sync-data.json`, {
            headers: { Authorization: authorization },
            data: `pf_2__${JSON.stringify(legacy)}`,
          });
          expect(response.ok()).toBe(true);
        }
        b = await setupSyncClient(browser, baseURL);
        const syncB = new SyncPage(b.page);
        const workB = new WorkViewPage(b.page);
        await workB.waitForTaskList();
        await syncB.setupWebdavSync(
          { ...config, isUseSplitSyncFiles: false },
          { useProductFormatDefault: choice === 'default' },
        );
        await waitForSyncComplete(b.page, syncB);
        await expect(b.page.locator('task').filter({ hasText: original })).toBeVisible();
        if (choice === 'migrate') {
          // First hydrate the existing config, then explicitly opt into migration.
          // The format option is synced, so joining may restore the remote false.
          await syncB.setupWebdavSync(
            { ...config, isUseSplitSyncFiles: true },
            { isReconfigure: true },
          );
          await waitForSyncComplete(b.page, syncB);
        }
        const added = `Joined writer ${folder}`;
        await workB.addTask(added);
        await waitForStatePersistence(b.page);
        await syncB.triggerSync();
        await waitForSyncComplete(b.page, syncB);
        if (choice === 'migrate') {
          const ops = await readPrefixedFile<{ version: number }>(
            request,
            `${remote}sync-ops.json`,
            authorization,
          );
          expect(ops.version).toBe(3);
          const tombstone = await readPrefixedFile<{ format: string }>(
            request,
            `${remote}sync-data.json`,
            authorization,
          );
          expect(tombstone.format).toBe('split');
        } else {
          const monolith = await readPrefixedFile<{ version: number; state: unknown }>(
            request,
            `${remote}sync-data.json`,
            authorization,
          );
          expect(monolith.version).toBe(2);
          expect(JSON.stringify(monolith.state)).toContain(original);
          expect(JSON.stringify(monolith.state)).toContain(added);
          for (const file of ['sync-ops.json', 'sync-state.json']) {
            expect(
              (
                await request.get(`${remote}${file}`, {
                  headers: { Authorization: authorization },
                })
              ).status(),
            ).toBe(404);
          }
          await syncA.triggerSync();
          await waitForSyncComplete(a.page, syncA);
          await expect(a.page.locator('task').filter({ hasText: added })).toBeVisible();
        }
        await b.page.reload();
        await waitForAppReady(b.page);
        await expect(b.page.locator('task').filter({ hasText: original })).toBeVisible();
        await expect(b.page.locator('task').filter({ hasText: added })).toBeVisible();
      } finally {
        await closeContextsSafely(a.context, b?.context);
      }
    });
  }

  for (const switchTarget of [false, true]) {
    test(
      switchTarget
        ? 'rediscovers an empty folder after switching during a late legacy read'
        : 'does not migrate v2 appearing after empty-folder discovery',
      async ({ browser, baseURL, request }) => {
        const seedFolder = generateSyncFolderName('rollout-race-seed');
        const folder = `${seedFolder}-target`;
        const nextFolder = `${folder}-next`;
        const root = WEBDAV_CONFIG_TEMPLATE.baseUrl;
        const remote = `${root}${folder}/DEV/`;
        await createSyncFolder(request, seedFolder);
        await createSyncFolder(request, folder);
        await createSyncFolder(request, `${folder}/DEV`);
        if (switchTarget) await createSyncFolder(request, nextFolder);
        const seed = await setupSyncClient(browser, baseURL);
        let joining: Awaited<ReturnType<typeof setupSyncClient>> | undefined;
        try {
          const seedSync = new SyncPage(seed.page);
          const seedWork = new WorkViewPage(seed.page);
          await seedWork.waitForTaskList();
          await seedWork.addTask(`Concurrent legacy task ${folder}`);
          await waitForStatePersistence(seed.page);
          await seedSync.setupWebdavSync({
            ...WEBDAV_CONFIG_TEMPLATE,
            syncFolderPath: `/${seedFolder}`,
            isUseSplitSyncFiles: false,
          });
          await waitForSyncComplete(seed.page, seedSync);
          const legacyResponse = await request.get(
            `${root}${seedFolder}/DEV/sync-data.json`,
            {
              headers: { Authorization: authorization },
            },
          );
          expect(legacyResponse.ok()).toBe(true);
          const legacy = await legacyResponse.text();
          joining = await setupSyncClient(browser, baseURL);
          const sync = new SyncPage(joining.page);
          const work = new WorkViewPage(joining.page);
          await work.waitForTaskList();
          const localTitle = `Preserved pending task ${folder}`;
          await work.addTask(localTitle);
          await waitForStatePersistence(joining.page);
          let legacyReads = 0;
          let concurrentV2Created = false;
          let releaseLegacyRead: (() => void) | undefined;
          await joining.page.route(`**/${folder}/DEV/sync-data.json`, async (route) => {
            if (route.request().method() === 'GET' && ++legacyReads === 6) {
              // Download and migration-check discovery/bootstrap plus upload
              // discovery saw no v2. Publish before the final upload read.
              const seeded = await request.put(`${remote}sync-data.json`, {
                headers: { Authorization: authorization },
                data: legacy,
              });
              expect(seeded.ok()).toBe(true);
              if (switchTarget) {
                const response = await route.fetch();
                const released = new Promise<void>((resolve) => {
                  releaseLegacyRead = resolve;
                });
                concurrentV2Created = true;
                await released;
                await route.fulfill({ response });
                return;
              }
              concurrentV2Created = true;
            }
            await route.continue();
          });
          await sync.setupWebdavSync(
            { ...WEBDAV_CONFIG_TEMPLATE, syncFolderPath: `/${folder}` },
            { useProductFormatDefault: true },
          );
          await expect.poll(() => concurrentV2Created).toBe(true);
          if (switchTarget) {
            // Use the real settings UI while the old GET is deliberately in flight.
            // The full setup helper waits for networkidle, which this test prevents.
            await sync.syncBtn.click({ button: 'right' });
            await sync.syncFolderInput.fill(`/${nextFolder}`);
            await sync.saveBtn.click();
            await expect(joining.page.locator('mat-dialog-container')).toBeHidden();
            releaseLegacyRead!();
          }
          await expect(sync.syncSpinner).toBeHidden();
          const preserved = await request.get(`${remote}sync-data.json`, {
            headers: { Authorization: authorization },
          });
          expect(await preserved.text()).toBe(legacy);
          expect(
            (
              await request.get(`${remote}sync-ops.json`, {
                headers: { Authorization: authorization },
              })
            ).status(),
          ).toBe(404);
          if (switchTarget) {
            await sync.triggerSync();
            await waitForSyncComplete(joining.page, sync);
            const nextRemote = `${root}${nextFolder}/DEV/`;
            const ops = await readPrefixedFile<{
              version: number;
              snapshotRef: { file: string };
            }>(request, `${nextRemote}sync-ops.json`, authorization);
            expect(ops.version).toBe(3);
            const snapshot = await readPrefixedFile<{ state: unknown }>(
              request,
              `${nextRemote}${ops.snapshotRef.file}`,
              authorization,
            );
            expect(JSON.stringify(snapshot.state)).toContain(localTitle);
          }
          await expect(
            joining.page.locator('task').filter({ hasText: localTitle }),
          ).toBeVisible();
        } finally {
          await closeContextsSafely(seed.context, joining?.context);
        }
      },
    );
  }

  test('does not write when format discovery fails, then retries the same folder', async ({
    browser,
    baseURL,
    request,
  }) => {
    const folder = generateSyncFolderName('rollout-discovery-error');
    const remote = `${WEBDAV_CONFIG_TEMPLATE.baseUrl}${folder}/DEV/`;
    await createSyncFolder(request, folder);
    const a = await setupSyncClient(browser, baseURL);
    try {
      const work = new WorkViewPage(a.page);
      const sync = new SyncPage(a.page);
      await work.waitForTaskList();
      const title = `Preserved after discovery error ${folder}`;
      await work.addTask(title);
      await waitForStatePersistence(a.page);
      let failedProbe = false;
      const writes: string[] = [];
      a.page.on('request', (req) => {
        if (req.url().includes(folder) && req.method() === 'PUT') writes.push(req.url());
      });
      const routePattern = `**/${folder}/DEV/sync-ops.json`;
      await a.page.route(routePattern, async (route) => {
        if (route.request().method() === 'GET') {
          failedProbe = true;
          // A real WebDAV HTTP failure maps to HttpNotOkAPIError, not not-found.
          await route.fulfill({
            status: 503,
            headers: { ['Access-Control-Allow-Origin']: '*' },
            body: 'Service Unavailable',
          });
        } else {
          await route.continue();
        }
      });
      await sync.setupWebdavSync(
        { ...WEBDAV_CONFIG_TEMPLATE, syncFolderPath: `/${folder}` },
        { useProductFormatDefault: true },
      );
      await expect.poll(() => failedProbe).toBe(true);
      await expect(sync.syncBtn.locator('mat-icon')).toHaveText('sync_problem');
      expect(writes).toEqual([]);
      await expect(a.page.locator('task').filter({ hasText: title })).toBeVisible();
      for (const file of ['sync-data.json', 'sync-ops.json', 'sync-state.json']) {
        expect(
          (
            await request.get(`${remote}${file}`, {
              headers: { Authorization: authorization },
            })
          ).status(),
        ).toBe(404);
      }
      await a.page.unroute(routePattern);
      await sync.triggerSync();
      await waitForSyncComplete(a.page, sync);
      const ops = await readPrefixedFile<{ version: number }>(
        request,
        `${remote}sync-ops.json`,
        authorization,
      );
      expect(ops.version).toBe(3);
      await expect(a.page.locator('task').filter({ hasText: title })).toBeVisible();
    } finally {
      await closeContextsSafely(a.context);
    }
  });
});
