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
 * Tests for provider switch scenario where Client B connects to an existing WebDAV
 * sync folder that Client A has been using.
 *
 * This test specifically verifies the fix for the "mutual SYNC_IMPORT discarding" bug:
 * - When Client B joins an existing sync, it creates a SYNC_IMPORT
 * - The SYNC_IMPORT's vector clock must include Client A's clock entries
 * - Otherwise, Client A's ops are CONCURRENT with Client B's SYNC_IMPORT and get discarded
 *
 * @tags @webdav
 */
test.describe('@webdav WebDAV Provider Switch', () => {
  // Run sync tests serially to avoid WebDAV server contention
  test.describe.configure({ mode: 'serial' });

  // Use a unique folder for each test run
  const SYNC_FOLDER_NAME = generateSyncFolderName('e2e-provider-switch');

  const WEBDAV_CONFIG = {
    ...WEBDAV_CONFIG_TEMPLATE,
    syncFolderPath: `/${SYNC_FOLDER_NAME}`,
  };

  test('should sync tasks when Client B connects to existing WebDAV server (provider switch)', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow(); // Sync tests take longer
    const url = baseURL || 'http://localhost:4242';
    const uniqueId = Date.now();

    // Create the sync folder on WebDAV server
    await createSyncFolder(request, SYNC_FOLDER_NAME);
    console.log(`[Provider Switch Test] Created sync folder: ${SYNC_FOLDER_NAME}`);

    // === CLIENT A: Establish sync and create initial tasks ===
    const { context: contextA, page: pageA } = await setupSyncClient(browser, url);
    const syncPageA = new SyncPage(pageA);
    const workViewPageA = new WorkViewPage(pageA);

    // Console logging for debugging
    pageA.on('console', (msg) => {
      if (
        msg.text().includes('SyncHydrationService') ||
        msg.text().includes('SyncImportFilterService') ||
        msg.text().includes('RemoteOpsProcessingService') ||
        msg.text().includes('OperationLogSyncService') ||
        msg.text().includes('FileBasedSyncAdapter')
      ) {
        console.log(`[Client A] ${msg.type()}: ${msg.text()}`);
      }
    });

    await workViewPageA.waitForTaskList();

    // Setup WebDAV sync on Client A
    await syncPageA.setupWebdavSync(WEBDAV_CONFIG);
    await expect(syncPageA.syncBtn).toBeVisible();
    console.log('[Provider Switch Test] Client A: Sync configured');

    // Create tasks on Client A
    const taskA1 = `Task-${uniqueId}-from-A-1`;
    const taskA2 = `Task-${uniqueId}-from-A-2`;
    await workViewPageA.addTask(taskA1);
    await workViewPageA.addTask(taskA2);
    await expect(pageA.locator('task')).toHaveCount(2);
    console.log('[Provider Switch Test] Client A: Created 2 tasks');

    // Sync Client A (upload)
    await waitForStatePersistence(pageA);
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log('[Provider Switch Test] Client A: Initial sync complete');

    // === CLIENT B: Fresh client connecting to existing sync (simulates provider switch) ===
    const { context: contextB, page: pageB } = await setupSyncClient(browser, url);
    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);

    // Console logging for debugging
    pageB.on('console', (msg) => {
      if (
        msg.text().includes('SyncHydrationService') ||
        msg.text().includes('SyncImportFilterService') ||
        msg.text().includes('RemoteOpsProcessingService') ||
        msg.text().includes('OperationLogSyncService') ||
        msg.text().includes('FileBasedSyncAdapter')
      ) {
        console.log(`[Client B] ${msg.type()}: ${msg.text()}`);
      }
    });

    await workViewPageB.waitForTaskList();

    // Setup WebDAV sync on Client B (fresh client joining existing sync)
    await syncPageB.setupWebdavSync(WEBDAV_CONFIG);
    await expect(syncPageB.syncBtn).toBeVisible();
    console.log('[Provider Switch Test] Client B: Sync configured (fresh client)');

    // Sync Client B (download from existing sync)
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);
    console.log('[Provider Switch Test] Client B: Initial sync complete');

    // Verify Client B received Client A's tasks
    await expect(pageB.locator('task')).toHaveCount(2);
    await expect(pageB.locator('task', { hasText: taskA1 })).toBeVisible();
    await expect(pageB.locator('task', { hasText: taskA2 })).toBeVisible();
    console.log('[Provider Switch Test] Client B: Received 2 tasks from Client A');

    // === CLIENT B: Create new task and sync ===
    const taskB = `Task-${uniqueId}-from-B`;
    await workViewPageB.addTask(taskB);
    await expect(pageB.locator('task')).toHaveCount(3);
    console.log('[Provider Switch Test] Client B: Created 1 new task');

    await waitForStatePersistence(pageB);
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);
    console.log('[Provider Switch Test] Client B: Synced new task');

    // === CLIENT A: Sync to receive Client B's task ===
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log('[Provider Switch Test] Client A: Synced to receive Client B task');

    // Verify Client A received Client B's task (THIS IS THE KEY ASSERTION)
    // Before the fix, Client B's ops were CONCURRENT with Client A's SYNC_IMPORT
    // and would be discarded. With the fix, they should be kept.
    await expect(pageA.locator('task')).toHaveCount(3);
    await expect(pageA.locator('task', { hasText: taskA1 })).toBeVisible();
    await expect(pageA.locator('task', { hasText: taskA2 })).toBeVisible();
    await expect(pageA.locator('task', { hasText: taskB })).toBeVisible();
    console.log('[Provider Switch Test] Client A: Received task from Client B');

    // Final verification - both clients should have identical state
    const countA = await pageA.locator('task').count();
    const countB = await pageB.locator('task').count();
    expect(countA).toBe(countB);
    expect(countA).toBe(3);

    console.log('[Provider Switch Test] SUCCESS: Both clients have 3 tasks');

    // Cleanup
    await closeContextsSafely(contextA, contextB);
  });

  /**
   * CRITICAL TEST: Concurrent task creation after late join
   *
   * This tests the specific bug scenario:
   * 1. Client A establishes sync and creates initial tasks
   * 2. Client C joins and downloads A's data (receives snapshot)
   * 3. BOTH A and C create tasks WITHOUT syncing to each other
   * 4. C syncs first (uploads its task)
   * 5. A syncs (should receive C's task AND C should receive A's task)
   *
   * Before the fix: When C joins and receives a snapshot, it created a SYNC_IMPORT.
   * When A created a task after C joined (without knowledge of C), A's task had
   * a vector clock like { A: 6 } which was CONCURRENT with C's SYNC_IMPORT clock
   * { A: 5, C: 1 }. This caused A's task to be filtered by SyncImportFilterService
   * on C, resulting in data loss.
   *
   * The fix: File-based sync bootstrap no longer creates SYNC_IMPORT, avoiding
   * the "clean slate" semantics that filter concurrent ops.
   */
  test('should sync concurrent tasks created after late join (CRITICAL BUG FIX)', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow();
    const url = baseURL || 'http://localhost:4242';
    const uniqueId = Date.now();

    // Use a unique folder for this test
    const FOLDER_NAME = generateSyncFolderName('e2e-concurrent-after-join');
    const config = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${FOLDER_NAME}`,
    };

    await createSyncFolder(request, FOLDER_NAME);
    console.log(`[Concurrent Join Test] Created sync folder: ${FOLDER_NAME}`);

    // === STEP 1: Client A establishes sync and creates initial tasks ===
    const { context: contextA, page: pageA } = await setupSyncClient(browser, url);
    const syncPageA = new SyncPage(pageA);
    const workViewPageA = new WorkViewPage(pageA);

    // Debug logging
    pageA.on('console', (msg) => {
      if (
        msg.text().includes('Discarded') ||
        msg.text().includes('SYNC_IMPORT') ||
        msg.text().includes('SyncImportFilterService') ||
        msg.text().includes('SyncHydrationService')
      ) {
        console.log(`[Client A] ${msg.type()}: ${msg.text()}`);
      }
    });

    await workViewPageA.waitForTaskList();
    await syncPageA.setupWebdavSync(config);

    const initialTaskA = `Task-${uniqueId}-initial-A`;
    await workViewPageA.addTask(initialTaskA);
    await expect(pageA.locator('task')).toHaveCount(1);
    console.log('[Concurrent Join Test] Client A: Created initial task');

    await waitForStatePersistence(pageA);
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log('[Concurrent Join Test] Client A: Initial sync complete');

    // === STEP 2: Client C joins and downloads A's data ===
    const { context: contextC, page: pageC } = await setupSyncClient(browser, url);
    const syncPageC = new SyncPage(pageC);
    const workViewPageC = new WorkViewPage(pageC);

    // Debug logging - CRITICAL: watch for SYNC_IMPORT filtering messages
    pageC.on('console', (msg) => {
      if (
        msg.text().includes('Discarded') ||
        msg.text().includes('SYNC_IMPORT') ||
        msg.text().includes('SyncImportFilterService') ||
        msg.text().includes('SyncHydrationService') ||
        msg.text().includes('Skipping SYNC_IMPORT')
      ) {
        console.log(`[Client C] ${msg.type()}: ${msg.text()}`);
      }
    });

    await workViewPageC.waitForTaskList();
    await syncPageC.setupWebdavSync(config);

    // C syncs to get A's data (this is the "late join" / bootstrap)
    await syncPageC.triggerSync();
    await waitForSyncComplete(pageC, syncPageC);

    // Verify C received A's initial task
    await expect(pageC.locator('task')).toHaveCount(1);
    await expect(pageC.locator('task', { hasText: initialTaskA })).toBeVisible();
    console.log('[Concurrent Join Test] Client C: Received initial task from A');

    // === STEP 3: BOTH clients create tasks WITHOUT syncing ===
    // This is the critical scenario - concurrent task creation after C's bootstrap

    // A creates a task (A doesn't know about C yet)
    const taskFromA = `Task-${uniqueId}-concurrent-from-A`;
    await workViewPageA.addTask(taskFromA);
    await expect(pageA.locator('task')).toHaveCount(2);
    console.log('[Concurrent Join Test] Client A: Created concurrent task');

    // C creates a task
    const taskFromC = `Task-${uniqueId}-concurrent-from-C`;
    await workViewPageC.addTask(taskFromC);
    await expect(pageC.locator('task')).toHaveCount(2);
    console.log('[Concurrent Join Test] Client C: Created concurrent task');

    // Wait for both to persist before syncing
    await waitForStatePersistence(pageA);
    await waitForStatePersistence(pageC);

    // === STEP 4: C syncs first ===
    await syncPageC.triggerSync();
    await waitForSyncComplete(pageC, syncPageC);
    console.log('[Concurrent Join Test] Client C: Synced concurrent task');

    // === STEP 5: A syncs - should receive C's task ===
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log('[Concurrent Join Test] Client A: Synced to receive C task');

    // A should now have 3 tasks: initial + concurrent from A + concurrent from C
    await expect(pageA.locator('task')).toHaveCount(3);
    await expect(pageA.locator('task', { hasText: initialTaskA })).toBeVisible();
    await expect(pageA.locator('task', { hasText: taskFromA })).toBeVisible();
    await expect(pageA.locator('task', { hasText: taskFromC })).toBeVisible();
    console.log('[Concurrent Join Test] Client A: Has all 3 tasks');

    // === STEP 6: C syncs again to receive A's concurrent task ===
    // THIS IS THE KEY TEST - before the fix, A's concurrent task would be filtered
    // because it was CONCURRENT with C's SYNC_IMPORT
    await syncPageC.triggerSync();
    await waitForSyncComplete(pageC, syncPageC);
    console.log('[Concurrent Join Test] Client C: Synced to receive A concurrent task');

    // C should now have 3 tasks
    const taskCountC = await pageC.locator('task').count();
    console.log(`[Concurrent Join Test] Client C: Has ${taskCountC} tasks`);

    // List tasks for debugging
    const taskTitlesC = await pageC.locator('.task-title').allInnerTexts();
    console.log(`[Concurrent Join Test] Client C tasks: ${JSON.stringify(taskTitlesC)}`);

    // CRITICAL ASSERTIONS - these would fail before the fix
    await expect(pageC.locator('task')).toHaveCount(3);
    await expect(pageC.locator('task', { hasText: initialTaskA })).toBeVisible();
    await expect(pageC.locator('task', { hasText: taskFromC })).toBeVisible();
    await expect(pageC.locator('task', { hasText: taskFromA })).toBeVisible({
      timeout: 5000,
    });
    console.log(
      '[Concurrent Join Test] SUCCESS: Client C received A concurrent task (bug is fixed!)',
    );

    // Final verification - both clients have identical state
    const countA = await pageA.locator('task').count();
    const countC = await pageC.locator('task').count();
    expect(countA).toBe(countC);
    expect(countA).toBe(3);

    console.log('[Concurrent Join Test] PASSED: Both clients have 3 tasks');

    await closeContextsSafely(contextA, contextC);
  });

  /**
   * Test: Three-client sync scenario (original bug report)
   *
   * Simulates the exact scenario from the bug report:
   * - Client A and B are syncing
   * - Client C joins and gets data from B
   * - Tasks created on C and B after C joins
   * - After syncing: C's task appears on B, but B's task should also appear on C
   */
  test('should sync three clients with late joiner (original bug report scenario)', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow();
    const url = baseURL || 'http://localhost:4242';
    const uniqueId = Date.now();

    const FOLDER_NAME = generateSyncFolderName('e2e-three-client');
    const config = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${FOLDER_NAME}`,
    };

    await createSyncFolder(request, FOLDER_NAME);
    console.log(`[Three Client Test] Created sync folder: ${FOLDER_NAME}`);

    // === Setup Client A ===
    const { context: contextA, page: pageA } = await setupSyncClient(browser, url);
    const syncPageA = new SyncPage(pageA);
    const workViewPageA = new WorkViewPage(pageA);
    await workViewPageA.waitForTaskList();
    await syncPageA.setupWebdavSync(config);

    // === Setup Client B ===
    const { context: contextB, page: pageB } = await setupSyncClient(browser, url);
    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);
    await workViewPageB.waitForTaskList();
    await syncPageB.setupWebdavSync(config);

    // A creates initial task and syncs
    const taskA1 = `Task-${uniqueId}-A1`;
    await workViewPageA.addTask(taskA1);
    await waitForStatePersistence(pageA);
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log('[Three Client Test] A: Created and synced initial task');

    // B syncs to get A's task
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);
    await expect(pageB.locator('task')).toHaveCount(1, { timeout: 10000 });
    console.log('[Three Client Test] B: Got A task');

    // B creates task and syncs
    const taskB1 = `Task-${uniqueId}-B1`;
    await workViewPageB.addTask(taskB1);
    await waitForStatePersistence(pageB);
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);
    console.log('[Three Client Test] B: Created and synced task');

    // === Client C joins (late joiner) ===
    const { context: contextC, page: pageC } = await setupSyncClient(browser, url);
    const syncPageC = new SyncPage(pageC);
    const workViewPageC = new WorkViewPage(pageC);

    // Debug logging for C
    pageC.on('console', (msg) => {
      if (
        msg.text().includes('Discarded') ||
        msg.text().includes('SYNC_IMPORT') ||
        msg.text().includes('Skipping SYNC_IMPORT')
      ) {
        console.log(`[Client C] ${msg.type()}: ${msg.text()}`);
      }
    });

    await workViewPageC.waitForTaskList();
    await syncPageC.setupWebdavSync(config);
    await syncPageC.triggerSync();
    await waitForSyncComplete(pageC, syncPageC);

    // C should have 2 tasks (from A and B)
    await expect(pageC.locator('task')).toHaveCount(2, { timeout: 30000 });
    console.log('[Three Client Test] C: Joined and received 2 tasks');

    // === Critical scenario: Both B and C create tasks before syncing ===
    const taskB2 = `Task-${uniqueId}-B2-after-C-joins`;
    await workViewPageB.addTask(taskB2);
    await waitForStatePersistence(pageB);

    const taskC1 = `Task-${uniqueId}-C1`;
    await workViewPageC.addTask(taskC1);
    await waitForStatePersistence(pageC);

    console.log('[Three Client Test] B and C: Created concurrent tasks');

    // C syncs first
    await syncPageC.triggerSync();
    await waitForSyncComplete(pageC, syncPageC);
    console.log('[Three Client Test] C: Synced');

    // B syncs
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);
    console.log('[Three Client Test] B: Synced');

    // B should have C's task
    await expect(pageB.locator('task')).toHaveCount(4);
    await expect(pageB.locator('task', { hasText: taskC1 })).toBeVisible();
    console.log('[Three Client Test] B: Has C task');

    // C syncs again to get B's concurrent task
    await syncPageC.triggerSync();
    await waitForSyncComplete(pageC, syncPageC);

    // CRITICAL: C should have B's task (this was the bug!)
    await expect(pageC.locator('task')).toHaveCount(4, { timeout: 30000 });
    await expect(pageC.locator('task', { hasText: taskB2 })).toBeVisible({
      timeout: 5000,
    });
    console.log('[Three Client Test] C: Has B concurrent task (BUG FIXED!)');

    // A syncs to verify full sync
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);

    // All clients should have 4 tasks
    await expect(pageA.locator('task')).toHaveCount(4, { timeout: 30000 });
    await expect(pageB.locator('task')).toHaveCount(4, { timeout: 30000 });
    await expect(pageC.locator('task')).toHaveCount(4, { timeout: 30000 });

    console.log('[Three Client Test] PASSED: All 3 clients have 4 tasks');

    await closeContextsSafely(contextA, contextB, contextC);
  });

  test('should handle bidirectional sync after provider switch', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow();
    const url = baseURL || 'http://localhost:4242';
    const uniqueId = Date.now();

    // Use a different folder for this test
    const FOLDER_NAME = generateSyncFolderName('e2e-bidirectional');
    const config = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${FOLDER_NAME}`,
    };

    await createSyncFolder(request, FOLDER_NAME);

    // === Setup both clients ===
    const { context: contextA, page: pageA } = await setupSyncClient(browser, url);
    const syncPageA = new SyncPage(pageA);
    const workViewPageA = new WorkViewPage(pageA);

    const { context: contextB, page: pageB } = await setupSyncClient(browser, url);
    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);

    await workViewPageA.waitForTaskList();
    await workViewPageB.waitForTaskList();

    // Client A: Create task and sync first
    await syncPageA.setupWebdavSync(config);
    const taskA = `Task-${uniqueId}-A`;
    await workViewPageA.addTask(taskA);
    await waitForStatePersistence(pageA);
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);

    // Client B: Join sync and verify task
    await syncPageB.setupWebdavSync(config);
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);
    await expect(pageB.locator('task')).toHaveCount(1);

    // === Bidirectional sync rounds ===
    // Round 1: B creates task
    const taskB1 = `Task-${uniqueId}-B1`;
    await workViewPageB.addTask(taskB1);
    await waitForStatePersistence(pageB);
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);

    // A syncs
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    await expect(pageA.locator('task')).toHaveCount(2);

    // Round 2: A creates task
    const taskA2 = `Task-${uniqueId}-A2`;
    await workViewPageA.addTask(taskA2);
    await waitForStatePersistence(pageA);
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);

    // B syncs
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);
    await expect(pageB.locator('task')).toHaveCount(3);

    // Round 3: B creates another task
    const taskB2 = `Task-${uniqueId}-B2`;
    await workViewPageB.addTask(taskB2);
    await waitForStatePersistence(pageB);
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);

    // A syncs
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);

    // Final check: both should have 4 tasks
    await expect(pageA.locator('task')).toHaveCount(4);
    await expect(pageB.locator('task')).toHaveCount(4);

    console.log(
      '[Bidirectional Test] SUCCESS: Both clients have 4 tasks after multiple sync rounds',
    );

    await closeContextsSafely(contextA, contextB);
  });

  /**
   * Test: Client with multiple local ops joining sync
   *
   * Verifies that confirmation shows correct count and accepting replaces all local data.
   */
  test('should replace multiple local ops when user accepts confirmation', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow();
    const url = baseURL || 'http://localhost:4242';
    const uniqueId = Date.now();

    const FOLDER_NAME = generateSyncFolderName('e2e-multi-local-ops');
    const config = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${FOLDER_NAME}`,
    };

    await createSyncFolder(request, FOLDER_NAME);

    // === Client A: Create tasks and sync ===
    const { context: contextA, page: pageA } = await setupSyncClient(browser, url);
    const syncPageA = new SyncPage(pageA);
    const workViewPageA = new WorkViewPage(pageA);

    await workViewPageA.waitForTaskList();
    await syncPageA.setupWebdavSync(config);

    // A creates multiple tasks
    const taskA1 = `Task-${uniqueId}-A1`;
    const taskA2 = `Task-${uniqueId}-A2`;
    const taskA3 = `Task-${uniqueId}-A3`;
    await workViewPageA.addTask(taskA1);
    await workViewPageA.addTask(taskA2);
    await workViewPageA.addTask(taskA3);
    await waitForStatePersistence(pageA);
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log('[Multi Local Ops Test] Client A: Created and synced 3 tasks');

    // === Client B: Create multiple local tasks ===
    const { context: contextB, page: pageB } = await setupSyncClient(browser, url);
    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);

    await workViewPageB.waitForTaskList();

    // B creates multiple tasks before sync
    const taskB1 = `Task-${uniqueId}-LOCAL-B1`;
    const taskB2 = `Task-${uniqueId}-LOCAL-B2`;
    await workViewPageB.addTask(taskB1);
    await workViewPageB.addTask(taskB2);
    await expect(pageB.locator('task')).toHaveCount(2);
    await waitForStatePersistence(pageB);
    console.log('[Multi Local Ops Test] Client B: Created 2 local tasks');

    // Configure sync - this triggers auto-sync which may show conflict dialog
    await syncPageB.setupWebdavSync(config);

    // Handle the sync conflict dialog (Material dialog, not browser confirm)
    // We want to keep remote data, so click "Keep remote"
    const conflictDialog = pageB.locator('mat-dialog-container', {
      hasText: 'Conflicting Data',
    });
    const conflictVisible = await conflictDialog
      .waitFor({ state: 'visible', timeout: 10000 })
      .then(() => true)
      .catch(() => false);

    if (conflictVisible) {
      const keepRemoteBtn = conflictDialog.locator('button', { hasText: /Keep remote/i });
      await keepRemoteBtn.click();
      // Wait for dialog to close
      await conflictDialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    }

    // Trigger sync if not already syncing and wait for completion
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);

    // B should now have A's 3 tasks (local tasks replaced)
    await expect(pageB.locator('task')).toHaveCount(3);
    await expect(pageB.locator('task', { hasText: taskA1 })).toBeVisible();
    await expect(pageB.locator('task', { hasText: taskA2 })).toBeVisible();
    await expect(pageB.locator('task', { hasText: taskA3 })).toBeVisible();

    // Local tasks should be gone
    await expect(pageB.locator('task', { hasText: taskB1 })).not.toBeVisible();
    await expect(pageB.locator('task', { hasText: taskB2 })).not.toBeVisible();

    console.log('[Multi Local Ops Test] PASSED: Local tasks replaced with remote');

    await closeContextsSafely(contextA, contextB);
  });

  /**
   * Test: Fresh client should not duplicate tasks on repeated syncs (b2b63da9)
   *
   * Validates the fix from commit b2b63da9 which prevents task duplication when a
   * fresh client syncs with a file-based provider. Without the fix, two duplication
   * paths existed:
   *
   * 1. Download path: On second sync cycle, recentOps bypass the appliedOpIds filter
   *    (not yet in IndexedDB) and get re-applied → duplicates
   * 2. Piggyback path: The adapter's isForceFromZero guard skipped marking ops as
   *    processed, so they were returned as piggybacked during upload → duplicates
   */
  test('should not duplicate tasks when fresh client syncs multiple times', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow();
    const url = baseURL || 'http://localhost:4242';
    const uniqueId = Date.now();

    const FOLDER_NAME = generateSyncFolderName('e2e-fresh-client-dup');
    const config = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${FOLDER_NAME}`,
    };

    await createSyncFolder(request, FOLDER_NAME);
    console.log(`[Fresh Client Dup Test] Created sync folder: ${FOLDER_NAME}`);

    // === STEP 1: Client A creates tasks and syncs ===
    const { context: contextA, page: pageA } = await setupSyncClient(browser, url);
    const syncPageA = new SyncPage(pageA);
    const workViewPageA = new WorkViewPage(pageA);

    pageA.on('console', (msg) => {
      if (
        msg.text().includes('OperationLogSyncService') ||
        msg.text().includes('FileBasedSyncAdapter')
      ) {
        console.log(`[Client A] ${msg.type()}: ${msg.text()}`);
      }
    });

    await workViewPageA.waitForTaskList();
    await syncPageA.setupWebdavSync(config);

    const task1 = `Task-${uniqueId}-1`;
    const task2 = `Task-${uniqueId}-2`;
    const task3 = `Task-${uniqueId}-3`;
    await workViewPageA.addTask(task1);
    await workViewPageA.addTask(task2);
    await workViewPageA.addTask(task3);
    await expect(pageA.locator('task')).toHaveCount(3);
    console.log('[Fresh Client Dup Test] Client A: Created 3 tasks');

    await waitForStatePersistence(pageA);
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log('[Fresh Client Dup Test] Client A: Initial sync complete');

    // === STEP 2: Client B (fresh) joins and syncs ===
    const { context: contextB, page: pageB } = await setupSyncClient(browser, url);
    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);

    pageB.on('console', (msg) => {
      if (
        msg.text().includes('OperationLogSyncService') ||
        msg.text().includes('FileBasedSyncAdapter')
      ) {
        console.log(`[Client B] ${msg.type()}: ${msg.text()}`);
      }
    });

    await workViewPageB.waitForTaskList();
    await syncPageB.setupWebdavSync(config);

    // First sync: Client B receives snapshot + recentOps
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);

    // Assert Client B has exactly 3 tasks (no more, no less)
    await expect(pageB.locator('task')).toHaveCount(3);
    await expect(pageB.locator('task', { hasText: task1 })).toBeVisible();
    await expect(pageB.locator('task', { hasText: task2 })).toBeVisible();
    await expect(pageB.locator('task', { hasText: task3 })).toBeVisible();
    console.log('[Fresh Client Dup Test] Client B: Received 3 tasks on first sync');

    // === STEP 3: Client B syncs again (no new remote changes) ===
    // Without the fix, recentOps would be re-applied → duplicates (download path)
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);

    await expect(pageB.locator('task')).toHaveCount(3);
    console.log(
      '[Fresh Client Dup Test] Client B: Still 3 tasks after second sync (download path OK)',
    );

    // === STEP 4: Client B creates a new task and syncs (upload) ===
    // Without the fix, piggyback would return the 3 snapshot ops again → duplicates
    const taskB = `Task-${uniqueId}-from-B`;
    await workViewPageB.addTask(taskB);
    await expect(pageB.locator('task')).toHaveCount(4);

    await waitForStatePersistence(pageB);
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);

    // CRITICAL: Client B should have exactly 4 tasks, not 7 (piggyback path)
    await expect(pageB.locator('task')).toHaveCount(4);
    console.log(
      '[Fresh Client Dup Test] Client B: 4 tasks after upload sync (piggyback path OK)',
    );

    // === STEP 5: Client A syncs to receive Client B's new task ===
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);

    // Client A should have exactly 4 tasks (no phantom duplicates propagated)
    await expect(pageA.locator('task')).toHaveCount(4);
    await expect(pageA.locator('task', { hasText: task1 })).toBeVisible();
    await expect(pageA.locator('task', { hasText: task2 })).toBeVisible();
    await expect(pageA.locator('task', { hasText: task3 })).toBeVisible();
    await expect(pageA.locator('task', { hasText: taskB })).toBeVisible();
    console.log(
      '[Fresh Client Dup Test] Client A: 4 tasks (received B task, no duplicates)',
    );

    // Final consistency check
    const countA = await pageA.locator('task').count();
    const countB = await pageB.locator('task').count();
    expect(countA).toBe(countB);
    expect(countA).toBe(4);

    console.log('[Fresh Client Dup Test] PASSED: No task duplication on repeated syncs');

    await closeContextsSafely(contextA, contextB);
  });
});
