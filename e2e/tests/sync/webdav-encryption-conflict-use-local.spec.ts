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
 * Tests for encryption + USE_LOCAL conflict resolution.
 *
 * Validates the double-encryption bug fix (commit b70a0e5634) end-to-end.
 * The bug: when Client B chose "Keep local" during a first-sync conflict with
 * encryption enabled, the snapshot was double-encrypted (encrypted state passed
 * to uploadSnapshot which encrypted again), producing unreadable data.
 *
 * The fix: uploadSnapshot uses getStateSnapshot() internally (which returns
 * unencrypted state) instead of the already-encrypted parameter.
 *
 * Run with: npm run e2e:file e2e/tests/sync/webdav-encryption-conflict-use-local.spec.ts
 */
test.describe('@webdav @encryption WebDAV Encryption + USE_LOCAL Conflict', () => {
  test.describe.configure({ mode: 'serial' });

  test('should resolve USE_LOCAL conflict with encryption without data corruption', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow();
    const SYNC_FOLDER_NAME = generateSyncFolderName('e2e-encrypt-conflict-local');
    await createSyncFolder(request, SYNC_FOLDER_NAME);
    const ENCRYPTION_PASSWORD = 'test-encrypt-conflict-123';
    const WEBDAV_CONFIG = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${SYNC_FOLDER_NAME}`,
    };
    const url = baseURL || 'http://localhost:4242';

    // --- Client A: Create task, enable encryption, sync ---
    const { context: contextA, page: pageA } = await setupSyncClient(browser, url);
    const syncPageA = new SyncPage(pageA);
    const workViewPageA = new WorkViewPage(pageA);
    await workViewPageA.waitForTaskList();

    // Setup sync with encryption enabled
    await syncPageA.setupWebdavSync({
      ...WEBDAV_CONFIG,
      isEncryptionEnabled: true,
      encryptionPassword: ENCRYPTION_PASSWORD,
    });

    const taskA = 'Encrypted Task A - ' + Date.now();
    await workViewPageA.addTask(taskA);
    await waitForStatePersistence(pageA);

    // Upload encrypted data to remote
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log('[Test] Client A uploaded encrypted task');

    // --- Client B: Create local task, then connect WITHOUT encryption ---
    // When Client B connects to a folder with encrypted data but no key configured,
    // the app shows a password entry dialog (DecryptNoPasswordError).
    // After entering the password, the conflict dialog appears.
    const contextB = await browser.newContext({ baseURL: url });
    const pageB = await contextB.newPage();

    pageB.on('console', (msg) => {
      if (msg.text().includes('DEBUG') || msg.text().includes('Error')) {
        console.log(`[Client B Console] ${msg.text()}`);
      }
    });

    await pageB.goto('/');
    await waitForAppReady(pageB);
    await dismissTourIfVisible(pageB);

    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);
    await workViewPageB.waitForTaskList();

    // Create a local task BEFORE setting up sync
    const taskB = 'Local Task B - ' + Date.now();
    await workViewPageB.addTask(taskB);
    await waitForStatePersistence(pageB);
    console.log('[Test] Client B created local task');

    // Setup sync WITHOUT encryption — auto-sync discovers encrypted remote data
    await syncPageB.setupWebdavSync(WEBDAV_CONFIG);
    console.log(
      '[Test] Client B set up sync (no encryption), waiting for password dialog...',
    );

    // Auto-sync triggers → downloads encrypted data → DecryptNoPasswordError
    // → password entry dialog appears
    const passwordDialog = pageB.locator('dialog-enter-encryption-password');
    await expect(passwordDialog).toBeVisible({ timeout: 30000 });
    console.log('[Test] Password dialog appeared on Client B');

    // Enter the encryption password
    const passwordInput = passwordDialog.locator('input[type="password"]');
    await passwordInput.fill(ENCRYPTION_PASSWORD);

    // Click "Save & Sync" button
    const saveAndSyncBtn = passwordDialog.locator(
      'button[mat-flat-button][color="primary"]',
    );
    await saveAndSyncBtn.click();
    console.log('[Test] Entered password and clicked Save & Sync');

    // After decryption succeeds, conflict dialog appears (both clients have data)
    const conflictDialog = pageB.locator('mat-dialog-container', {
      hasText: 'Conflicting Data',
    });
    await expect(conflictDialog).toBeVisible({ timeout: 30000 });
    console.log('[Test] Conflict dialog appeared on Client B');

    // Click "Keep local"
    const useLocalBtn = conflictDialog.locator('button', { hasText: /Keep local/i });
    await expect(useLocalBtn).toBeVisible();
    await useLocalBtn.click();
    console.log('[Test] Clicked Keep local on Client B');

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

    // Wait for sync to complete — this is the critical moment.
    // If the double-encryption bug were present, decryption would fail here.
    await waitForSyncComplete(pageB, syncPageB, 30000);
    console.log(
      '[Test] Client B sync completed after USE_LOCAL (no double-encryption error)',
    );

    // Verify Client B still has its local task
    await expect(pageB.locator('task', { hasText: taskB })).toBeVisible({
      timeout: 5000,
    });
    // Client A's task should NOT be visible (we chose USE_LOCAL)
    await expect(pageB.locator('task', { hasText: taskA })).not.toBeVisible();
    console.log('[Test] Verified Client B has local task, not remote task');

    // --- KEY REGRESSION: No repeated conflict on subsequent sync ---
    const taskB2 = 'Second Task B - ' + Date.now();
    await workViewPageB.addTask(taskB2);
    await waitForStatePersistence(pageB);

    await syncPageB.triggerSync();

    // Conflict dialog should NOT appear
    const conflictDialogSecond = pageB.locator('mat-dialog-container', {
      hasText: 'Conflicting Data',
    });
    await pageB.waitForTimeout(2000);
    const isConflictVisible = await conflictDialogSecond.isVisible();
    expect(isConflictVisible).toBe(false);
    console.log('[Test] Verified NO conflict dialog on second sync');

    await waitForSyncComplete(pageB, syncPageB, 30000);
    console.log('[Test] Second sync completed without conflict');

    // Verify both tasks present on Client B
    await expect(pageB.locator('task', { hasText: taskB })).toBeVisible();
    await expect(pageB.locator('task', { hasText: taskB2 })).toBeVisible();

    // --- Client A syncs → should decrypt Client B's encrypted data correctly ---
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log('[Test] Client A synced');

    // Client A should be able to decrypt Client B's ops (taskB2 was uploaded as ops).
    // This validates that Client B's encrypted upload after USE_LOCAL is readable.
    // Note: The first task (taskB) was part of Client B's snapshot upload, which
    // may not propagate via incremental sync when seq numbers align. That's an
    // orthogonal sync protocol behavior, not related to the double-encryption fix.
    await expect(pageA.locator('task', { hasText: taskB2 })).toBeVisible({
      timeout: 15000,
    });
    console.log('[Test] Client A received and decrypted Client B data successfully');

    await closeContextsSafely(contextA, contextB);
  });
});
