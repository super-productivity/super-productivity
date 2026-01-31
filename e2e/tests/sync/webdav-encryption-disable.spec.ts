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
  closeContextsSafely,
} from '../../utils/sync-helpers';

/**
 * WebDAV (File-Based) Encryption Disable E2E Tests
 *
 * These tests verify the "Disable Encryption" flow for file-based sync providers.
 *
 * Flow:
 * 1. Client A sets up WebDAV sync with encryption enabled
 * 2. Client A creates and syncs encrypted task
 * 3. Client A removes encryption (triggers unencrypted snapshot upload)
 * 4. Client B joins without encryption and receives data
 *
 * Run with: npm run e2e:file e2e/tests/sync/webdav-encryption-disable.spec.ts
 */

test.describe('@webdav @encryption WebDAV Encryption Disable', () => {
  test.describe.configure({ mode: 'serial' });

  const SYNC_FOLDER_NAME = generateSyncFolderName('e2e-encrypt-disable');
  const ENCRYPTION_PASSWORD = 'test-password-123';

  const WEBDAV_CONFIG = {
    ...WEBDAV_CONFIG_TEMPLATE,
    syncFolderPath: `/${SYNC_FOLDER_NAME}`,
  };

  test('should disable encryption and allow unencrypted sync', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow(); // Sync tests take longer
    const url = baseURL || 'http://localhost:4242';
    const uniqueId = Date.now();

    // Create the sync folder on WebDAV server
    await createSyncFolder(request, SYNC_FOLDER_NAME);

    // ============ PHASE 1: Setup Client A with encryption ============
    console.log('[EncryptDisable] Phase 1: Setting up Client A with encryption');

    const { context: contextA, page: pageA } = await setupSyncClient(browser, url);
    const syncPageA = new SyncPage(pageA);
    const workViewPageA = new WorkViewPage(pageA);

    await workViewPageA.waitForTaskList();

    // Setup WebDAV sync with encryption enabled
    await syncPageA.setupWebdavSync({
      ...WEBDAV_CONFIG,
      isEncryptionEnabled: true,
      encryptionPassword: ENCRYPTION_PASSWORD,
    });
    await expect(syncPageA.syncBtn).toBeVisible();
    console.log('[EncryptDisable] Client A configured with encryption');

    // Create and sync encrypted task
    const encryptedTask = `EncryptedTask-${uniqueId}`;
    await workViewPageA.addTask(encryptedTask);
    await expect(pageA.locator('task')).toHaveCount(1);
    await waitForStatePersistence(pageA);

    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log(`[EncryptDisable] Client A created and synced: ${encryptedTask}`);

    // Wait for state to fully persist before proceeding
    await waitForStatePersistence(pageA);

    // Reload the page to ensure state is loaded from IndexedDB
    // This ensures we're testing the actual persisted state, not just in-memory
    await pageA.reload();
    await workViewPageA.waitForTaskList();

    // Wait for sync provider to be fully initialized after reload
    // This ensures the provider's private config (including encryptKey) is loaded from IndexedDB
    await syncPageA.waitForSyncReady();

    // ============ PHASE 2: Client A disables encryption ============
    console.log('[EncryptDisable] Phase 2: Client A disabling encryption');

    await syncPageA.disableEncryptionForFileBased();
    console.log('[EncryptDisable] Client A disabled encryption');

    // Verify task still exists after encryption removal
    await expect(pageA.locator(`task:has-text("${encryptedTask}")`)).toBeVisible();

    // Create a new task after disabling encryption
    const unencryptedTask = `UnencryptedTask-${uniqueId}`;
    await workViewPageA.addTask(unencryptedTask);
    await waitForStatePersistence(pageA);

    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log(`[EncryptDisable] Client A created unencrypted: ${unencryptedTask}`);

    // ============ PHASE 3: Fresh Client B joins without encryption ============
    console.log('[EncryptDisable] Phase 3: Client B joining without encryption');

    const { context: contextB, page: pageB } = await setupSyncClient(browser, url);
    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);

    await workViewPageB.waitForTaskList();

    // Setup WebDAV sync WITHOUT encryption (since A disabled it)
    await syncPageB.setupWebdavSync({
      ...WEBDAV_CONFIG,
      // Note: No encryption config - should work because A disabled encryption
    });
    await expect(syncPageB.syncBtn).toBeVisible();

    // Sync to receive data
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);
    console.log('[EncryptDisable] Client B synced');

    // Verify Client B has both tasks (use .first() in case task appears in multiple views)
    await expect(
      pageB.locator(`task:has-text("${encryptedTask}")`).first(),
    ).toBeVisible();
    await expect(
      pageB.locator(`task:has-text("${unencryptedTask}")`).first(),
    ).toBeVisible();
    console.log('[EncryptDisable] Client B received all tasks');

    // ============ PHASE 4: Verify bidirectional sync works ============
    console.log('[EncryptDisable] Phase 4: Verifying bidirectional sync');

    const finalTask = `FinalTask-${uniqueId}`;
    await workViewPageB.addTask(finalTask);
    await waitForStatePersistence(pageB);

    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);

    // Client A should receive the new task
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    await expect(pageA.locator(`task:has-text("${finalTask}")`).first()).toBeVisible();

    console.log('[EncryptDisable] ✓ Encryption disabled successfully!');

    // Cleanup
    await closeContextsSafely(contextA, contextB);
  });
});
