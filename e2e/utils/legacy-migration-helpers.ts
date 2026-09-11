import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { skipOnboardingForE2E, waitForAppReady } from './waits';
import { MIGRATION_BACKUP_PREFIX } from '../../electron/shared-with-frontend/get-backup-timestamp';
import { installDevErrorDialogHandler } from './runtime-errors';

/**
 * Legacy Migration E2E Test Helpers
 *
 * These helpers facilitate testing scenarios where clients have migrated
 * from the old Super Productivity format (pre-operation-log) and then sync.
 */

/**
 * Read the migrated store back out of the SUP_OPS snapshot (`state_cache/current`).
 *
 * Generic over the slices a given test cares about, so each caller keeps the
 * narrow shape it asserts on without re-implementing the IndexedDB read.
 */
export const readMigratedState = async <T extends Record<string, unknown>>(
  page: Page,
): Promise<T> =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('SUP_OPS');
        request.onsuccess = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          try {
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
          } catch (e) {
            // `open()` with no version CREATES an empty SUP_OPS when none
            // exists, and `transaction()` then throws synchronously in here —
            // without this the promise never settles and the caller hangs to
            // the Playwright timeout instead of failing with the reason.
            db.close();
            reject(e);
          }
        };
        request.onerror = () => reject(request.error);
      }),
  ) as Promise<T>;

/**
 * Strip a legacy fixture down to its archive: no active tasks, only the INBOX
 * project and the TODAY tag, archived tasks re-homed to INBOX. Models a legacy
 * user whose every task was archived before sync was set up (#9932).
 */
export const toArchiveOnlyLegacyData = (
  data: Record<string, unknown>,
): Record<string, unknown> => {
  const entityIds = (slice: unknown): string[] =>
    ((slice as { ids?: string[] })?.ids ?? []).slice();
  const pick = (slice: unknown, keep: string[]): unknown => {
    const entities = (slice as { entities: Record<string, unknown> }).entities;
    return {
      ids: keep,
      entities: Object.fromEntries(keep.map((id) => [id, entities[id]])),
    };
  };
  const archiveYoung = data.archiveYoung as {
    task: { entities: Record<string, object> };
  };
  return {
    ...data,
    task: { ...(data.task as object), ids: [], entities: {} },
    project: pick(data.project, ['INBOX_PROJECT']),
    tag: pick(data.tag, ['TODAY']),
    archiveYoung: {
      ...archiveYoung,
      task: {
        ids: entityIds(archiveYoung.task),
        entities: Object.fromEntries(
          Object.entries(archiveYoung.task.entities).map(([id, task]) => [
            id,
            { ...task, projectId: 'INBOX_PROJECT', tagIds: [] },
          ]),
        ),
      },
    },
  };
};

/**
 * Seed the legacy 'pf' IndexedDB database with data.
 * Must be called BEFORE the Angular app initializes.
 *
 * @param page - Playwright page (must be on app's origin with JS blocked)
 * @param data - Legacy data to seed (the 'data' property from backup JSON)
 */
export const seedLegacyDatabase = async (
  page: Page,
  data: Record<string, unknown>,
): Promise<void> => {
  await page.evaluate(async (entityData) => {
    return new Promise<void>((resolve, reject) => {
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

        // Store each entity type
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
    });
  }, data);
};

/**
 * Create a client with legacy data that triggers migration on app load.
 *
 * This helper:
 * 1. Creates a fresh browser context
 * 2. Blocks JavaScript to prevent app initialization
 * 3. Seeds the legacy 'pf' database
 * 4. Unblocks JS and reloads to trigger migration
 * 5. Waits for migration to complete (backup file download is the indicator)
 * 6. Returns page ready for sync setup
 *
 * @param browser - Playwright browser instance
 * @param baseURL - App base URL (e.g., http://localhost:4242)
 * @param legacyData - Legacy data to seed (the 'data' property from backup JSON)
 * @param clientName - Human-readable name for debugging (e.g., "A", "B")
 * @param options.seedBeforeBoot - Extra seeding that runs in the same JS-blocked
 *   phase as the legacy database (e.g. `seedSuperSyncCredentials`), before the
 *   reload that triggers the migration.
 */
