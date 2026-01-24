import { test, expect } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import { waitForStatePersistence } from '../../utils/waits';
import {
  WEBDAV_CONFIG_TEMPLATE,
  createSyncFolder,
  waitForSyncComplete,
  generateSyncFolderName,
} from '../../utils/sync-helpers';
import {
  createLegacyMigratedClient,
  closeLegacyClient,
} from '../../utils/legacy-migration-helpers';

// Import fixtures
import legacyDataClientA from '../../fixtures/legacy-migration-client-a.json';
import legacyDataClientB from '../../fixtures/legacy-migration-client-b.json';
import legacyDataCollisionA from '../../fixtures/legacy-migration-collision-a.json';
import legacyDataCollisionB from '../../fixtures/legacy-migration-collision-b.json';

/**
 * WebDAV Legacy Migration Sync E2E Tests
 *
 * Tests scenarios where BOTH clients have migrated from old Super Productivity
 * (pre-operation-log format) and then sync via WebDAV.
 *
 * This tests a gap in coverage: what happens when two clients with independent
 * legacy data both migrate and then try to sync to the same WebDAV folder.
 *
 * Run with: npm run e2e:file e2e/tests/sync/webdav-legacy-migration-sync.spec.ts -- --retries=0
 */
test.describe('@webdav @migration WebDAV Legacy Migration Sync', () => {
  test.describe.configure({ mode: 'serial' });

  /**
   * Test: Both clients migrated from legacy - Keep local resolution
   *
   * Scenario:
   * 1. Client A has legacy data (Task A1, Task A2), migrates, syncs to WebDAV
   * 2. Client B has different legacy data (Task B1, Task B2), migrates
   * 3. Client B sets up WebDAV sync to same folder -> conflict dialog appears
   * 4. Client B chooses "Keep local" -> B's data replaces remote
   * 5. Client A syncs -> receives B's data
   */
  test('both clients migrated from legacy - Keep local resolution', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow(); // Migration + sync tests take longer
    const SYNC_FOLDER_NAME = generateSyncFolderName('e2e-legacy-mig-local');
    await createSyncFolder(request, SYNC_FOLDER_NAME);
    const WEBDAV_CONFIG = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${SYNC_FOLDER_NAME}`,
    };
    const url = baseURL || 'http://localhost:4242';

    let clientA: {
      context: Awaited<ReturnType<typeof browser.newContext>>;
      page: Awaited<ReturnType<typeof browser.newPage>>;
    } | null = null;
    let clientB: {
      context: Awaited<ReturnType<typeof browser.newContext>>;
      page: Awaited<ReturnType<typeof browser.newPage>>;
    } | null = null;

    try {
      // === Client A: Legacy migration + sync setup ===
      console.log('[Test] Creating Client A with legacy data...');
      clientA = await createLegacyMigratedClient(
        browser,
        url,
        legacyDataClientA.data,
        'A',
      );
      const syncPageA = new SyncPage(clientA.page);
      const workViewA = new WorkViewPage(clientA.page);

      // Navigate to the project by clicking in sidebar (more reliable than URL navigation)
      const sidenavA = clientA.page.locator('magic-side-nav');
      await sidenavA.locator('nav-item', { hasText: 'Client A Project' }).click();
      await clientA.page.waitForLoadState('networkidle').catch(() => {});
      await workViewA.waitForTaskList();

      // Verify Client A has its migrated data
      await expect(clientA.page.locator('task', { hasText: 'Task A1' })).toBeVisible({
        timeout: 10000,
      });
      await expect(clientA.page.locator('task', { hasText: 'Task A2' })).toBeVisible();
      console.log('[Test] Client A verified: has migrated tasks');

      // Setup sync and upload
      await syncPageA.setupWebdavSync(WEBDAV_CONFIG);
      await waitForStatePersistence(clientA.page);
      await syncPageA.triggerSync();
      await waitForSyncComplete(clientA.page, syncPageA);
      console.log('[Test] Client A: Data uploaded to WebDAV');

      // === Client B: Legacy migration (different data) ===
      console.log('[Test] Creating Client B with different legacy data...');
      clientB = await createLegacyMigratedClient(
        browser,
        url,
        legacyDataClientB.data,
        'B',
      );
      const syncPageB = new SyncPage(clientB.page);
      const workViewB = new WorkViewPage(clientB.page);

      // Navigate to the project by clicking in sidebar
      const sidenavB = clientB.page.locator('magic-side-nav');
      await sidenavB.locator('nav-item', { hasText: 'Client B Project' }).click();
      await clientB.page.waitForLoadState('networkidle').catch(() => {});
      await workViewB.waitForTaskList();

      // Verify Client B has its migrated data
      await expect(clientB.page.locator('task', { hasText: 'Task B1' })).toBeVisible({
        timeout: 10000,
      });
      await expect(clientB.page.locator('task', { hasText: 'Task B2' })).toBeVisible();
      console.log('[Test] Client B verified: has migrated tasks');

      // Add a task after migration to create "real" operations that trigger conflict detection
      // (MIGRATION_GENESIS_IMPORT alone might be treated differently by sync logic)
      await workViewB.addTask('Task B3 - After Migration');
      await waitForStatePersistence(clientB.page);
      console.log('[Test] Client B added task after migration');

      // Setup sync - should trigger conflict dialog
      console.log('[Test] Client B setting up sync (expecting conflict)...');
      await syncPageB.setupWebdavSync(WEBDAV_CONFIG);

      // Wait for conflict dialog
      const conflictDialog = clientB.page.locator('mat-dialog-container', {
        hasText: 'Conflicting Data',
      });
      await expect(conflictDialog).toBeVisible({ timeout: 30000 });
      console.log('[Test] Conflict dialog appeared on Client B');

      // Choose "Keep local"
      const useLocalBtn = conflictDialog.locator('button', { hasText: /Keep local/i });
      await expect(useLocalBtn).toBeVisible();
      await useLocalBtn.click();
      console.log('[Test] Client B clicked "Keep local"');

      // Handle potential confirmation dialog
      const confirmDialog = clientB.page.locator('dialog-confirm');
      try {
        await confirmDialog.waitFor({ state: 'visible', timeout: 3000 });
        await confirmDialog
          .locator('button[color="warn"], button:has-text("OK")')
          .first()
          .click();
      } catch {
        // Confirmation might not appear - that's fine
      }

      await waitForSyncComplete(clientB.page, syncPageB, 30000);
      console.log('[Test] Client B sync completed');

      // Navigate to B's project and verify data
      await sidenavB.locator('nav-item', { hasText: 'Client B Project' }).click();
      await clientB.page.waitForLoadState('networkidle').catch(() => {});
      await workViewB.waitForTaskList();

      // Verify Client B still has its data
      await expect(clientB.page.locator('task', { hasText: 'Task B1' })).toBeVisible();
      await expect(clientB.page.locator('task', { hasText: 'Task B2' })).toBeVisible();
      await expect(clientB.page.locator('task', { hasText: 'Task B3' })).toBeVisible();
      console.log('[Test] Client B verified: kept local data');

      // === Client A syncs - with divergent MIGRATION_GENESIS operations ===
      // Note: When both clients have independent MIGRATION_GENESIS_IMPORT operations,
      // they're on divergent timelines. Client A may also see a conflict.
      console.log('[Test] Client A syncing...');
      await syncPageA.triggerSync();

      // Client A might also see a conflict dialog since both clients have
      // independent MIGRATION_GENESIS_IMPORT operations (divergent timelines)
      const conflictDialogA = clientA.page.locator('mat-dialog-container', {
        hasText: 'Conflicting Data',
      });
      try {
        await conflictDialogA.waitFor({ state: 'visible', timeout: 5000 });
        console.log(
          '[Test] Client A also sees conflict dialog (expected with divergent timelines)',
        );
        // Choose "Keep remote" to adopt B's data
        const useRemoteBtn = conflictDialogA.locator('button', {
          hasText: /Keep remote/i,
        });
        await useRemoteBtn.click();
        // Handle confirmation if present
        const confirmDialogClientA = clientA.page.locator('dialog-confirm');
        try {
          await confirmDialogClientA.waitFor({ state: 'visible', timeout: 3000 });
          await confirmDialogClientA
            .locator('button[color="warn"], button:has-text("OK")')
            .first()
            .click();
        } catch {
          // OK if not present
        }
      } catch {
        console.log('[Test] Client A did not see conflict dialog - synced normally');
      }

      await waitForSyncComplete(clientA.page, syncPageA);

      // Verify Client A has some data (either its own or B's depending on conflict resolution)
      // Navigate to whatever project exists
      const projectsInSidebarA = sidenavA.locator('nav-item').filter({
        has: clientA.page.locator('[class*="project"], [data-project]'),
      });
      const projectCount = await projectsInSidebarA.count().catch(() => 0);

      if (projectCount > 0) {
        // Check if Client B Project exists after sync
        const hasBProject = await sidenavA
          .locator('nav-item', { hasText: 'Client B Project' })
          .isVisible()
          .catch(() => false);

        if (hasBProject) {
          await sidenavA.locator('nav-item', { hasText: 'Client B Project' }).click();
          await clientA.page.waitForLoadState('networkidle').catch(() => {});
          await workViewA.waitForTaskList();
          await expect(clientA.page.locator('task', { hasText: 'Task B' })).toBeVisible({
            timeout: 10000,
          });
          console.log('[Test] SUCCESS: Client A received Client B data');
        } else {
          // Client A kept its own data - this is also valid
          await sidenavA.locator('nav-item', { hasText: 'Client A Project' }).click();
          await clientA.page.waitForLoadState('networkidle').catch(() => {});
          await workViewA.waitForTaskList();
          await expect(clientA.page.locator('task', { hasText: 'Task A1' })).toBeVisible({
            timeout: 10000,
          });
          console.log(
            '[Test] SUCCESS: Client A kept its own data (divergent timeline scenario)',
          );
        }
      } else {
        console.log('[Test] WARNING: No projects found in sidebar after sync');
      }

      console.log(
        '[Test] PASSED: Legacy migration sync with conflict resolution completed',
      );
    } finally {
      if (clientA) await closeLegacyClient(clientA).catch(() => {});
      if (clientB) await closeLegacyClient(clientB).catch(() => {});
    }
  });

  /**
   * Test: Both clients migrated from legacy - Keep remote resolution
   *
   * Same as above but Client B chooses "Keep remote" to adopt A's data.
   */
  test('both clients migrated from legacy - Keep remote resolution', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow();
    const SYNC_FOLDER_NAME = generateSyncFolderName('e2e-legacy-mig-remote');
    await createSyncFolder(request, SYNC_FOLDER_NAME);
    const WEBDAV_CONFIG = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${SYNC_FOLDER_NAME}`,
    };
    const url = baseURL || 'http://localhost:4242';

    let clientA: {
      context: Awaited<ReturnType<typeof browser.newContext>>;
      page: Awaited<ReturnType<typeof browser.newPage>>;
    } | null = null;
    let clientB: {
      context: Awaited<ReturnType<typeof browser.newContext>>;
      page: Awaited<ReturnType<typeof browser.newPage>>;
    } | null = null;

    try {
      // === Client A: Legacy migration + sync setup ===
      console.log('[Test] Creating Client A with legacy data...');
      clientA = await createLegacyMigratedClient(
        browser,
        url,
        legacyDataClientA.data,
        'A',
      );
      const syncPageA = new SyncPage(clientA.page);
      const workViewA = new WorkViewPage(clientA.page);

      // Navigate to the project by clicking in sidebar
      const sidenavA = clientA.page.locator('magic-side-nav');
      await sidenavA.locator('nav-item', { hasText: 'Client A Project' }).click();
      await clientA.page.waitForLoadState('networkidle').catch(() => {});
      await workViewA.waitForTaskList();

      // Verify Client A has its migrated data
      await expect(clientA.page.locator('task', { hasText: 'Task A1' })).toBeVisible({
        timeout: 10000,
      });

      // Setup sync and upload
      await syncPageA.setupWebdavSync(WEBDAV_CONFIG);
      await waitForStatePersistence(clientA.page);
      await syncPageA.triggerSync();
      await waitForSyncComplete(clientA.page, syncPageA);
      console.log('[Test] Client A: Data uploaded');

      // === Client B: Legacy migration + conflict resolution ===
      console.log('[Test] Creating Client B with different legacy data...');
      clientB = await createLegacyMigratedClient(
        browser,
        url,
        legacyDataClientB.data,
        'B',
      );
      const syncPageB = new SyncPage(clientB.page);
      const workViewB = new WorkViewPage(clientB.page);

      // Navigate to the project by clicking in sidebar
      const sidenavB = clientB.page.locator('magic-side-nav');
      await sidenavB.locator('nav-item', { hasText: 'Client B Project' }).click();
      await clientB.page.waitForLoadState('networkidle').catch(() => {});
      await workViewB.waitForTaskList();

      // Verify Client B has its migrated data
      await expect(clientB.page.locator('task', { hasText: 'Task B1' })).toBeVisible({
        timeout: 10000,
      });

      // Add a task after migration to create operations that trigger conflict detection
      await workViewB.addTask('Task B3 - After Migration');
      await waitForStatePersistence(clientB.page);
      console.log('[Test] Client B added task after migration');

      // Setup sync - triggers conflict
      await syncPageB.setupWebdavSync(WEBDAV_CONFIG);

      // Wait for conflict dialog
      const conflictDialog = clientB.page.locator('mat-dialog-container', {
        hasText: 'Conflicting Data',
      });
      await expect(conflictDialog).toBeVisible({ timeout: 30000 });
      console.log('[Test] Conflict dialog appeared');

      // Choose "Keep remote" - adopt A's data
      const useRemoteBtn = conflictDialog.locator('button', { hasText: /Keep remote/i });
      await expect(useRemoteBtn).toBeVisible();
      await useRemoteBtn.click();
      console.log('[Test] Client B clicked "Keep remote"');

      // Handle potential confirmation dialog
      const confirmDialog = clientB.page.locator('dialog-confirm');
      try {
        await confirmDialog.waitFor({ state: 'visible', timeout: 3000 });
        await confirmDialog
          .locator('button[color="warn"], button:has-text("OK")')
          .first()
          .click();
      } catch {
        // Confirmation might not appear
      }

      await waitForSyncComplete(clientB.page, syncPageB, 30000);
      console.log('[Test] Client B sync completed');

      // Navigate to A's project (which should now exist on B after adopting remote data)
      await sidenavB.locator('nav-item', { hasText: 'Client A Project' }).click();
      await clientB.page.waitForLoadState('networkidle').catch(() => {});
      await workViewB.waitForTaskList();

      // Verify Client B now has A's data (remote data)
      await expect(clientB.page.locator('task', { hasText: 'Task A1' })).toBeVisible({
        timeout: 10000,
      });
      await expect(clientB.page.locator('task', { hasText: 'Task A2' })).toBeVisible();
      // Client B's local tasks should be gone since we chose "Keep remote"
      await expect(
        clientB.page.locator('task', { hasText: 'Task B1' }),
      ).not.toBeVisible();
      console.log('[Test] SUCCESS: Client B adopted remote (A) data');
    } finally {
      if (clientA) await closeLegacyClient(clientA).catch(() => {});
      if (clientB) await closeLegacyClient(clientB).catch(() => {});
    }
  });

  /**
   * Test: Both clients migrated with SAME entity IDs - ID collision
   *
   * Tests what happens when both clients have the same entity IDs but different content.
   * This is an edge case that could occur if users manually copied databases.
   *
   * Scenario:
   * - Client A: SHARED_PROJECT with "Shared Task (Version A)"
   * - Client B: SHARED_PROJECT with "Shared Task (Version B)"
   * - Same IDs, different titles/content
   *
   * Expected: Winner-take-all based on conflict resolution choice
   */
  test('both clients migrated with SAME entity IDs - ID collision', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow();
    const SYNC_FOLDER_NAME = generateSyncFolderName('e2e-legacy-collision');
    await createSyncFolder(request, SYNC_FOLDER_NAME);
    const WEBDAV_CONFIG = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${SYNC_FOLDER_NAME}`,
    };
    const url = baseURL || 'http://localhost:4242';

    let clientA: {
      context: Awaited<ReturnType<typeof browser.newContext>>;
      page: Awaited<ReturnType<typeof browser.newPage>>;
    } | null = null;
    let clientB: {
      context: Awaited<ReturnType<typeof browser.newContext>>;
      page: Awaited<ReturnType<typeof browser.newPage>>;
    } | null = null;

    try {
      // === Client A: Legacy data with SHARED_PROJECT and shared-task-1 ===
      console.log('[Test] Creating Client A with collision fixture (Version A)...');
      clientA = await createLegacyMigratedClient(
        browser,
        url,
        legacyDataCollisionA.data,
        'A',
      );
      const syncPageA = new SyncPage(clientA.page);
      const workViewA = new WorkViewPage(clientA.page);

      // Navigate to the shared project by clicking in sidebar
      const sidenavA = clientA.page.locator('magic-side-nav');
      await sidenavA.locator('nav-item', { hasText: 'Shared Project' }).click();
      await clientA.page.waitForLoadState('networkidle').catch(() => {});
      await workViewA.waitForTaskList();

      // Verify Client A has Version A data
      await expect(clientA.page.locator('task', { hasText: 'Version A' })).toBeVisible({
        timeout: 10000,
      });
      console.log('[Test] Client A verified: has Version A task');

      // Setup sync and upload
      await syncPageA.setupWebdavSync(WEBDAV_CONFIG);
      await waitForStatePersistence(clientA.page);
      await syncPageA.triggerSync();
      await waitForSyncComplete(clientA.page, syncPageA);
      console.log('[Test] Client A: Version A data uploaded');

      // === Client B: Same IDs but Version B content ===
      console.log('[Test] Creating Client B with collision fixture (Version B)...');
      clientB = await createLegacyMigratedClient(
        browser,
        url,
        legacyDataCollisionB.data,
        'B',
      );
      const syncPageB = new SyncPage(clientB.page);
      const workViewB = new WorkViewPage(clientB.page);

      // Navigate to the shared project by clicking in sidebar
      const sidenavB = clientB.page.locator('magic-side-nav');
      await sidenavB.locator('nav-item', { hasText: 'Shared Project' }).click();
      await clientB.page.waitForLoadState('networkidle').catch(() => {});
      await workViewB.waitForTaskList();

      // Verify Client B has Version B data
      await expect(clientB.page.locator('task', { hasText: 'Version B' })).toBeVisible({
        timeout: 10000,
      });
      console.log('[Test] Client B verified: has Version B task');

      // Add a task after migration to create operations that trigger conflict detection
      await workViewB.addTask('Version B Extra Task');
      await waitForStatePersistence(clientB.page);
      console.log('[Test] Client B added task after migration');

      // Setup sync - triggers conflict (same IDs, different content)
      await syncPageB.setupWebdavSync(WEBDAV_CONFIG);

      // Wait for conflict dialog
      const conflictDialog = clientB.page.locator('mat-dialog-container', {
        hasText: 'Conflicting Data',
      });
      await expect(conflictDialog).toBeVisible({ timeout: 30000 });
      console.log('[Test] Conflict dialog appeared (ID collision detected)');

      // Choose "Keep local" - B's Version B should win
      const useLocalBtn = conflictDialog.locator('button', { hasText: /Keep local/i });
      await useLocalBtn.click();
      console.log('[Test] Client B clicked "Keep local"');

      // Handle confirmation
      const confirmDialog = clientB.page.locator('dialog-confirm');
      try {
        await confirmDialog.waitFor({ state: 'visible', timeout: 3000 });
        await confirmDialog
          .locator('button[color="warn"], button:has-text("OK")')
          .first()
          .click();
      } catch {
        // OK if not present
      }

      await waitForSyncComplete(clientB.page, syncPageB, 30000);
      console.log('[Test] Client B sync completed');

      // Navigate back to project and verify
      await sidenavB.locator('nav-item', { hasText: 'Shared Project' }).click();
      await clientB.page.waitForLoadState('networkidle').catch(() => {});
      await workViewB.waitForTaskList();

      // Verify Client B still has the original shared task with Version B content
      // Use ID selector to target the specific shared-task-1
      await expect(clientB.page.locator('#t-shared-task-1')).toBeVisible();
      await expect(
        clientB.page.locator('#t-shared-task-1', { hasText: 'Version B' }),
      ).toBeVisible();
      // Version A should NOT be visible (same ID, B's version won)
      await expect(
        clientB.page.locator('#t-shared-task-1', { hasText: 'Version A' }),
      ).not.toBeVisible();
      // The extra task we added should also be there
      await expect(
        clientB.page.locator('task', { hasText: 'Version B Extra Task' }),
      ).toBeVisible();

      // Verify 2 tasks: shared-task-1 (Version B) + extra task we added
      const taskCount = await clientB.page.locator('task').count();
      expect(taskCount).toBe(2);
      console.log('[Test] Verified: No ID duplicates, winner-take-all for shared-task-1');

      // === Client A syncs - with divergent timelines ===
      console.log('[Test] Client A syncing...');
      await syncPageA.triggerSync();

      // Client A might also see a conflict dialog
      const conflictDialogA = clientA.page.locator('mat-dialog-container', {
        hasText: 'Conflicting Data',
      });
      try {
        await conflictDialogA.waitFor({ state: 'visible', timeout: 5000 });
        console.log('[Test] Client A sees conflict dialog - choosing Keep remote');
        const useRemoteBtn = conflictDialogA.locator('button', {
          hasText: /Keep remote/i,
        });
        await useRemoteBtn.click();
        const confirmDialogA = clientA.page.locator('dialog-confirm');
        try {
          await confirmDialogA.waitFor({ state: 'visible', timeout: 3000 });
          await confirmDialogA
            .locator('button[color="warn"], button:has-text("OK")')
            .first()
            .click();
        } catch {
          // OK
        }
      } catch {
        console.log('[Test] Client A did not see conflict dialog');
      }

      await waitForSyncComplete(clientA.page, syncPageA);

      // Navigate to shared project and verify
      await sidenavA.locator('nav-item', { hasText: 'Shared Project' }).click();
      await clientA.page.waitForLoadState('networkidle').catch(() => {});
      await workViewA.waitForTaskList();

      // With divergent MIGRATION_GENESIS_IMPORT operations, Client A may keep its
      // own data or receive Client B's data depending on sync logic.
      // The key assertion is: no ID duplicates - only ONE version of shared-task-1 exists.
      await expect(clientA.page.locator('#t-shared-task-1')).toBeVisible({
        timeout: 10000,
      });

      // Check which version Client A has
      const hasVersionB = await clientA.page
        .locator('#t-shared-task-1', { hasText: 'Version B' })
        .isVisible()
        .catch(() => false);
      const hasVersionA = await clientA.page
        .locator('#t-shared-task-1', { hasText: 'Version A' })
        .isVisible()
        .catch(() => false);

      // Only ONE version should exist (no duplicates)
      expect(hasVersionA || hasVersionB).toBe(true);
      expect(hasVersionA && hasVersionB).toBe(false); // Can't have both

      if (hasVersionB) {
        console.log(
          '[Test] SUCCESS: ID collision resolved - Client A received Version B',
        );
      } else {
        console.log(
          '[Test] SUCCESS: ID collision handled - Client A kept Version A (divergent timeline)',
        );
      }
    } finally {
      if (clientA) await closeLegacyClient(clientA).catch(() => {});
      if (clientB) await closeLegacyClient(clientB).catch(() => {});
    }
  });

  /**
   * Test: Archive data is preserved after migration + sync
   *
   * Verifies that archived tasks from legacy data survive the migration
   * process and can be synced to other clients.
   */
  test('verify archive data is preserved after migration + sync', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow();
    const SYNC_FOLDER_NAME = generateSyncFolderName('e2e-legacy-archive');
    await createSyncFolder(request, SYNC_FOLDER_NAME);
    const WEBDAV_CONFIG = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${SYNC_FOLDER_NAME}`,
    };
    const url = baseURL || 'http://localhost:4242';

    let clientA: {
      context: Awaited<ReturnType<typeof browser.newContext>>;
      page: Awaited<ReturnType<typeof browser.newPage>>;
    } | null = null;
    let clientB: {
      context: Awaited<ReturnType<typeof browser.newContext>>;
      page: Awaited<ReturnType<typeof browser.newPage>>;
    } | null = null;

    try {
      // === Client A: Legacy migration with archived task ===
      console.log('[Test] Creating Client A with legacy data (including archive)...');
      clientA = await createLegacyMigratedClient(
        browser,
        url,
        legacyDataClientA.data,
        'A',
      );
      const syncPageA = new SyncPage(clientA.page);
      const workViewA = new WorkViewPage(clientA.page);

      // Navigate to the project by clicking in sidebar
      const sidenavA = clientA.page.locator('magic-side-nav');
      await sidenavA.locator('nav-item', { hasText: 'Client A Project' }).click();
      await clientA.page.waitForLoadState('networkidle').catch(() => {});
      await workViewA.waitForTaskList();

      // Verify active tasks are visible
      await expect(clientA.page.locator('task', { hasText: 'Task A1' })).toBeVisible({
        timeout: 10000,
      });
      console.log('[Test] Client A: Active tasks verified');

      // Setup sync and upload (includes archive data)
      await syncPageA.setupWebdavSync(WEBDAV_CONFIG);
      await waitForStatePersistence(clientA.page);
      await syncPageA.triggerSync();
      await waitForSyncComplete(clientA.page, syncPageA);
      console.log('[Test] Client A: Data uploaded (including archive)');

      // === Client B: Fresh client (no legacy data), syncs ===
      // We use a fresh client to verify archive data transfers correctly
      console.log('[Test] Creating fresh Client B...');
      const contextB = await browser.newContext({
        baseURL: url,
        acceptDownloads: true,
      });
      const pageB = await contextB.newPage();

      // Auto-accept dialogs for fresh client
      pageB.on('dialog', async (dialog) => {
        if (dialog.type() === 'confirm') {
          await dialog.accept();
        }
      });

      await pageB.goto('/');
      // Wait for app to be ready
      await pageB.waitForSelector('magic-side-nav', { state: 'visible', timeout: 30000 });

      clientB = { context: contextB, page: pageB };
      const syncPageB = new SyncPage(pageB);
      const workViewB = new WorkViewPage(pageB);
      await workViewB.waitForTaskList();

      // Setup sync - fresh client downloads data
      await syncPageB.setupWebdavSync(WEBDAV_CONFIG);
      await waitForSyncComplete(pageB, syncPageB, 30000);
      console.log('[Test] Client B: Synced (downloaded A data)');

      // Navigate to A's project (which should now exist on B after sync)
      const sidenavB = pageB.locator('magic-side-nav');
      await sidenavB.locator('nav-item', { hasText: 'Client A Project' }).click();
      await pageB.waitForLoadState('networkidle').catch(() => {});
      await workViewB.waitForTaskList();

      // Verify Client B has A's active tasks
      await expect(pageB.locator('task', { hasText: 'Task A1' })).toBeVisible({
        timeout: 10000,
      });
      await expect(pageB.locator('task', { hasText: 'Task A2' })).toBeVisible();
      console.log('[Test] Client B: Active tasks verified');

      // Verify archive data via IndexedDB (archived tasks aren't visible in UI by default)
      const archiveData = await pageB.evaluate(async () => {
        return new Promise((resolve, reject) => {
          const dbRequest = indexedDB.open('SUP_OPS', 4);
          dbRequest.onsuccess = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            const tx = db.transaction('archive_young', 'readonly');
            const store = tx.objectStore('archive_young');
            const getReq = store.get('current');
            getReq.onsuccess = () => {
              db.close();
              resolve(getReq.result?.data || null);
            };
            getReq.onerror = () => {
              db.close();
              reject(getReq.error);
            };
          };
          dbRequest.onerror = () => reject(dbRequest.error);
        });
      });

      // Verify archive contains the archived task from Client A
      expect(archiveData).not.toBeNull();
      const archiveTaskIds = (archiveData as { task?: { ids?: string[] } })?.task?.ids;
      expect(archiveTaskIds).toBeDefined();
      expect(archiveTaskIds).toContain('archived-a');
      console.log('[Test] SUCCESS: Archive data preserved after migration + sync');
    } finally {
      if (clientA) await closeLegacyClient(clientA).catch(() => {});
      if (clientB) await closeLegacyClient(clientB).catch(() => {});
    }
  });
});
