import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { SuperSyncPage } from '../../pages/supersync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import { waitForAppReady } from '../../utils/waits';
import { ImportPage } from '../../pages/import.page';
import type { BrowserContext, Page } from '@playwright/test';

const UPLOAD_LOCK_NAME = 'sp_op_log_upload';

const installSecondTabTestInit = async (context: BrowserContext): Promise<void> => {
  await context.addInitScript(() => {
    localStorage.setItem('SUP_ONBOARDING_PRESET_DONE', 'true');
    localStorage.setItem('SUP_ONBOARDING_HINTS_DONE', 'true');
    localStorage.setItem('SUP_IS_SHOW_TOUR', 'true');
    localStorage.setItem('SUP_EXAMPLE_TASKS_CREATED', 'true');

    const testGlobal = globalThis as typeof globalThis & {
      __SP_E2E_BLOCK_AUTO_SYNC?: boolean;
      __SP_E2E_BLOCK_IMMEDIATE_UPLOAD?: boolean;
      __SP_E2E_BLOCK_WS_DOWNLOAD?: boolean;
    };
    testGlobal.__SP_E2E_BLOCK_AUTO_SYNC = true;
    testGlobal.__SP_E2E_BLOCK_IMMEDIATE_UPLOAD = true;
    testGlobal.__SP_E2E_BLOCK_WS_DOWNLOAD = true;

    const NativeBroadcastChannel = globalThis.BroadcastChannel;
    class MultiTabTestBroadcastChannel extends NativeBroadcastChannel {
      private readonly _isSingleInstanceChannel: boolean;

      constructor(name: string) {
        super(name);
        this._isSingleInstanceChannel = name === 'superProductivityTab';
      }

      override postMessage(message: unknown): void {
        if (this._isSingleInstanceChannel) {
          return;
        }
        super.postMessage(message);
      }
    }

    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      writable: true,
      value: MultiTabTestBroadcastChannel,
    });
  });
};

const acquireUploadLock = async (page: Page): Promise<void> => {
  await page.evaluate((lockName) => {
    const testGlobal = globalThis as typeof globalThis & {
      __SP_E2E_RELEASE_UPLOAD_LOCK?: () => void;
      __SP_E2E_UPLOAD_LOCK_HELD?: boolean;
      __SP_E2E_UPLOAD_LOCK_ERROR?: string;
    };
    let releaseLock: () => void = () => undefined;
    const releasePromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    testGlobal.__SP_E2E_RELEASE_UPLOAD_LOCK = releaseLock;
    testGlobal.__SP_E2E_UPLOAD_LOCK_HELD = false;
    void navigator.locks
      .request(lockName, async () => {
        testGlobal.__SP_E2E_UPLOAD_LOCK_HELD = true;
        try {
          await releasePromise;
        } finally {
          testGlobal.__SP_E2E_UPLOAD_LOCK_HELD = false;
        }
      })
      .catch((error: unknown) => {
        testGlobal.__SP_E2E_UPLOAD_LOCK_ERROR = String(error);
      });
  }, UPLOAD_LOCK_NAME);

  await page.waitForFunction(() => {
    const testGlobal = globalThis as typeof globalThis & {
      __SP_E2E_UPLOAD_LOCK_HELD?: boolean;
      __SP_E2E_UPLOAD_LOCK_ERROR?: string;
    };
    if (testGlobal.__SP_E2E_UPLOAD_LOCK_ERROR) {
      throw new Error(testGlobal.__SP_E2E_UPLOAD_LOCK_ERROR);
    }
    return testGlobal.__SP_E2E_UPLOAD_LOCK_HELD === true;
  });
};

const releaseUploadLock = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const testGlobal = globalThis as typeof globalThis & {
      __SP_E2E_RELEASE_UPLOAD_LOCK?: () => void;
    };
    testGlobal.__SP_E2E_RELEASE_UPLOAD_LOCK?.();
  });
};

const waitForQueuedUploadLock = async (page: Page): Promise<void> => {
  await page.waitForFunction(
    async (lockName) => {
      const snapshot = await navigator.locks.query();
      return snapshot.pending?.some((lock) => lock.name === lockName) ?? false;
    },
    UPLOAD_LOCK_NAME,
    { timeout: 20000 },
  );
};

const getUnsyncedOperationCount = async (page: Page): Promise<number> =>
  page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('SUP_OPS');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    try {
      const entries = await new Promise<{ syncedAt?: number; rejectedAt?: number }[]>(
        (resolve, reject) => {
          const transaction = db.transaction('ops', 'readonly');
          const request = transaction.objectStore('ops').getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
          transaction.onabort = () => reject(transaction.error);
        },
      );
      return entries.filter((entry) => !entry.syncedAt && !entry.rejectedAt).length;
    } finally {
      db.close();
    }
  });

