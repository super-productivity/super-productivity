import {
  type Browser,
  type BrowserContext,
  type Page,
  type APIRequestContext,
} from '@playwright/test';
import { expect } from '@playwright/test';
import { waitForAppReady } from './waits';
import { dismissTourIfVisible } from './tour-helpers';
import type { SyncPage } from '../pages/sync.page';

// Re-export tour helper for convenience
export { dismissTourIfVisible };

/**
 * WebDAV configuration interface
 */
export interface WebDavConfig {
  baseUrl: string;
  username: string;
  password: string;
  syncFolderPath: string;
}

/**
 * Default WebDAV configuration template for sync tests
 */
export const WEBDAV_CONFIG_TEMPLATE = {
  baseUrl: 'http://127.0.0.1:2345/',
  username: 'admin',
  password: 'admin',
};

/**
 * Generates a unique sync folder name for test isolation.
 * @param prefix - Folder name prefix (default: 'e2e-test')
 * @returns Unique folder name with timestamp
 */
export const generateSyncFolderName = (prefix: string = 'e2e-test'): string => {
  return `${prefix}-${Date.now()}`;
};

/**
 * @deprecated Use generateSyncFolderName instead
 */
export const createUniqueSyncFolder = generateSyncFolderName;

/**
 * Creates a WebDAV folder on the server via MKCOL request.
 * Used to set up sync folder before tests.
 *
 * @param request - Playwright APIRequestContext
 * @param folderName - Name of the folder to create
 * @param baseUrl - WebDAV server base URL (default: from WEBDAV_CONFIG_TEMPLATE)
 */
export const createSyncFolder = async (
  request: APIRequestContext,
  folderName: string,
  baseUrl: string = WEBDAV_CONFIG_TEMPLATE.baseUrl,
): Promise<void> => {
  const mkcolUrl = `${baseUrl}${folderName}`;
  console.log(`Creating WebDAV folder: ${mkcolUrl}`);
  try {
    const response = await request.fetch(mkcolUrl, {
      method: 'MKCOL',
      headers: {
        Authorization:
          'Basic ' +
          Buffer.from(
            `${WEBDAV_CONFIG_TEMPLATE.username}:${WEBDAV_CONFIG_TEMPLATE.password}`,
          ).toString('base64'),
      },
    });
    if (!response.ok() && response.status() !== 405) {
      console.warn(
        `Failed to create WebDAV folder: ${response.status()} ${response.statusText()}`,
      );
    }
  } catch (e) {
    console.warn('Error creating WebDAV folder:', e);
  }
};

/**
 * @deprecated Use createSyncFolder instead
 */
export const createWebDavFolder = async (
  request: APIRequestContext,
  folderName: string,
): Promise<void> => createSyncFolder(request, folderName);

/**
 * Creates a new browser context and page for sync testing.
 * Handles app initialization and tour dismissal.
 *
 * @param browser - Playwright Browser instance
 * @param baseURL - Base URL for the app
 * @returns Object with context and page
 */
export const setupSyncClient = async (
  browser: Browser,
  baseURL: string | undefined,
): Promise<{ context: BrowserContext; page: Page }> => {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.goto('/');
  await waitForAppReady(page);
  await dismissTourIfVisible(page);
  return { context, page };
};

/**
 * @deprecated Use setupSyncClient instead
 */
export const setupClient = setupSyncClient;

/**
 * Waits for sync to complete by polling for success icon or conflict dialog.
 * Throws on error snackbar or timeout.
 *
 * @param page - Playwright page
 * @param syncPage - SyncPage instance
 * @param timeout - Maximum wait time in ms (default 30000)
 * @returns 'success' | 'conflict' | void
 */
export const waitForSyncComplete = async (
  page: Page,
  syncPage: SyncPage,
  timeout: number = 30000,
): Promise<'success' | 'conflict' | void> => {
  const startTime = Date.now();

  // Ensure sync button is visible first
  await expect(syncPage.syncBtn).toBeVisible({ timeout: 10000 });

  while (Date.now() - startTime < timeout) {
    const successVisible = await syncPage.syncCheckIcon.isVisible();
    if (successVisible) return 'success';

    const conflictDialog = page.locator('dialog-sync-conflict');
    if (await conflictDialog.isVisible()) return 'conflict';

    const snackBars = page.locator('.mat-mdc-snack-bar-container');
    const count = await snackBars.count();
    for (let i = 0; i < count; ++i) {
      const text = await snackBars.nth(i).innerText();
      if (text.toLowerCase().includes('error') || text.toLowerCase().includes('fail')) {
        throw new Error(`Sync failed with error: ${text}`);
      }
    }

    await page.waitForTimeout(500);
  }

  throw new Error(`Sync timeout after ${timeout}ms: Success icon did not appear`);
};

/**
 * @deprecated Use waitForSyncComplete instead
 */
export const waitForSync = async (
  page: Page,
  syncPage: SyncPage,
): Promise<'success' | 'conflict' | void> => waitForSyncComplete(page, syncPage);

/**
 * Simulates network failure by aborting all WebDAV requests.
 * Useful for testing offline/error scenarios.
 */
export const simulateNetworkFailure = async (page: Page): Promise<void> => {
  await page.route('**/127.0.0.1:2345/**', (route) => route.abort('connectionfailed'));
};

/**
 * Restores network by removing WebDAV request interception.
 */
export const restoreNetwork = async (page: Page): Promise<void> => {
  await page.unroute('**/127.0.0.1:2345/**');
};
