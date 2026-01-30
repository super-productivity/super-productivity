import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * SuperSync Encryption Password Preservation E2E Tests
 *
 * These tests verify the bug fixes for multiple race conditions that could
 * cause encryption passwords to be lost. The bugs were:
 *
 * 1. Form model race condition: Angular's ngModel could overwrite the password
 *    with a stale value ~2 seconds after enabling encryption
 * 2. Observable update timing: currentProviderPrivateCfg$ wasn't updated
 *    when enabling encryption, causing stale reads
 * 3. providerManager.setProviderConfig: File-based providers could lose
 *    password when config was updated through providerManager
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-encryption-password-preservation.spec.ts
 */

test.describe('@supersync @encryption Password Preservation', () => {
  /**
   * Scenario: Encryption password survives form model race condition
   *
   * Tests that after enabling encryption, the password is not cleared by
   * a delayed form model update.
   *
   * Setup:
   * - Client A configures SuperSync without encryption
   *
   * Actions:
   * 1. Client A creates task, syncs
   * 2. Client A enables encryption
   * 3. Wait 5+ seconds (longer than race condition window)
   * 4. Client A creates another task, syncs
   * 5. Client B joins with same password
   *
   * Verify:
   * - Client B can decrypt and sees all tasks
   * - No decrypt errors
   */
  test('Encryption password survives form model race condition', async ({
    browser,
    baseURL,
    testRunId,
  }, testInfo) => {
    testInfo.setTimeout(180000);
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);
      const encryptionPassword = `preserve-test-${testRunId}`;

      // ============ PHASE 1: Setup Client A without encryption ============
      console.log('[PasswordRace] Phase 1: Setting up Client A without encryption');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync({
        ...syncConfig,
        isEncryptionEnabled: false,
      });

      // Create initial task
      const task1 = `Task1-BeforeEncrypt-${uniqueId}`;
      await clientA.workView.addTask(task1);
      await clientA.sync.syncAndWait();
      console.log(`[PasswordRace] Client A created: ${task1}`);

      // ============ PHASE 2: Enable encryption ============
      console.log('[PasswordRace] Phase 2: Enabling encryption');

      await clientA.sync.enableEncryption(encryptionPassword);
      console.log('[PasswordRace] Encryption enabled');

      // ============ PHASE 3: Wait for race condition window ============
      console.log('[PasswordRace] Phase 3: Waiting 6 seconds (race condition window)');

      // The race condition typically occurred within 2-3 seconds after enabling
      // We wait longer to ensure any delayed updates have fired
      await clientA.page.waitForTimeout(6000);
      console.log('[PasswordRace] Wait complete');

      // ============ PHASE 4: Create task and sync after wait ============
      console.log('[PasswordRace] Phase 4: Creating task after wait');

      const task2 = `Task2-AfterWait-${uniqueId}`;
      await clientA.workView.addTask(task2);

      // This sync would fail if password was cleared by race condition
      await clientA.sync.syncAndWait();
      console.log(`[PasswordRace] Client A synced task: ${task2}`);

      // Verify no sync errors on A
      const hasErrorA = await clientA.sync.hasSyncError();
      expect(hasErrorA).toBe(false);
      console.log('[PasswordRace] ✓ Client A synced successfully after wait');

      // ============ PHASE 5: Client B joins with password ============
      console.log('[PasswordRace] Phase 5: Client B joining with password');

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync({
        ...syncConfig,
        isEncryptionEnabled: true,
        password: encryptionPassword,
      });

      // Verify B can see both tasks (proves encryption/decryption working)
      await waitForTask(clientB.page, task1);
      await waitForTask(clientB.page, task2);

      const hasErrorB = await clientB.sync.hasSyncError();
      expect(hasErrorB).toBe(false);

      console.log('[PasswordRace] ✓ Client B decrypted all data successfully');
      console.log('[PasswordRace] ✓ Password race condition test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Password persists after opening settings without changes
   *
   * Tests that opening the settings dialog (which triggers form model init)
   * doesn't overwrite the encryption password with stale/empty values.
   *
   * Setup:
   * - Client A with encryption enabled and synced data
   *
   * Actions:
   * 1. Client A opens settings dialog (right-click sync button)
   * 2. Client A closes settings without making changes
   * 3. Wait 3 seconds
   * 4. Client A creates new task and syncs
   *
   * Verify:
   * - Sync completes without password errors
   * - Client B can join and decrypt data
   */
  test('Password persists after opening settings without changes', async ({
    browser,
    baseURL,
    testRunId,
  }, testInfo) => {
    testInfo.setTimeout(180000);
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);
      const encryptionPassword = `settings-test-${testRunId}`;

      // ============ PHASE 1: Setup Client A with encryption ============
      console.log('[SettingsOpen] Phase 1: Setting up Client A with encryption');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync({
        ...syncConfig,
        isEncryptionEnabled: true,
        password: encryptionPassword,
      });

      // Create initial task
      const task1 = `Task1-Initial-${uniqueId}`;
      await clientA.workView.addTask(task1);
      await clientA.sync.syncAndWait();
      console.log(`[SettingsOpen] Client A created and synced: ${task1}`);

      // ============ PHASE 2: Open and close settings dialog ============
      console.log('[SettingsOpen] Phase 2: Opening settings dialog');

      // Right-click sync button to open settings
      await clientA.sync.syncBtn.click({ button: 'right' });

      // Wait for dialog to appear
      const dialog = clientA.page.locator('mat-dialog-container');
      await expect(dialog).toBeVisible({ timeout: 5000 });
      console.log('[SettingsOpen] Settings dialog opened');

      // Wait a moment to let form initialize
      await clientA.page.waitForTimeout(1000);

      // Close dialog without making changes (press Escape)
      await clientA.page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible({ timeout: 5000 });
      console.log('[SettingsOpen] Settings dialog closed');

      // ============ PHASE 3: Wait and create new task ============
      console.log('[SettingsOpen] Phase 3: Waiting after settings close');

      // Wait for any delayed form model updates
      await clientA.page.waitForTimeout(3000);

      const task2 = `Task2-AfterSettings-${uniqueId}`;
      await clientA.workView.addTask(task2);

      // This sync would fail if password was cleared
      await clientA.sync.syncAndWait();
      console.log(`[SettingsOpen] Client A synced: ${task2}`);

      // Verify no sync errors
      const hasErrorA = await clientA.sync.hasSyncError();
      expect(hasErrorA).toBe(false);
      console.log('[SettingsOpen] ✓ Sync successful after settings dialog');

      // ============ PHASE 4: Verify with Client B ============
      console.log('[SettingsOpen] Phase 4: Verifying with Client B');

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync({
        ...syncConfig,
        isEncryptionEnabled: true,
        password: encryptionPassword,
      });

      await waitForTask(clientB.page, task1);
      await waitForTask(clientB.page, task2);

      const hasErrorB = await clientB.sync.hasSyncError();
      expect(hasErrorB).toBe(false);

      console.log('[SettingsOpen] ✓ Client B decrypted all data');
      console.log('[SettingsOpen] ✓ Settings open test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Password preserved after multiple sync cycles
   *
   * Tests that the encryption password remains functional after multiple
   * sync operations (tests observable and state persistence).
   *
   * Setup:
   * - Client A with encryption enabled
   *
   * Actions:
   * 1. Client A performs 5 sync cycles, creating a task each time
   *
   * Verify:
   * - All syncs complete without errors
   * - Client B can join and see all tasks
   */
  test('Password preserved after multiple sync cycles', async ({
    browser,
    baseURL,
    testRunId,
  }, testInfo) => {
    testInfo.setTimeout(180000);
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);
      const encryptionPassword = `multi-cycle-${testRunId}`;

      // ============ PHASE 1: Setup Client A with encryption ============
      console.log('[MultiCycle] Phase 1: Setting up Client A');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync({
        ...syncConfig,
        isEncryptionEnabled: true,
        password: encryptionPassword,
      });

      // ============ PHASE 2: Multiple sync cycles ============
      console.log('[MultiCycle] Phase 2: Performing 5 sync cycles');

      const taskNames: string[] = [];
      for (let i = 1; i <= 5; i++) {
        const taskName = `MultiTask${i}-${uniqueId}`;
        taskNames.push(taskName);

        await clientA.workView.addTask(taskName);
        await clientA.sync.syncAndWait();

        // Verify no error after each sync
        const hasError = await clientA.sync.hasSyncError();
        expect(hasError).toBe(false);

        console.log(`[MultiCycle] Cycle ${i}/5 complete: ${taskName}`);
      }

      // ============ PHASE 3: Verify with Client B ============
      console.log('[MultiCycle] Phase 3: Verifying with Client B');

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync({
        ...syncConfig,
        isEncryptionEnabled: true,
        password: encryptionPassword,
      });

      // Verify all tasks present
      for (const taskName of taskNames) {
        await waitForTask(clientB.page, taskName);
      }

      const hasErrorB = await clientB.sync.hasSyncError();
      expect(hasErrorB).toBe(false);

      console.log('[MultiCycle] ✓ All 5 tasks received by Client B');
      console.log('[MultiCycle] ✓ Multi-cycle test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Password change migration works correctly
   *
   * Tests that changing the encryption password properly re-encrypts data
   * and both old and new clients work correctly.
   *
   * Setup:
   * - Client A with encryption (password1)
   *
   * Actions:
   * 1. Client A creates task, syncs
   * 2. Client A changes password to password2
   * 3. Client A creates another task, syncs
   * 4. Client B joins with new password (password2)
   *
   * Verify:
   * - Client B can decrypt and see all tasks
   */
  test('Password change migration works correctly', async ({
    browser,
    baseURL,
    testRunId,
  }, testInfo) => {
    testInfo.setTimeout(180000);
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);
      const password1 = `old-pass-${testRunId}`;
      const password2 = `new-pass-${testRunId}`;

      // ============ PHASE 1: Setup with initial password ============
      console.log('[PasswordChange] Phase 1: Setting up with initial password');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync({
        ...syncConfig,
        isEncryptionEnabled: true,
        password: password1,
      });

      const task1 = `Task1-OldPass-${uniqueId}`;
      await clientA.workView.addTask(task1);
      await clientA.sync.syncAndWait();
      console.log(`[PasswordChange] Created with old password: ${task1}`);

      // ============ PHASE 2: Change password ============
      console.log('[PasswordChange] Phase 2: Changing password');

      await clientA.sync.changeEncryptionPassword(password2);
      console.log('[PasswordChange] Password changed');

      // Wait for password change operation to complete
      await clientA.page.waitForTimeout(2000);

      // ============ PHASE 3: Create task with new password ============
      console.log('[PasswordChange] Phase 3: Creating task with new password');

      const task2 = `Task2-NewPass-${uniqueId}`;
      await clientA.workView.addTask(task2);
      await clientA.sync.syncAndWait();
      console.log(`[PasswordChange] Created with new password: ${task2}`);

      // Verify no sync errors
      const hasErrorA = await clientA.sync.hasSyncError();
      expect(hasErrorA).toBe(false);

      // ============ PHASE 4: Client B joins with new password ============
      console.log('[PasswordChange] Phase 4: Client B joining with new password');

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync({
        ...syncConfig,
        isEncryptionEnabled: true,
        password: password2,
      });

      // Verify B can see both tasks
      await waitForTask(clientB.page, task1);
      await waitForTask(clientB.page, task2);

      const hasErrorB = await clientB.sync.hasSyncError();
      expect(hasErrorB).toBe(false);

      console.log('[PasswordChange] ✓ Client B decrypted all data with new password');
      console.log('[PasswordChange] ✓ Password change test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
