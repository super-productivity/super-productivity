import { test, expect } from '../../fixtures/supersync.fixture';
import { ImportPage } from '../../pages/import.page';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { waitForAppReady } from '../../utils/waits';

const CRASH_STATE_KEY = 'e2e-use-remote-crash-state';
const CRASH_LOG = '[CrashResume] Simulating reload after remote baseline commit';
const REBUILD_COMMITTED_LOG =
  'OperationLogSyncService: Replaced local persistence with remote baseline.';
const RESUME_DETECTED_LOG =
  'OperationLogSyncService: Interrupted USE_REMOTE rebuild detected';

/**
 * SuperSync USE_REMOTE crash recovery.
 *
 * The test reloads Client B immediately after runRemoteStateReplacement() has
 * atomically committed the remote baseline and its raw-rebuild-incomplete marker,
 * but before replay can finish and clear that marker. On the next sync, B must:
 *
 * 1. detect the interrupted rebuild,
 * 2. redo the raw server-history download,
 * 3. keep the FIRST attempt's pre-replace import backup,
 * 4. finish on the remote state, and
 * 5. offer Undo that restores B's original imported state.
 *
 * Run with:
 *   npm run e2e:supersync:file e2e/tests/sync/supersync-use-remote-crash-resume.spec.ts
 */
test.describe('@supersync USE_REMOTE interrupted rebuild recovery', () => {
  test.describe.configure({ mode: 'serial' });

  test('resumes after reload and preserves the original Undo backup', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);

    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);
      const remoteTask = `CrashResumeRemote-${testRunId}`;
      const importedTask = 'E2E Import Test - Active Task With Subtask';

      // ===== PHASE 1: A establishes the remote state =====
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.workView.addTask(remoteTask);
      await clientA.sync.syncAndWait();

      // ===== PHASE 2: B installs a one-shot crash failpoint before app boot =====
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.page.addInitScript(
        ({ crashLog, crashStateKey, rebuildCommittedLog }) => {
          const e2eGlobal = globalThis as typeof globalThis & {
            __SP_E2E_BLOCK_AUTO_SYNC?: boolean;
            __SP_E2E_BLOCK_IMMEDIATE_UPLOAD?: boolean;
            __SP_E2E_BLOCK_WS_DOWNLOAD?: boolean;
          };
          // Allow setup's initial sync before the crash. On the reload, block
          // automatic sync so the test can observe and trigger recovery itself.
          e2eGlobal.__SP_E2E_BLOCK_AUTO_SYNC =
            sessionStorage.getItem(crashStateKey) === 'crashed';
          e2eGlobal.__SP_E2E_BLOCK_IMMEDIATE_UPLOAD = true;
          e2eGlobal.__SP_E2E_BLOCK_WS_DOWNLOAD = true;

          // Install before Angular modules load so Log's pre-bound console method
          // captures this wrapper. The session marker makes the reload one-shot.
          const originalLog = console.log.bind(console);
          console.log = (...args: unknown[]): void => {
            originalLog(...args);
            const message = args.map(String).join(' ');
            if (
              sessionStorage.getItem(crashStateKey) === 'armed' &&
              message.includes(rebuildCommittedLog)
            ) {
              sessionStorage.setItem(crashStateKey, 'crashed');
              originalLog(crashLog);
              // Abort the current replay task at the exact committed-baseline
              // cutoff. Playwright reloads the document after observing crashLog.
              throw new Error(crashLog);
            }
          };
        },
        {
          crashLog: CRASH_LOG,
          crashStateKey: CRASH_STATE_KEY,
          rebuildCommittedLog: REBUILD_COMMITTED_LOG,
        },
      );
      // Wait only for `domcontentloaded`, not the default `load`: an active
      // SuperSync WebSocket/sync connection can keep the page "loading" so the
      // `load` event never fires and `reload()` times out (flaky). `reload()`
      // preserves sessionStorage (unlike close()+newPage()), which this test
      // needs, and `waitForAppReady` below is the real readiness gate.
      await clientB.page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitForAppReady(clientB.page);

      // Importing gives B a known local state and creates a full-state local op,
      // guaranteeing the incoming server history requires an explicit choice.
      const importPageB = new ImportPage(clientB.page);
      await importPageB.navigateToImportPage();
      await importPageB.importBackupFile(ImportPage.getFixturePath('test-backup.json'));
      await clientB.page.goto('/#/tag/TODAY/tasks');
      await clientB.page.waitForURL(/(active\/tasks|tag\/TODAY\/tasks)/);
      await expect(clientB.page.locator('task', { hasText: importedTask })).toBeVisible({
        timeout: 15000,
      });

      await clientB.page.evaluate(
        ({ crashStateKey }) => sessionStorage.setItem(crashStateKey, 'armed'),
        { crashStateKey: CRASH_STATE_KEY },
      );

      // Setup starts the first sync but leaves its conflict dialog for the test.
      await clientB.sync.setupSuperSync({
        ...syncConfig,
        waitForInitialSync: false,
      });
      await expect(clientB.sync.syncImportConflictDialog).toBeVisible({ timeout: 30000 });

      // ===== PHASE 3: choose USE_REMOTE and reload at the atomic baseline cutoff =====
      const crashObserved = clientB.page.waitForEvent('console', {
        predicate: (message) => message.text().includes(CRASH_LOG),
        timeout: 30000,
      });

      await clientB.sync.syncImportUseRemoteBtn.click();
      await crashObserved;
      // domcontentloaded (not the default `load`) — see the note on the first
      // reload above: an active sync connection can block `load` and hang
      // `reload()`. sessionStorage survives the reload; the assertion below
      // depends on it.
      await clientB.page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitForAppReady(clientB.page);
      expect(
        await clientB.page.evaluate(
          ({ crashStateKey }) => sessionStorage.getItem(crashStateKey),
          { crashStateKey: CRASH_STATE_KEY },
        ),
      ).toBe('crashed');

      // ===== PHASE 4: next sync must resume raw rebuild and keep first backup =====
      const resumeDetected = clientB.page.waitForEvent('console', {
        predicate: (message) => message.text().includes(RESUME_DETECTED_LOG),
        timeout: 30000,
      });
      await clientB.sync.syncAndWait({ timeout: 60000 });
      await resumeDetected;

      // B was already on Today before the reload. Keep the current work context:
      // changing it intentionally dismisses snacks, including the persistent Undo.
      await expect(clientB.page.locator('task', { hasText: remoteTask })).toBeVisible({
        timeout: 15000,
      });
      await expect(
        clientB.page.locator('task', { hasText: importedTask }),
      ).not.toBeVisible();

      const undoSnack = clientB.page.locator('snack-custom', {
        hasText: /replaced with the server/i,
      });
      await expect(undoSnack).toBeVisible({ timeout: 30000 });
      await undoSnack.locator('button.action').click();

      // Undo must restore the backup from BEFORE the first, interrupted replace,
      // not a backup of the partial remote baseline captured during crash resume.
      await expect(clientB.page.locator('task', { hasText: importedTask })).toBeVisible({
        timeout: 15000,
      });
      console.log('[CrashResume] ✓ Original imported state restored from first backup');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
