import { type Dialog } from '@playwright/test';
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
 * SuperSync Wrong Password Error E2E Tests
 *
 * Verifies that when a client has the wrong encryption password (e.g., after
 * another client changed it), the DecryptError properly surfaces a password
 * prompt dialog instead of being silently logged.
 *
 * This tests the fix for: operation-log-download.service.ts DecryptError handling
 * - DecryptError should propagate to sync-wrapper handler
 * - DialogHandleDecryptErrorComponent should open
 * - Sync status should show ERROR icon
 * - User can enter correct password and retry
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-wrong-password-error.spec.ts
 */

test.describe('@supersync @encryption Wrong Password Error Handling', () => {
  /**
   * Scenario: Client with old password gets DecryptError and sees password dialog
   *
   * Setup:
   * - Client A enables encryption with password "pass1"
   * - Client A creates task and syncs
   * - Client A changes encryption password to "pass2"
   * - Client B configured with "pass1" (old password)
   *
   * Actions:
   * 1. Client B tries to sync
   * 2. DecryptError occurs (wrong password)
   *
   * Verify:
   * - Sync ERROR icon appears
   * - Error snackbar appears
   * - DialogHandleDecryptErrorComponent opens (password correction dialog)
   * - User can enter correct password
   * - After entering correct password, sync succeeds
   */
  test('Wrong password shows error dialog and allows password correction', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);
      const oldPassword = `pass1-${testRunId}`;
      const newPassword = `pass2-${testRunId}`;

      // ============ PHASE 1: Client A sets up with initial password ============
      console.log('[WrongPassword] Phase 1: Client A setup with password:', oldPassword);

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: oldPassword,
      });

      // Create and sync encrypted task
      const taskName = `EncryptedTask-${uniqueId}`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, taskName);
      console.log(`[WrongPassword] Client A created and synced: ${taskName}`);

      // ============ PHASE 2: Client A changes password ============
      console.log('[WrongPassword] Phase 2: Client A changing password to:', newPassword);

      await clientA.sync.changeEncryptionPassword(newPassword);
      console.log('[WrongPassword] Client A password changed successfully');

      // Verify task still exists after password change
      await waitForTask(clientA.page, taskName);

      // ============ PHASE 3: Client B sets up with OLD password ============
      console.log(
        '[WrongPassword] Phase 3: Client B setup with old password:',
        oldPassword,
      );

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: oldPassword, // Using OLD password (wrong!)
        waitForInitialSync: false, // Don't wait - we expect sync to fail
      });

      // ============ PHASE 4: Client B attempts sync - should fail ============
      console.log(
        '[WrongPassword] Phase 4: Client B attempting sync with wrong password',
      );

      // The sync starts automatically after setup. Check if the decrypt error dialog
      // is already open before trying to trigger sync manually.
      const decryptErrorDialogEarly = clientB.page.locator('dialog-handle-decrypt-error');
      const dialogAlreadyOpen = await decryptErrorDialogEarly
        .waitFor({ state: 'visible', timeout: 3000 })
        .then(() => true)
        .catch(() => false);

      if (!dialogAlreadyOpen) {
        // Use a raw click: triggerSync() is success-only and would throw on the
        // expected decrypt error before this test can assert its recovery UI.
        // dispatchEvent avoids an actionability deadlock if auto-sync opens the
        // disable-close dialog between the probe and this nudge.
        await clientB.page.locator('button.sync-btn').dispatchEvent('click');
      } else {
        console.log('[WrongPassword] Decrypt error dialog already open from auto-sync');
      }

      await decryptErrorDialogEarly.waitFor({ state: 'visible', timeout: 10000 });

      // ============ PHASE 5: Verify error handling ============
      console.log('[WrongPassword] Phase 5: Verifying error is properly surfaced');

      // Verify sync ERROR icon is visible
      const hasError = await clientB.sync.hasSyncError();
      expect(hasError).toBe(true);
      console.log('[WrongPassword] ✓ Sync ERROR icon is visible');

      // Note: Error snackbar may be transient and may have closed by now.
      // The primary UX feedback is the DialogHandleDecryptError which we check below.
      const snackbar = clientB.page.locator(
        'snack-custom:has-text("decrypt"), ' +
          'snack-custom:has-text("Decryption"), ' +
          '.mat-mdc-snack-bar-container:has-text("decrypt"), ' +
          '.mat-mdc-snack-bar-container:has-text("Decryption")',
      );
      const snackbarVisible = await snackbar
        .first()
        .isVisible()
        .catch(() => false);
      // Log but don't fail - snackbar may have already closed when dialog opened
      if (snackbarVisible) {
        console.log('[WrongPassword] ✓ Error snackbar is visible');
      } else {
        console.log(
          '[WrongPassword] Note: Error snackbar not visible (may have closed when dialog opened)',
        );
      }

      // Verify DialogHandleDecryptError component opens
      const decryptErrorDialog = decryptErrorDialogEarly;
      console.log('[WrongPassword] ✓ DialogHandleDecryptError is open');

      // ============ PHASE 6: User corrects password and retries ============
      console.log('[WrongPassword] Phase 6: User entering correct password');

      // The dialog should have options:
      // - Update password field
      // - "Re-sync" button
      // - "Overwrite Remote" button

      // Look for the password input in the dialog
      const passwordInput = decryptErrorDialog.locator('input[type="password"]');
      await expect(passwordInput).toBeVisible();
      await passwordInput.fill(newPassword);
      console.log('[WrongPassword] Filled in correct password');

      const resyncBtn = decryptErrorDialog
        .locator('button')
        .filter({ hasText: /retry.*decrypt/i })
        .first();
      await expect(resyncBtn).toBeEnabled();
      await resyncBtn.click();
      console.log('[WrongPassword] Clicked Retry Decrypt button');

      await decryptErrorDialog.waitFor({ state: 'hidden', timeout: 10000 });
      await clientB.sync.waitForSyncToComplete({ timeout: 15000 });

      await waitForTask(clientB.page, taskName);
      console.log('[WrongPassword] ✓ Task synced after password correction');

      const stillHasError = await clientB.sync.hasSyncError();
      expect(stillHasError).toBe(false);
      console.log('[WrongPassword] ✓ Sync status shows success');

      console.log('[WrongPassword] ✓ Test completed successfully!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: User chooses "Overwrite Remote" option instead of correcting password
   *
   * This verifies the alternative path where the user decides to upload their
   * local data instead of correcting the password.
   */
  test('User can choose to overwrite remote instead of correcting password', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let clientC: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);
      const password1 = `pass1-${testRunId}`;
      const password2 = `pass2-${testRunId}`;

      // Setup Client A with password1
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: password1,
      });

      const taskA = `TaskFromA-${uniqueId}`;
      await clientA.workView.addTask(taskA);
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, taskA);

      // Client A changes password
      await clientA.sync.changeEncryptionPassword(password2);
      await waitForTask(clientA.page, taskA);

      // Setup Client B with OLD password
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: password1, // Old password
        waitForInitialSync: false,
      });

      // The sync starts automatically after setup and may trigger the decrypt error dialog.
      // If dialog appears, cancel it so we can add a local task first.
      const decryptErrorDialogEarly = clientB.page.locator('dialog-handle-decrypt-error');
      const dialogOpenedEarly = await decryptErrorDialogEarly
        .waitFor({ state: 'visible', timeout: 3000 })
        .then(() => true)
        .catch(() => false);

      if (dialogOpenedEarly) {
        // Cancel the dialog so we can add a local task
        const cancelBtn = decryptErrorDialogEarly
          .locator('button')
          .filter({ hasText: /cancel/i });
        await cancelBtn.click();
        await decryptErrorDialogEarly.waitFor({ state: 'hidden', timeout: 5000 });
        await clientB.page.waitForTimeout(500);
      }

      // Client B has its own local task
      const taskB = `TaskFromB-${uniqueId}`;
      await clientB.workView.addTask(taskB);

      // Trigger sync - should fail with DecryptError
      // NOTE: Don't use triggerSync() because it waits for success check icon
      // With wrong password, sync will fail and show error dialog instead
      const syncBtn = clientB.page.locator('button.sync-btn');
      await syncBtn.click();

      // Wait for the decrypt error dialog to appear
      const decryptErrorDialog = clientB.page.locator('dialog-handle-decrypt-error');
      await decryptErrorDialog.waitFor({ state: 'visible', timeout: 10000 });

      // The "Change & Overwrite Remote" button requires a password to be entered first
      // Enter any password (it will become the new encryption password after overwrite)
      const passwordInput = decryptErrorDialog.locator('input[type="password"]');
      const newPassword = `overwrite-pass-${uniqueId}`;
      await passwordInput.fill(newPassword);
      await clientB.page.waitForTimeout(300); // Wait for form validation

      // Look for "Change & Overwrite Remote" button (should be enabled now)
      const overwriteBtn = decryptErrorDialog
        .locator('button')
        .filter({ hasText: /Overwrite Server & Other Devices/i })
        .first();
      await expect(overwriteBtn).toBeVisible();
      await expect(overwriteBtn).toBeEnabled();

      const forceUploadResponse = clientB.page.waitForResponse(
        (response) => {
          const request = response.request();
          return (
            request.method() === 'POST' &&
            new URL(response.url()).pathname === '/api/sync/snapshot' &&
            response.ok()
          );
        },
        { timeout: 30000 },
      );
      const confirmationMessages: string[] = [];
      const confirmationHandler = async (dialog: Dialog): Promise<void> => {
        confirmationMessages.push(dialog.message());
        await dialog.accept();
      };
      clientB.page.on('dialog', confirmationHandler);

      const response = await (async () => {
        try {
          await overwriteBtn.click();
          return await forceUploadResponse;
        } finally {
          clientB.page.off('dialog', confirmationHandler);
        }
      })();

      expect(confirmationMessages).toEqual([
        "This will REPLACE the encrypted data on the server with this device's local copy and re-encrypt it with the new password. All other devices will need to re-enter the password and download the replaced data. Any unsynced changes on those devices will be permanently lost. Continue?",
        "This will REPLACE all data on the server and on every other device with this device's local copy. Any unsynced changes on those devices will be permanently lost. Continue?",
      ]);
      expect(await response.finished()).toBeNull();
      await decryptErrorDialog.waitFor({ state: 'hidden', timeout: 10000 });
      await waitForTask(clientB.page, taskB);

      // A fresh client is the remote oracle: it must hydrate B's replacement
      // with the new password, and the old remote snapshot must be gone.
      clientC = await createSimulatedClient(browser, baseURL!, 'C', testRunId);
      await clientC.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: newPassword,
      });
      await waitForTask(clientC.page, taskB);
      await expect(clientC.page.locator(`task:has-text("${taskA}")`)).not.toBeVisible();
      console.log('[Overwrite] Fresh client verified the encrypted remote replacement');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
      if (clientC) await closeClient(clientC);
    }
  });
});
