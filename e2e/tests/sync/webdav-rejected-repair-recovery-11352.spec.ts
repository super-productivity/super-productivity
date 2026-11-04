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
import { waitForAppReady, waitForStatePersistence } from '../../utils/waits';

const task = (page: Page, title: string): ReturnType<Page['locator']> =>
  page.locator('task').filter({ hasText: title });

/**
 * Adds a tag id that exists nowhere to a task, as a real persistent update.
 * A client that applies this op repairs its state (invalid reference removed)
 * and so appends a local REPAIR full-state op.
 */
const addGhostTagReference = async (page: Page, title: string): Promise<void> => {
  const taskId = await task(page, title).first().getAttribute('data-task-id');
  expect(taskId).toBeTruthy();
  await page.evaluate((id) => {
    const helpers = (
      window as unknown as {
        __e2eTestHelpers: {
          store: { dispatch: (action: unknown) => void };
          flushPendingWrites: () => Promise<void>;
        };
      }
    ).__e2eTestHelpers;
    helpers.store.dispatch({
      type: '[Task Shared] updateTask',
      task: { id, changes: { tagIds: ['ghost-tag-11352'] } },
      isIgnoreShortSyntax: true,
      meta: { isPersistent: true, entityType: 'TASK', entityId: id, opType: 'UPD' },
    });
    return helpers.flushPendingWrites();
  }, taskId!);
};

/**
 * Persists the state older versions left behind after classifying a failed
 * REPAIR snapshot upload as a rejection: the never-synced local REPAIR carries
 * `rejectedAt`. Returns how many entries were marked.
 */
const markPendingRepairRejected = (page: Page): Promise<number> =>
  page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('SUP_OPS');
      open.onsuccess = (): void => resolve(open.result);
      open.onerror = (): void => reject(open.error);
    });
    try {
      return await new Promise<number>((resolve, reject) => {
        const tx = db.transaction('ops', 'readwrite');
        const store = tx.objectStore('ops');
        const read = store.getAll();
        let marked = 0;
        read.onsuccess = (): void => {
          for (const entry of read.result as Array<{
            op: { o: string };
            source: string;
            syncedAt?: number;
            rejectedAt?: number;
          }>) {
            if (
              entry.source === 'local' &&
              entry.op.o === 'REPAIR' &&
              entry.syncedAt === undefined
            ) {
              entry.rejectedAt ??= Date.now();
              store.put(entry);
              marked++;
            }
          }
        };
        tx.oncomplete = (): void => resolve(marked);
        tx.onerror = (): void => reject(tx.error);
      });
    } finally {
      db.close();
    }
  });

/**
 * #11352: a Dropbox client's automatic REPAIR snapshot upload failed and an
 * older version classified the thrown error as a rejection. File-based remotes
 * never reject a snapshot on its merits, but the rejected REPAIR stayed the
 * newest full-state op, so every later sync stopped with "Upload blocked
 * because pending operations depend on a rejected full-state baseline". The
 * client must heal without losing its own later work or the other device's.
 *
 * `bHasPendingWhenRepairLands` decides whether B's last change is still local
 * when A's healing REPAIR snapshot reaches the remote.
 */
