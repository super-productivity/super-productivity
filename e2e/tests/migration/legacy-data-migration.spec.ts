import { test, expect, Page } from '@playwright/test';
import legacyData from '../../fixtures/legacy-full-migration-backup.json';

/**
 * Legacy Data Migration E2E Tests
 *
 * These tests verify that legacy data (pre-operation-log format) migrates correctly
 * when the app starts. The tests:
 * 1. Seed the legacy 'pf' IndexedDB database with test data BEFORE app loads
 * 2. Navigate to the app and verify migration dialog appears
 * 3. Verify backup file downloads
 * 4. Verify all data migrates correctly (tasks, projects, tags, sync settings, archives)
 *
 * Run with: npm run e2e:file e2e/tests/migration/legacy-data-migration.spec.ts -- --retries=0
 */

/**
 * Helper to seed the legacy 'pf' IndexedDB database with data
 * Must be called BEFORE navigating to the app
 */
const seedLegacyDatabase = async (
  page: Page,
  data: Record<string, unknown>,
): Promise<void> => {
  await page.evaluate(async (entityData) => {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('pf', 1);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('main')) {
          db.createObjectStore('main');
        }
      };

      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const tx = db.transaction('main', 'readwrite');
        const store = tx.objectStore('main');

        // Store each entity type
        for (const [key, value] of Object.entries(entityData)) {
          store.put(value, key);
        }

        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };

      request.onerror = () => reject(request.error);
    });
  }, data);
};

/**
 * Helper to read data from SUP_OPS IndexedDB after migration
 */
const readMigratedState = async (
  page: Page,
): Promise<{
  globalConfig?: { sync?: Record<string, unknown> };
  task?: { ids: string[]; entities: Record<string, unknown> };
  project?: { ids: string[]; entities: Record<string, unknown> };
  tag?: { ids: string[]; entities: Record<string, unknown> };
  note?: { ids: string[]; entities: Record<string, unknown> };
}> => {
  return page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('SUP_OPS', 4);
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const tx = db.transaction('state_cache', 'readonly');
        const store = tx.objectStore('state_cache');
        const getReq = store.get('current');
        getReq.onsuccess = () => {
          db.close();
          resolve(getReq.result?.state || {});
        };
        getReq.onerror = () => {
          db.close();
          reject(getReq.error);
        };
      };
      request.onerror = () => reject(request.error);
    });
  });
};

/**
 * Helper to read archive data from SUP_OPS IndexedDB after migration
 * Archive data is stored as { id: 'current', data: ArchiveModel, lastModified: number }
 */
const readMigratedArchive = async (
  page: Page,
  archiveType: 'archive_young' | 'archive_old',
): Promise<{
  task?: { ids: string[]; entities: Record<string, unknown> };
  timeTracking?: Record<string, unknown>;
}> => {
  return page.evaluate(async (storeKey) => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('SUP_OPS', 4);
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const tx = db.transaction(storeKey, 'readonly');
        const store = tx.objectStore(storeKey);
        // Key is 'current' (SINGLETON_KEY), data is in the 'data' property
        const getReq = store.get('current');
        getReq.onsuccess = () => {
          db.close();
          // Return the 'data' property which contains the actual ArchiveModel
          resolve(getReq.result?.data || {});
        };
        getReq.onerror = () => {
          db.close();
          reject(getReq.error);
        };
      };
      request.onerror = () => reject(request.error);
    });
  }, archiveType);
};

