import { test, expect, Page } from '@playwright/test';
import { skipOnboardingForE2E, waitForAppReady } from '../../utils/waits';

/**
 * User Profiles removal: the SUP_OPS v10 -> v11 upgrade.
 *
 * `runDbUpgrade` runs on EVERY user's first launch of the build that drops the
 * feature, and its failure mode is not degraded behaviour — a versionchange
 * transaction that throws aborts, the database never opens, and the user sees
 * no data at all. That makes it the highest-stakes code in the removal.
 *
 * The unit tests already pin the pieces against real IndexedDB: `db-upgrade.spec`
 * covers 10 -> 11 preserving `state_cache`, `op-log-db-schema.spec` covers the
 * fresh-install 0 -> 11 path, and `local-draft.service.spec` covers the
 * localStorage sweep. None of them can show the three running TOGETHER inside a
 * real app boot, which is the only thing a user actually experiences — the
 * upgrade, then the draft migration in its APP_INITIALIZER, then hydration
 * reading a store that just lost an object store. That is what this test is for.
 *
 * The seeded device is the awkward cohort on purpose: profiles enabled, with a
 * SECONDARY profile active rather than `default`, a retired snapshot still in
 * `profile_data`, and drafts belonging to two different profiles. Everything the
 * removal has to reason about is present at once.
 *
 * Run: npm run e2e:file e2e/tests/migration/user-profiles-removal-v11.spec.ts -- --retries=0
 */

/** The profile that was active when the user updated — deliberately not `default`. */
const ACTIVE_PROFILE_ID = 'V1StGXR8Z5jdHi6BmyT8w';
const OTHER_PROFILE_ID = 'bR7kQm2LpXn4TvZs9WcYd';

const DRAFT_PREFIX = 'SUP_LOCAL_DRAFT_';
const legacyDraftKey = (profileId: string, noteId: string): string =>
  `${DRAFT_PREFIX}${profileId}:NOTE:${noteId}`;
const migratedDraftKey = (noteId: string): string => `${DRAFT_PREFIX}NOTE:${noteId}`;

/**
 * Build SUP_OPS at exactly version 10 — the last shape before the removal.
 *
 * Every v10 store and index is created faithfully rather than just the ones this
 * test asserts on: `runDbUpgrade`'s steps are all guarded by `oldVersion < N`, so
 * a store missing here would never be created by the app either, and the test
 * would fail on a hole of its own making instead of on the upgrade.
 */
const seedProfilesEraDatabase = (page: Page): Promise<string> =>
  page.evaluate(
    ([activeProfileId, otherProfileId]) =>
      new Promise<string>((resolve) => {
        // Resolve on every branch: an IndexedDB request that neither succeeds
        // nor errors would otherwise hang until the Playwright timeout and
        // report as something unrelated.
        const timer = setTimeout(() => resolve('TIMEOUT'), 10000);
        const done = (msg: string): void => {
          clearTimeout(timer);
          resolve(msg);
        };

        const req = indexedDB.open('SUP_OPS', 10);
        req.onblocked = () => done('BLOCKED');
        req.onerror = () => done('OPEN-ERROR:' + String(req.error));
        req.onupgradeneeded = () => {
          const db = req.result;
          const ops = db.createObjectStore('ops', {
            keyPath: 'seq',
            autoIncrement: true,
          });
          ops.createIndex('byId', 'op.id', { unique: true });
          ops.createIndex('bySyncedAt', 'syncedAt');
          ops.createIndex('bySourceAndStatus', ['source', 'applicationStatus']);
          db.createObjectStore('state_cache', { keyPath: 'id' });
          db.createObjectStore('import_backup', { keyPath: 'id' });
          db.createObjectStore('vector_clock');
          db.createObjectStore('archive_young', { keyPath: 'id' });
          db.createObjectStore('archive_old', { keyPath: 'id' });
          db.createObjectStore('profile_data', { keyPath: 'id' });
          db.createObjectStore('client_id');
          db.createObjectStore('meta');
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('profile_data', 'readwrite');
          tx.onabort = () => {
            db.close();
            done('TX-ABORT:' + String(tx.error));
          };
          // The retired snapshots the removal discards. Two of them, so the
          // store is not trivially empty when it is dropped.
          tx.objectStore('profile_data').put({
            id: activeProfileId,
            data: { marker: 'active snapshot' },
            lastModified: Date.now(),
          });
          tx.objectStore('profile_data').put({
            id: otherProfileId,
            data: { marker: 'retired snapshot' },
            lastModified: Date.now(),
          });
          tx.oncomplete = () => {
            db.close();
            done('OK');
          };
        };
      }),
    [ACTIVE_PROFILE_ID, OTHER_PROFILE_ID],
  );

