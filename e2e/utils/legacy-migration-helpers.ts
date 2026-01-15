import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { waitForAppReady } from './waits';
import { dismissTourIfVisible } from './sync-helpers';

/**
 * Legacy Migration E2E Test Helpers
 *
 * These helpers facilitate testing scenarios where clients have migrated
 * from the old Super Productivity format (pre-operation-log) and then sync.
 */

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
 */
export const createLegacyMigratedClient = async (
  browser: Browser,
  baseURL: string,
  legacyData: Record<string, unknown>,
  clientName: string,
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

  // Set up error logging
  page.on('pageerror', (error) => {
    console.error(`[Legacy Client ${clientName}] Page error:`, error.message);
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error(`[Legacy Client ${clientName}] Console error:`, msg.text());
    } else if (process.env.E2E_VERBOSE) {
      console.log(`[Legacy Client ${clientName}] Console ${msg.type()}:`, msg.text());
    }
  });

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

  // Unblock JS so app can load
  await page.unroute('**/*.js');

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
    expect(download.suggestedFilename()).toContain('sp-pre-migration-backup');
    console.log(`[Legacy Client ${clientName}] Migration backup downloaded`);
  } else {
    console.warn(
      `[Legacy Client ${clientName}] No migration backup file detected (may have completed very quickly)`,
    );
  }

  // Wait for app to be fully ready
  await waitForAppReady(page);
  await dismissTourIfVisible(page);
  console.log(`[Legacy Client ${clientName}] App ready after migration`);

  return { context, page };
};

/**
 * Create a legacy-migrated client without auto-accepting dialogs.
 * Use this when you need to interact with conflict dialogs manually.
 *
 * @param browser - Playwright browser instance
 * @param baseURL - App base URL
 * @param legacyData - Legacy data to seed
 * @param clientName - Human-readable name for debugging
 */
export const createLegacyMigratedClientNoDialogHandler = async (
  browser: Browser,
  baseURL: string,
  legacyData: Record<string, unknown>,
  clientName: string,
): Promise<{ context: BrowserContext; page: Page }> => {
  // Same as createLegacyMigratedClient but doesn't add dialog handlers
  // This is useful for conflict tests where we need to observe dialogs
  return createLegacyMigratedClient(browser, baseURL, legacyData, clientName);
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
