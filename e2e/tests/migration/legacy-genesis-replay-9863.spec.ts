import { test, expect, Page } from '@playwright/test';
import { CURRENT_SCHEMA_VERSION } from '@sp/shared-schema';
import legacyData from '../../fixtures/legacy-full-migration-backup.json';
import { skipOnboardingForE2E } from '../../utils/waits';
import { WorkViewPage } from '../../pages/work-view.page';
import { TaskPage } from '../../pages/task.page';
import {
  createLegacyMigratedClient,
  closeLegacyClient,
  readMigratedState,
} from '../../utils/legacy-migration-helpers';

/**
 * Issue #9863 (follow-up finding): a legacy-migrated client's op-log opens
 * with a MIGRATION genesis op that carries the whole pre-migration state. No
 * reducer handled that op, so whenever the hydrator had to rebuild state from
 * the log — here: a corrupt `state_cache` snapshot, the #7892 path — every
 * task from before the app update vanished and only post-migration tasks
 * survived. That path then PERSISTED the truncated state as the new snapshot,
 * so the loss was permanent.
 *
 * The unit and integration specs pin the reducer wiring. This test is the
 * end-to-end claim: real legacy data on disk, a real migration, a real corrupt
 * snapshot, and the user's tasks still on screen after the reboot.
 *
 * Run: npm run e2e:file e2e/tests/migration/legacy-genesis-replay-9863.spec.ts -- --retries=0
 */

const PRE_MIGRATION_TASK = 'Legacy Migration - Standalone Task';
const POST_MIGRATION_TASK = 'created-after-migration-9863';

type MigratedState = {
  task?: { ids: string[]; entities: Record<string, { title?: string }> };
};

/**
 * Overwrite the snapshot with one `isValidSnapshot()` rejects (no core
 * models in `state`) at the CURRENT schema version, so boot takes the
 * corrupt-snapshot branch rather than the #9140 schema-migration fallback.
 * `lastAppliedOpSeq` is pushed past every real op so the tasks can only come
 * back through a replay from seq 0.
 */
const seedCorruptSnapshot = async (page: Page): Promise<string> =>
  page.evaluate(
    async ({ schemaVersion }) =>
      new Promise<string>((resolve) => {
        const timer = setTimeout(() => resolve('TIMEOUT'), 10000);
        const done = (msg: string): void => {
          clearTimeout(timer);
          resolve(msg);
        };
        const req = indexedDB.open('SUP_OPS');
        req.onblocked = () => done('BLOCKED');
        req.onerror = () => done('OPEN-ERROR');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('state_cache', 'readwrite');
          tx.onabort = () => done('TX-ABORT');
          const store = tx.objectStore('state_cache');
          const row = {
            id: 'current',
            state: {},
            lastAppliedOpSeq: 9999,
            vectorClock: {},
            compactedAt: Date.now(),
            schemaVersion,
          };
          let putReq: IDBRequest;
          try {
            putReq = store.keyPath ? store.put(row) : store.put(row, 'current');
          } catch (e) {
            db.close();
            done('PUT-THREW:' + String(e));
            return;
          }
          putReq.onsuccess = () => {
            db.close();
            done('OK');
          };
          putReq.onerror = () => {
            db.close();
            done('PUT-ERROR:' + String(putReq.error));
          };
        };
      }),
    { schemaVersion: CURRENT_SCHEMA_VERSION },
  );

const migratedTaskTitles = async (page: Page): Promise<string[]> => {
  const state = await readMigratedState<MigratedState>(page);
  return (state.task?.ids ?? []).map((id) => state.task?.entities[id]?.title ?? '');
};

test.describe('@migration #9863 genesis op replay after snapshot loss', () => {
  test('keeps pre-migration tasks when the snapshot is corrupt and the op-log is replayed', async ({
    browser,
    baseURL,
  }) => {
    const client = await createLegacyMigratedClient(
      browser,
      baseURL || 'http://localhost:4242',
      legacyData.data,
      'genesis-replay',
    );
    const { page } = client;
    await page.addInitScript(skipOnboardingForE2E);
    const workViewPage = new WorkViewPage(page);
    const taskPage = new TaskPage(page);

    try {
      // Post-migration op on top of the genesis op: this is what used to
      // survive the rebuild while everything older was dropped.
      await page.goto('/#/project/TEST_PROJECT/tasks');
      await workViewPage.waitForTaskList();
      await expect(taskPage.getTaskByText(PRE_MIGRATION_TASK)).toBeVisible();
      await workViewPage.addTask(POST_MIGRATION_TASK);
      await expect(taskPage.getTaskByText(POST_MIGRATION_TASK)).toBeVisible();

      expect(await seedCorruptSnapshot(page)).toBe('OK');

      const consoleLines: string[] = [];
      page.on('console', (msg) => consoleLines.push(msg.text()));

      await page.reload();
      await page.waitForLoadState('networkidle');
      await page.goto('/#/project/TEST_PROJECT/tasks');
      await workViewPage.waitForTaskList();

      // The corrupt-snapshot branch handled the boot, not some other path.
      expect(
        consoleLines.some((line) =>
          line.includes('Discarding corrupt snapshot and replaying the op-log'),
        ),
      ).toBe(true);

      // Both generations of data are back. Pre-fix: only the second one.
      await expect(taskPage.getTaskByText(POST_MIGRATION_TASK)).toBeVisible();
      await expect(taskPage.getTaskByText(PRE_MIGRATION_TASK)).toBeVisible();

      // This branch writes the rebuilt state back as the new snapshot, so the
      // on-disk copy must hold the legacy tasks too — that is where the loss
      // used to become permanent.
      await expect
        .poll(() => migratedTaskTitles(page), { timeout: 15000 })
        .toEqual(expect.arrayContaining([PRE_MIGRATION_TASK, POST_MIGRATION_TASK]));

      // A plain second boot reads that snapshot and shows the same data.
      await page.reload();
      await page.waitForLoadState('networkidle');
      await page.goto('/#/project/TEST_PROJECT/tasks');
      await workViewPage.waitForTaskList();
      await expect(taskPage.getTaskByText(PRE_MIGRATION_TASK)).toBeVisible();
      await expect(taskPage.getTaskByText(POST_MIGRATION_TASK)).toBeVisible();
    } finally {
      await closeLegacyClient(client);
    }
  });
});