export const createLegacyMigratedClient = async (
  browser: Browser,
  baseURL: string,
  legacyData: Record<string, unknown>,
  clientName: string,
  options: { seedBeforeBoot?: (page: Page) => Promise<void> } = {},
): Promise<{ context: BrowserContext; page: Page }> => {
  const effectiveBaseURL = baseURL || 'http://localhost:4242';

  const context = await browser.newContext({
    storageState: undefined, // Clean slate - no shared state
    baseURL: effectiveBaseURL,
    acceptDownloads: true, // Required to detect migration backup
    userAgent: `PLAYWRIGHT LEGACY-MIGRATION-CLIENT-${clientName}`,
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();
  await page.addInitScript(skipOnboardingForE2E);

  // pageerror is safe to attach early — it only fires on uncaught JS exceptions,
  // and no JS runs during the seeding phase (we abort all *.js loads below).
  page.on('pageerror', (error) => {
    console.error(`[Legacy Client ${clientName}] Page error:`, error.message);
  });
  installDevErrorDialogHandler(page, `Legacy Client ${clientName}`);

  // Block JS to seed database before app initializes
  await page.route('**/*.js', async (route) => {
    await route.abort();
  });

  // Navigate to the app origin (index.html loads but JS is blocked)
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  console.log(`[Legacy Client ${clientName}] Seeding legacy database...`);

  // Seed the legacy 'pf' database
  await seedLegacyDatabase(page, legacyData);
  console.log(`[Legacy Client ${clientName}] Legacy database seeded`);
  if (options.seedBeforeBoot) {
    await options.seedBeforeBoot(page);
    console.log(`[Legacy Client ${clientName}] Extra pre-boot seed applied`);
  }

  // Unblock JS so app can load
  await page.unroute('**/*.js');

  // Attach console listener only now — attaching earlier would surface the
  // `Failed to load resource: net::ERR_FAILED` errors from the intentional
  // *.js aborts above as spurious `console.error` output.
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error(`[Legacy Client ${clientName}] Console error:`, msg.text());
    } else if (process.env.E2E_VERBOSE) {
      console.log(`[Legacy Client ${clientName}] Console ${msg.type()}:`, msg.text());
    }
  });

  // Set up download listener for migration backup file
  const downloadPromise = page
    .waitForEvent('download', { timeout: 90000 })
    .catch(() => null);

  // Reload to trigger migration
  console.log(`[Legacy Client ${clientName}] Reloading to trigger migration...`);
  await page.reload({ waitUntil: 'domcontentloaded' });

  // Wait for migration backup file (key indicator that migration ran)
  const download = await downloadPromise;
  if (download) {
    expect(download.suggestedFilename()).toContain(MIGRATION_BACKUP_PREFIX);
    console.log(`[Legacy Client ${clientName}] Migration backup downloaded`);
  } else {
    console.warn(
      `[Legacy Client ${clientName}] No migration backup file detected (may have completed very quickly)`,
    );
  }

  // Wait for app to be fully ready
  await waitForAppReady(page);
  console.log(`[Legacy Client ${clientName}] App ready after migration`);

  return { context, page };
};

/**
 * Close a legacy-migrated client and clean up resources.
 * Safely handles already-closed contexts.
 */
export const closeLegacyClient = async (client: {
  context: BrowserContext;
  page: Page;
}): Promise<void> => {
  try {
    if (!client.page.isClosed()) {
      const closePromise = client.context.close();
      const timeoutPromise = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Cleanup timeout')), 5000),
      );
      await Promise.race([closePromise, timeoutPromise]);
    }
  } catch (error) {
    if (error instanceof Error) {
      const ignorableErrors = [
        'Target page, context or browser has been closed',
        'ENOENT',
        'Protocol error',
        'Target.disposeBrowserContext',
        'Failed to find context',
        'Cleanup timeout',
      ];
      const shouldIgnore = ignorableErrors.some((msg) => error.message.includes(msg));
      if (shouldIgnore) {
        console.warn(`[closeLegacyClient] Ignoring cleanup error: ${error.message}`);
      } else {
        throw error;
      }
    }
  }
};
