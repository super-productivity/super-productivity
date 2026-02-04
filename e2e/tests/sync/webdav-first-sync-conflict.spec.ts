import { test, expect } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import { waitForStatePersistence } from '../../utils/waits';
import {
  WEBDAV_CONFIG_TEMPLATE,
  setupSyncClient,
  createSyncFolder,
  waitForSyncComplete,
  generateSyncFolderName,
  dismissTourIfVisible,
  closeContextsSafely,
} from '../../utils/sync-helpers';
import { waitForAppReady } from '../../utils/waits';

/**
 * Tests for first sync conflict when both clients have existing data.
 *
 * Scenario:
 * 1. Client A has data, sets up WebDAV sync → uploads data
 * 2. Client B has DIFFERENT data, sets up WebDAV sync to same folder
 * 3. Expected: Conflict dialog with "Use Local" vs "Use Remote" options
 */
test.describe('@webdav WebDAV First Sync Conflict', () => {
  test.describe.configure({ mode: 'serial' });

  test('should show conflict dialog and allow USE_LOCAL to upload local data', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow();
    const SYNC_FOLDER_NAME = generateSyncFolderName('e2e-first-conflict-local');
    await createSyncFolder(request, SYNC_FOLDER_NAME);
    const WEBDAV_CONFIG = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${SYNC_FOLDER_NAME}`,
    };
    const url = baseURL || 'http://localhost:4242';

    // --- Client A: Create task and upload ---
    const { context: contextA, page: pageA } = await setupSyncClient(browser, url);

    // Capture console logs from Client A for debugging
    pageA.on('console', (msg) => {
      if (msg.text().includes('DEBUG')) {
        console.log(`[Client A Console] ${msg.text()}`);
      }
    });

    const syncPageA = new SyncPage(pageA);
    const workViewPageA = new WorkViewPage(pageA);
    await workViewPageA.waitForTaskList();

    // Setup sync and create task
    await syncPageA.setupWebdavSync(WEBDAV_CONFIG);
    const taskA = 'Task from Client A - ' + Date.now();
    await workViewPageA.addTask(taskA);
    await waitForStatePersistence(pageA);

    // Upload to remote
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log('[Test] Client A uploaded task');

    // --- Client B: Create local task BEFORE setting up sync ---
    // IMPORTANT: Do NOT use setupSyncClient - we need to NOT auto-accept dialogs
    const contextB = await browser.newContext({ baseURL: url });
    const pageB = await contextB.newPage();

    // Capture console logs from Client B for debugging
    pageB.on('console', (msg) => {
      if (msg.text().includes('DEBUG') || msg.text().includes('Marked')) {
        console.log(`[Client B Console] ${msg.text()}`);
      }
    });

    // Don't add dialog handler here - we want the conflict dialog to appear

    await pageB.goto('/');
    await waitForAppReady(pageB);
    await dismissTourIfVisible(pageB);

    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);
    await workViewPageB.waitForTaskList();

    // Create a local task BEFORE setting up sync
    const taskB = 'Task from Client B - ' + Date.now();
    await workViewPageB.addTask(taskB);
    await waitForStatePersistence(pageB);
    console.log('[Test] Client B created local task');

    // Now setup sync - this triggers auto-sync which should show conflict dialog
    await syncPageB.setupWebdavSync(WEBDAV_CONFIG);
    console.log('[Test] Client B set up sync, waiting for conflict dialog...');

    // Wait for conflict dialog to appear (auto-sync triggers after save)
    // The dialog contains "Sync: Conflicting Data" title and "Keep local"/"Keep remote" buttons
    const conflictDialog = pageB.locator('mat-dialog-container', {
      hasText: 'Conflicting Data',
    });
    await expect(conflictDialog).toBeVisible({ timeout: 30000 });
    console.log('[Test] Conflict dialog appeared on Client B');

    // Click "Keep local" button
    const useLocalBtn = conflictDialog.locator('button', { hasText: /Keep local/i });
    await expect(useLocalBtn).toBeVisible();
    await useLocalBtn.click();
    console.log('[Test] Clicked Use Local on Client B');

    // Handle potential confirmation dialog (for overwrites with many changes)
    const confirmDialog = pageB.locator('dialog-confirm');
    try {
      await confirmDialog.waitFor({ state: 'visible', timeout: 3000 });
      // Click the confirm/OK button
      await confirmDialog
        .locator('button[color="warn"], button:has-text("OK")')
        .first()
        .click();
    } catch {
      // Confirmation might not appear - that's fine
    }

    // Wait for sync to complete
    await waitForSyncComplete(pageB, syncPageB, 30000);
    console.log('[Test] Sync completed on Client B');

    // Verify Client B still has its local task
    await expect(pageB.locator('task', { hasText: taskB })).toBeVisible({
      timeout: 5000,
    });
    // Client A's task should NOT be visible (we chose USE_LOCAL, which replaced remote)
    await expect(pageB.locator('task', { hasText: taskA })).not.toBeVisible();
    console.log('[Test] Verified Client B has local task, not remote task');

    // --- Verify Client A now gets Client B's data ---
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log('[Test] Client A synced');

    // Client A should now have Client B's task (remote was replaced by B's local data)
    await expect(pageA.locator('task', { hasText: taskB })).toBeVisible({
      timeout: 5000,
    });
    // Client A's original task is gone (replaced by B's upload)
    await expect(pageA.locator('task', { hasText: taskA })).not.toBeVisible();
    console.log('[Test] Verified Client A received Client B data');

    await closeContextsSafely(contextA, contextB);
  });

  test('should show conflict dialog and allow USE_REMOTE to download remote data', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow();
    const SYNC_FOLDER_NAME = generateSyncFolderName('e2e-first-conflict-remote');
    await createSyncFolder(request, SYNC_FOLDER_NAME);
    const WEBDAV_CONFIG = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${SYNC_FOLDER_NAME}`,
    };
    const url = baseURL || 'http://localhost:4242';

    // --- Client A: Create task and upload ---
    const { context: contextA, page: pageA } = await setupSyncClient(browser, url);
    const syncPageA = new SyncPage(pageA);
    const workViewPageA = new WorkViewPage(pageA);
    await workViewPageA.waitForTaskList();

    await syncPageA.setupWebdavSync(WEBDAV_CONFIG);
    const taskA = 'Task from Client A - ' + Date.now();
    await workViewPageA.addTask(taskA);
    await waitForStatePersistence(pageA);
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log('[Test] Client A uploaded task');

    // --- Client B: Create local task, then connect ---
    const contextB = await browser.newContext({ baseURL: url });
    const pageB = await contextB.newPage();

    // Reject any window.confirm dialogs so they don't block the page
    // (we're testing the mat-dialog conflict, not window.confirm)
    pageB.on('dialog', async (dialog) => {
      if (dialog.type() === 'confirm') {
        console.log(
          `[Test] Client B auto-dismissing confirm dialog: ${dialog.message()}`,
        );
        await dialog.dismiss();
      }
    });

    await pageB.goto('/');
    await waitForAppReady(pageB);
    await dismissTourIfVisible(pageB);

    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);
    await workViewPageB.waitForTaskList();

    const taskB = 'Task from Client B - ' + Date.now();
    await workViewPageB.addTask(taskB);
    await waitForStatePersistence(pageB);
    console.log('[Test] Client B created local task');

    await syncPageB.setupWebdavSync(WEBDAV_CONFIG);
    console.log('[Test] Client B set up sync, waiting for conflict dialog...');

    // Wait for conflict dialog (auto-sync triggers after save)
    const conflictDialog = pageB.locator('mat-dialog-container', {
      hasText: 'Conflicting Data',
    });
    await expect(conflictDialog).toBeVisible({ timeout: 30000 });
    console.log('[Test] Conflict dialog appeared');

    // Click "Keep remote" button
    const useRemoteBtn = conflictDialog.locator('button', { hasText: /Keep remote/i });
    await expect(useRemoteBtn).toBeVisible();
    await useRemoteBtn.click();
    console.log('[Test] Clicked Use Remote');

    // Handle potential confirmation dialog
    const confirmDialog = pageB.locator('dialog-confirm');
    try {
      await confirmDialog.waitFor({ state: 'visible', timeout: 3000 });
      await confirmDialog
        .locator('button[color="warn"], button:has-text("OK")')
        .first()
        .click();
    } catch {
      // Confirmation might not appear
    }

    await waitForSyncComplete(pageB, syncPageB, 30000);
    console.log('[Test] Sync completed');

    // Verify Client B now has remote data (Client A's task)
    await expect(pageB.locator('task', { hasText: taskA })).toBeVisible({
      timeout: 10000,
    });
    // Client B's local task should be gone
    await expect(pageB.locator('task', { hasText: taskB })).not.toBeVisible();
    console.log('[Test] Verified Client B has remote task, not local task');

    await closeContextsSafely(contextA, contextB);
  });

  /**
   * Regression test for: Repeated conflict dialog after USE_LOCAL resolution
   *
   * Bug: After resolving first sync conflict with "Keep local", every subsequent
   * change would trigger the conflict dialog again.
   *
   * Root cause: After snapshot upload, serverSeq was incorrectly set to 0 instead
   * of syncVersion (1). This caused the next download to use sinceSeq=0, which
   * returned snapshotState, triggering LocalDataConflictError.
   *
   * Fix: file-based-sync-adapter.service.ts now returns serverSeq: newSyncVersion
   * after snapshot upload.
   */
  test('should NOT show conflict dialog on subsequent changes after USE_LOCAL resolution', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow();
    const SYNC_FOLDER_NAME = generateSyncFolderName('e2e-no-repeat-conflict');
    await createSyncFolder(request, SYNC_FOLDER_NAME);
    const WEBDAV_CONFIG = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${SYNC_FOLDER_NAME}`,
    };
    const url = baseURL || 'http://localhost:4242';

    // --- Client A: Create task and upload ---
    const { context: contextA, page: pageA } = await setupSyncClient(browser, url);
    const syncPageA = new SyncPage(pageA);
    const workViewPageA = new WorkViewPage(pageA);
    await workViewPageA.waitForTaskList();

    await syncPageA.setupWebdavSync(WEBDAV_CONFIG);
    const taskA = 'Initial Task from A - ' + Date.now();
    await workViewPageA.addTask(taskA);
    await waitForStatePersistence(pageA);
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log('[Test] Client A uploaded initial task');

    // --- Client B: Create local task, connect, and resolve conflict ---
    const contextB = await browser.newContext({ baseURL: url });
    const pageB = await contextB.newPage();

    await pageB.goto('/');
    await waitForAppReady(pageB);
    await dismissTourIfVisible(pageB);

    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);
    await workViewPageB.waitForTaskList();

    const taskB = 'Local Task from B - ' + Date.now();
    await workViewPageB.addTask(taskB);
    await waitForStatePersistence(pageB);
    console.log('[Test] Client B created local task');

    // Setup sync - triggers conflict
    await syncPageB.setupWebdavSync(WEBDAV_CONFIG);
    console.log('[Test] Client B set up sync, waiting for conflict dialog...');

    // Wait for conflict dialog and resolve with USE_LOCAL
    const conflictDialog = pageB.locator('mat-dialog-container', {
      hasText: 'Conflicting Data',
    });
    await expect(conflictDialog).toBeVisible({ timeout: 30000 });
    console.log('[Test] First conflict dialog appeared');

    const useLocalBtn = conflictDialog.locator('button', { hasText: /Keep local/i });
    await useLocalBtn.click();
    console.log('[Test] Clicked Use Local');

    // Handle potential confirmation dialog
    const confirmDialog = pageB.locator('dialog-confirm');
    try {
      await confirmDialog.waitFor({ state: 'visible', timeout: 3000 });
      await confirmDialog
        .locator('button[color="warn"], button:has-text("OK")')
        .first()
        .click();
    } catch {
      // Confirmation might not appear
    }

    await waitForSyncComplete(pageB, syncPageB, 30000);
    console.log('[Test] First sync completed after conflict resolution');

    // Verify Client B has its local task
    await expect(pageB.locator('task', { hasText: taskB })).toBeVisible();
    console.log('[Test] Verified local task is present');

    // --- KEY TEST: Create ANOTHER task and sync ---
    // This is where the bug manifested: every change would trigger conflict dialog again
    const taskB2 = 'Second Task from B - ' + Date.now();
    await workViewPageB.addTask(taskB2);
    await waitForStatePersistence(pageB);
    console.log('[Test] Created second task');

    // Trigger sync - should NOT show conflict dialog
    await syncPageB.triggerSync();

    // Wait a moment for potential conflict dialog (should NOT appear)
    const conflictDialogSecond = pageB.locator('mat-dialog-container', {
      hasText: 'Conflicting Data',
    });

    // Give it a short window to potentially appear (it shouldn't)
    await pageB.waitForTimeout(2000);

    // Verify conflict dialog did NOT appear
    const isConflictVisible = await conflictDialogSecond.isVisible();
    expect(isConflictVisible).toBe(false);
    console.log('[Test] Verified NO conflict dialog on second sync');

    // Wait for sync to complete normally
    await waitForSyncComplete(pageB, syncPageB, 30000);
    console.log('[Test] Second sync completed without conflict');

    // Verify both tasks are present on Client B
    await expect(pageB.locator('task', { hasText: taskB })).toBeVisible();
    await expect(pageB.locator('task', { hasText: taskB2 })).toBeVisible();
    console.log('[Test] Verified both tasks are present on Client B');

    // Note: We don't verify Client A receives the data here because that's
    // testing sync propagation, not the conflict dialog regression.
    // The key assertion is that NO conflict dialog appeared on the second sync.

    await closeContextsSafely(contextA, contextB);
  });

  /**
   * Test for gap detection when another client uploads a snapshot replacement.
   *
   * This tests the scenario from unit tests:
   * - "should detect snapshot replacement when recentOps is empty"
   * - "should detect gap when syncVersion resets"
   *
   * Scenario:
   * 1. Client A sets up sync, creates task, uploads
   * 2. Client B sets up sync (no local data), downloads A's data - becomes synced client
   * 3. Client B creates a local task (not yet synced)
   * 4. Client C connects with its own local data → conflict → chooses USE_LOCAL → uploads snapshot
   * 5. Client B syncs → should detect gap (snapshot replacement) → shows conflict dialog
   *
   * This verifies that an ALREADY SYNCING client correctly detects when another
   * client has replaced all data with a snapshot, potentially causing data loss
   * for Client B's unsynced changes.
   */
  test('should show conflict dialog when another client uploads snapshot replacement', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow();
    const SYNC_FOLDER_NAME = generateSyncFolderName('e2e-snapshot-replacement');
    await createSyncFolder(request, SYNC_FOLDER_NAME);
    const WEBDAV_CONFIG = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${SYNC_FOLDER_NAME}`,
    };
    const url = baseURL || 'http://localhost:4242';

    // --- Client A: Create initial data and upload ---
    const { context: contextA, page: pageA } = await setupSyncClient(browser, url);
    const syncPageA = new SyncPage(pageA);
    const workViewPageA = new WorkViewPage(pageA);
    await workViewPageA.waitForTaskList();

    await syncPageA.setupWebdavSync(WEBDAV_CONFIG);
    const taskA = 'Initial Task from A - ' + Date.now();
    await workViewPageA.addTask(taskA);
    await waitForStatePersistence(pageA);
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log('[Test] Client A uploaded initial task');

    // --- Client B: Connect WITHOUT local data (no conflict), becomes synced client ---
    const { context: contextB, page: pageB } = await setupSyncClient(browser, url);
    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);
    await workViewPageB.waitForTaskList();

    // Setup sync - should download A's data without conflict (no local data)
    await syncPageB.setupWebdavSync(WEBDAV_CONFIG);
    await waitForSyncComplete(pageB, syncPageB, 30000);
    console.log('[Test] Client B connected and downloaded A data (no conflict)');

    // Verify Client B has A's task
    await expect(pageB.locator('task', { hasText: taskA })).toBeVisible({
      timeout: 5000,
    });
    console.log('[Test] Client B verified it has A task');

    // --- Client B creates a local task (NOT synced yet) ---
    const taskB = 'Unsynced Task from B - ' + Date.now();
    await workViewPageB.addTask(taskB);
    await waitForStatePersistence(pageB);
    console.log('[Test] Client B created local task (not synced)');

    // --- Client C: Connect with its own local data → conflict → USE_LOCAL ---
    // This simulates another client uploading a snapshot that replaces all data
    const contextC = await browser.newContext({ baseURL: url });
    const pageC = await contextC.newPage();

    await pageC.goto('/');
    await waitForAppReady(pageC);
    await dismissTourIfVisible(pageC);

    const syncPageC = new SyncPage(pageC);
    const workViewPageC = new WorkViewPage(pageC);
    await workViewPageC.waitForTaskList();

    // Create local task BEFORE setting up sync
    const taskC = 'Replacement Task from C - ' + Date.now();
    await workViewPageC.addTask(taskC);
    await waitForStatePersistence(pageC);
    console.log('[Test] Client C created local task');

    // Setup sync - triggers conflict with remote data
    await syncPageC.setupWebdavSync(WEBDAV_CONFIG);
    console.log('[Test] Client C set up sync, waiting for conflict dialog...');

    // Wait for conflict dialog and resolve with USE_LOCAL (uploads snapshot)
    const conflictDialogC = pageC.locator('mat-dialog-container', {
      hasText: 'Conflicting Data',
    });
    await expect(conflictDialogC).toBeVisible({ timeout: 30000 });
    console.log('[Test] Client C conflict dialog appeared');

    const useLocalBtnC = conflictDialogC.locator('button', { hasText: /Keep local/i });
    await useLocalBtnC.click();
    console.log('[Test] Client C clicked Use Local (uploads snapshot)');

    // Handle potential confirmation dialog
    const confirmDialogC = pageC.locator('dialog-confirm');
    try {
      await confirmDialogC.waitFor({ state: 'visible', timeout: 3000 });
      await confirmDialogC
        .locator('button[color="warn"], button:has-text("OK")')
        .first()
        .click();
    } catch {
      // Confirmation might not appear
    }

    await waitForSyncComplete(pageC, syncPageC, 30000);
    console.log('[Test] Client C sync completed (snapshot uploaded)');

    // --- KEY TEST: Client B syncs and should detect gap/snapshot replacement ---
    // Client B has unsynced local changes (taskB) and the remote data was replaced
    // by Client C's snapshot. Client B should detect this gap and show conflict dialog.
    await syncPageB.triggerSync();
    console.log('[Test] Client B triggered sync, waiting for conflict dialog...');

    // Wait for conflict dialog on Client B
    const conflictDialogB = pageB.locator('mat-dialog-container', {
      hasText: 'Conflicting Data',
    });
    await expect(conflictDialogB).toBeVisible({ timeout: 30000 });
    console.log(
      '[Test] SUCCESS: Client B detected snapshot replacement and showed conflict dialog',
    );

    // Resolve with USE_LOCAL to keep B's data
    const useLocalBtnB = conflictDialogB.locator('button', { hasText: /Keep local/i });
    await useLocalBtnB.click();

    // Handle potential confirmation dialog
    const confirmDialogB = pageB.locator('dialog-confirm');
    try {
      await confirmDialogB.waitFor({ state: 'visible', timeout: 3000 });
      await confirmDialogB
        .locator('button[color="warn"], button:has-text("OK")')
        .first()
        .click();
    } catch {
      // Confirmation might not appear
    }

    await waitForSyncComplete(pageB, syncPageB, 30000);
    console.log('[Test] Client B resolved conflict');

    // Verify Client B kept its local task
    await expect(pageB.locator('task', { hasText: taskB })).toBeVisible({
      timeout: 5000,
    });
    console.log('[Test] Verified Client B kept its local task');

    await closeContextsSafely(contextA, contextB, contextC);
  });
});
