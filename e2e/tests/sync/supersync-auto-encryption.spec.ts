import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  getEncryptionStatus,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * SuperSync Auto-Encryption E2E Tests
 *
 * Phase 1 (current): Auto-encryption activation is disabled.
 * The client can HANDLE auto-encrypted data but does not proactively activate it.
 * Tests verify:
 * - Unencrypted sync works (baseline)
 * - Encryption status endpoint returns correct data
 * - Manual encryption still works and is reflected in DB
 *
 * Phase 2 (next release): Auto-encryption activates automatically.
 * Tests marked with .skip will be re-enabled when activation is turned on.
 *
 * Run with E2E_VERBOSE=1 to see browser console logs for debugging.
 */

test.describe('@supersync SuperSync Auto-Encryption', () => {
  // ============================================================================
  // Phase 1 tests: passive capability (auto-encryption NOT activated)
  // ============================================================================

  test('Sync works without encryption and encryption status endpoint reports unencrypted', async ({
    browser,
    baseURL,
    testRunId,
    serverHealthy,
  }) => {
    void serverHealthy;
    let clientA: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);

      // Setup SuperSync WITHOUT password or encryption
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(baseConfig);

      const taskName = `NoEnc-${testRunId}`;
      await clientA.workView.addTask(taskName);

      await clientA.sync.syncAndWait();

      // Verify task synced successfully
      await waitForTask(clientA.page, taskName);
      await expect(clientA.page.locator(`task:has-text("${taskName}")`)).toBeVisible();

      // Verify encryption status endpoint works and reports unencrypted
      // (Phase 1: auto-encryption activation is disabled)
      const status = await getEncryptionStatus(user.userId);
      expect(status.total).toBeGreaterThan(0);
      expect(status.unencrypted).toBe(status.total);
      expect(status.encrypted).toBe(0);
    } finally {
      if (clientA) await closeClient(clientA);
    }
  });

  test('Manual encryption is reflected in encryption status', async ({
    browser,
    baseURL,
    testRunId,
    serverHealthy,
  }) => {
    void serverHealthy;
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);
      const manualPassword = `manual-pass-${testRunId}`;

      // Client A: setup with manual encryption
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: manualPassword,
      });

      const taskName = `ManualEnc-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();

      // Verify operations are encrypted in DB
      const status = await getEncryptionStatus(user.userId);
      expect(status.total).toBeGreaterThan(0);
      expect(status.encrypted).toBe(status.total);
      expect(status.unencrypted).toBe(0);

      // Client B: setup with same password, verify data syncs
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: manualPassword,
      });
      await clientB.sync.syncAndWait();

      await waitForTask(clientB.page, taskName);
      await expect(clientB.page.locator(`task:has-text("${taskName}")`)).toBeVisible();
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  // ============================================================================
  // Phase 2 tests: auto-encryption activation (currently skipped)
  // Re-enable these when ensureAutoEncryption() is uncommented in
  // sync-wrapper.service.ts
  // ============================================================================

  test.skip('Auto-encryption activates on first sync', async ({
    browser,
    baseURL,
    testRunId,
    serverHealthy,
  }) => {
    void serverHealthy;
    let clientA: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);

      // Setup SuperSync WITHOUT password (auto-encryption only)
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(baseConfig);

      const taskName = `AutoEnc-${testRunId}`;
      await clientA.workView.addTask(taskName);

      // Sync (should auto-encrypt)
      await clientA.sync.syncAndWait();

      // Verify task is still visible after sync
      await waitForTask(clientA.page, taskName);
      await expect(clientA.page.locator(`task:has-text("${taskName}")`)).toBeVisible();

      // Verify operations are encrypted in the database
      const status = await getEncryptionStatus(user.userId);
      expect(status.total).toBeGreaterThan(0);
      expect(status.encrypted).toBe(status.total);
      expect(status.unencrypted).toBe(0);
    } finally {
      if (clientA) await closeClient(clientA);
    }
  });

  test.skip('Auto-encrypted data syncs between two clients', async ({
    browser,
    baseURL,
    testRunId,
    serverHealthy,
  }) => {
    void serverHealthy;
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);

      // Client A: setup without password, add task, sync
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(baseConfig);

      const taskName = `AutoSync-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();

      // Client B: setup with same user (no password), sync
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(baseConfig);
      await clientB.sync.syncAndWait();

      // Verify Client B sees Client A's task (key recovered automatically)
      await waitForTask(clientB.page, taskName);
      await expect(clientB.page.locator(`task:has-text("${taskName}")`)).toBeVisible();
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  test.skip('Manual E2E password overrides auto-encryption', async ({
    browser,
    baseURL,
    testRunId,
    serverHealthy,
  }) => {
    void serverHealthy;
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);
      const manualPassword = `manual-pass-${testRunId}`;

      // Client A: setup without password first (auto-encryption)
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(baseConfig);

      const task1 = `AutoTask-${testRunId}`;
      await clientA.workView.addTask(task1);
      await clientA.sync.syncAndWait();

      // Verify auto-encrypted
      const statusBefore = await getEncryptionStatus(user.userId);
      expect(statusBefore.encrypted).toBeGreaterThan(0);

      // Enable manual encryption with password on Client A
      await clientA.sync.enableEncryption(manualPassword);
      await clientA.sync.syncAndWait();

      // Client B: setup with same manual password
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: manualPassword,
      });
      await clientB.sync.syncAndWait();

      // Verify Client B sees the task
      await waitForTask(clientB.page, task1);
      await expect(clientB.page.locator(`task:has-text("${task1}")`)).toBeVisible();

      // Verify operations are still encrypted in DB
      const statusAfter = await getEncryptionStatus(user.userId);
      expect(statusAfter.encrypted).toBeGreaterThan(0);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  test.skip('Server operations are encrypted (DB verification)', async ({
    browser,
    baseURL,
    testRunId,
    serverHealthy,
  }) => {
    void serverHealthy;
    let clientA: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);

      // Setup and sync with auto-encryption
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(baseConfig);

      // Add multiple tasks to generate operations
      const task1 = `DBCheck1-${testRunId}`;
      const task2 = `DBCheck2-${testRunId}`;
      await clientA.workView.addTask(task1);
      await clientA.page.waitForTimeout(100);
      await clientA.workView.addTask(task2);

      await clientA.sync.syncAndWait();

      // Query the encryption status endpoint
      const status = await getEncryptionStatus(user.userId);

      // All operations should be encrypted, none unencrypted
      expect(status.encrypted).toBeGreaterThan(0);
      expect(status.unencrypted).toBe(0);
      expect(status.total).toBe(status.encrypted);
    } finally {
      if (clientA) await closeClient(clientA);
    }
  });
});
