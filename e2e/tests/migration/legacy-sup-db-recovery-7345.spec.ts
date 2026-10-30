import { test, expect, Page } from '@playwright/test';
import legacyV12Data from '../../../src/app/op-log/backup/test-fixtures/legacy-v10-backup.json';
import { readMigratedState } from '../../utils/legacy-migration-helpers';

/**
 * #7345 / v17 gap: Super Productivity v12 and older kept everything in the `SUP`
 * IndexedDB (store `SUP_STORE`, one record per model). v13–v16 copied it into
 * `pf` on first start; v17.0.0 removed that step (04728267e). A profile that
 * jumps from v12 or older straight to a current build therefore boots into an
 * empty app with no hint, while its data is still on disk.
 *
 * Run: npm run e2e:file e2e/tests/migration/legacy-sup-db-recovery-7345.spec.ts -- --retries=0
 */

/** Writes a v12-era `SUP` database the way v12's IndexedDBAdapterService laid it out. */
const seedSupDatabase = (page: Page): Promise<string> =>
  page.evaluate(
    (data) =>
      new Promise<string>((resolve) => {
        const req = indexedDB.open('SUP', 2);
        req.onupgradeneeded = () => req.result.createObjectStore('SUP_STORE');
        req.onerror = () => resolve('OPEN-ERROR:' + String(req.error));
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('SUP_STORE', 'readwrite');
          const store = tx.objectStore('SUP_STORE');
          // The fixture is a `loadComplete()` result: its two timestamps are not
          // store records, and v10–v12 kept bookmarks per project, not top-level.
          const notRecords = [
            'lastLocalSyncModelChange',
            'lastArchiveUpdate',
            'bookmark',
          ];
          for (const [key, value] of Object.entries(data)) {
            if (!notRecords.includes(key)) {
              store.put(value, key);
            }
          }
          store.put(data.lastLocalSyncModelChange, 'LOCAL_LAST_SYNC_MODEL_CHANGE');
          tx.oncomplete = () => {
            db.close();
            resolve('OK');
          };
          tx.onerror = () => resolve('TX-ERROR:' + String(tx.error));
        };
      }),
    legacyV12Data as Record<string, unknown>,
  );

/**
 * Skips only the onboarding dialogs. Unlike `skipOnboardingForE2E` it leaves
 * `SUP_EXAMPLE_TASKS_CREATED` unset, as on a real v12 profile (v12 never wrote
 * it), so the onboarding example tasks race the startup check as they would
 * for a real upgrading user.
 */
const skipOnboardingDialogsOnly = (): void => {
  try {
    localStorage.setItem('SUP_ONBOARDING_PRESET_DONE', 'true');
    localStorage.setItem('SUP_ONBOARDING_HINTS_DONE', 'true');
    localStorage.setItem('SUP_IS_SHOW_TOUR', 'true');
  } catch {
    // No localStorage in this frame (data:/sandboxed); the host frame already ran us.
  }
};

test.describe('@migration v12 SUP database on a blank start (#7345)', () => {
  test('offers the never-migrated v12 data and imports it', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL: baseURL || 'http://localhost:4242',
      acceptDownloads: true,
    });
    const page = await context.newPage();
    try {
      await page.addInitScript(skipOnboardingDialogsOnly);
      await page.route('**/*.js', (route) => route.abort());
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      expect(await seedSupDatabase(page)).toBe('OK');
      await page.unroute('**/*.js');

      const prompts: string[] = [];
      page.on('dialog', async (dialog) => {
        prompts.push(dialog.message());
        await dialog.accept();
      });
      const downloadPromise = page.waitForEvent('download', { timeout: 60000 });

      await page.reload({ waitUntil: 'domcontentloaded' });

      // The copy is offered before anything is imported.
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toContain('sp-pre-v13-data');
      expect(prompts.some((msg) => msg.includes('12 or older'))).toBe(true);

      const v12TaskIds = ['task-1', 'task-2', 'task-2-sub', 'task-3'];
      await expect
        .poll(
          async () =>
            (
              await readMigratedState<{ task?: { ids: string[] } }>(page).catch(
                (): { task?: { ids: string[] } } => ({}),
              )
            ).task?.ids ?? [],
          { timeout: 30000 },
        )
        .toEqual(expect.arrayContaining(v12TaskIds));

      // The imported data survives a restart and is what the user sees.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('magic-side-nav', { state: 'visible', timeout: 30000 });
      await expect(page.getByText('My Project', { exact: false }).first()).toBeVisible({
        timeout: 15000,
      });
    } finally {
      await context.close();
    }
  });
});