const runRejectedRepairScenario = async (
  {
    browser,
    baseURL,
    request,
  }: { browser: Browser; baseURL: string | undefined; request: APIRequestContext },
  { bHasPendingWhenRepairLands }: { bHasPendingWhenRepairLands: boolean },
): Promise<void> => {
  const folder = generateSyncFolderName('rejected-repair');
  const shared = `Shared ${folder}`;
  const whileStuck = `While stuck A ${folder}`;
  const fromBMeanwhile = `From B meanwhile ${folder}`;
  const bPending = `B pending ${folder}`;
  const afterRecovery = `After recovery ${folder}`;
  const cfg = { ...WEBDAV_CONFIG_TEMPLATE, syncFolderPath: `/${folder}` };
  await createSyncFolder(request, folder);

  const a = await setupSyncClient(browser, baseURL);
  let b: Awaited<ReturnType<typeof setupSyncClient>> | undefined;
  try {
    const syncA = new SyncPage(a.page);
    const workA = new WorkViewPage(a.page);
    await workA.waitForTaskList();
    await workA.addTask(shared);
    await waitForStatePersistence(a.page);
    await syncA.setupWebdavSync(cfg);
    expect(await waitForSyncComplete(a.page, syncA)).toBe('success');

    b = await setupSyncClient(browser, baseURL);
    const syncB = new SyncPage(b.page);
    const workB = new WorkViewPage(b.page);
    await workB.waitForTaskList();
    await syncB.setupWebdavSync(cfg);
    expect(await waitForSyncComplete(b.page, syncB)).toBe('success');
    await expect(task(b.page, shared)).toBeVisible();

    // B uploads an op whose application makes A repair its state.
    await addGhostTagReference(b.page, shared);
    await syncB.triggerSync();
    expect(await waitForSyncComplete(b.page, syncB)).toBe('success');

    // A's REPAIR snapshot upload fails: the server refuses writes.
    let refusedWrites = 0;
    await a.page.route(`**/${folder}/**`, async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      refusedWrites++;
      await route.fulfill({ status: 403, body: 'Forbidden' });
    });
    await syncA.triggerSync();
    await expect.poll(() => refusedWrites).toBeGreaterThan(0);
    await expect(syncA.syncSpinner).toBeHidden({ timeout: 30000 });

    // What an older version left behind: the REPAIR is marked rejected.
    expect(await markPendingRepairRejected(a.page)).toBe(1);
    await workA.addTask(whileStuck);
    await waitForStatePersistence(a.page);

    // Meanwhile B keeps working. Done before A reloads, so the remote has
    // moved on whenever A's first sync after the reload runs (startup or the
    // explicit one below). `bPending` is either uploaded too or stays local.
    await workB.addTask(fromBMeanwhile);
    await waitForStatePersistence(b.page);
    await syncB.triggerSync();
    expect(await waitForSyncComplete(b.page, syncB)).toBe('success');
    await workB.addTask(bPending);
    await waitForStatePersistence(b.page);
    if (!bHasPendingWhenRepairLands) {
      await syncB.triggerSync();
      expect(await waitForSyncComplete(b.page, syncB)).toBe('success');
    }

    await a.page.unroute(`**/${folder}/**`);
    // Drop in-memory op-log caches so the persisted state is what runs.
    await a.page.reload();
    await waitForAppReady(a.page);
    await workA.waitForTaskList();

    // A heals: it rebases on B's uploaded changes and uploads its own work.
    await syncA.triggerSync();
    expect(await waitForSyncComplete(a.page, syncA)).toBe('success');
    await expect(syncA.syncErrorIcon).toBeHidden();
    await expect(task(a.page, fromBMeanwhile)).toBeVisible();
    if (!bHasPendingWhenRepairLands) {
      await expect(task(a.page, bPending)).toBeVisible();
    }

    // B takes A's new full-state snapshot without the whole-dataset dialog
    // (with `bHasPendingWhenRepairLands`, B's still-local change survives it).
    await syncB.triggerSync();
    expect(await waitForSyncComplete(b.page, syncB)).toBe('success');
    await expect(task(b.page, whileStuck)).toBeVisible();
    await expect(task(b.page, bPending)).toBeVisible();

    // A's uploads stay unblocked afterwards.
    await workA.addTask(afterRecovery);
    await waitForStatePersistence(a.page);
    await syncA.triggerSync();
    expect(await waitForSyncComplete(a.page, syncA)).toBe('success');
    await syncB.triggerSync();
    expect(await waitForSyncComplete(b.page, syncB)).toBe('success');
    for (const title of [shared, whileStuck, fromBMeanwhile, bPending, afterRecovery]) {
      await expect(task(a.page, title)).toBeVisible();
      await expect(task(b.page, title)).toBeVisible();
    }
  } finally {
    await closeContextsSafely(a.context, b?.context);
  }
};

test.describe('@webdav a rejected REPAIR does not stop file sync for good', () => {
  test.beforeEach(async ({ webdavServerUp }) => {
    void webdavServerUp;
  });

  test('a client left with a rejected REPAIR syncs again and keeps both sides', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.setTimeout(240000);
    await runRejectedRepairScenario(
      { browser, baseURL, request },
      { bHasPendingWhenRepairLands: false },
    );
  });

  // #11470: a peer's non-wiping REPAIR snapshot already holds everything B
  // last saw, so B keeps its pending change on top, with no whole-dataset
  // dialog.
  test('a peer with pending work keeps it when the healed client uploads its REPAIR', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.setTimeout(240000);
    await runRejectedRepairScenario(
      { browser, baseURL, request },
      { bHasPendingWhenRepairLands: true },
    );
  });
});
