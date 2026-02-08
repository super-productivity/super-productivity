import { type Page, type Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

export interface SuperSyncConfig {
  baseUrl: string;
  accessToken: string;
  isEncryptionEnabled?: boolean;
  password?: string;
  /**
   * If true (default), waits for the automatic initial sync to complete
   * and handles dialogs. Set to false when you want to manually handle
   * dialogs (e.g., to test specific dialog behaviors like wrong password errors).
   */
  waitForInitialSync?: boolean;
}

/**
 * Page object for SuperSync configuration and sync operations.
 * Used for E2E tests that verify multi-client sync via the super-sync-server.
 */
export class SuperSyncPage extends BasePage {
  readonly syncBtn: Locator;
  readonly providerSelect: Locator;
  readonly baseUrlInput: Locator;
  readonly accessTokenInput: Locator;
  readonly enableEncryptionBtn: Locator;
  readonly disableEncryptionBtn: Locator;
  readonly encryptionPasswordInput: Locator;
  readonly saveBtn: Locator;
  readonly syncSpinner: Locator;
  readonly syncCheckIcon: Locator;
  readonly syncErrorIcon: Locator;
  /** Fresh client confirmation dialog - appears when a new client first syncs */
  readonly freshClientDialog: Locator;
  readonly freshClientConfirmBtn: Locator;
  /** Conflict resolution dialog - appears when local and remote have conflicting changes */
  readonly conflictDialog: Locator;
  readonly conflictUseRemoteBtn: Locator;
  readonly conflictApplyBtn: Locator;
  /** Sync import conflict dialog - appears when SYNC_IMPORT filters remote ops */
  readonly syncImportConflictDialog: Locator;
  readonly syncImportUseLocalBtn: Locator;
  readonly syncImportUseRemoteBtn: Locator;

  constructor(page: Page) {
    super(page);
    this.syncBtn = page.locator('button.sync-btn');
    this.providerSelect = page.locator('formly-field-mat-select mat-select');
    this.baseUrlInput = page.locator('.e2e-baseUrl input');
    this.accessTokenInput = page.locator('.e2e-accessToken textarea');
    this.enableEncryptionBtn = page.locator('.e2e-enable-encryption-btn button');
    this.disableEncryptionBtn = page.locator('.e2e-disable-encryption-btn button');
    this.encryptionPasswordInput = page.locator('.e2e-encryptKey input[type="password"]');
    this.saveBtn = page.locator('mat-dialog-actions button[mat-stroked-button]');
    this.syncSpinner = page.locator('.sync-btn mat-icon.spin');
    this.syncCheckIcon = page.locator('.sync-btn mat-icon.sync-state-ico');
    // Error state shows sync_problem icon (no special class, just the icon name)
    this.syncErrorIcon = page.locator('.sync-btn mat-icon:has-text("sync_problem")');
    // Fresh client confirmation dialog elements
    this.freshClientDialog = page.locator('dialog-confirm');
    this.freshClientConfirmBtn = page.locator(
      'dialog-confirm button[mat-stroked-button]',
    );
    // Conflict resolution dialog elements
    this.conflictDialog = page.locator('dialog-conflict-resolution');
    this.conflictUseRemoteBtn = page.locator(
      'dialog-conflict-resolution button:has-text("Use All Remote")',
    );
    this.conflictApplyBtn = page.locator(
      'dialog-conflict-resolution button:has-text("Apply")',
    );
    // Sync import conflict dialog elements
    this.syncImportConflictDialog = page.locator('dialog-sync-import-conflict');
    this.syncImportUseLocalBtn = page.locator(
      'dialog-sync-import-conflict button:has-text("Use My Data")',
    );
    this.syncImportUseRemoteBtn = page.locator(
      'dialog-sync-import-conflict button:has-text("Use Server Data")',
    );
  }

  /**
   * Click the provider dropdown and select "SuperSync" with retry logic.
   * Angular Material dropdowns can be flaky under load - the click may not register
   * or the dropdown may close immediately. This method retries up to 3 times.
   *
   * @private
   */
  private async selectSuperSyncProviderWithRetry(): Promise<void> {
    // Wait for Angular Material to fully initialize the select component
    // and for any animations to complete
    await this.page.waitForTimeout(300);

    // Ensure the provider select is visible and scrolled into view
    await this.providerSelect.scrollIntoViewIfNeeded();
    await this.providerSelect.waitFor({ state: 'visible', timeout: 5000 });

    const superSyncOption = this.page.locator('mat-option:has-text("SuperSync")');
    let dropdownOpened = false;

    for (let attempt = 0; attempt < 3 && !dropdownOpened; attempt++) {
      if (attempt > 0) {
        console.log(`[SuperSyncPage] Retrying dropdown click (attempt ${attempt + 1})`);
        // Wait between retries to let Angular settle
        await this.page.waitForTimeout(500);
      }

      // Ensure no animations are in progress before clicking
      await this.page
        .waitForFunction(
          () =>
            document.getAnimations().filter((a) => a.playState === 'running').length ===
            0,
          { timeout: 2000 },
        )
        .catch(() => {
          // Ignore timeout - proceed anyway if animations can't be detected
        });

      await this.providerSelect.click();
      // Wait for dropdown options to appear (Angular Material animation)
      // Increased timeout from 2s to 3s for slow environments
      dropdownOpened = await superSyncOption
        .waitFor({ state: 'visible', timeout: 3000 })
        .then(() => true)
        .catch(() => false);
    }

    if (!dropdownOpened) {
      throw new Error('Failed to open provider dropdown after 3 attempts');
    }

    await superSyncOption.click();
  }

  /**
   * Configure SuperSync with server URL and access token.
   * Uses right-click to open settings dialog (works even when sync is already configured).
   *
   * @param config - SuperSync configuration (includes optional waitForInitialSync flag)
   */
  async setupSuperSync(config: SuperSyncConfig): Promise<void> {
    // Extract waitForInitialSync from config, defaulting to true
    const waitForInitialSync = config.waitForInitialSync ?? true;
    // Auto-accept native browser confirm dialogs (window.confirm used for fresh client sync confirmation)
    // Only handles 'confirm' dialogs to avoid conflicts with test handlers that may handle 'alert' dialogs
    // Use 'once' to prevent memory leak from registering multiple handlers on repeated calls
    this.page.once('dialog', async (dialog) => {
      if (dialog.type() === 'confirm') {
        const message = dialog.message();
        // Validate this is the expected fresh client sync confirmation
        const expectedPatterns = [/fresh/i, /remote/i, /sync/i, /operations/i];
        const isExpectedDialog = expectedPatterns.some((pattern) =>
          pattern.test(message),
        );

        if (!isExpectedDialog) {
          console.warn(
            `[SuperSyncPage] Unexpected confirm dialog: "${message}". Accepting anyway...`,
          );
        }
        await dialog.accept();
      }
    });

    // CRITICAL: Ensure any leftover overlays from previous operations are closed
    // This prevents "backdrop intercepts pointer events" errors when clicking buttons
    await this.ensureOverlaysClosed();

    // Open sync settings via right-click (context menu)
    // This allows configuring sync even when already set up
    await this.syncBtn.click({ button: 'right' });

    // Wait for the provider select (indicates dialog is open)
    await this.providerSelect.waitFor({ state: 'visible', timeout: 10000 });

    // Select "SuperSync" from provider dropdown with retry logic
    await this.selectSuperSyncProviderWithRetry();
    await this.page.waitForTimeout(500); // Wait for dropdown to close and form to update

    // IMPORTANT: The baseUrl field is now inside the "Advanced Config" collapsible section.
    // We need to expand it first to access the field.
    const advancedCollapsible = this.page.locator(
      '.collapsible-header:has-text("Advanced")',
    );
    await advancedCollapsible.waitFor({ state: 'visible', timeout: 5000 });

    // Check if already expanded (baseUrl input is visible)
    const isExpanded = await this.baseUrlInput.isVisible().catch(() => false);
    if (!isExpanded) {
      await advancedCollapsible.click();
      await this.baseUrlInput.waitFor({ state: 'visible', timeout: 3000 });
    }

    // Fill in base URL
    await this.baseUrlInput.fill(config.baseUrl);

    // Fill in access token (this field is NOT in the Advanced section)
    await this.accessTokenInput.fill(config.accessToken);

    // Track if this is a fresh setup that needs encryption enabled
    // For the FIRST client (Client A), we enable encryption AFTER saving config
    // For SUBSEQUENT clients (Client B), we handle the password dialog that appears
    // when receiving encrypted data from the server
    const needsEncryptionEnabled = config.isEncryptionEnabled && config.password;

    // Save configuration first (without encryption changes)
    // Encryption can only be enabled/disabled after the provider is active
    await expect(this.saveBtn).toBeEnabled({ timeout: 5000 });
    await this.saveBtn.click();

    // Wait for the config dialog to close
    // The save() method is async and may take time to complete
    // Note: After save, a password dialog might appear if server has encrypted data
    // So we check for the config dialog specifically, not just any dialog
    await this.page.waitForTimeout(1000);

    // Define locators for dialogs we might see
    const configDialog = this.page.locator('dialog-sync-initial-cfg');
    const passwordDialog = this.page.locator('dialog-enter-encryption-password');

    // Wait for config dialog to close OR password dialog to appear
    // (password dialog appearing means config dialog closed and sync started)
    const configDialogClosed = await Promise.race([
      configDialog
        .waitFor({ state: 'hidden', timeout: 15000 })
        .then(() => 'config_closed'),
      passwordDialog
        .waitFor({ state: 'visible', timeout: 15000 })
        .then(() => 'password_appeared'),
    ]).catch(() => 'timeout');

    if (configDialogClosed === 'timeout') {
      // Neither happened - try pressing Escape to close any stuck dialog
      console.log(
        '[SuperSyncPage] Config dialog did not close after save, trying Escape',
      );
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(500);
    } else if (configDialogClosed === 'password_appeared') {
      console.log('[SuperSyncPage] Password dialog appeared - config dialog closed');
    }

    // If encryption is needed, handle the flow based on whether server has encrypted data
    if (needsEncryptionEnabled && waitForInitialSync) {
      // Wait for one of several possible outcomes:
      // 1. Password dialog (server has encrypted data, client needs to enter password)
      // 2. Fresh client dialog (server has no data or unencrypted data)
      // 3. Sync completes successfully (server has no data - this is Client A)
      // 4. Sync error with password dialog (server has encrypted data - this is Client B)
      // 5. Sync import conflict dialog

      // Define locators for all possible dialogs/states
      const decryptErrorDialog = this.page.locator('dialog-handle-decrypt-error');

      // CRITICAL: Wait for sync to reach a definitive state before deciding Client A vs B
      // The password dialog appears AFTER sync fails with DecryptNoPasswordError.
      // We should NOT assume Client A until sync has actually completed or failed.
      console.log(
        '[SuperSyncPage] Waiting for sync outcome to determine Client A vs B...',
      );

      // IMPORTANT: Do NOT include syncCheckIcon in the race!
      // The sync check icon can appear briefly when local data syncs,
      // BEFORE the server's encrypted data triggers the password dialog.
      // Instead, we wait specifically for dialogs that indicate definitive outcomes.
      // If no dialog appears within timeout, THEN we check if sync succeeded.
      const outcome = await Promise.race([
        passwordDialog
          .waitFor({ state: 'visible', timeout: 15000 })
          .then(() => 'password_dialog' as const),
        this.freshClientDialog
          .waitFor({ state: 'visible', timeout: 15000 })
          .then(() => 'fresh_client_dialog' as const),
        this.syncImportConflictDialog
          .waitFor({ state: 'visible', timeout: 15000 })
          .then(() => 'sync_import_dialog' as const),
        decryptErrorDialog
          .waitFor({ state: 'visible', timeout: 15000 })
          .then(() => 'decrypt_error_dialog' as const),
        // Sync error icon indicates encrypted data received but no password
        this.syncErrorIcon
          .waitFor({ state: 'visible', timeout: 15000 })
          .then(() => 'sync_error' as const),
        // Timeout fallback - we'll check state manually after timeout
        this.page.waitForTimeout(15000).then(() => 'timeout' as const),
      ]).catch(() => 'error' as const);

      console.log(`[SuperSyncPage] Sync outcome: ${outcome}`);

      if (outcome === 'password_dialog') {
        // Server has encrypted data - enter password and sync (this is Client B)
        console.log('[SuperSyncPage] Password dialog appeared - entering password');
        const passwordInput = passwordDialog.locator('input[type="password"]');
        await passwordInput.fill(config.password!);
        const saveAndSyncBtn = passwordDialog.locator('button[mat-flat-button]');
        await saveAndSyncBtn.click();
        await passwordDialog.waitFor({ state: 'hidden', timeout: 30000 });
      } else if (outcome === 'decrypt_error_dialog') {
        // Decryption error - this shouldn't happen with correct password
        console.log('[SuperSyncPage] Decrypt error dialog appeared - unexpected');
        throw new Error('Decrypt error dialog appeared - password may be incorrect');
      } else if (outcome === 'fresh_client_dialog') {
        // Fresh client dialog - server has no encrypted data yet
        // This means we're Client A (first client)
        console.log('[SuperSyncPage] Fresh client dialog - enabling encryption');
        await this.freshClientConfirmBtn.click();
        await this.freshClientDialog.waitFor({ state: 'hidden', timeout: 5000 });

        // Now enable encryption (this is Client A)
        await this.ensureOverlaysClosed();
        await this.enableEncryption(config.password!);
      } else if (outcome === 'sync_import_dialog') {
        // Sync import conflict - use remote data
        console.log('[SuperSyncPage] Sync import conflict dialog - using remote');
        await this.syncImportUseRemoteBtn.click();
        await this.syncImportConflictDialog.waitFor({ state: 'hidden', timeout: 5000 });

        // After handling sync import, check for password dialog
        const passwordDialogAfterImport = await passwordDialog
          .waitFor({ state: 'visible', timeout: 5000 })
          .then(() => true)
          .catch(() => false);

        if (passwordDialogAfterImport) {
          const passwordInput = passwordDialog.locator('input[type="password"]');
          await passwordInput.fill(config.password!);
          const saveAndSyncBtn = passwordDialog.locator('button[mat-flat-button]');
          await saveAndSyncBtn.click();
          await passwordDialog.waitFor({ state: 'hidden', timeout: 30000 });
        } else {
          // No password dialog after import - this might be Client A
          // Check if sync succeeded
          const syncSucceeded = await this.syncCheckIcon.isVisible().catch(() => false);
          if (!syncSucceeded) {
            // Enable encryption if no sync success (this is Client A)
            await this.ensureOverlaysClosed();
            await this.enableEncryption(config.password!);
          }
        }
      } else if (outcome === 'sync_error') {
        // Sync error - this typically means encrypted data was received but no password configured
        // Wait for password dialog to appear
        console.log('[SuperSyncPage] Sync error detected - waiting for password dialog');
        const passwordDialogAfterError = await passwordDialog
          .waitFor({ state: 'visible', timeout: 10000 })
          .then(() => true)
          .catch(() => false);

        if (passwordDialogAfterError) {
          console.log(
            '[SuperSyncPage] Password dialog appeared after sync error - entering password',
          );
          const passwordInput = passwordDialog.locator('input[type="password"]');
          await passwordInput.fill(config.password!);
          const saveAndSyncBtn = passwordDialog.locator('button[mat-flat-button]');
          await saveAndSyncBtn.click();
          await passwordDialog.waitFor({ state: 'hidden', timeout: 30000 });
        } else {
          throw new Error(
            'Sync error occurred but no password dialog appeared - check sync configuration',
          );
        }
      } else {
        // Timeout or error - check current state and decide
        console.log(
          '[SuperSyncPage] Timeout/error - checking current state to determine Client A vs B',
        );

        // Check for sync error (which would indicate encrypted data without password)
        const hasSyncError = await this.syncErrorIcon.isVisible().catch(() => false);
        const hasPasswordDialog = await passwordDialog.isVisible().catch(() => false);
        const hasSyncSuccess = await this.syncCheckIcon.isVisible().catch(() => false);
        const isSpinnerVisible = await this.syncSpinner.isVisible().catch(() => false);

        if (hasPasswordDialog) {
          console.log(
            '[SuperSyncPage] Password dialog visible after timeout - entering password',
          );
          const passwordInput = passwordDialog.locator('input[type="password"]');
          await passwordInput.fill(config.password!);
          const saveAndSyncBtn = passwordDialog.locator('button[mat-flat-button]');
          await saveAndSyncBtn.click();
          await passwordDialog.waitFor({ state: 'hidden', timeout: 30000 });
        } else if (hasSyncError) {
          // Sync error without password dialog - wait longer for password dialog
          console.log(
            '[SuperSyncPage] Sync error detected - waiting for password dialog',
          );
          const passwordDialogAfterError = await passwordDialog
            .waitFor({ state: 'visible', timeout: 10000 })
            .then(() => true)
            .catch(() => false);

          if (passwordDialogAfterError) {
            const passwordInput = passwordDialog.locator('input[type="password"]');
            await passwordInput.fill(config.password!);
            const saveAndSyncBtn = passwordDialog.locator('button[mat-flat-button]');
            await saveAndSyncBtn.click();
            await passwordDialog.waitFor({ state: 'hidden', timeout: 30000 });
          } else {
            throw new Error(
              'Sync error occurred but no password dialog appeared - check sync configuration',
            );
          }
        } else if (isSpinnerVisible) {
          // Sync still in progress - wait for it to complete or for password dialog
          console.log('[SuperSyncPage] Sync still in progress - waiting for outcome');
          const laterOutcome = await Promise.race([
            passwordDialog
              .waitFor({ state: 'visible', timeout: 30000 })
              .then(() => 'password_dialog' as const),
            this.syncCheckIcon
              .waitFor({ state: 'visible', timeout: 30000 })
              .then(() => 'sync_success' as const),
            this.syncErrorIcon
              .waitFor({ state: 'visible', timeout: 30000 })
              .then(() => 'sync_error' as const),
          ]).catch(() => 'error' as const);

          console.log(`[SuperSyncPage] Later outcome: ${laterOutcome}`);

          if (laterOutcome === 'password_dialog') {
            const passwordInput = passwordDialog.locator('input[type="password"]');
            await passwordInput.fill(config.password!);
            const saveAndSyncBtn = passwordDialog.locator('button[mat-flat-button]');
            await saveAndSyncBtn.click();
            await passwordDialog.waitFor({ state: 'hidden', timeout: 30000 });
          } else if (laterOutcome === 'sync_success') {
            // Sync succeeded with no password dialog - this is Client A
            console.log(
              '[SuperSyncPage] Sync success after wait - enabling encryption as Client A',
            );
            await this.ensureOverlaysClosed();
            await this.enableEncryption(config.password!);
          } else if (laterOutcome === 'sync_error') {
            // Wait for password dialog after error
            const dialogAfterError = await passwordDialog
              .waitFor({ state: 'visible', timeout: 10000 })
              .then(() => true)
              .catch(() => false);
            if (dialogAfterError) {
              const passwordInput = passwordDialog.locator('input[type="password"]');
              await passwordInput.fill(config.password!);
              const saveAndSyncBtn = passwordDialog.locator('button[mat-flat-button]');
              await saveAndSyncBtn.click();
              await passwordDialog.waitFor({ state: 'hidden', timeout: 30000 });
            } else {
              throw new Error('Sync error but no password dialog');
            }
          } else {
            throw new Error('Unable to determine sync outcome after waiting');
          }
        } else if (hasSyncSuccess) {
          // Sync shows success but we might still get a password dialog if server has encrypted data
          // Wait a bit longer to see if password dialog appears (it can be delayed)
          console.log(
            '[SuperSyncPage] Sync success - waiting to see if password dialog appears',
          );
          const latePasswordDialog = await passwordDialog
            .waitFor({ state: 'visible', timeout: 10000 })
            .then(() => true)
            .catch(() => false);

          if (latePasswordDialog) {
            console.log(
              '[SuperSyncPage] Late password dialog appeared - entering password',
            );
            const passwordInput = passwordDialog.locator('input[type="password"]');
            await passwordInput.fill(config.password!);
            const saveAndSyncBtn = passwordDialog.locator('button[mat-flat-button]');
            await saveAndSyncBtn.click();
            await passwordDialog.waitFor({ state: 'hidden', timeout: 30000 });
          } else {
            // No password dialog after waiting - this is truly Client A (first client)
            console.log(
              '[SuperSyncPage] No password dialog after wait - enabling encryption as Client A',
            );
            await this.ensureOverlaysClosed();
            await this.enableEncryption(config.password!);
          }
        } else {
          // Unknown state - log and throw
          throw new Error(
            'Unable to determine Client A vs B - sync state unclear after timeout',
          );
        }
      }

      // Wait for sync to complete
      const checkAlreadyVisible = await this.syncCheckIcon.isVisible().catch(() => false);

      if (!checkAlreadyVisible) {
        // Wait for sync to start or complete
        const spinnerAppeared = await this.syncSpinner
          .waitFor({ state: 'visible', timeout: 2000 })
          .then(() => true)
          .catch(() => false);

        if (spinnerAppeared) {
          await this.syncSpinner.waitFor({ state: 'hidden', timeout: 30000 });
        }

        // Wait for check icon to appear
        await this.syncCheckIcon.waitFor({ state: 'visible', timeout: 10000 });
      }
    } else if (waitForInitialSync) {
      // No encryption change needed - just wait for dialogs and sync
      // Check if a fresh client confirmation dialog appeared
      const freshDialogVisible = await this.freshClientDialog
        .isVisible()
        .catch(() => false);
      if (freshDialogVisible) {
        await this.freshClientConfirmBtn.click();
        await this.freshClientDialog.waitFor({ state: 'hidden', timeout: 5000 });
      }

      // Check if a sync import conflict dialog appeared
      const syncImportDialogVisible = await this.syncImportConflictDialog
        .isVisible()
        .catch(() => false);
      if (syncImportDialogVisible) {
        await this.syncImportUseRemoteBtn.click();
        await this.syncImportConflictDialog.waitFor({ state: 'hidden', timeout: 5000 });
      }

      // Wait for all dialogs to close
      await expect(this.page.locator('mat-dialog-container')).toHaveCount(0, {
        timeout: 10000,
      });

      // Wait for initial sync to complete
      const checkAlreadyVisible = await this.syncCheckIcon.isVisible().catch(() => false);

      if (!checkAlreadyVisible) {
        const spinnerAppeared = await this.syncSpinner
          .waitFor({ state: 'visible', timeout: 2000 })
          .then(() => true)
          .catch(() => false);

        if (spinnerAppeared) {
          await this.syncSpinner.waitFor({ state: 'hidden', timeout: 30000 });
        }

        await this.syncCheckIcon.waitFor({ state: 'visible', timeout: 5000 });
      }
    } else if (needsEncryptionEnabled) {
      // When waitForInitialSync is false but encryption is needed,
      // we need to handle the password dialog that appears when receiving encrypted data
      // This is used for testing wrong password scenarios
      const decryptErrorDialog = this.page.locator('dialog-handle-decrypt-error');

      // Wait for password dialog to appear (server has encrypted data)
      const passwordDialogAppeared = await passwordDialog
        .waitFor({ state: 'visible', timeout: 10000 })
        .then(() => true)
        .catch(() => false);

      if (passwordDialogAppeared) {
        // Enter the password (which may be wrong for testing purposes)
        console.log(
          '[SuperSyncPage] Password dialog appeared - entering password (may be wrong)',
        );
        const passwordInput = passwordDialog.locator('input[type="password"]');
        await passwordInput.fill(config.password!);
        const saveAndSyncBtn = passwordDialog.locator('button[mat-flat-button]');
        await saveAndSyncBtn.click();

        // Wait for either:
        // 1. Password dialog to close (password was correct)
        // 2. Decrypt error dialog to appear (password was wrong)
        // 3. Sync to complete (password was correct)
        const result = await Promise.race([
          passwordDialog
            .waitFor({ state: 'hidden', timeout: 30000 })
            .then(() => 'password_dialog_closed'),
          decryptErrorDialog
            .waitFor({ state: 'visible', timeout: 30000 })
            .then(() => 'decrypt_error'),
        ]).catch(() => 'timeout');

        console.log(`[SuperSyncPage] After entering password: ${result}`);
      } else {
        // No password dialog - wait for sync to start or error
        const syncStartedOrFailed = await Promise.race([
          this.syncSpinner
            .waitFor({ state: 'visible', timeout: 5000 })
            .then(() => 'spinner'),
          this.syncErrorIcon
            .waitFor({ state: 'visible', timeout: 5000 })
            .then(() => 'error'),
          decryptErrorDialog
            .waitFor({ state: 'visible', timeout: 5000 })
            .then(() => 'decrypt_error'),
          this.page.waitForTimeout(2000).then(() => 'timeout'),
        ]).catch(() => 'timeout');
        console.log(`[SuperSyncPage] Sync started or failed: ${syncStartedOrFailed}`);
      }
    } else {
      // When waitForInitialSync is false and no encryption,
      // just wait for sync to start or show an error
      const syncStartedOrFailed = Promise.race([
        this.syncSpinner
          .waitFor({ state: 'visible', timeout: 5000 })
          .catch(() => 'timeout'),
        this.syncErrorIcon
          .waitFor({ state: 'visible', timeout: 5000 })
          .catch(() => 'timeout'),
        this.page
          .locator('dialog-handle-decrypt-error')
          .waitFor({ state: 'visible', timeout: 5000 })
          .catch(() => 'timeout'),
        this.page.waitForTimeout(2000).then(() => 'timeout'),
      ]);
      await syncStartedOrFailed;
    }
  }

  /**
   * Enable encryption by reconfiguring the SuperSync provider.
   * This will trigger a clean slate operation (server wipe + fresh encrypted upload).
   *
   * Prerequisites: SuperSync must already be configured without encryption
   */
  async enableEncryption(password: string): Promise<void> {
    // Open sync settings via right-click
    await this.syncBtn.click({ button: 'right' });
    await this.providerSelect.waitFor({ state: 'visible', timeout: 10000 });

    // CRITICAL: Select "SuperSync" from provider dropdown to load current configuration
    // Without this, the form shows default/empty values instead of the actual current state
    await this.selectSuperSyncProviderWithRetry();

    // IMPORTANT: Wait for the provider change listener to complete loading the config
    // The listener is async and needs time to load provider config and update the form
    await this.page.waitForTimeout(1000);

    // Expand "Advanced settings" collapsible to access encryption fields
    const advancedCollapsible = this.page.locator(
      '.collapsible-header:has-text("Advanced")',
    );
    await advancedCollapsible.waitFor({ state: 'visible', timeout: 5000 });

    // Check if already expanded
    const isExpanded = await this.enableEncryptionBtn.isVisible().catch(() => false);
    if (!isExpanded) {
      await advancedCollapsible.click();
      await this.enableEncryptionBtn.waitFor({ state: 'visible', timeout: 3000 });
    }

    // Check if already enabled
    const isEnabled = await this.disableEncryptionBtn.isVisible().catch(() => false);
    if (isEnabled) {
      // Already enabled - just close the dialog
      const configDialog = this.page.locator('mat-dialog-container').first();
      const cancelBtn = configDialog.locator('button').filter({ hasText: /cancel/i });
      await cancelBtn.click();
      await this.page.waitForTimeout(500);
      return;
    }

    // Enable encryption by clicking the "Enable Encryption" button which opens a dialog
    await this.enableEncryptionBtn.waitFor({ state: 'visible', timeout: 5000 });
    await this.enableEncryptionBtn.click();

    // Wait for the Enable Encryption dialog to appear
    const enableEncryptionDialog = this.page.locator('dialog-enable-encryption');
    await enableEncryptionDialog.waitFor({ state: 'visible', timeout: 5000 });

    // Fill in the password fields
    const passwordInput = enableEncryptionDialog
      .locator('input[type="password"]')
      .first();
    const confirmPasswordInput = enableEncryptionDialog
      .locator('input[type="password"]')
      .nth(1);
    await passwordInput.fill(password);
    await confirmPasswordInput.fill(password);

    // Click the confirm button (has mat-flat-button and text includes "Enable")
    const confirmBtn = enableEncryptionDialog.locator(
      'button[mat-flat-button]:has-text("Enable")',
    );
    await confirmBtn.click();

    await this.page.waitForTimeout(500);

    // Close the "Configure Sync" dialog
    const configDialog = this.page.locator('mat-dialog-container').first();
    const cancelBtn = configDialog.locator('button').filter({ hasText: /cancel/i });
    await cancelBtn.click();

    // Wait for dialog to close
    await expect(this.page.locator('mat-dialog-container')).toHaveCount(0, {
      timeout: 10000,
    });

    // CRITICAL: Ensure all overlays are properly closed
    // This handles backdrop removal and any lingering dialogs
    await this.ensureOverlaysClosed();

    // Wait for clean slate operation to complete (sync will happen automatically)
    await this.page.waitForTimeout(3000);
  }

  /**
   * Disable encryption by reconfiguring the SuperSync provider.
   * This will trigger a clean slate operation (server wipe + fresh unencrypted upload).
   *
   * Prerequisites: SuperSync must already be configured with encryption enabled
   */
  async disableEncryption(): Promise<void> {
    // Open sync settings via right-click
    // Use noWaitAfter to prevent waiting for navigation events
    await this.syncBtn.click({ button: 'right', noWaitAfter: true });
    await this.providerSelect.waitFor({ state: 'visible', timeout: 10000 });

    // CRITICAL: Select "SuperSync" from provider dropdown to load current configuration
    // Without this, the form shows default/empty values instead of the actual current state
    await this.selectSuperSyncProviderWithRetry();

    // IMPORTANT: Wait for the provider change listener to complete loading the config
    // The listener is async and needs time to load provider config and update the form
    await this.page.waitForTimeout(1000);

    // Expand "Advanced settings" collapsible to access encryption fields
    const advancedCollapsible = this.page.locator(
      '.collapsible-header:has-text("Advanced")',
    );

    // Debug: Check if Advanced collapsible exists
    const advancedExists = await advancedCollapsible.count();
    console.log(`[DisableEncryption] Advanced collapsible count: ${advancedExists}`);

    // Debug: Get all collapsible headers
    const allCollapsibles = await this.page
      .locator('.collapsible-header')
      .allTextContents();
    console.log(
      `[DisableEncryption] All collapsible headers: ${JSON.stringify(allCollapsibles)}`,
    );

    await advancedCollapsible.waitFor({ state: 'visible', timeout: 5000 });

    // Check if already expanded
    const isExpanded = await this.disableEncryptionBtn.isVisible().catch(() => false);
    console.log(`[DisableEncryption] isExpanded before click: ${isExpanded}`);
    if (!isExpanded) {
      // Debug: Check if collapsible is clickable
      const isClickable = await advancedCollapsible.isEnabled().catch(() => false);
      console.log(`[DisableEncryption] Collapsible isEnabled: ${isClickable}`);

      // Scroll the collapsible into view
      await advancedCollapsible.scrollIntoViewIfNeeded();
      await this.page.waitForTimeout(300);

      // Try clicking multiple times with different methods
      console.log(`[DisableEncryption] Attempting click on collapsible...`);

      // Method 1: Regular click with noWaitAfter to prevent navigation blocking
      await advancedCollapsible.click({ noWaitAfter: true });
      await this.page.waitForTimeout(500);

      // Check if expanded
      let expandedAfterClick1 =
        (await this.page.locator('formly-collapsible.isExpanded').count()) > 0;
      console.log(`[DisableEncryption] After click 1: isExpanded=${expandedAfterClick1}`);

      if (!expandedAfterClick1) {
        // Method 2: Click with force and noWaitAfter
        await advancedCollapsible.click({ force: true, noWaitAfter: true });
        await this.page.waitForTimeout(500);
        expandedAfterClick1 =
          (await this.page.locator('formly-collapsible.isExpanded').count()) > 0;
        console.log(
          `[DisableEncryption] After click 2 (force): isExpanded=${expandedAfterClick1}`,
        );
      }

      if (!expandedAfterClick1) {
        // Method 3: Use JavaScript to click
        await advancedCollapsible.evaluate((el) => (el as HTMLElement).click());
        await this.page.waitForTimeout(500);
        expandedAfterClick1 =
          (await this.page.locator('formly-collapsible.isExpanded').count()) > 0;
        console.log(
          `[DisableEncryption] After click 3 (JS): isExpanded=${expandedAfterClick1}`,
        );
      }

      // Debug: Check collapsible state after click
      const collapsibleText = await advancedCollapsible
        .textContent()
        .catch(() => 'unknown');
      console.log(`[DisableEncryption] Collapsible text after click: ${collapsibleText}`);

      // Debug: Check what buttons are visible in the Advanced section
      const enableBtn = await this.enableEncryptionBtn.isVisible().catch(() => false);
      const disableBtn = await this.disableEncryptionBtn.isVisible().catch(() => false);
      const changeBtn = await this.page
        .locator('button:has-text("Change Password")')
        .isVisible()
        .catch(() => false);

      // Debug: Check if the Advanced section content is visible at all
      const advancedContent = await this.page
        .locator('.collapsible-content')
        .first()
        .isVisible()
        .catch(() => false);
      const encryptKeyInput = await this.encryptionPasswordInput
        .isVisible()
        .catch(() => false);

      // Debug: Check the selected provider
      const selectedProvider = await this.providerSelect
        .textContent()
        .catch(() => 'unknown');

      // Debug: Check if there are any formly fields inside the collapsible
      const formlyFieldsInCollapsible = await this.page
        .locator('.collapsible-content formly-field')
        .count();

      // Debug: Check if there are any hidden formly fields
      const hiddenFormlyFields = await this.page
        .locator('.collapsible-content formly-field[hidden]')
        .count();

      // Debug: Check if the collapsible panel exists (expanded state)
      const collapsiblePanel = await this.page.locator('.collapsible-panel').count();

      // Debug: Check if formly-collapsible has isExpanded class
      const isCollapsibleExpanded = await this.page
        .locator('formly-collapsible.isExpanded')
        .count();

      console.log('[DisableEncryption] After expand', {
        enableBtn,
        disableBtn,
        changeBtn,
        advancedContent,
        encryptKeyInput,
        selectedProvider,
        formlyFieldsInCollapsible,
        hiddenFormlyFields,
        collapsiblePanel,
        isCollapsibleExpanded,
      });

      await this.disableEncryptionBtn.waitFor({ state: 'visible', timeout: 3000 });
    }

    // Check if already disabled
    const isEnabled = await this.disableEncryptionBtn.isVisible().catch(() => false);
    if (isEnabled) {
      await this.disableEncryptionBtn.click();

      // IMPORTANT: The "Disable Encryption?" confirmation dialog appears immediately
      // when the button is clicked, NOT after clicking Save.
      // We must handle this dialog BEFORE trying to click Save on the Configure Sync dialog.

      // Wait for confirmation dialog "Disable Encryption?"
      // Use a longer timeout since the dialog might take time to render
      const confirmDialog = this.page
        .locator('mat-dialog-container')
        .filter({ hasText: 'Disable Encryption?' });
      await confirmDialog.waitFor({ state: 'visible', timeout: 10000 });

      // Click the confirm button (mat-flat-button with "Disable Encryption" text)
      const confirmBtn = confirmDialog
        .locator('button[mat-flat-button]')
        .filter({ hasText: /disable encryption/i });
      // Wait for button to be visible and clickable (dialog animation may delay rendering)
      await confirmBtn.waitFor({ state: 'visible', timeout: 10000 });
      await confirmBtn.click();

      // Wait for the disable encryption dialog to close and the operation to complete
      // This includes server wipe + fresh unencrypted upload - can take a while
      await confirmDialog.waitFor({ state: 'hidden', timeout: 60000 });
      await this.page.waitForTimeout(500);
    }

    // Now close the "Configure Sync" dialog if it's still open
    // NOTE: The app's closeAllDialogs() is called after disabling encryption,
    // which may have already closed the config dialog. Check before trying to close.
    const configDialog = this.page.locator('mat-dialog-container').first();
    const isDialogOpen = await configDialog.isVisible().catch(() => false);

    if (isDialogOpen) {
      const cancelBtn = configDialog.locator('button').filter({ hasText: /cancel/i });
      const hasCancelBtn = await cancelBtn.isVisible().catch(() => false);
      if (hasCancelBtn) {
        await cancelBtn.click();
        // Wait for dialog to close
        await expect(this.page.locator('mat-dialog-container')).toHaveCount(0, {
          timeout: 10000,
        });
      }
    }

    // CRITICAL: Ensure all overlays are properly closed
    // This handles backdrop removal and any lingering dialogs
    await this.ensureOverlaysClosed();

    // Wait for clean slate operation to complete (sync will happen automatically)
    await this.page.waitForTimeout(3000);
  }

  /**
   * Trigger a manual sync via the sync button and wait for it to complete.
   * Does not handle dialogs - use syncAndWait() for normal operation.
   *
   * @internal Use syncAndWait() instead for most cases
   */
  async triggerSync(): Promise<void> {
    await this.syncBtn.click();

    const spinnerAppeared = await this.syncSpinner
      .waitFor({ state: 'visible', timeout: 3000 })
      .then(() => true)
      .catch(() => false);

    if (spinnerAppeared) {
      // Increased timeout from 15s to 30s for multi-client scenarios under load
      // Also check for error state to fail fast
      const result = await Promise.race([
        this.syncSpinner
          .waitFor({ state: 'hidden', timeout: 30000 })
          .then(() => 'hidden'),
        this.syncErrorIcon
          .waitFor({ state: 'visible', timeout: 30000 })
          .then(() => 'error'),
      ]);

      if (result === 'error') {
        throw new Error('Sync failed with error state during triggerSync()');
      }
    }

    await this.syncCheckIcon.waitFor({ state: 'visible', timeout: 10000 });
  }

  /**
   * Wait for an ongoing sync operation to complete.
   * Useful when sync is triggered automatically (e.g., after data changes).
   *
   * @param options.timeout - Maximum time to wait (default: 15000ms)
   * @param options.skipSpinnerCheck - If true, only waits for check icon (useful when sync might already be in progress)
   */
  async waitForSyncToComplete(
    options: { timeout?: number; skipSpinnerCheck?: boolean } = {},
  ): Promise<void> {
    const { timeout = 15000, skipSpinnerCheck = false } = options;

    if (!skipSpinnerCheck) {
      // Wait for spinner to appear (sync started)
      await this.syncSpinner.waitFor({ state: 'visible', timeout: 5000 });
    }

    // Wait for sync to complete (spinner disappears)
    await this.syncSpinner.waitFor({ state: 'hidden', timeout });

    // Verify success (check icon should be visible)
    await this.syncCheckIcon.waitFor({ state: 'visible', timeout: 3000 });
  }

  /**
   * Trigger a manual sync and wait for it to complete, handling any dialogs that appear.
   * This is the main method to use for syncing in tests.
   *
   * Automatically handles:
   * - Fresh client confirmation dialogs
   * - Conflict resolution (uses "Use All Remote" by default)
   * - Sync import conflicts (uses remote by default)
   *
   * @param options.useLocal - For conflicts, use local data instead of remote (default: false)
   * @param options.timeout - Maximum time to wait for sync (default: 30000ms)
   */
  async syncAndWait(
    options: { useLocal?: boolean; timeout?: number } = {},
  ): Promise<void> {
    // Increased default timeout from 15s to 30s for multi-client scenarios under load
    const { useLocal = false, timeout = 30000 } = options;

    // Click sync button
    await this.syncBtn.click();

    // Check if sync already completed (for very fast syncs)
    const checkAlreadyVisible = await this.syncCheckIcon.isVisible().catch(() => false);

    if (!checkAlreadyVisible) {
      // Sync not yet complete, wait for it to start or complete
      // Try to wait for spinner, but if it's already gone (sync completed quickly), that's fine
      const spinnerAppeared = await this.syncSpinner
        .waitFor({ state: 'visible', timeout: 2000 })
        .then(() => true)
        .catch(() => false);

      if (spinnerAppeared) {
        // Spinner appeared, now wait for dialogs and completion
        // Check for dialogs that might appear during sync
        // These can appear in any order or not at all

        // 1. Check for fresh client confirmation dialog
        const freshDialogVisible = await this.freshClientDialog
          .isVisible()
          .catch(() => false);
        if (freshDialogVisible) {
          console.log('[SuperSyncPage] Fresh client dialog detected, confirming...');
          await this.freshClientConfirmBtn.click();
          await this.freshClientDialog.waitFor({ state: 'hidden', timeout: 5000 });
        }

        // 2. Check for conflict resolution dialog
        const conflictDialogVisible = await this.conflictDialog
          .isVisible()
          .catch(() => false);
        if (conflictDialogVisible) {
          console.log(
            `[SuperSyncPage] Conflict dialog detected, using ${useLocal ? 'local' : 'remote'} data...`,
          );
          if (useLocal) {
            // Keep local changes (manual resolution required - just click Apply)
            await this.conflictApplyBtn.click();
          } else {
            // Use all remote changes
            await this.conflictUseRemoteBtn.click();
            await this.page.waitForTimeout(200);
            await this.conflictApplyBtn.click();
          }
          await this.conflictDialog.waitFor({ state: 'hidden', timeout: 5000 });
        }

        // 3. Check for sync import conflict dialog
        const syncImportConflictVisible = await this.syncImportConflictDialog
          .isVisible()
          .catch(() => false);
        if (syncImportConflictVisible) {
          console.log(
            `[SuperSyncPage] Sync import conflict dialog detected, using ${useLocal ? 'local' : 'remote'} data...`,
          );
          if (useLocal) {
            await this.syncImportUseLocalBtn.click();
          } else {
            await this.syncImportUseRemoteBtn.click();
          }
          await this.syncImportConflictDialog.waitFor({ state: 'hidden', timeout: 5000 });
        }

        // Wait for sync to complete (spinner disappears)
        await this.syncSpinner.waitFor({ state: 'hidden', timeout });
      }

      // Now wait for check icon to appear (whether spinner appeared or not)
      await this.syncCheckIcon.waitFor({ state: 'visible', timeout: 5000 });
    }
  }

  /**
   * Check if sync is currently in error state.
   * Useful for debugging test failures.
   */
  async isSyncInErrorState(): Promise<boolean> {
    return this.syncErrorIcon.isVisible().catch(() => false);
  }

  /**
   * Check if sync button shows an error icon.
   * Alias for isSyncInErrorState for backwards compatibility with tests.
   */
  async hasSyncError(): Promise<boolean> {
    return this.syncErrorIcon.isVisible().catch(() => false);
  }

  /**
   * Open the sync settings dialog and change the encryption password.
   * This will delete all server data and re-upload with the new password.
   *
   * @param newPassword - The new encryption password
   */
  async changeEncryptionPassword(newPassword: string): Promise<void> {
    // Open sync settings via right-click
    await this.syncBtn.click({ button: 'right' });
    await this.providerSelect.waitFor({ state: 'visible', timeout: 10000 });

    // Wait for the form to initialize and load the current configuration
    // The encryption-status-box should be visible when isEncryptionEnabled is true
    await this.page.waitForTimeout(500);

    // Scroll down to find the change password button in the encryption-status-box
    const dialogContent = this.page.locator('mat-dialog-content');
    await dialogContent.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await this.page.waitForTimeout(200);

    // Click the "Change Password" button (using e2e selector)
    // If the button isn't visible, try re-selecting SuperSync to force config reload
    const changePasswordBtn = this.page.locator('.e2e-change-password-btn button');

    // First try: wait for button with shorter timeout
    let isButtonVisible = await changePasswordBtn
      .waitFor({ state: 'visible', timeout: 3000 })
      .then(() => true)
      .catch(() => false);

    // If not visible, re-select SuperSync to force provider config reload
    if (!isButtonVisible) {
      console.log(
        '[SuperSyncPage] Change password button not visible, re-selecting provider...',
      );
      await this.selectSuperSyncProviderWithRetry();
      await this.page.waitForTimeout(1500); // Wait for async config load

      // Scroll again after provider change
      await dialogContent.evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await this.page.waitForTimeout(200);

      // Second try: wait with longer timeout
      isButtonVisible = await changePasswordBtn
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true)
        .catch(() => false);
    }

    // If still not visible, throw a helpful error
    if (!isButtonVisible) {
      // Log what we can see for debugging
      const enableBtnVisible = await this.enableEncryptionBtn
        .isVisible()
        .catch(() => false);
      const disableBtnVisible = await this.disableEncryptionBtn
        .isVisible()
        .catch(() => false);
      throw new Error(
        `Change password button not visible after retries. ` +
          `Enable btn visible: ${enableBtnVisible}, Disable btn visible: ${disableBtnVisible}. ` +
          `This suggests isEncryptionEnabled is false in the form model.`,
      );
    }

    await changePasswordBtn.click();

    // Wait for the change password dialog to appear
    const changePasswordDialog = this.page.locator('dialog-change-encryption-password');
    await changePasswordDialog.waitFor({ state: 'visible', timeout: 5000 });

    // Fill in the new password
    const newPasswordInput = changePasswordDialog.locator('input[name="newPassword"]');
    const confirmPasswordInput = changePasswordDialog.locator(
      'input[name="confirmPassword"]',
    );

    await newPasswordInput.fill(newPassword);
    await newPasswordInput.blur(); // Trigger ngModel update
    await confirmPasswordInput.fill(newPassword);
    await confirmPasswordInput.blur(); // Trigger ngModel update

    // Wait for Angular to process form validation
    await this.page.waitForTimeout(200);

    // Click the "Change Password" confirm button (mat-flat-button, not the "Disable Encryption" button which is mat-stroked-button)
    const confirmBtn = changePasswordDialog.locator(
      'button[mat-flat-button][color="warn"]',
    );
    await confirmBtn.waitFor({ state: 'visible', timeout: 5000 });
    await expect(confirmBtn).toBeEnabled({ timeout: 5000 });
    await confirmBtn.click();

    // Wait for the dialog to close (password change complete)
    await changePasswordDialog.waitFor({ state: 'detached', timeout: 60000 });

    // Wait for the config dialog to close as well
    await this.page.waitForTimeout(500);

    // Close the sync config dialog if still open
    const configDialog = this.page.locator('mat-dialog-container').first();
    const isConfigDialogOpen = await configDialog.isVisible().catch(() => false);
    if (isConfigDialogOpen) {
      const cancelBtn = configDialog.locator('button').filter({ hasText: /cancel/i });
      const hasCancelBtn = await cancelBtn.isVisible().catch(() => false);
      if (hasCancelBtn) {
        await cancelBtn.click();
        await configDialog.waitFor({ state: 'hidden', timeout: 5000 });
      }
    }

    // Wait for password change operation to complete (server wipe + re-upload)
    const checkAlreadyVisible = await this.syncCheckIcon.isVisible().catch(() => false);
    if (!checkAlreadyVisible) {
      const spinnerVisible = await this.syncSpinner
        .waitFor({ state: 'visible', timeout: 3000 })
        .then(() => true)
        .catch(() => false);
      if (spinnerVisible) {
        await this.syncSpinner.waitFor({ state: 'hidden', timeout: 30000 });
      }
      await this.syncCheckIcon.waitFor({ state: 'visible', timeout: 10000 });
    }
  }

  /**
   * Get the current sync state based on visible icons.
   * Returns: 'syncing' | 'success' | 'error' | 'unknown'
   */
  async getSyncState(): Promise<'syncing' | 'success' | 'error' | 'unknown'> {
    const isSpinnerVisible = await this.syncSpinner.isVisible().catch(() => false);
    if (isSpinnerVisible) return 'syncing';

    const isCheckVisible = await this.syncCheckIcon.isVisible().catch(() => false);
    if (isCheckVisible) return 'success';

    const isErrorVisible = await this.syncErrorIcon.isVisible().catch(() => false);
    if (isErrorVisible) return 'error';

    return 'unknown';
  }

  /**
   * Disable sync by opening settings and disabling the provider.
   * Useful for test cleanup or testing sync re-enabling.
   */
  async disableSync(): Promise<void> {
    // Open sync settings via right-click
    await this.syncBtn.click({ button: 'right' });
    await this.providerSelect.waitFor({ state: 'visible', timeout: 10000 });

    // Look for "Enable Syncing" toggle (appears when editing existing config)
    const enableToggle = this.page.locator('.e2e-isEnabled input[type="checkbox"]');
    const toggleExists = await enableToggle.isVisible().catch(() => false);

    if (toggleExists) {
      const isChecked = await enableToggle.isChecked();
      if (isChecked) {
        // Click the label to toggle off
        const toggleLabel = this.page.locator('.e2e-isEnabled label');
        await toggleLabel.click();
        await this.page.waitForTimeout(200);
      }
    }

    // Save configuration
    await expect(this.saveBtn).toBeEnabled({ timeout: 5000 });
    await this.saveBtn.click();

    // Wait for dialog to close
    await expect(this.page.locator('mat-dialog-container')).toHaveCount(0, {
      timeout: 10000,
    });
  }

  /**
   * Check if SuperSync is currently configured and enabled.
   * Returns true if sync button shows check or spinner icon.
   */
  async isSyncEnabled(): Promise<boolean> {
    const checkVisible = await this.syncCheckIcon.isVisible().catch(() => false);
    const spinnerVisible = await this.syncSpinner.isVisible().catch(() => false);
    const errorVisible = await this.syncErrorIcon.isVisible().catch(() => false);

    return checkVisible || spinnerVisible || errorVisible;
  }
}