/** Report the live SUP_OPS version and store names without forcing an upgrade. */
const readDbShape = (
  page: Page,
): Promise<{ version: number; stores: string[]; metaKeyCount: number }> =>
  page.evaluate(
    () =>
      new Promise<{ version: number; stores: string[]; metaKeyCount: number }>(
        (resolve, reject) => {
          const req = indexedDB.open('SUP_OPS');
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const db = req.result;
            const shape = {
              version: db.version,
              stores: Array.from(db.objectStoreNames),
              metaKeyCount: 0,
            };
            // A real post-upgrade WRITE by the app, not merely a successful
            // open: the startup migrations record their markers in `meta`, so a
            // non-empty store proves the migrated database is writable.
            const getReq = db
              .transaction('meta', 'readonly')
              .objectStore('meta')
              .getAllKeys();
            getReq.onsuccess = () => {
              shape.metaKeyCount = getReq.result.length;
              db.close();
              resolve(shape);
            };
            getReq.onerror = () => {
              db.close();
              resolve(shape);
            };
          };
        },
      ),
  );

const readLocalStorageKeys = (page: Page): Promise<Record<string, string | null>> =>
  page.evaluate(() => {
    const draftKeys = Object.keys(localStorage).filter((k) =>
      k.startsWith('SUP_LOCAL_DRAFT_'),
    );
    const profileDataKeys = Object.keys(localStorage).filter((k) =>
      k.startsWith('sp_profile_data_'),
    );
    return {
      meta: localStorage.getItem('sp_profile_meta'),
      enabled: localStorage.getItem('sp_user_profiles_enabled'),
      draftKeys: draftKeys.sort().join(','),
      profileDataKeys: profileDataKeys.sort().join(','),
    };
  });

test.describe('@migration user profiles removal', () => {
  test('upgrades a profiles-era install to v11 and keeps the active drafts', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      storageState: undefined,
      baseURL: baseURL || 'http://localhost:4242',
    });
    const page = await context.newPage();
    await page.addInitScript(skipOnboardingForE2E);

    // The pre-fix failure mode of a bad upgrade is an uncaught exception during
    // startup, so collect page errors explicitly — a blank-but-quiet page and a
    // crashed page must not look the same to this test.
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      // Block JS so the app cannot boot (and upgrade the database) mid-seed.
      await page.route('**/*.js', async (route) => route.abort());
      await page.goto('/', { waitUntil: 'domcontentloaded' });

      expect(await seedProfilesEraDatabase(page)).toBe('OK');

      const draftAt = Date.now();
      const activeDraft = JSON.stringify({
        content: 'draft in the profile that was active',
        baseContent: 'base',
        updatedAt: draftAt,
      });
      await page.evaluate(
        ([active, other, draft, activeKey, otherKey]) => {
          localStorage.setItem(
            'sp_profile_meta',
            JSON.stringify({ activeProfileId: active, profiles: [], version: 1 }),
          );
          localStorage.setItem('sp_user_profiles_enabled', 'true');
          // Pre-IndexedDB snapshot leftovers, which the sweep also clears.
          localStorage.setItem(`sp_profile_data_${active}`, 'legacy blob');
          localStorage.setItem(`sp_profile_data_${other}`, 'legacy blob');
          localStorage.setItem(activeKey, draft);
          localStorage.setItem(otherKey, draft);
        },
        [
          ACTIVE_PROFILE_ID,
          OTHER_PROFILE_ID,
          activeDraft,
          legacyDraftKey(ACTIVE_PROFILE_ID, 'note-1'),
          legacyDraftKey(OTHER_PROFILE_ID, 'note-2'),
        ],
      );

      // Sanity-check the fixture itself: without profile_data present at v10,
      // the assertions below would pass vacuously.
      const before = await readDbShape(page);
      expect(before.version).toBe(10);
      expect(before.stores).toContain('profile_data');

      await page.unroute('**/*.js');
      await page.reload({ waitUntil: 'domcontentloaded' });

      // The load-bearing assertion: the app renders at all. A versionchange
      // transaction that aborts leaves the database unopenable, and this is
      // where that shows up.
      await waitForAppReady(page);
      await expect(page.locator('magic-side-nav')).toBeVisible();

      // The upgrade ran, dropped only the obsolete store, and the migrated
      // database then accepted a real write from the app.
      await expect
        .poll(async () => (await readDbShape(page)).metaKeyCount, { timeout: 30000 })
        .toBeGreaterThan(0);

      const after = await readDbShape(page);
      expect(after.version).toBe(11);
      expect(after.stores).not.toContain('profile_data');
      expect(after.stores.sort()).toEqual([
        'archive_old',
        'archive_young',
        'client_id',
        'import_backup',
        'meta',
        'ops',
        'state_cache',
        'vector_clock',
      ]);

      // The device-local sweep ran in the same boot: the active profile's draft
      // survives under the new key, the other profile's is gone, and none of the
      // feature's localStorage remains.
      await expect
        .poll(async () => (await readLocalStorageKeys(page)).draftKeys, {
          timeout: 30000,
        })
        .toBe(migratedDraftKey('note-1'));

      const ls = await readLocalStorageKeys(page);
      expect(ls.meta).toBeNull();
      expect(ls.enabled).toBeNull();
      expect(ls.profileDataKeys).toBe('');
      expect(
        await page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key) || '{}').content,
          migratedDraftKey('note-1'),
        ),
      ).toBe('draft in the profile that was active');

      // Checked last on purpose: the polls above are a real settle window, so a
      // startup error has had time to surface.
      expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
