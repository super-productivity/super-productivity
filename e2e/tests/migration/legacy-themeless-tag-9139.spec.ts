import { test, expect, Page } from '@playwright/test';
import legacyData from '../../fixtures/legacy-full-migration-backup.json';
import { MIGRATION_BACKUP_PREFIX } from '../../../electron/shared-with-frontend/get-backup-timestamp';
import { skipOnboardingForE2E } from '../../utils/waits';

/**
 * Issue #9139: a tag persisted with no `theme` at all crashed the app on
 * EVERY launch — `resolveBackground()` dereferenced `theme.backgroundImageDark`
 * on undefined, and the reported entity was TODAY, the active context at
 * startup.
 *
 * The unit tests pin the pieces (the fallback, the heal, the `currentTheme$`
 * wiring). None of them can show that the app actually STARTS with this data
 * on disk, which is the only claim the bug report makes. That is what this
 * test is for, so it deliberately asserts boot-and-render rather than any
 * particular colour.
 *
 * SCOPE: this covers the on-disk heal. With the heal in place the data is
 * repaired during migration, so the read-side fallback in `resolveContextTheme`
 * is never reached here — verified by removing it and watching this test stay
 * green. That path is covered by the `currentTheme$` unit test instead; an
 * end-to-end version needs to corrupt an already-migrated store, which fights
 * the running app's own IndexedDB connection and is not worth the flake.
 *
 * Run: npm run e2e:file e2e/tests/migration/legacy-themeless-tag-9139.spec.ts -- --retries=0
 */

/** Read the migrated store back out of SUP_OPS. */
const readMigratedState = async (
  page: Page,
): Promise<{ tag?: { ids: string[]; entities: Record<string, unknown> } }> =>
  page.evaluate(
    async () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('SUP_OPS');
        request.onsuccess = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          const tx = db.transaction('state_cache', 'readonly');
          const getReq = tx.objectStore('state_cache').get('current');
          getReq.onsuccess = () => {
            db.close();
            resolve(getReq.result?.state || {});
          };
          getReq.onerror = () => {
            db.close();
            reject(getReq.error);
          };
        };
        request.onerror = () => reject(request.error);
      }),
  );

const seedLegacyDatabase = async (
  page: Page,
  data: Record<string, unknown>,
): Promise<void> => {
  await page.evaluate(
    async (entityData) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('pf', 1);
        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains('main')) {
            db.createObjectStore('main');
          }
        };
        request.onsuccess = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          const tx = db.transaction('main', 'readwrite');
          const store = tx.objectStore('main');
          for (const [key, value] of Object.entries(entityData)) {
            store.put(value, key);
          }
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
      }),
    data,
  );
};

test.describe('@migration #9139 work context with no theme', () => {
  test('app starts and migrates when the TODAY tag has no theme', async ({
    browser,
    baseURL,
  }) => {
    // Mutate the shared fixture in-code rather than committing a near-duplicate
    // copy of it: the single deleted key IS the bug, and this way it stays
    // visible in the diff instead of buried in ~100KB of JSON.
    const themelessData = JSON.parse(JSON.stringify(legacyData.data)) as Record<
      string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any
    >;
    delete themelessData.tag.entities.TODAY.theme;
    expect('theme' in themelessData.tag.entities.TODAY).toBe(false);

    const context = await browser.newContext({
      storageState: undefined,
      baseURL: baseURL || 'http://localhost:4242',
      acceptDownloads: true,
    });
    const page = await context.newPage();
    await page.addInitScript(skipOnboardingForE2E);

    // The pre-fix failure is an uncaught TypeError during startup, so collect
    // page errors and assert on them explicitly — a blank-but-quiet page and a
    // crashed page must not look the same to this test.
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await page.route('**/*.js', async (route) => route.abort());
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await seedLegacyDatabase(page, themelessData);
      await page.unroute('**/*.js');

      const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
      await page.reload({ waitUntil: 'domcontentloaded' });

      // Migration ran at all (its backup download is the reliable signal —
      // the dialog can come and go faster than we can observe it).
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toContain(MIGRATION_BACKUP_PREFIX);

      // The actual regression: the app renders instead of dying at startup.
      await page.waitForSelector('magic-side-nav', { state: 'visible', timeout: 30000 });
      await expect(page.locator('magic-side-nav')).toBeVisible();

      // TODAY is the context the crash was reported on, so make sure we
      // actually landed on it rather than passing on some other route.
      await page.goto('/#/tag/TODAY/tasks');
      await page.waitForSelector('magic-side-nav', { state: 'visible', timeout: 30000 });

      expect(
        pageErrors.filter((m) => /backgroundImage|theme|undefined/i.test(m)),
      ).toEqual([]);

      // And the data was healed, not merely tolerated at read time — otherwise
      // this would still pass with the on-disk corruption left in place.
      const state = await readMigratedState(page);
      const today = state.tag?.entities?.TODAY as
        | { theme?: Record<string, unknown> }
        | undefined;
      expect(today).toBeDefined();
      expect(today?.theme).toBeDefined();
      expect(typeof today?.theme?.primary).toBe('string');
    } finally {
      await context.close();
    }
  });
});
