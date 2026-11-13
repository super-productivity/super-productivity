import { gunzipSync } from 'zlib';
import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/webdav.fixture';
import { ImportPage } from '../../pages/import.page';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import { waitForAppReady, waitForStatePersistence } from '../../utils/waits';
import {
  WEBDAV_CONFIG_TEMPLATE,
  WEBDAV_SYNC_FILE,
  closeContextsSafely,
  createSyncFolder,
  generateSyncFolderName,
  setupSyncClient,
  waitForSyncComplete,
} from '../../utils/sync-helpers';

/**
 * #11063: a client whose IndexedDB is lost must not overwrite the remote.
 *
 * Chromium's corruption recovery deletes the origin's whole IndexedDB store
 * (op log, state cache, sync config and credentials) but leaves localStorage
 * alone, including the file-based adapter's sync cursor. Onboarding then
 * creates example tasks, the user configures the same sync target again, and
 * the client syncs. Had the stale cursor been reused, the client would skip the
 * remote snapshot and upload its own near-empty state over it; configuring the
 * target resets the cursor (`invalidateAllTargets`, #9063), so the client
 * downloads the snapshot and adopts it instead.
 *
 * #11099: the same loss, but only the op log (`SUP_OPS`) goes while the sync
 * credentials (`sup-sync`) survive. Configuring the target again is then no
 * target change, so the cursor is not reset; the client must still notice that
 * its op log never synced with that cursor and download the snapshot.
 *
 * Data shape: most of the remote data exists only in the snapshot (a backup
 * import, `recentOps: []`), like a long-lived sync file whose history was
 * trimmed. With data still replayable from `recentOps` the overwrite would go
 * unnoticed.
 *
 * Run: npm run quiet -- e2e:webdav:file e2e/tests/sync/webdav-reset-db-overwrite-11063.spec.ts --retries=0
 */
const EXAMPLE_TASK_TITLE = 'Optional: getting started tips';
const SNAPSHOT_ONLY_TASK = 'E2E Import Test - Simple Active Task';
const DB_LOSS_FLAG = 'E2E_SIMULATED_DB_LOSS_11063';
const INBOX_URL = '/#/project/INBOX_PROJECT/tasks';

const AUTHORIZATION =
  'Basic ' +
  Buffer.from(
    `${WEBDAV_CONFIG_TEMPLATE.username}:${WEBDAV_CONFIG_TEMPLATE.password}`,
  ).toString('base64');

/**
 * Deletes the app origin's IndexedDB databases (except `keepDbs`) while the app
 * is not running, keeping localStorage — with no `keepDbs`, what Chromium's
 * "recovering from a corrupted (and deleted) database" does on the next start.
 */
const wipeIndexedDbKeepLocalStorage = async (
  page: Page,
  keepDbs: string[],
): Promise<string[]> => {
  // Leave the app so it releases its DB connections (open ones block deletion).
  await page.goto('/assets/i18n/en.json');
  return page.evaluate(
    async ({ flag, keep }) => {
      // The reported loss hit a client that never stored the example-task flag
      // (set for existing users only since #7976), so onboarding ran again.
      localStorage.removeItem('SUP_EXAMPLE_TASKS_CREATED');
      sessionStorage.setItem(flag, 'true');
      const names = (await indexedDB.databases())
        .map((db) => db.name)
        .filter((name): name is string => !!name && !keep.includes(name));
      for (const name of names) {
        await new Promise<void>((resolve, reject) => {
          const req = indexedDB.deleteDatabase(name);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
          req.onblocked = () => reject(new Error(`deleteDatabase blocked: ${name}`));
        });
      }
      return names;
    },
    { flag: DB_LOSS_FLAG, keep: keepDbs },
  );
};

/** The file-based adapter's per-provider seq cursor, persisted in localStorage. */
const readFileSyncCursor = (page: Page): Promise<Record<string, number>> =>
  page.evaluate(() => {
    const raw = localStorage.getItem('FILE_SYNC_VERSION_state');
    return raw ? (JSON.parse(raw).seqCounters ?? {}) : {};
  });

/** Reads the remote sync file; the imported backup turns compression on. */
const readRemote = async (
  request: APIRequestContext,
  folder: string,
): Promise<{ state: string; recentOps: string }> => {
  const response = await request.get(
    `${WEBDAV_CONFIG_TEMPLATE.baseUrl}${folder}/DEV/${WEBDAV_SYNC_FILE}`,
    { headers: { Authorization: AUTHORIZATION } },
  );
  expect(response.ok()).toBe(true);
  const encoded = await response.text();
  const payload = encoded.slice(encoded.indexOf('__') + 2);
  const json = payload.startsWith('{')
    ? payload
    : gunzipSync(Buffer.from(payload, 'base64')).toString('utf-8');
  const data = JSON.parse(json) as { state?: unknown; recentOps?: unknown };
  return {
    state: JSON.stringify(data.state ?? null),
    recentOps: JSON.stringify(data.recentOps ?? []),
  };
};

const LOSS_VARIANTS = [
  { name: 'whole IndexedDB lost (#11063)', keepDbs: [] as string[] },
  { name: 'op log lost, sync credentials kept (#11099)', keepDbs: ['sup-sync'] },
];

