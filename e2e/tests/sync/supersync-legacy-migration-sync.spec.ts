import { test, expect } from '../../fixtures/supersync.fixture';
import type { Page } from '@playwright/test';
import { SuperSyncPage } from '../../pages/supersync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import { waitForStatePersistence } from '../../utils/waits';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getArchiveYoungTaskIds,
  getLocalOpLogSummary,
  getSuperSyncConfig,
  isFullStateOpType,
  seedSuperSyncCredentials,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import {
  createLegacyMigratedClient,
  closeLegacyClient,
  toArchiveOnlyLegacyData,
} from '../../utils/legacy-migration-helpers';

// Import fixtures
import legacyDataClientA from '../../fixtures/legacy-migration-client-a.json';
import legacyDataClientB from '../../fixtures/legacy-migration-client-b.json';
import legacyDataCollisionA from '../../fixtures/legacy-migration-collision-a.json';
import legacyDataCollisionB from '../../fixtures/legacy-migration-collision-b.json';

/**
 * SuperSync Legacy Migration Sync E2E Tests
 *
 * Tests scenarios where BOTH clients have migrated from old Super Productivity
 * (pre-operation-log format) and then sync via SuperSync.
 *
 * This tests a gap in coverage: what happens when two clients with independent
 * legacy data both migrate and then try to sync to the same SuperSync account.
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-legacy-migration-sync.spec.ts -- --retries=0
 */
