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
 * WebDAV (File-Based) Setup-Time Encryption E2E Test
 *
 * Verifies the file-based "E2EE before first upload" feature: when the user sets
 * an encryption password DURING first-time setup, the key is persisted with the
 * config so the very FIRST sync is already encrypted (no plaintext window), via
 * the normal download-first sync flow (no snapshot-overwrite).
 *
 * Flow:
 * 1. Client A configures WebDAV and sets an encryption password at setup.
 * 2. Client A adds a task and performs its first sync.
 * 3. The raw remote sync file is fetched and asserted to NOT contain the task
 *    title in plaintext (compression is off by default, so an unencrypted upload
 *    would contain it verbatim) — proving the first upload was encrypted.
 * 4. Client B configures WebDAV with the SAME password at setup and receives
 *    A's task (round-trips with the key; no overwrite of the remote).
 *
 * Run with: npm run e2e:file e2e/tests/sync/webdav-setup-encryption.spec.ts
 */

test.describe('@webdav @encryption WebDAV Setup-Time Encryption', () => {
  test.describe.configure({ mode: 'serial' });

  const SYNC_FOLDER_NAME = generateSyncFolderName('e2e-setup-encrypt');
  const ENCRYPTION_PASSWORD = 'setup-password-123';

  const WEBDAV_CONFIG = {
    ...WEBDAV_CONFIG_TEMPLATE,
    syncFolderPath: `/${SYNC_FOLDER_NAME}`,
  };

  // Non-production builds nest the sync file under a `/DEV` segment
  // (`environment.production ? undefined : '/DEV'` in sync-providers.factory.ts).
  // E2E always runs a non-production build, so include it here.
  const SYNC_FILE_URL = `${WEBDAV_CONFIG_TEMPLATE.baseUrl}${SYNC_FOLDER_NAME}/DEV/sync-data.json`;
  const AUTH_HEADER =
    'Basic ' +
    Buffer.from(
      `${WEBDAV_CONFIG_TEMPLATE.username}:${WEBDAV_CONFIG_TEMPLATE.password}`,
    ).toString('base64');

  test('encrypts the first upload when the password is set at setup, and a same-password client can read it', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow(); // Sync tests take longer
    const url = baseURL || 'http://localhost:4242';
    const uniqueId = Date.now();
    const taskTitle = `SetupEncryptedTask-${uniqueId}`;

    await createSyncFolder(request, SYNC_FOLDER_NAME);

    // ============ PHASE 1: Client A sets the password AT SETUP ============
    console.log('[SetupEncrypt] Phase 1: Client A setup with setup-time encryption');

    const { context: contextA, page: pageA } = await setupSyncClient(browser, url);
    const syncPageA = new SyncPage(pageA);
    const workViewPageA = new WorkViewPage(pageA);

    await workViewPageA.waitForTaskList();

    await syncPageA.setupWebdavSync({
      ...WEBDAV_CONFIG,
      encryptAtSetup: true,
      encryptionPassword: ENCRYPTION_PASSWORD,
    });
    await expect(syncPageA.syncBtn).toBeVisible();

    // Add a task and perform the FIRST sync — this upload must already be encrypted.
    await workViewPageA.addTask(taskTitle);
    await expect(pageA.locator('task')).toHaveCount(1);
    await waitForStatePersistence(pageA);

    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log(`[SetupEncrypt] Client A synced first task: ${taskTitle}`);

    // ============ PHASE 2: The remote blob must NOT be plaintext ============
    console.log('[SetupEncrypt] Phase 2: Verifying the remote file is encrypted');

    const remote = await request.fetch(SYNC_FILE_URL, {
      headers: { Authorization: AUTH_HEADER },
    });
    expect(remote.ok()).toBeTruthy();
    const remoteBody = await remote.text();
    expect(remoteBody.length).toBeGreaterThan(0);
    // Compression is off by default, so a plaintext upload would contain the
    // task title verbatim. Its absence proves the first upload was encrypted.
    expect(remoteBody).not.toContain(taskTitle);
    console.log('[SetupEncrypt] Remote file does not contain the plaintext task');

    // ============ PHASE 3: Client B joins with the SAME password ============
    console.log('[SetupEncrypt] Phase 3: Client B joins with the same password');

    const { context: contextB, page: pageB } = await setupSyncClient(browser, url);
    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);

    await workViewPageB.waitForTaskList();

    await syncPageB.setupWebdavSync({
      ...WEBDAV_CONFIG,
      encryptAtSetup: true,
      encryptionPassword: ENCRYPTION_PASSWORD,
    });
    await expect(syncPageB.syncBtn).toBeVisible();

    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);

    // B decrypts with the key and receives A's task (and did not overwrite it).
    await expect(pageB.locator(`task:has-text("${taskTitle}")`).first()).toBeVisible();
    console.log('[SetupEncrypt] ✓ Client B decrypted and received the task');

    await closeContextsSafely(contextA, contextB);
  });
});
