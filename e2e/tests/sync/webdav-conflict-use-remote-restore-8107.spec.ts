import { test, expect } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import { waitForStatePersistence, waitForAppReady } from '../../utils/waits';
import {
  WEBDAV_CONFIG_TEMPLATE,
  setupSyncClient,
  createSyncFolder,
  waitForSyncComplete,
  generateSyncFolderName,
  closeContextsSafely,
} from '../../utils/sync-helpers';

/**
 * Regression test for #8107.
 *
 * Resolving a sync conflict with "Use Server Data" (USE_REMOTE) replaces ALL
 * local state with the server snapshot via forceDownloadRemoteState(). Before
 * the fix this was irreversible — local-only data was permanently lost.
 *
 * The fix captures a pre-wipe snapshot and offers an "Undo" snack that restores
 * it. This test reproduces the loss (Client B's local task is wiped by
 * USE_REMOTE) and verifies recovery: the Undo snack appears and restores the
 * local task.
 *
 * Run with:
 *   npm run e2e:webdav:file e2e/tests/sync/webdav-conflict-use-remote-restore-8107.spec.ts
 */
test.describe('@webdav WebDAV USE_REMOTE pre-replace backup (#8107)', () => {
  test.describe.configure({ mode: 'serial' });

  test('should offer Undo after USE_REMOTE wipes local data and restore it', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow();
    const SYNC_FOLDER_NAME = generateSyncFolderName('e2e-use-remote-restore-8107');
    await createSyncFolder(request, SYNC_FOLDER_NAME);
    const WEBDAV_CONFIG = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${SYNC_FOLDER_NAME}`,
    };
    const url = baseURL || 'http://localhost:4242';

    // --- Client A: create a task and upload it to the server ---
    const { context: contextA, page: pageA } = await setupSyncClient(browser, url);
    const syncPageA = new SyncPage(pageA);
    const workViewPageA = new WorkViewPage(pageA);
    await workViewPageA.waitForTaskList();
    await syncPageA.setupWebdavSync(WEBDAV_CONFIG);

    const taskA = 'Server Task A - ' + Date.now();
    await workViewPageA.addTask(taskA);
    await waitForStatePersistence(pageA);
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log('[Test] Client A uploaded server task');

    // --- Client B: create a local task, then connect → conflict ---
    const contextB = await browser.newContext({ baseURL: url });
    const pageB = await contextB.newPage();
    // Auto-dismiss native window.confirm; we drive the mat-dialog + snack instead.
    pageB.on('dialog', async (dialog) => {
      if (dialog.type() === 'confirm') {
        await dialog.dismiss();
      }
    });
    await pageB.goto('/');
    await waitForAppReady(pageB);

    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);
    await workViewPageB.waitForTaskList();

    const localTaskB = 'Local Task B - ' + Date.now();
    await workViewPageB.addTask(localTaskB);
    await waitForStatePersistence(pageB);
    console.log('[Test] Client B created local task');

    await syncPageB.setupWebdavSync(WEBDAV_CONFIG);

    // Conflict dialog → choose "Keep remote" (USE_REMOTE).
    const conflictDialog = pageB.locator('mat-dialog-container', {
      hasText: 'Conflicting Data',
    });
    await expect(conflictDialog).toBeVisible({ timeout: 30000 });
    const useRemoteBtn = conflictDialog.locator('button', { hasText: /Keep remote/i });
    await expect(useRemoteBtn).toBeVisible();
    await useRemoteBtn.click();
    console.log('[Test] Clicked Keep remote (USE_REMOTE)');

    // Optional overwrite-confirmation dialog (only shown for large change-count diffs).
    const confirmDialog = pageB.locator('dialog-confirm');
    try {
      await confirmDialog.waitFor({ state: 'visible', timeout: 3000 });
      await confirmDialog
        .locator('button[color="warn"], button:has-text("OK")')
        .first()
        .click();
    } catch {
      // No confirmation for a single-task diff.
    }

    // The Undo snack appears once forceDownloadRemoteState() completes the replace.
    const undoSnack = pageB.locator('snack-custom', {
      hasText: /replaced with the server/i,
    });
    await expect(undoSnack).toBeVisible({ timeout: 30000 });
    console.log('[Test] Undo snack shown after USE_REMOTE replace');

    // Data loss reproduced: server task present, local task wiped.
    await expect(pageB.locator('task', { hasText: taskA })).toBeVisible({
      timeout: 10000,
    });
    await expect(pageB.locator('task', { hasText: localTaskB })).not.toBeVisible();
    console.log('[Test] Verified local task was wiped by USE_REMOTE');

    // Click "Undo" → restores the snapshot captured before the replace.
    await undoSnack.locator('button.action').click();
    console.log('[Test] Clicked Undo');

    // Recovery: Client B's original local task is restored from the pre-replace
    // snapshot. (We don't also assert the server task disappears — that's
    // correct-by-design but timing-sensitive to a follow-up auto-sync.)
    await expect(pageB.locator('task', { hasText: localTaskB })).toBeVisible({
      timeout: 15000,
    });
    console.log('[Test] Verified local task restored via Undo');

    await closeContextsSafely(contextA, contextB);
  });
});