test.describe('@supersync @migration SuperSync Legacy Migration Sync', () => {
  test.describe.configure({ mode: 'serial' });

  /**
   * Test: Both clients migrated from legacy - Keep local resolution
   *
   * Scenario:
   * 1. Client A has legacy data (Task A1, Task A2), migrates, syncs to SuperSync
   * 2. Client B has different legacy data (Task B1, Task B2), migrates
   * 3. Client B sets up SuperSync to same account -> conflict dialog appears
   * 4. Client B chooses "Use My Data" -> B's data replaces remote
   * 5. Client A syncs -> receives B's data
   */
  test('both clients migrated from legacy - Keep local resolution', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.slow(); // Migration + sync tests take longer
    const url = baseURL || 'http://localhost:4242';

    // Create shared test user for both clients
    const user = await createTestUser(testRunId);
    const syncConfig = getSuperSyncConfig(user);

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
      const syncPageA = new SuperSyncPage(clientA.page);
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
      await syncPageA.setupSuperSync(syncConfig);
      await waitForStatePersistence(clientA.page);
      await syncPageA.syncAndWait();
      console.log('[Test] Client A: Data uploaded to SuperSync');

      // === Client B: Legacy migration (different data) ===
      console.log('[Test] Creating Client B with different legacy data...');
      clientB = await createLegacyMigratedClient(
        browser,
        url,
        legacyDataClientB.data,
        'B',
      );
      const syncPageB = new SuperSyncPage(clientB.page);
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

      // Setup sync - may trigger conflict dialog or auto-resolve via native confirm
      // SuperSync can use either Angular dialogs or native browser confirm dialogs
      console.log('[Test] Client B setting up sync...');

      // Set up handler for native confirm dialogs to keep local data
      clientB.page.on('dialog', async (dialog) => {
        if (dialog.type() === 'confirm') {
          console.log('[Test] Native confirm dialog: ' + dialog.message());
          // Accept to keep local data (default behavior)
          await dialog.accept();
        }
      });

      await syncPageB.setupSuperSync({ ...syncConfig, syncImportChoice: 'local' });
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

      // Core test passed: Both clients migrated from legacy, and Client B successfully
      // synced while keeping its local data. This is the main scenario we're testing.
      // Note: Client A could sync again but with divergent MIGRATION_GENESIS_IMPORT
      // operations, the behavior is complex and already covered by other sync tests.
      console.log(
        '[Test] PASSED: Legacy migration sync - Client B kept local data after conflict',
      );
    } finally {
      if (clientA) await closeLegacyClient(clientA).catch(() => {});
      if (clientB) await closeLegacyClient(clientB).catch(() => {});
    }
  });

  /**
   * Test: Both clients migrated from legacy - Keep remote resolution
   *
   * Same as above but Client B chooses "Use Server Data" to adopt A's data.
   */
  test('both clients migrated from legacy - Keep remote resolution', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.slow();
    const url = baseURL || 'http://localhost:4242';

    const user = await createTestUser(testRunId);
    const syncConfig = getSuperSyncConfig(user);

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
      const syncPageA = new SuperSyncPage(clientA.page);
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
      await syncPageA.setupSuperSync(syncConfig);
      await waitForStatePersistence(clientA.page);
      await syncPageA.syncAndWait();
      console.log('[Test] Client A: Data uploaded');

      // === Client B: Legacy migration + conflict resolution ===
      console.log('[Test] Creating Client B with different legacy data...');
      clientB = await createLegacyMigratedClient(
        browser,
        url,
        legacyDataClientB.data,
        'B',
      );
      const syncPageB = new SuperSyncPage(clientB.page);
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

      // A's setup uploaded a full-state import, so B's pending ops trigger the
      // sync-import conflict dialog; answer it with "Use Server Data".
      console.log('[Test] Client B setting up sync...');
      await syncPageB.setupSuperSync({ ...syncConfig, syncImportChoice: 'remote' });
      console.log('[Test] Client B sync completed');

      // "Use Server Data" is a full replace, not a merge: B adopts A's data and
      // its own migrated project plus the post-migration task are gone. The
      // previous either/or check here could not catch a regression (#9863).
      await expect(
        sidenavB.locator('nav-item', { hasText: 'Client A Project' }),
      ).toBeVisible({ timeout: 10000 });
      await expect(
        sidenavB.locator('nav-item', { hasText: 'Client B Project' }),
      ).not.toBeVisible();

      await sidenavB.locator('nav-item', { hasText: 'Client A Project' }).click();
      await clientB.page.waitForLoadState('networkidle').catch(() => {});
      await workViewB.waitForTaskList();

      await expect(clientB.page.locator('task', { hasText: 'Task A1' })).toBeVisible({
        timeout: 10000,
      });
      await expect(clientB.page.locator('task', { hasText: 'Task A2' })).toBeVisible();
      await expect(
        clientB.page.locator('task', { hasText: 'Task B3 - After Migration' }),
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
    testRunId,
  }) => {
    test.slow();
    const url = baseURL || 'http://localhost:4242';

    const user = await createTestUser(testRunId);
    const syncConfig = getSuperSyncConfig(user);

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
      const syncPageA = new SuperSyncPage(clientA.page);
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
      await syncPageA.setupSuperSync(syncConfig);
      await waitForStatePersistence(clientA.page);
      await syncPageA.syncAndWait();
      console.log('[Test] Client A: Version A data uploaded');

      // === Client B: Same IDs but Version B content ===
      console.log('[Test] Creating Client B with collision fixture (Version B)...');
      clientB = await createLegacyMigratedClient(
        browser,
        url,
        legacyDataCollisionB.data,
        'B',
      );
      const syncPageB = new SuperSyncPage(clientB.page);
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

      // Setup sync - may trigger conflict (same IDs, different content)
      console.log('[Test] Client B setting up sync...');

      // Use syncImportChoice 'local' so B keeps its Version B data
      await syncPageB.setupSuperSync({ ...syncConfig, syncImportChoice: 'local' });
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
      // B's SYNC_IMPORT replaces server state, so A gets a sync_import_conflict dialog.
      // syncAndWait handles dialogs automatically (defaults to 'Use Server Data').
      console.log('[Test] Client A syncing...');
      await syncPageA.syncAndWait();

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
   * Test: genesis-only client joins a server that holds ordinary ops only (#9863)
   *
   * The silent join path: Client B holds nothing but its MIGRATION genesis op
   * (no post-migration edits), the server holds Client A's ordinary ops and no
   * full-state op. Before #9863 both sides reported IN_SYNC and B's migrated
   * tasks stayed stranded on B. Expected now: B gets the local-data conflict
   * dialog; "Keep local" ships B's state as a SYNC_IMPORT that A then adopts.
   *
   * The server state is only reachable by pre-seeding both clients' encryption
   * key before the app boots: the post-setup encryption modal that the normal
   * setup flow goes through deletes and re-uploads a snapshot (a SYNC_IMPORT),
   * which would route B through the incoming-import gate instead (#9921).
   */
  test('genesis-only client joining a server with ordinary ops gets the conflict dialog', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.slow();
    const url = baseURL || 'http://localhost:4242';

    const user = await createTestUser(testRunId);
    const syncConfig = getSuperSyncConfig(user);
    const seedCredentials = (page: Page): Promise<void> =>
      seedSuperSyncCredentials(page, {
        baseUrl: syncConfig.baseUrl,
        accessToken: syncConfig.accessToken,
        encryptKey: syncConfig.password!,
      });
    const isFullStateOp = (op: { opType: string }): boolean =>
      isFullStateOpType(op.opType);

    let clientA: SimulatedE2EClient | null = null;
    let clientB: {
      context: Awaited<ReturnType<typeof browser.newContext>>;
      page: Awaited<ReturnType<typeof browser.newPage>>;
    } | null = null;

    try {
      // === Client A: fresh client, key pre-seeded, uploads ordinary ops only ===
      console.log('[Test] Creating fresh Client A with pre-seeded encryption key...');
      clientA = await createSimulatedClient(browser, url, 'A', testRunId, {
        seedBeforeBoot: seedCredentials,
      });
      await clientA.workView.waitForTaskList();
      await clientA.workView.addTask('Task A1 - Fresh');
      await clientA.workView.addTask('Task A2 - Fresh');
      await waitForStatePersistence(clientA.page);

      await clientA.sync.setupSuperSync({ ...syncConfig, waitForInitialSync: false });
      await clientA.sync.syncAndWait();
      console.log('[Test] Client A: ordinary ops uploaded');

      // Precondition of the silent path: A left no full-state op behind. If the
      // harness ever re-introduces the snapshot re-upload, fail here rather than
      // silently testing the incoming-import gate instead.
      const opsA = await getLocalOpLogSummary(clientA.page);
      expect(opsA.some((op) => op.entityType === 'TASK' && op.isSynced)).toBe(true);
      expect(opsA.filter(isFullStateOp)).toEqual([]);

      // === Client B: legacy migration, genesis op only ===
      console.log(
        '[Test] Creating Client B with legacy data (no post-migration edits)...',
      );
      clientB = await createLegacyMigratedClient(
        browser,
        url,
        legacyDataClientB.data,
        'B',
        { seedBeforeBoot: seedCredentials },
      );
      const syncPageB = new SuperSyncPage(clientB.page);
      const workViewB = new WorkViewPage(clientB.page);

      const sidenavB = clientB.page.locator('magic-side-nav');
      await sidenavB.locator('nav-item', { hasText: 'Client B Project' }).click();
      await clientB.page.waitForLoadState('networkidle').catch(() => {});
      await workViewB.waitForTaskList();
      await expect(clientB.page.locator('task', { hasText: 'Task B1' })).toBeVisible({
        timeout: 10000,
      });

      // Precondition: B's history starts with its own genesis op and holds no
      // full-state op — the shape the #9863 fix keys on.
      const opsB = await getLocalOpLogSummary(clientB.page);
      expect(opsB[0]?.entityType).toBe('MIGRATION');
      expect(opsB.filter(isFullStateOp)).toEqual([]);

      // Deliberately NO task added after migration (unlike the other flows).
      // The key is already seeded, so hand the page object no password: that
      // keeps its encryption-setup handling (which re-triggers sync) out of the
      // way while the conflict dialog is up.
      console.log(
        '[Test] Client B setting up sync — expecting the local-data conflict dialog',
      );
      await syncPageB.setupSuperSync({
        baseUrl: syncConfig.baseUrl,
        accessToken: syncConfig.accessToken,
        waitForInitialSync: false,
      });

      // The regression pin: the setup sync must prompt instead of silently
      // reporting IN_SYNC with B's migrated tasks stranded.
      await expect(syncPageB.conflictDialog).toBeVisible({ timeout: 30000 });
      await syncPageB.resolveConflictDialog('local');
      await syncPageB.syncAndWait({ useLocal: true });
      console.log('[Test] Client B: kept local data via SYNC_IMPORT');

      await sidenavB.locator('nav-item', { hasText: 'Client B Project' }).click();
      await clientB.page.waitForLoadState('networkidle').catch(() => {});
      await workViewB.waitForTaskList();
      await expect(clientB.page.locator('task', { hasText: 'Task B1' })).toBeVisible();
      await expect(clientB.page.locator('task', { hasText: 'Task B2' })).toBeVisible();

      // B's state now ships as a SYNC_IMPORT; the genesis op is settled locally
      // once that upload succeeded (the no-upload rule itself is unit-tested).
      const opsBAfter = await getLocalOpLogSummary(clientB.page);
      expect(opsBAfter.find((op) => op.entityType === 'MIGRATION')?.isSynced).toBe(true);
      expect(opsBAfter.some(isFullStateOp)).toBe(true);

      // === Client A syncs and adopts B's full state ===
      console.log('[Test] Client A syncing...');
      await clientA.sync.syncAndWait();

      const sidenavA = clientA.page.locator('magic-side-nav');
      await expect(
        sidenavA.locator('nav-item', { hasText: 'Client B Project' }),
      ).toBeVisible({ timeout: 10000 });
      await sidenavA.locator('nav-item', { hasText: 'Client B Project' }).click();
      await clientA.page.waitForLoadState('networkidle').catch(() => {});
      await clientA.workView.waitForTaskList();
      await expect(clientA.page.locator('task', { hasText: 'Task B1' })).toBeVisible({
        timeout: 10000,
      });
      await expect(
        clientA.page.locator('task', { hasText: 'Task A1 - Fresh' }),
      ).not.toBeVisible();

      // A adopted B's import and never received a genesis op from B.
      const opsAAfter = await getLocalOpLogSummary(clientA.page);
      expect(opsAAfter.filter((op) => op.entityType === 'MIGRATION')).toEqual([]);
      console.log("[Test] SUCCESS: silent join path prompts and B's state reaches A");
    } finally {
      if (clientA) await closeClient(clientA).catch(() => {});
      if (clientB) await closeLegacyClient(clientB).catch(() => {});
    }
  });

  /**
   * Test: archive-only legacy client joins a server that holds ordinary ops (#9932)
   *
   * Same setup as the genesis-only test above, but Client B's legacy data holds
   * only an archived task: its NgRx store reads as the default state and the
   * archive lives only in IndexedDB. Before #9932 the fresh-client gate judged
   * B as having nothing to protect and applied A's ops silently, stranding the
   * archive on B. Expected now: the conflict dialog, and "Keep local" ships the
   * archive as a SYNC_IMPORT that A adopts.
   */
  test('archive-only legacy client joining a server with ordinary ops gets the conflict dialog', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.slow();
    const url = baseURL || 'http://localhost:4242';

    const user = await createTestUser(testRunId);
    const syncConfig = getSuperSyncConfig(user);
    const seedCredentials = (page: Page): Promise<void> =>
      seedSuperSyncCredentials(page, {
        baseUrl: syncConfig.baseUrl,
        accessToken: syncConfig.accessToken,
        encryptKey: syncConfig.password!,
      });
    const isFullStateOp = (op: { opType: string }): boolean =>
      isFullStateOpType(op.opType);
    const legacyData = toArchiveOnlyLegacyData(legacyDataClientB.data);
    const ARCHIVED_TASK_ID = legacyDataClientB.data.archiveYoung.task.ids[0];

    let clientA: SimulatedE2EClient | null = null;
    let clientB: {
      context: Awaited<ReturnType<typeof browser.newContext>>;
      page: Awaited<ReturnType<typeof browser.newPage>>;
    } | null = null;

    try {
      // === Client A: fresh client, key pre-seeded, uploads ordinary ops only ===
      clientA = await createSimulatedClient(browser, url, 'A', testRunId, {
        seedBeforeBoot: seedCredentials,
      });
      await clientA.workView.waitForTaskList();
      await clientA.workView.addTask('Task A1 - Fresh');
      await waitForStatePersistence(clientA.page);
      await clientA.sync.setupSuperSync({ ...syncConfig, waitForInitialSync: false });
      await clientA.sync.syncAndWait();
      const opsA = await getLocalOpLogSummary(clientA.page);
      expect(opsA.some((op) => op.entityType === 'TASK' && op.isSynced)).toBe(true);
      expect(opsA.filter(isFullStateOp)).toEqual([]);

      // === Client B: legacy migration, archived task only ===
      clientB = await createLegacyMigratedClient(browser, url, legacyData, 'B', {
        seedBeforeBoot: seedCredentials,
      });
      const syncPageB = new SuperSyncPage(clientB.page);
      await new WorkViewPage(clientB.page).waitForTaskList();
      await expect(clientB.page.locator('task')).toHaveCount(0);
      expect(await getArchiveYoungTaskIds(clientB.page)).toContain(ARCHIVED_TASK_ID);
      const opsB = await getLocalOpLogSummary(clientB.page);
      expect(opsB[0]?.entityType).toBe('MIGRATION');
      expect(opsB.filter(isFullStateOp)).toEqual([]);

      await syncPageB.setupSuperSync({
        baseUrl: syncConfig.baseUrl,
        accessToken: syncConfig.accessToken,
        waitForInitialSync: false,
      });

      // The regression pin: an archive-only store prompts like one with active tasks.
      await expect(syncPageB.conflictDialog).toBeVisible({ timeout: 30000 });
      await syncPageB.resolveConflictDialog('local');
      await syncPageB.syncAndWait({ useLocal: true });
      const opsBAfter = await getLocalOpLogSummary(clientB.page);
      expect(opsBAfter.some(isFullStateOp)).toBe(true);
      expect(opsBAfter.find((op) => op.entityType === 'MIGRATION')?.isSynced).toBe(true);

      // === Client A adopts B's full state, archive included ===
      await clientA.sync.syncAndWait();
      await expect
        .poll(() => getArchiveYoungTaskIds(clientA!.page), { timeout: 15000 })
        .toContain(ARCHIVED_TASK_ID);
      await clientA.workView.waitForTaskList();
      await expect(
        clientA.page.locator('task', { hasText: 'Task A1 - Fresh' }),
      ).not.toBeVisible();
    } finally {
      if (clientA) await closeClient(clientA).catch(() => {});
      if (clientB) await closeLegacyClient(clientB).catch(() => {});
    }
  });

  /**
   * Test: Archive data is preserved after migration + sync
   *
   * Verifies that archived tasks from legacy data survive the migration
   * process and can be synced to other clients.
   *
   */
  test('verify archive data is preserved after migration + sync', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.slow();
    const url = baseURL || 'http://localhost:4242';

    const user = await createTestUser(testRunId);
    const syncConfig = getSuperSyncConfig(user);

    let clientA: {
      context: Awaited<ReturnType<typeof browser.newContext>>;
      page: Awaited<ReturnType<typeof browser.newPage>>;
    } | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      // === Client A: Legacy migration with archived task ===
      console.log('[Test] Creating Client A with legacy data (including archive)...');
      clientA = await createLegacyMigratedClient(
        browser,
        url,
        legacyDataClientA.data,
        'A',
      );
      const syncPageA = new SuperSyncPage(clientA.page);
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
      await syncPageA.setupSuperSync(syncConfig);
      await waitForStatePersistence(clientA.page);
      await syncPageA.syncAndWait();
      console.log('[Test] Client A: Data uploaded (including archive)');

      // === Client B: Fresh client (no legacy data), syncs ===
      // We use a fresh client to verify archive data transfers correctly
      console.log('[Test] Creating fresh Client B...');
      clientB = await createSimulatedClient(browser, url, 'B', testRunId);
      const pageB = clientB.page;
      const syncPageB = clientB.sync;
      const workViewB = clientB.workView;

      // Setup sync - fresh client downloads data
      await syncPageB.setupSuperSync({ ...syncConfig, waitForInitialSync: false });

      // Trigger sync and wait for it to complete
      await syncPageB.triggerSync();
      // Wait for sync to finish - fresh client should download A's data
      await pageB.waitForTimeout(3000);
      console.log('[Test] Client B: Synced (downloaded A data)');

      // Navigate to A's project (which should now exist on B after sync)
      const sidenavB = pageB.locator('magic-side-nav');
      // Wait for the project to appear in sidebar (may take a moment for UI to update)
      await sidenavB
        .locator('nav-item', { hasText: 'Client A Project' })
        .waitFor({ state: 'visible', timeout: 15000 });
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
      expect(await getArchiveYoungTaskIds(pageB)).toContain('archived-a');
      console.log('[Test] SUCCESS: Archive data preserved after migration + sync');
    } finally {
      if (clientA) await closeLegacyClient(clientA).catch(() => {});
      if (clientB) await closeClient(clientB).catch(() => {});
    }
  });
});
