import type { Page, TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../fixtures/test.fixture';
import { ImportPage } from '../../pages/import.page';
import type { TaskPage } from '../../pages/task.page';
import type { WorkViewPage } from '../../pages/work-view.page';
import { readRecoveryRing } from '../../utils/recovery-ring-helpers';
import { waitForAppReady } from '../../utils/waits';

// Pin the retired on-disk format here: this fixture must survive deletion of
// the production journal model and must never open the DB to test its absence.
const JOURNAL_DB = 'SUP_CONFLICT_JOURNAL';
const CLEAR_MARKER = 'SUP_CONFLICT_JOURNAL_CLEARED_BEFORE';

interface StoredLocalOp {
  seq: number;
  source: string;
  syncedAt?: number;
  rejectedAt?: number;
  op: {
    id: string;
    e?: string;
    entityType?: string;
    p?: unknown;
    payload?: unknown;
  };
}

interface StoredBackup {
  backupId: string;
  savedAt: number;
  state: { task: { entities: Record<string, { title: string }> } };
}

interface UpgradeWitnesses {
  pending: StoredLocalOp[];
  backup?: StoredBackup;
}

interface JournalSeedEvidence {
  version: number;
  keyPath: string | string[] | null;
  indexes: string[];
  rows: unknown[];
  storedRows: unknown[];
  marker: string | null;
  clearedBefore: number;
}

const readWitnesses = (page: Page, backupId: string): Promise<UpgradeWitnesses> =>
  page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('SUP_OPS');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const tx = db.transaction(['ops', 'import_backup'], 'readonly');
      const opsRequest = tx.objectStore('ops').getAll();
      const backupRequest = tx.objectStore('import_backup').get(id);
      const [ops, backup] = await Promise.all([
        new Promise<StoredLocalOp[]>((resolve, reject) => {
          opsRequest.onsuccess = () => resolve(opsRequest.result);
          opsRequest.onerror = () => reject(opsRequest.error);
        }),
        new Promise<StoredBackup | undefined>((resolve, reject) => {
          backupRequest.onsuccess = () => resolve(backupRequest.result);
          backupRequest.onerror = () => reject(backupRequest.error);
        }),
      ]);
      return {
        pending: ops.filter(
          (entry) => entry.source === 'local' && !entry.syncedAt && !entry.rejectedAt,
        ),
        backup,
      };
    } finally {
      db.close();
    }
  }, backupId);

