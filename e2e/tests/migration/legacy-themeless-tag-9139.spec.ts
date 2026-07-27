import { test, expect, Page } from '@playwright/test';
import legacyData from '../../fixtures/legacy-full-migration-backup.json';
import { MIGRATION_BACKUP_PREFIX } from '../../../electron/shared-with-frontend/get-backup-timestamp';
import { skipOnboardingForE2E } from '../../utils/waits';
import { cssSelectors } from '../../constants/selectors';

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
 * There are two independent defenses and they cover different paths, so there
 * is a test for each:
 *  1. the on-disk heal, which repairs the data during migration;
 *  2. the read-side fallback in `resolveContextTheme`, which is what saves an
 *     ALREADY-migrated store whose theme goes missing later — hydration
 *     validates but does not repair, so nothing heals that before render.
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

/**
 * Delete `theme` from the TODAY tag of an already-migrated store, and report
 * what happened rather than failing silently.
 *
 * Corrupting a store the app itself produced beats hand-building one: the
 * surrounding schema is guaranteed real, so the only variable is the missing
 * key.
 */
const stripThemeFromMigratedToday = async (page: Page): Promise<string> =>
  page.evaluate(
    async () =>
      new Promise<string>((resolve) => {
        // Resolve on every branch — an IndexedDB request that neither succeeds
        // nor errors (a blocked upgrade, say) would otherwise hang the evaluate
        // until the whole test times out with a misleading message.
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
          const getReq = store.get('current');
          getReq.onsuccess = () => {
            const row = getReq.result;
            const today = row?.state?.tag?.entities?.TODAY;
            if (!today) {
              db.close();
              done('NO-TODAY');
              return;
            }
            delete today.theme;
            // `state_cache` uses an in-line key (the row carries its own id),
            // and passing an explicit key to put() on such a store raises
            // DataError, which aborts the transaction rather than surfacing as
            // a request error. Let the store take the key from the row.
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
          getReq.onerror = () => done('GET-ERROR');
        };
      }),
  );

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

      // The data was healed, not merely tolerated at read time — otherwise this
      // would still pass with the on-disk corruption left in place. This is the
      // load-bearing assertion of this test (verified: disabling the heal fails
      // right here).
      await expect
        .poll(async () => (await readMigratedState(page)).tag?.entities?.TODAY != null, {
          timeout: 30000,
        })
        .toBe(true);

      const state = await readMigratedState(page);
      const today = state.tag?.entities?.TODAY as
        | { theme?: Record<string, unknown> }
        | undefined;
      expect(today).toBeDefined();
      expect(today?.theme).toBeDefined();
      expect(typeof today?.theme?.primary).toBe('string');

      // Checked LAST on purpose: the IndexedDB poll above is a real
      // settle window, so a startup error has had time to surface. Asserting
      // this straight after the side nav appears would pass on timing alone.
      // (No task-content assertion here — TODAY membership is virtual, driven
      // by dueDay rather than the tag's taskIds, so the list can legitimately
      // be empty for this fixture.)
      expect(
        pageErrors.filter((m) => /backgroundImage|theme|undefined/i.test(m)),
      ).toEqual([]);
    } finally {
      await context.close();
    }
  });

  // The test above only exercises the on-disk heal: it repairs the data during
  // migration, so the read-side fallback is never reached (verified — removing
  // it leaves that test green). But the crash in #9139 was an ordinary launch,
  // not a migration. This covers that: an already-migrated store that loses its
  // theme afterwards. Hydration validates without repairing, so nothing heals
  // this before render and `resolveContextTheme` is the only thing standing
  // between the user and the startup crash.
  test('app starts when an already-migrated TODAY tag loses its theme', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      storageState: undefined,
      baseURL: baseURL || 'http://localhost:4242',
      acceptDownloads: true,
    });

    try {
      // Phase 1 — let the app build a real, valid store for itself.
      const appPage = await context.newPage();
      await appPage.addInitScript(skipOnboardingForE2E);
      await appPage.route('**/*.js', async (route) => route.abort());
      await appPage.goto('/', { waitUntil: 'domcontentloaded' });
      await seedLegacyDatabase(appPage, legacyData.data as Record<string, unknown>);
      await appPage.unroute('**/*.js');

      const downloadPromise = appPage.waitForEvent('download', { timeout: 60000 });
      await appPage.reload({ waitUntil: 'domcontentloaded' });
      await downloadPromise;
      await appPage.waitForSelector('magic-side-nav', {
        state: 'visible',
        timeout: 30000,
      });

      // Phase 2 — corrupt the store from a second, script-free page.
      //
      // Order matters and is load-bearing: this page is opened BEFORE the app
      // page closes. Opening it afterwards produced an evaluate that never
      // settled and surfaced as a misleading "execution context was destroyed".
      // Reading from the app's own page is no good either — the state_cache
      // write is async and lands after `magic-side-nav` is already visible, so
      // it reads back empty.
      const dbPage = await context.newPage();
      await dbPage.route('**/*.js', async (route) => route.abort());
      await dbPage.goto('/', { waitUntil: 'domcontentloaded' });

      // Wait for the row to actually exist before touching it, so a corruption
      // that silently no-ops cannot masquerade as a pass.
      await expect
        .poll(
          async () => (await readMigratedState(dbPage)).tag?.entities?.TODAY != null,
          {
            timeout: 30000,
          },
        )
        .toBe(true);

      await appPage.close();
      expect(await stripThemeFromMigratedToday(dbPage)).toBe('OK');

      // Confirm the corruption is really on disk before relying on it.
      const corrupted = (await readMigratedState(dbPage)).tag?.entities?.TODAY as
        | Record<string, unknown>
        | undefined;
      expect(corrupted).toBeDefined();
      expect('theme' in (corrupted as Record<string, unknown>)).toBe(false);
      await dbPage.close();

      // Phase 3 — the launch that used to die in resolveBackground().
      const page = await context.newPage();
      await page.addInitScript(skipOnboardingForE2E);
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));

      await page.goto('/#/tag/TODAY/tasks', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('magic-side-nav', { state: 'visible', timeout: 30000 });
      await expect(page.locator('magic-side-nav')).toBeVisible();

      // "No error happened" is meaningless without waiting for something real
      // first. The side nav renders BEFORE the theme pipeline throws, so
      // asserting straight after it is a race — verified the hard way: with the
      // fallback removed this test failed alongside its sibling but PASSED when
      // run alone, purely because the faster solo run checked before the error
      // arrived. Waiting on a rendered task is both the stronger assertion and
      // the settle window, without a bare timeout.
      await expect(page.locator(cssSelectors.TASK).first()).toBeVisible({
        timeout: 30000,
      });

      expect(
        pageErrors.filter((m) => /backgroundImage|theme|undefined/i.test(m)),
      ).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