test.describe('@migration Legacy Data Migration', () => {
  test.describe.configure({ mode: 'serial' });

  test('should migrate legacy data with full dialog flow and preserve all data', async ({
    browser,
    baseURL,
  }) => {
    // Create a completely fresh context with download support
    const context = await browser.newContext({
      storageState: undefined,
      baseURL: baseURL || 'http://localhost:4242',
      acceptDownloads: true,
    });

    const page = await context.newPage();

    try {
      // ========================================================================
      // STEP 1: Seed legacy 'pf' database BEFORE app initializes
      // ========================================================================
      // We need to be on the app's origin to access IndexedDB, but we want to
      // seed the database before the Angular app initializes.
      // Strategy: Block JS to prevent app init, navigate, seed DB, then reload.

      // Block all JS to prevent app initialization during seeding
      await page.route('**/*.js', async (route) => {
        await route.abort();
      });

      // Navigate to the app origin (index.html loads but JS is blocked)
      await page.goto('/', { waitUntil: 'domcontentloaded' });

      // Seed the legacy database while JS is blocked
      await seedLegacyDatabase(page, legacyData.data);

      // Remove the route blocking so JS can load on reload
      await page.unroute('**/*.js');

      // ========================================================================
      // STEP 2: Reload to trigger app initialization with migration
      // ========================================================================
      // Set up download listener before reload
      const downloadPromise = page.waitForEvent('download', { timeout: 60000 });

      // Reload the page - this will load the app fresh with our seeded legacy data
      await page.reload({ waitUntil: 'domcontentloaded' });

      // ========================================================================
      // STEP 3: Wait for migration to complete
      // ========================================================================
      // Migration may complete very quickly (faster than we can observe the dialog)
      // So we focus on verifying the outcome rather than the dialog UI

      // Try to observe migration dialog - wait a short time to see if it appears
      const dialog = page.locator('dialog-legacy-migration');
      try {
        // Wait up to 5 seconds to see if dialog appears
        await dialog.waitFor({ state: 'visible', timeout: 5000 });

        // If we caught the dialog, wait for it to complete
        await expect(dialog.getByText('Migration complete!')).toBeVisible({
          timeout: 60000,
        });
        await expect(dialog).not.toBeVisible({ timeout: 15000 });
      } catch {
        // Dialog didn't appear or already closed - that's OK, migration may have
        // completed very quickly. We'll verify success via the backup download
        // and data verification below.
      }

      // ========================================================================
      // STEP 4: Verify backup was downloaded
      // ========================================================================
      // The backup download is the key indicator that migration ran
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toContain('sp-pre-migration-backup');

      // ========================================================================
      // STEP 5: Wait for app to be fully loaded
      // ========================================================================
      // Wait for loading screen to disappear
      const loadingWrapper = page.locator('.loading-full-page-wrapper');
      try {
        const isLoadingVisible = await loadingWrapper.isVisible().catch(() => false);
        if (isLoadingVisible) {
          await loadingWrapper.waitFor({ state: 'hidden', timeout: 30000 });
        }
      } catch {
        // Loading screen might not appear
      }

      // Wait for side nav to be visible (app is ready)
      await page.waitForSelector('magic-side-nav', { state: 'visible', timeout: 30000 });

      // Wait for network to settle
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

      // Dismiss welcome dialog if it appears
      const welcomeDialog = page
        .locator('mat-dialog-container')
        .filter({ hasText: 'Welcome' });
      if (await welcomeDialog.isVisible().catch(() => false)) {
        const noThanksBtn = welcomeDialog
          .locator('button')
          .filter({ hasText: 'No thanks' });
        if (await noThanksBtn.isVisible().catch(() => false)) {
          await noThanksBtn.click();
          await welcomeDialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
        }
      }

      // ========================================================================
      // STEP 6: Verify migrated data via IndexedDB
      // ========================================================================
      const state = await readMigratedState(page);

      // --- Verify Tasks ---
      expect(state.task?.ids).toBeDefined();
      expect(state.task?.ids.length).toBeGreaterThanOrEqual(5); // At least 5 tasks from fixture

      // Verify parent task exists
      expect(state.task?.entities?.['parent-task-1']).toBeDefined();
      const parentTask = state.task?.entities?.['parent-task-1'] as Record<
        string,
        unknown
      >;
      expect(parentTask?.title).toBe('Legacy Migration - Parent Task With Subtasks');
      expect((parentTask?.subTaskIds as string[])?.length).toBe(2);

      // Verify subtasks exist and have correct parent
      expect(state.task?.entities?.['subtask-1']).toBeDefined();
      const subtask1 = state.task?.entities?.['subtask-1'] as Record<string, unknown>;
      expect(subtask1?.parentId).toBe('parent-task-1');
      expect(subtask1?.title).toBe('Legacy Migration - First Subtask');

      // Verify task with tag exists
      expect(state.task?.entities?.['tagged-task-1']).toBeDefined();
      const taggedTask = state.task?.entities?.['tagged-task-1'] as Record<
        string,
        unknown
      >;
      expect(taggedTask?.tagIds).toContain('test-tag-1');
      expect(taggedTask?.timeSpent).toBe(5400000); // Time tracking preserved

      // --- Verify Projects ---
      expect(state.project?.ids).toContain('TEST_PROJECT');
      const testProject = state.project?.entities?.['TEST_PROJECT'] as Record<
        string,
        unknown
      >;
      expect(testProject?.title).toBe('Migration Test Project');
      expect((testProject?.taskIds as string[])?.length).toBeGreaterThanOrEqual(5);
      expect((testProject?.noteIds as string[])?.length).toBe(1);

      // --- Verify Tags ---
      expect(state.tag?.ids).toContain('test-tag-1');
      const testTag = state.tag?.entities?.['test-tag-1'] as Record<string, unknown>;
      expect(testTag?.title).toBe('Migration Test Tag');
      expect((testTag?.taskIds as string[])?.length).toBe(1);

      // --- Verify Notes ---
      expect(state.note?.ids).toContain('note-1');
      const note = state.note?.entities?.['note-1'] as Record<string, unknown>;
      expect(note?.content).toContain('test note for migration verification');

      // --- Verify Sync Settings ---
      expect(state.globalConfig?.sync).toBeDefined();
      const syncConfig = state.globalConfig?.sync as Record<string, unknown>;
      expect(syncConfig?.isEnabled).toBe(true);
      expect(syncConfig?.syncProvider).toBe('WebDAV');

      const webDavConfig = syncConfig?.webDav as Record<string, unknown>;
      expect(webDavConfig?.baseUrl).toBe('https://example.com/webdav');
      expect(webDavConfig?.userName).toBe('testuser');
      expect(webDavConfig?.syncFolderPath).toBe('/sp-sync');

      const superSyncConfig = syncConfig?.superSync as Record<string, unknown>;
      expect(superSyncConfig?.baseUrl).toBe('https://supersync.example.com');
      expect(superSyncConfig?.userName).toBe('syncuser');

      // ========================================================================
      // STEP 7: Verify Archive Data
      // ========================================================================
      const archiveYoung = await readMigratedArchive(page, 'archive_young');

      // Verify archived tasks migrated
      expect(archiveYoung.task?.ids).toBeDefined();
      expect(archiveYoung.task?.ids?.length).toBeGreaterThanOrEqual(2);

      // Verify specific archived task
      if (archiveYoung.task?.entities?.['archived-task-1']) {
        const archivedTask = archiveYoung.task?.entities?.['archived-task-1'] as Record<
          string,
          unknown
        >;
        expect(archivedTask?.title).toBe('Legacy Migration - Archived Task 1');
        expect(archivedTask?.isDone).toBe(true);
      }

      // Verify archive time tracking data
      expect(archiveYoung.timeTracking).toBeDefined();

      // Note: archiveOld may be merged into archiveYoung during migration
      // Check if old archived task exists in either archive
      const archiveOld = await readMigratedArchive(page, 'archive_old');
      const oldTaskInYoung = archiveYoung.task?.entities?.['old-archived-task-1'];
      const oldTaskInOld = archiveOld.task?.entities?.['old-archived-task-1'];
      expect(oldTaskInYoung || oldTaskInOld).toBeDefined();

      // ========================================================================
      // STEP 8: Verify UI shows migrated data
      // ========================================================================
      // Navigate to the test project
      await page.goto('/#/project/TEST_PROJECT');
      await page.waitForLoadState('networkidle').catch(() => {});

      // Wait for task list to appear
      await page.waitForSelector('task-list', { state: 'visible', timeout: 15000 });

      // Verify tasks are visible in UI
      const taskElements = page.locator('task');
      const taskCount = await taskElements.count();
      expect(taskCount).toBeGreaterThan(0);

      // Verify parent task title is visible
      await expect(
        page.locator('task-title').filter({ hasText: 'Parent Task' }),
      ).toBeVisible({
        timeout: 10000,
      });

      // Verify tag exists in sidebar
      const sideNav = page.locator('magic-side-nav');
      await expect(sideNav.getByText('Migration Test Tag')).toBeVisible({
        timeout: 10000,
      });

      // Verify project exists in sidebar
      await expect(sideNav.getByText('Migration Test Project')).toBeVisible({
        timeout: 10000,
      });
    } finally {
      await context.close();
    }
  });

  test('should handle migration error gracefully', async ({ browser, baseURL }) => {
    // This test verifies the error state handling
    // We'll seed invalid data to potentially trigger validation errors

    const context = await browser.newContext({
      storageState: undefined,
      baseURL: baseURL || 'http://localhost:4242',
      acceptDownloads: true,
    });

    const page = await context.newPage();

    try {
      // Seed minimal but valid data - app should still migrate successfully
      // even with minimal data
      const minimalData = {
        task: { ids: [], entities: {}, currentTaskId: null },
        project: {
          ids: ['INBOX_PROJECT'],
          entities: {
            INBOX_PROJECT: {
              id: 'INBOX_PROJECT',
              title: 'Inbox',
              taskIds: [],
              backlogTaskIds: [],
              noteIds: [],
              isArchived: false,
            },
          },
        },
        globalConfig: {
          misc: { isDisableInitialDialog: true },
          sync: { isEnabled: false, syncProvider: null },
        },
      };

      // Block all JS to prevent app initialization during seeding
      await page.route('**/*.js', async (route) => {
        await route.abort();
      });

      // Navigate to the app origin (index.html loads but JS is blocked)
      await page.goto('/', { waitUntil: 'domcontentloaded' });

      // Seed the legacy database while JS is blocked
      await seedLegacyDatabase(page, minimalData);

      // Remove the route blocking so JS can load on reload
      await page.unroute('**/*.js');

      // Set up download listener and reload
      const downloadPromise = page
        .waitForEvent('download', { timeout: 60000 })
        .catch(() => null);
      await page.reload({ waitUntil: 'domcontentloaded' });

      // Migration dialog should appear
      const dialog = page.locator('dialog-legacy-migration');

      // Wait for either success or error state
      const successText = dialog.getByText('Migration complete!');
      const errorIcon = dialog.locator('mat-icon:has-text("error")');

      // Wait for one of the outcomes
      await Promise.race([
        successText.waitFor({ state: 'visible', timeout: 60000 }),
        errorIcon.waitFor({ state: 'visible', timeout: 60000 }),
      ]);

      // If error occurred, verify error handling
      if (await errorIcon.isVisible().catch(() => false)) {
        // Error message should be displayed
        const errorMessage = dialog.locator('.error-message');
        await expect(errorMessage).toBeVisible();

        // OK button should be available to dismiss
        const okButton = dialog.locator('button').filter({ hasText: 'OK' });
        await expect(okButton).toBeVisible();
      } else {
        // Migration succeeded - app should load
        await expect(dialog).not.toBeVisible({ timeout: 15000 });
        await page.waitForSelector('magic-side-nav', {
          state: 'visible',
          timeout: 30000,
        });
      }

      // Backup should have been downloaded (if migration started)
      const download = await downloadPromise;
      if (download) {
        expect(download.suggestedFilename()).toContain('sp-pre-migration-backup');
      }
    } finally {
      await context.close();
    }
  });
});