const getSuperSyncCursor = async (page: Page): Promise<string | null> =>
  page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) =>
      candidate.startsWith('super_sync_last_server_seq_'),
    );
    return key ? localStorage.getItem(key) : null;
  });

/**
 * SuperSync Multi-Tab Same Account E2E Tests
 *
 * Tests that two browser tabs sharing the same IndexedDB (same BrowserContext)
 * don't corrupt data when using SuperSync.
 *
 * NOTE: The app prevents two tabs from running simultaneously via BroadcastChannel.
 * The convergence test navigates the inactive tab to about:blank. The race test
 * suppresses only that startup channel so both tabs can exercise the shared locks.
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-multi-tab.spec.ts
 */

test.describe('@supersync Multi-Tab Same Account', () => {
  /**
   * Scenario: Two tabs share IndexedDB, tasks created in one tab appear in other after reload
   *
   * Flow:
   * 1. Create a SHARED browser context (same IndexedDB)
   * 2. Open Tab 1, set up SuperSync, create task
   * 3. Tab 1 syncs
   * 4. Navigate Tab 1 away (avoid multi-instance blocker)
   * 5. Open Tab 2 → should see Tab 1's task (from shared IndexedDB)
   * 6. Tab 2 creates a task, syncs
   * 7. Navigate Tab 2 away, reload Tab 1 → should see both tasks
   * 8. External Client C (separate context) syncs → should see consistent state
   */
  test('Two tabs sharing IndexedDB converge with external client', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);
    const appUrl = baseURL || 'http://localhost:4242';
    let clientC: SimulatedE2EClient | null = null;
    let sharedContext: import('@playwright/test').BrowserContext | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Setup shared context with Tab 1 ============
      console.log('[MultiTab] Phase 1: Setup shared context with Tab 1');

      sharedContext = await browser.newContext({
        storageState: undefined,
        viewport: { width: 1920, height: 1080 },
        // Set PLAYWRIGHT user agent for test identification and to skip onboarding
        userAgent: 'PLAYWRIGHT MULTI-TAB-TEST',
      });

      const tab1 = await sharedContext.newPage();
      tab1.on('console', (msg) => {
        if (msg.type() === 'error') {
          console.error(`[Tab1] Console error:`, msg.text());
        }
      });

      await tab1.goto(appUrl);
      await waitForAppReady(tab1);

      const tab1Sync = new SuperSyncPage(tab1);
      const tab1WorkView = new WorkViewPage(tab1, `Tab1-${testRunId}`);

      await tab1Sync.setupSuperSync(syncConfig);
      console.log('[MultiTab] Tab 1 setup complete');

      // ============ PHASE 2: Tab 1 creates task and syncs ============
      console.log('[MultiTab] Phase 2: Tab 1 creates task');

      const taskFromTab1 = `Tab1-Task-${testRunId}`;
      await tab1WorkView.addTask(taskFromTab1);
      await waitForTask(tab1, taskFromTab1);

      await tab1Sync.syncAndWait();
      console.log('[MultiTab] Tab 1 created task and synced');

      // ============ PHASE 3: Open Tab 2 in same context ============
      console.log('[MultiTab] Phase 3: Open Tab 2 in same context');

      // Navigate Tab 1 away to avoid multi-instance blocker
      // (app uses BroadcastChannel to prevent two tabs from running simultaneously)
      await tab1.goto('about:blank');

      const tab2 = await sharedContext.newPage();
      tab2.on('console', (msg) => {
        if (msg.type() === 'error') {
          console.error(`[Tab2] Console error:`, msg.text());
        }
      });

      await tab2.goto(appUrl);
      await waitForAppReady(tab2);
      await tab2.waitForTimeout(2000); // Let Angular hydrate from IndexedDB

      // Tab 2 should see Tab 1's task from shared IndexedDB
      await waitForTask(tab2, taskFromTab1);
      console.log("[MultiTab] ✓ Tab 2 sees Tab 1's task from shared IndexedDB");

      // ============ PHASE 4: Tab 2 creates task ============
      console.log('[MultiTab] Phase 4: Tab 2 creates task');

      const tab2WorkView = new WorkViewPage(tab2, `Tab2-${testRunId}`);
      const taskFromTab2 = `Tab2-Task-${testRunId}`;
      await tab2WorkView.addTask(taskFromTab2);
      await waitForTask(tab2, taskFromTab2);
      console.log('[MultiTab] Tab 2 created task');

      // Trigger sync from Tab 2 (SuperSync config is shared via IndexedDB)
      const tab2Sync = new SuperSyncPage(tab2);
      await tab2Sync.syncAndWait();
      console.log('[MultiTab] Tab 2 synced');

      // ============ PHASE 5: Tab 1 reloads and verifies ============
      console.log('[MultiTab] Phase 5: Tab 1 reloads');

      // Navigate Tab 2 away before reloading Tab 1
      await tab2.goto('about:blank');

      await tab1.goto(appUrl);
      await waitForAppReady(tab1);
      await tab1.waitForTimeout(2000);

      // Tab 1 should see both tasks
      await waitForTask(tab1, taskFromTab1);
      await waitForTask(tab1, taskFromTab2);
      console.log('[MultiTab] ✓ Tab 1 sees both tasks after reload');

      // ============ PHASE 6: External Client C verifies consistent state ============
      console.log('[MultiTab] Phase 6: External Client C verifies');

      // Navigate Tab 1 away before creating external client
      await tab1.goto('about:blank');

      clientC = await createSimulatedClient(browser, appUrl, 'C', testRunId);
      await clientC.sync.setupSuperSync(syncConfig);
      await clientC.sync.syncAndWait();

      await waitForTask(clientC.page, taskFromTab1);
      await waitForTask(clientC.page, taskFromTab2);

      const cTask1 = clientC.page.locator(`task:has-text("${taskFromTab1}")`);
      const cTask2 = clientC.page.locator(`task:has-text("${taskFromTab2}")`);
      await expect(cTask1).toBeVisible();
      await expect(cTask2).toBeVisible();
      console.log('[MultiTab] ✓ External Client C sees consistent state');

      console.log('[MultiTab] ✓ Multi-tab test PASSED!');
    } finally {
      if (clientC) await closeClient(clientC);
      if (sharedContext) {
        await sharedContext.close().catch(() => {});
      }
    }
  });

  test('late sibling-tab work blocks a downloaded full-state apply atomically', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);
      const baselineTask = `Full-State-Race-Baseline-${testRunId}`;
      await clientA.workView.addTask(baselineTask);
      await clientA.sync.syncAndWait();

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      const tab1 = clientB.page;
      const tab1Sync = clientB.sync;
      await tab1Sync.setupSuperSync(syncConfig);
      await waitForTask(tab1, baselineTask);

      await installSecondTabTestInit(clientB.context);
      const tab2 = await clientB.context.newPage();
      await tab2.goto('/');
      await waitForAppReady(tab2);
      const tab2WorkView = new WorkViewPage(tab2, `Sibling-${testRunId}`);
      await tab2WorkView.waitForTaskList();
      await waitForTask(tab2, baselineTask);

      const importPage = new ImportPage(clientA.page);
      await importPage.navigateToImportPage();
      await importPage.importBackupFile(ImportPage.getFixturePath('test-backup.json'));
      await clientA.page.goto(clientA.page.url(), {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await clientA.page.waitForLoadState('networkidle');
      await clientA.sync.syncAndWait({ useLocal: true });

      const cursorBeforeDownload = await getSuperSyncCursor(tab1);
      expect(cursorBeforeDownload).not.toBeNull();
      const pendingBeforeRace = await getUnsyncedOperationCount(tab2);
      expect(pendingBeforeRace).toBe(0);

      await acquireUploadLock(tab1);
      await tab1Sync.syncBtn.click();
      await waitForQueuedUploadLock(tab1);

      const lateTask = `Sibling-Late-Task-${testRunId}`;
      await tab2WorkView.addTask(lateTask);
      await waitForTask(tab2, lateTask);
      await expect
        .poll(() => getUnsyncedOperationCount(tab2), { timeout: 10000 })
        .toBeGreaterThan(pendingBeforeRace);

      await releaseUploadLock(tab1);

      const conflictDialog = tab1.locator('dialog-sync-import-conflict');
      await expect(conflictDialog).toBeVisible({ timeout: 20000 });
      await conflictDialog.getByRole('button', { name: /cancel/i }).click();
      await expect(conflictDialog).not.toBeVisible({ timeout: 5000 });

      expect(await getSuperSyncCursor(tab1)).toBe(cursorBeforeDownload);
      expect(await getUnsyncedOperationCount(tab2)).toBeGreaterThan(pendingBeforeRace);
      await expect(tab2.locator('task', { hasText: lateTask })).toBeVisible();
    } finally {
      if (clientB && !clientB.page.isClosed()) {
        await releaseUploadLock(clientB.page).catch(() => undefined);
      }
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