const seedLegacyJournal = (page: Page): Promise<JournalSeedEvidence> =>
  page.evaluate(
    async ({ name, marker }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore('conflicts', {
            keyPath: 'id',
          });
          store.createIndex('by-status', 'status');
          store.createIndex('by-resolvedAt', 'resolvedAt');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const now = Date.now();
        const clearedBefore = now - 1000;
        const rows = [
          { id: 's5-hidden-before-clear', resolvedAt: now - 2000, status: 'kept' },
          { id: 's5-fresh-unreviewed', resolvedAt: now, status: 'unreviewed' },
        ].map((entry) => ({
          ...entry,
          entityType: 'TASK',
          entityId: 's5-legacy-task',
          entityTitle: 'Legacy conflict witness',
          winner: 'remote',
          reason: 'newer',
          fieldDiffs: [
            {
              field: 'title',
              localVal: 'Discarded title',
              remoteVal: 'Kept title',
              localChanged: true,
              remoteChanged: true,
              pickedSide: 'remote',
            },
          ],
          localClientId: 's5-local',
          remoteClientId: 's5-remote',
          localTs: now - 3000,
          remoteTs: now - 2500,
        }));
        const tx = db.transaction('conflicts', 'readwrite');
        rows.forEach((row) => tx.objectStore('conflicts').put(row));
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
        localStorage.setItem(marker, String(clearedBefore));
        const readTx = db.transaction('conflicts', 'readonly');
        const store = readTx.objectStore('conflicts');
        const storedRows = await new Promise<unknown[]>((resolve, reject) => {
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        return {
          version: db.version,
          keyPath: store.keyPath,
          indexes: Array.from(store.indexNames),
          rows,
          storedRows,
          marker: localStorage.getItem(marker),
          clearedBefore,
        };
      } finally {
        db.close();
      }
    },
    { name: JOURNAL_DB, marker: CLEAR_MARKER },
  );

const prepareAndReloadUpgrade = async (
  page: Page,
  workViewPage: WorkViewPage,
  taskPage: TaskPage,
  testInfo: TestInfo,
  beforeReload?: () => Promise<void>,
): Promise<void> => {
  await workViewPage.waitForTaskList();
  await workViewPage.addTask('S5 backup witness');
  const importPage = new ImportPage(page);
  await importPage.navigateToImportPage();
  const downloadPromise = page.waitForEvent('download');
  await importPage.exportBackupBtn.click();
  const download = await downloadPromise;
  const backupPath = testInfo.outputPath('app-created-backup.json');
  await download.saveAs(backupPath);
  // A real import captures the current app-created task in the local recovery
  // ring. Add another task afterwards so it is absent from the saved backup.
  await importPage.importBackupFile(backupPath);
  await workViewPage.waitForTaskList();
  await workViewPage.addTask('S5 pending operation witness');
  const ring = await readRecoveryRing(page);
  expect(ring).toHaveLength(1);
  expect(ring[0]).toMatchObject({ reason: 'LOCAL_IMPORT', taskCount: 1 });
  const backupId = ring[0].backupId;
  await expect
    .poll(async () => {
      const witnesses = await readWitnesses(page, backupId);
      return witnesses.pending.some(
        (entry) =>
          (entry.op.e ?? entry.op.entityType) === 'TASK' &&
          JSON.stringify(entry.op.p ?? entry.op.payload).includes(
            'S5 pending operation witness',
          ),
      );
    })
    .toBe(true);
  const before = await readWitnesses(page, backupId);
  expect(before.backup?.backupId).toBe(backupId);
  expect(
    Object.values(before.backup!.state.task.entities).map((task) => task.title),
  ).toEqual([expect.stringContaining('S5 backup witness')]);

  const seeded = await seedLegacyJournal(page);
  expect(seeded.version).toBe(1);
  expect(seeded.keyPath).toBe('id');
  expect(seeded.indexes).toEqual(['by-resolvedAt', 'by-status']);
  expect(seeded.storedRows).toHaveLength(seeded.rows.length);
  expect(seeded.storedRows).toEqual(expect.arrayContaining(seeded.rows));
  expect(seeded.marker).toBe(String(seeded.clearedBefore));

  await beforeReload?.();
  await page.reload();
  await waitForAppReady(page);
  await workViewPage.waitForTaskList();
  await expect(taskPage.getTaskByText('S5 backup witness')).toBeVisible();
  await expect(taskPage.getTaskByText('S5 pending operation witness')).toBeVisible();
  const after = await readWitnesses(page, backupId);
  expect(after.pending).toEqual(expect.arrayContaining(before.pending));
  expect(after.backup).toEqual(before.backup);
  expect(await readRecoveryRing(page)).toEqual(ring);
  const witnessPath = testInfo.outputPath('upgrade-witnesses.json');
  await writeFile(witnessPath, JSON.stringify({ seeded, before, after, ring }, null, 2));
  await testInfo.attach('upgrade-witnesses', {
    path: witnessPath,
    contentType: 'application/json',
  });
};

test.describe('Conflict journal retirement', () => {
  test('legacy fixture boots with tasks, pending operations and a usable backup', async ({
    page,
    workViewPage,
    taskPage,
  }, testInfo) => {
    await prepareAndReloadUpgrade(page, workViewPage, taskPage, testInfo);
    const importPage = new ImportPage(page);
    await importPage.navigateToImportPage();
    await page
      .locator('config-page')
      .getByRole('button', { name: 'Browse backups' })
      .click();
    const dialog = page.locator('dialog-backups-list');
    await expect(dialog).toBeVisible();
    await dialog.locator('.backup').click();
    await expect(dialog).toContainText('1 tasks');
    await dialog.getByRole('button', { name: 'Restore', exact: true }).click();
    await page.locator('dialog-confirm button[e2e="confirmBtn"]').click();
    await expect(dialog).not.toBeVisible();
    await page.goto('/#/work-view');
    await workViewPage.waitForTaskList();
    await expect(taskPage.getTaskByText('S5 backup witness')).toBeVisible();
    await expect(
      taskPage.getTaskByText('S5 pending operation witness'),
    ).not.toBeVisible();
  });

  test('seeded upgrade removes the journal while retaining task, operation and backup witnesses', async ({
    page,
    workViewPage,
    taskPage,
  }, testInfo) => {
    await prepareAndReloadUpgrade(page, workViewPage, taskPage, testInfo);
    const databaseNames = await page.evaluate(async () =>
      (await indexedDB.databases()).map((db) => db.name),
    );
    expect(
      databaseNames,
      'Upgrade must delete the legacy conflict journal database',
    ).not.toContain(JOURNAL_DB);
    expect(
      await page.evaluate((key) => localStorage.getItem(key), CLEAR_MARKER),
    ).toBeNull();
  });

  test('fresh and repeated startup never creates the journal', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    for (let startup = 0; startup < 3; startup++) {
      await workViewPage.waitForTaskList();
      expect(
        await page.evaluate(async () =>
          (await indexedDB.databases()).map((db) => db.name),
        ),
      ).not.toContain(JOURNAL_DB);
      expect(
        await page.evaluate((key) => localStorage.getItem(key), CLEAR_MARKER),
      ).toBeNull();
      if (startup === 0) {
        await workViewPage.addTask('S5 repeated startup witness');
      }
      await expect(taskPage.getTaskByText('S5 repeated startup witness')).toBeVisible();
      if (startup < 2) {
        await page.reload();
        await waitForAppReady(page);
      }
    }
  });

  test('an old open connection cannot block startup and closing it permits cleanup', async ({
    page,
    workViewPage,
    taskPage,
  }, testInfo) => {
    const blocker = await page.context().newPage();
    try {
      // Same-origin document without an app bootstrap: only this deliberate
      // legacy IDB connection can block the new app's deletion request.
      await blocker.route('**/s5-journal-blocker.html', (route) =>
        route.fulfill({ contentType: 'text/html', body: '<html></html>' }),
      );
      await blocker.goto(new URL('/s5-journal-blocker.html', page.url()).href);
      await prepareAndReloadUpgrade(page, workViewPage, taskPage, testInfo, async () => {
        await blocker.evaluate(async (name) => {
          const state = window as unknown as {
            s5JournalConnection?: IDBDatabase;
            s5DeleteRequested?: boolean;
          };
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(name, 1);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          state.s5JournalConnection = db;
          db.onversionchange = (event) => {
            state.s5DeleteRequested = event.newVersion === null;
            // Deliberately keep the connection open like a running old client.
          };
        }, JOURNAL_DB);
      });
      expect(
        await blocker.evaluate(
          () => (window as unknown as { s5DeleteRequested?: boolean }).s5DeleteRequested,
        ),
      ).toBe(true);
      expect(
        await page.evaluate(async () =>
          (await indexedDB.databases()).map((db) => db.name),
        ),
      ).toContain(JOURNAL_DB);
      expect(
        await page.evaluate((key) => localStorage.getItem(key), CLEAR_MARKER),
      ).toBeNull();
      await workViewPage.addTask('S5 usable during blocked deletion');
      await expect(
        taskPage.getTaskByText('S5 usable during blocked deletion'),
      ).toBeVisible();
      const backupId = (await readRecoveryRing(page))[0].backupId;
      await expect
        .poll(async () =>
          (await readWitnesses(page, backupId)).pending.some((entry) =>
            JSON.stringify(entry.op.p ?? entry.op.payload).includes(
              'S5 usable during blocked deletion',
            ),
          ),
        )
        .toBe(true);
      await blocker.evaluate(() =>
        (
          window as unknown as { s5JournalConnection?: IDBDatabase }
        ).s5JournalConnection!.close(),
      );
      await expect
        .poll(() =>
          page.evaluate(async () => (await indexedDB.databases()).map((db) => db.name)),
        )
        .not.toContain(JOURNAL_DB);
      await expect(
        taskPage.getTaskByText('S5 usable during blocked deletion'),
      ).toBeVisible();
    } finally {
      await blocker.close();
    }
  });

  test('retired review route and Settings entry disappear while backup controls remain', async ({
    page,
  }) => {
    const importPage = new ImportPage(page);
    await importPage.navigateToImportPage();
    await expect(
      page.locator(
        'config-page a[href*="sync-conflicts"], config-page button[routerLink="/sync-conflicts"]',
      ),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Review sync conflicts' })).toHaveCount(
      0,
    );
    await expect(
      page.locator('config-page').getByRole('button', { name: 'Browse backups' }),
    ).toBeVisible();
    await page.goto('/#/sync-conflicts');
    await waitForAppReady(page);
    await expect(page.locator('sync-conflicts-page')).toHaveCount(0);
  });
});