test.describe('@webdav Reset local DB with sync re-configured (#11063)', () => {
  for (const { name, keepDbs } of LOSS_VARIANTS) {
    test(`reset client adopts the remote instead of overwriting it: ${name}`, async ({
      browser,
      baseURL,
      request,
    }) => {
      test.skip(WEBDAV_SYNC_FILE !== 'sync-data.json', 'single-file format only');
      test.slow();
      const folder = generateSyncFolderName('e2e-reset-db-11063');
      await createSyncFolder(request, folder);
      const config = { ...WEBDAV_CONFIG_TEMPLATE, syncFolderPath: `/${folder}` };
      const url = baseURL || 'http://localhost:4242';
      const recentTask = `Recent-task-${Date.now()}`;

      const { context: contextA, page: pageA } = await setupSyncClient(browser, url);
      // Runs after setupSyncClient's init script: once the DB is "lost", let
      // onboarding create example tasks like it did for the reporter.
      await pageA.addInitScript((flag) => {
        if (sessionStorage.getItem(flag)) {
          localStorage.removeItem('SUP_EXAMPLE_TASKS_CREATED');
        }
      }, DB_LOSS_FLAG);
      let contextB: Awaited<ReturnType<typeof setupSyncClient>>['context'] | undefined;

      try {
        const syncA = new SyncPage(pageA);
        const workA = new WorkViewPage(pageA);
        await workA.waitForTaskList();

        // --- Client A: real data, mostly snapshot-only on the remote ---
        const importA = new ImportPage(pageA);
        await importA.navigateToImportPage();
        await importA.importBackupFile(ImportPage.getFixturePath('test-backup.json'));
        await pageA.goto(INBOX_URL);
        await expect(
          pageA.locator('task', { hasText: SNAPSHOT_ONLY_TASK }).first(),
        ).toBeVisible();
        await syncA.setupWebdavSync(config);
        await waitForSyncComplete(pageA, syncA);
        await workA.addTask(recentTask);
        await waitForStatePersistence(pageA);
        await syncA.triggerSync();
        await waitForSyncComplete(pageA, syncA);

        const remoteBefore = await readRemote(request, folder);
        expect(remoteBefore.state).toContain(SNAPSHOT_ONLY_TASK);
        expect(remoteBefore.state).toContain(recentTask);
        // The shape that makes an overwrite lose data: no op can rebuild it.
        expect(remoteBefore.recentOps).not.toContain(SNAPSHOT_ONLY_TASK);
        const cursorBefore = await readFileSyncCursor(pageA);
        console.log('[11063] file-sync cursor before reset:', cursorBefore);

        // --- Client A loses its IndexedDB, keeps localStorage, restarts ---
        const deleted = await wipeIndexedDbKeepLocalStorage(pageA, keepDbs);
        console.log('[11063] deleted IndexedDB databases:', deleted);
        expect(deleted).toContain('SUP_OPS');
        expect(deleted.includes('sup-sync')).toBe(!keepDbs.includes('sup-sync'));
        await pageA.goto('/');
        await waitForAppReady(pageA);
        await workA.waitForTaskList();

        // Onboarding recreated the example tasks; the real tasks are gone locally.
        await pageA.goto(INBOX_URL);
        await expect(
          pageA.locator('task', { hasText: EXAMPLE_TASK_TITLE }).first(),
        ).toBeVisible({
          timeout: 20000,
        });
        await expect(pageA.locator('task', { hasText: SNAPSHOT_ONLY_TASK })).toHaveCount(
          0,
        );

        // The stale cursor outlived the database.
        const cursorAfterReset = await readFileSyncCursor(pageA);
        console.log('[11063] file-sync cursor after reset:', cursorAfterReset);
        expect(cursorAfterReset).toEqual(cursorBefore);
        expect(Math.max(...Object.values(cursorAfterReset))).toBeGreaterThan(0);
        pageA.on('console', (msg) => {
          if (/OperationLogSyncService|FileBasedSyncAdapter/.test(msg.text())) {
            console.log(`[11063][A] ${msg.text().slice(0, 300)}`);
          }
        });

        // --- The same sync target is configured again, then syncs twice ---
        await syncA.setupWebdavSync(config);
        expect(await waitForSyncComplete(pageA, syncA)).toBe('success');
        await syncA.triggerSync();
        expect(await waitForSyncComplete(pageA, syncA)).toBe('success');

        // CORE: the remote snapshot still holds the original data.
        const remoteAfter = await readRemote(request, folder);
        console.log(
          `[11063] remote state size before/after: ` +
            `${remoteBefore.state.length}/${remoteAfter.state.length}`,
        );
        expect(remoteAfter.state).toContain(SNAPSHOT_ONLY_TASK);
        expect(remoteAfter.state).toContain(recentTask);
        // The reset client adopted the remote data.
        await pageA.goto(INBOX_URL);
        await expect(
          pageA.locator('task', { hasText: SNAPSHOT_ONLY_TASK }).first(),
        ).toBeVisible();

        // --- A second client still receives the original data ---
        const clientB = await setupSyncClient(browser, url);
        contextB = clientB.context;
        const syncB = new SyncPage(clientB.page);
        await new WorkViewPage(clientB.page).waitForTaskList();
        await syncB.setupWebdavSync(config);
        await waitForSyncComplete(clientB.page, syncB);
        await clientB.page.goto(INBOX_URL);
        await expect(
          clientB.page.locator('task', { hasText: SNAPSHOT_ONLY_TASK }).first(),
        ).toBeVisible();
        await expect(
          clientB.page.locator('task', { hasText: recentTask }).first(),
        ).toBeVisible();
      } finally {
        await closeContextsSafely(contextA, contextB);
      }
    });
  }
});
