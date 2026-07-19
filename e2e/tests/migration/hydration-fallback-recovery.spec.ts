import { test, expect } from '../../fixtures/test.fixture';
import { type Page } from '@playwright/test';

/**
 * E2E reproduction + fix verification for issue #9140.
 *
 * A `state_cache` snapshot that cannot be schema-migrated (here: a
 * schemaVersion-1 snapshot whose `globalConfig.misc` is a non-object, which
 * makes the v1→v2 misc-to-tasks migration transform throw) used to escalate
 * into attemptRecovery() → "Refusing legacy recovery because a SUP_OPS
 * snapshot still exists" → HYDRATION_FAILED + EMPTY store, deterministically
 * on every boot.
 *
 * With the fix, boot must instead fall back to replaying the intact op-log:
 * the user's data is visible, the degraded recovery is announced via snack,
 * and the unmigratable-but-intact snapshot stays on disk untouched (it is the
 * last complete local copy — the fallback must never overwrite it).
 */

const DB_NAME = 'SUP_OPS';
const STATE_CACHE_STORE = 'state_cache';
const SINGLETON_KEY = 'current';

/**
 * Seeds a poisoned v1 snapshot. The op-log ('ops' store) already holds the
 * ops for the tasks created earlier in the test — exactly the "intact op-log,
 * unhydratable snapshot" shape #9140 describes.
 */
const seedPoisonedSnapshot = async (page: Page): Promise<void> => {
  await page.evaluate(
    async ({ dbName, storeName, key }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(storeName, 'readwrite');
          tx.objectStore(storeName).put({
            id: key,
            // `misc` as a string makes the v1→v2 migration's
            // `'field' in misc` check throw a TypeError.
            state: {
              task: { ids: [], entities: {} },
              project: { ids: [], entities: {} },
              globalConfig: { misc: 'corrupt-not-an-object' },
            },
            // Far past the real op seqs: on any NON-fallback path the tail
            // replay finds no ops after this seq, so the tasks can ONLY come
            // back via the fallback's replay-from-0 — this makes the
            // task-visibility assertions discriminate the recovery path.
            lastAppliedOpSeq: 9999,
            vectorClock: {},
            compactedAt: Date.now(),
            schemaVersion: 1,
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
        request.onerror = () => reject(request.error);
      });
    },
    { dbName: DB_NAME, storeName: STATE_CACHE_STORE, key: SINGLETON_KEY },
  );
};

const readSnapshotSchemaVersion = async (page: Page): Promise<number | undefined> =>
  page.evaluate(
    async ({ dbName, storeName, key }) =>
      new Promise<number | undefined>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(storeName, 'readonly');
          const get = tx.objectStore(storeName).get(key);
          get.onsuccess = () => {
            const version = (get.result as { schemaVersion?: number } | undefined)
              ?.schemaVersion;
            db.close();
            resolve(version);
          };
          get.onerror = () => {
            db.close();
            reject(get.error);
          };
        };
        request.onerror = () => reject(request.error);
      }),
    { dbName: DB_NAME, storeName: STATE_CACHE_STORE, key: SINGLETON_KEY },
  );

test.describe('hydration fallback recovery (#9140)', () => {
  test('boots with data from op-log replay when the snapshot cannot be migrated', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('survives-fallback-1');
    await workViewPage.addTask('survives-fallback-2');
    await expect(taskPage.getTaskByText('survives-fallback-1')).toBeVisible();

    await seedPoisonedSnapshot(page);

    // Pin the exact boot path via the hydrator's own log lines.
    const consoleLines: string[] = [];
    page.on('console', (msg) => consoleLines.push(msg.text()));

    await page.reload();
    await page.waitForLoadState('networkidle');
    await workViewPage.waitForTaskList();

    // Data comes back from the op-log replay — NOT the pre-fix empty store.
    // (lastAppliedOpSeq is seeded past all real ops, so only the fallback's
    // replay-from-0 can restore these.)
    await expect(taskPage.getTaskByText('survives-fallback-1')).toBeVisible();
    await expect(taskPage.getTaskByText('survives-fallback-2')).toBeVisible();

    // The #9140 fallback — not some other recovery path — handled the boot.
    expect(
      consoleLines.some((line) =>
        line.includes(
          'Skipping the snapshot for this boot and replaying the op-log from the start',
        ),
      ),
    ).toBe(true);

    // No pre-fix terminal failure. The recovery snack itself cannot be
    // DOM-asserted here: in the web e2e env the "Data will not be persisted
    // permanently" boot snack replaces it (SnackService debounces opens);
    // snackService.open is asserted at the unit level instead.
    await expect(page.locator('.mat-mdc-snack-bar-container')).not.toContainText(
      'Failed to load data',
    );

    // The intact-but-unmigratable snapshot is preserved on disk, still at v1 —
    // the fallback must never overwrite the last complete local copy.
    expect(await readSnapshotSchemaVersion(page)).toBe(1);

    // The recovery is stable: a second boot recovers the same way instead of
    // looping into the old every-boot brick.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await workViewPage.waitForTaskList();
    await expect(taskPage.getTaskByText('survives-fallback-1')).toBeVisible();
    await expect(taskPage.getTaskByText('survives-fallback-2')).toBeVisible();
    expect(await readSnapshotSchemaVersion(page)).toBe(1);
  });
});
