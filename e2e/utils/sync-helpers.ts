import {
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type APIRequestContext,
} from '@playwright/test';
import { expect } from '@playwright/test';
import { waitForAppReady } from './waits';
import type { SyncPage } from '../pages/sync.page';
import {
  attachPageErrorCollector,
  guardContextCloseWithRuntimeErrorCheck,
  installDevErrorDialogHandler,
} from './runtime-errors';

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
      throw new Error(
        `Failed to create WebDAV folder "${folderName}": ${response.status()} ${response.statusText()}`,
      );
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Error creating WebDAV folder "${folderName}" at ${mkcolUrl}: ${message}`,
    );
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
 * Handles app initialization and auto-accepts fresh client sync confirmations.
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
  const pageErrors = attachPageErrorCollector(page, 'WebDAV sync client');
  installDevErrorDialogHandler(page, 'WebDAV sync client');
  guardContextCloseWithRuntimeErrorCheck(context, pageErrors, 'WebDAV sync client');

  // Skip onboarding, hints, and example tasks before the app boots.
  // This runs before any page JavaScript, so Angular sees the flags immediately.
  await page.addInitScript(() => {
    localStorage.setItem('SUP_ONBOARDING_PRESET_DONE', 'true');
    localStorage.setItem('SUP_ONBOARDING_HINTS_DONE', 'true');
    localStorage.setItem('SUP_IS_SHOW_TOUR', 'true');
    localStorage.setItem('SUP_EXAMPLE_TASKS_CREATED', 'true');
  });

  // Auto-accept only the native confirmation for a genuinely fresh client.
  // This handler lives for the page lifetime, so broad words such as "sync" or
  // "remote" would also authorize later destructive repair/overwrite prompts.
  page.on('dialog', async (dialog) => {
    const message = dialog.message();
    if (
      dialog.type() === 'beforeunload' ||
      message.startsWith('Throw an error for error?') ||
      (dialog.type() === 'alert' && message.startsWith('devERR:'))
    ) {
      return;
    }

    if (dialog.type() === 'confirm') {
      const normalizedMessage = message.replace(/\s+/g, ' ').toLowerCase();
      const isExpectedDialog =
        normalizedMessage.includes('initial sync') &&
        normalizedMessage.includes('fresh installation') &&
        normalizedMessage.includes('remote data') &&
        normalizedMessage.includes('overwrite your local data');

      if (!isExpectedDialog) {
        console.error(`[E2E] Unexpected confirm dialog: "${message}"`);
        await dialog.dismiss();
        throw new Error(
          `Unexpected confirm dialog message: "${message}". ` +
            `Expected fresh client sync confirmation.`,
        );
      }

      console.log(`Auto-accepting confirm dialog: ${message}`);
      await dialog.accept();
      return;
    }

    await dialog.dismiss();
    throw new Error(
      `Unexpected ${dialog.type()} dialog: "${message}". ` +
        'Only the fresh-client confirmation is expected.',
    );
  });

  await page.goto('/');
  await waitForAppReady(page);
  return { context, page };
};

/**
 * @deprecated Use setupSyncClient instead
 */
export const setupClient = setupSyncClient;

type TerminalSyncState =
  | { kind: 'success' }
  | { kind: 'conflict' }
  | { kind: 'error'; message: string }
  | null;

const readTerminalSyncState = async (
  page: Page,
  syncPage: SyncPage,
  allowResponseOnlyCompletion: boolean,
): Promise<TerminalSyncState> => {
  // Error and conflict states can coexist with the old success icon, so they
  // must always win over the success check below.
  if (await syncPage.syncErrorIcon.isVisible().catch(() => false)) {
    return { kind: 'error', message: 'sync_problem icon is visible' };
  }

  const snackBars = page.locator('.mat-mdc-snack-bar-container');
  const snackBarTexts = await snackBars.allInnerTexts().catch(() => []);
  const errorText = snackBarTexts.find((text) =>
    /\b(error|failed?|failure|unable)\b|could not/i.test(text),
  );
  if (errorText) {
    return { kind: 'error', message: errorText };
  }

  const conflictDialog = page.locator('dialog-sync-conflict');
  if (await conflictDialog.isVisible().catch(() => false)) {
    return { kind: 'conflict' };
  }

  const conflictMatDialog = page.locator('mat-dialog-container', {
    hasText: 'Conflicting Data',
  });
  if (await conflictMatDialog.isVisible().catch(() => false)) {
    return { kind: 'conflict' };
  }

  const [spinnerVisible, confirmedIconVisible] = await Promise.all([
    syncPage.syncSpinner.isVisible().catch(() => false),
    syncPage.syncConfirmedIcon.isVisible().catch(() => false),
  ]);
  if (!spinnerVisible && (confirmedIconVisible || allowResponseOnlyCompletion)) {
    return { kind: 'success' };
  }

  return null;
};

/**
 * Waits for a newly-triggered provider request and then a terminal sync state.
 * Throws on error UI or timeout.
 *
 * @param page - Playwright page
 * @param syncPage - SyncPage instance
 * @param timeout - Maximum wait time in ms (default 30000)
 * @param options.allowResponseOnlyCompletion - Require done_all by default. Conflict
 * resolution paths may opt into a stable idle state after the witnessed response
 * because those actions do not expose a reliable terminal icon. Such callers must
 * assert the exact resulting state.
 * @returns 'success' | 'conflict' | void
 */
export const waitForSyncComplete = async (
  page: Page,
  syncPage: SyncPage,
  timeout: number = 30000,
  options: { allowResponseOnlyCompletion?: boolean } = {},
): Promise<'success' | 'conflict' | void> => {
  const startTime = Date.now();
  const allowResponseOnlyCompletion = options.allowResponseOnlyCompletion ?? false;

  // Ensure sync button is visible first
  await expect(syncPage.syncBtn).toBeVisible({ timeout: 10000 });

  const responseTimeout = Math.max(1, timeout - (Date.now() - startTime));
  await syncPage.waitForTriggeredSyncResponse(responseTimeout);

  const terminalTimeout = Math.max(1, timeout - (Date.now() - startTime));
  const terminalState: { value: TerminalSyncState } = { value: null };
  let consecutiveSuccessChecks = 0;

  await expect
    .poll(
      async () => {
        const state = await readTerminalSyncState(
          page,
          syncPage,
          allowResponseOnlyCompletion,
        );
        if (state?.kind === 'success') {
          consecutiveSuccessChecks++;
          terminalState.value =
            consecutiveSuccessChecks >= 3 ? state : terminalState.value;
        } else {
          consecutiveSuccessChecks = 0;
          terminalState.value = state;
        }
        return terminalState.value?.kind ?? 'pending';
      },
      {
        timeout: terminalTimeout,
        message: 'Expected sync to reach a terminal success, conflict, or error state',
      },
    )
    .not.toBe('pending');

  const state = terminalState.value;
  if (!state) {
    throw new Error(`Sync timeout after ${timeout}ms: no terminal state appeared`);
  }
  if (state.kind === 'error') {
    syncPage.completeTriggeredSyncCycle();
    throw new Error(`Sync failed with error: ${state.message}`);
  }
  if (state.kind === 'conflict') {
    syncPage.completeTriggeredSyncCycle();
    return 'conflict';
  }

  syncPage.completeTriggeredSyncCycle();
  return 'success';
};

/**
 * @deprecated Use waitForSyncComplete instead
 */
export const waitForSync = async (
  page: Page,
  syncPage: SyncPage,
): Promise<'success' | 'conflict' | void> => waitForSyncComplete(page, syncPage);

/**
 * Completes the optional overwrite-warning step of the ordinary sync conflict
 * dialog. The warning is conditional on the measured change counts, so wait
 * for either that exact dialog or the parent conflict dialog closing instead
 * of probing for a fixed delay and silently swallowing the result.
 */
export const confirmSyncConflictOverwriteIfShown = async (
  page: Page,
  conflictDialog: Locator,
): Promise<void> => {
  const overwriteConfirm = page
    .locator('dialog-confirm')
    .filter({ hasText: /WARNING:[\s\S]*overwrit/i });

  await expect
    .poll(
      async () => {
        if (await overwriteConfirm.isVisible().catch(() => false)) {
          return 'confirm';
        }
        if (!(await conflictDialog.isVisible().catch(() => false))) {
          return 'closed';
        }
        return 'pending';
      },
      {
        timeout: 5000,
        message: 'Expected the sync conflict to close or show its overwrite warning',
      },
    )
    .not.toBe('pending');

  if (await overwriteConfirm.isVisible().catch(() => false)) {
    await overwriteConfirm.locator('[e2e="confirmBtn"]').click();
  }
  await expect(conflictDialog).toBeHidden({ timeout: 5000 });
};

/**
 * Waits for archive operations to complete and persist.
 * Archive operations (finish day, archive task) involve async IndexedDB writes
 * that may not complete immediately. This helper ensures state is stable before proceeding.
 *
 * @param page - Playwright page instance
 * @param waitMs - Time to wait in milliseconds (default: 1000ms)
 */
export const waitForArchivePersistence = async (
  page: Page,
  waitMs: number = 1000,
): Promise<void> => {
  // Wait for IndexedDB operations to complete
  await page.waitForTimeout(waitMs);

  // Additional check: wait for any pending micro-tasks/animations
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
};

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

/**
 * Safely close multiple browser contexts with proper error handling
 * for Playwright trace file race conditions.
 *
 * When tests pass on retry with `trace: 'retain-on-failure'`, trace files
 * may still be writing asynchronously while context disposal happens synchronously.
 * This causes ENOENT errors that fail otherwise-passing tests.
 *
 * @param contexts - Browser contexts to close (null/undefined values are ignored)
 */
export const closeContextsSafely = async (
  ...contexts: (BrowserContext | null | undefined)[]
): Promise<void> => {
  for (const context of contexts) {
    if (!context) continue;
    try {
      await context.close();
    } catch (error) {
      if (error instanceof Error) {
        const ignorableErrors = [
          'ENOENT',
          'Target page, context or browser has been closed',
          'Protocol error',
          'End of central directory record',
        ];
        if (!ignorableErrors.some((msg) => error.message.includes(msg))) {
          throw error;
        }
        // Silently ignore trace-related cleanup errors
      }
    }
  }
};
