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
  /**
   * When a sync-import-conflict dialog appears, which choice to make.
   * 'remote' (default) clicks "Use Server Data", 'local' clicks "Use My Data".
   */
  syncImportChoice?: 'remote' | 'local';
  /**
   * Password to use when a "Decryption Failed" dialog appears during initial sync.
   * This happens when the server has old encrypted ops from before an encryption change.
   * The password is entered and "Retry Decrypt" is clicked to proceed.
   */
  decryptionFailedPassword?: string;
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
  /**
   * Encryption password used during setup, stored so that syncAndWait() can
   * handle enter_password and enable_encryption dialogs that appear mid-test.
   */
  private _encryptionPassword: string = 'e2e-default-encryption-pw';

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
    const superSyncOption = this.page.locator('mat-option:has-text("SuperSync")');

    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        console.log(
          `[SuperSyncPage] Retrying dropdown selection (attempt ${attempt + 1})`,
        );
        // Close any open dropdown/overlay before retrying
        await this.page.keyboard.press('Escape').catch(() => {});
        await this.page.waitForTimeout(500);
      }

      try {
        // Wait for any pending navigation to settle (Angular routing from / to /#/tag/...)
        await this.page.waitForLoadState('domcontentloaded').catch(() => {});

        // Wait for Angular Material to fully initialize the select component
        await this.page.waitForTimeout(300);

        // Ensure the provider select is visible and scrolled into view
        await this.providerSelect.scrollIntoViewIfNeeded({ timeout: 5000 });
        await this.providerSelect.waitFor({ state: 'visible', timeout: 5000 });

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
        const dropdownOpened = await superSyncOption
          .waitFor({ state: 'visible', timeout: 3000 })
          .then(() => true)
          .catch(() => false);

        if (!dropdownOpened) {
          continue;
        }

        await superSyncOption.click();
        return; // Success!
      } catch (error) {
        console.log(
          `[SuperSyncPage] Attempt ${attempt + 1} failed: ${(error as Error).message}`,
        );
      }
    }

    throw new Error('Failed to select SuperSync provider after 3 attempts');
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
        // Try/catch: another handler (e.g. syncAndWait) may have already handled this dialog
        try {
          await dialog.accept();
        } catch {
          // Dialog already handled by another listener - ignore
        }
      }
    });

    // CRITICAL: Handle any leftover mandatory encryption dialog from previous operations
    // (e.g., backup import triggers sync which opens the disableClose:true encryption dialog).
    // ensureOverlaysClosed() uses Escape which can't dismiss disableClose dialogs.
    // Use waitFor with a short timeout instead of isVisible() to avoid a race where the
    // dialog is still animating in when we check.
    const enableEncryptionDialogEarly = this.page.locator('dialog-enable-encryption');
    const earlyEncDialogVisible = await enableEncryptionDialogEarly
      .first()
      .waitFor({ state: 'visible', timeout: 1000 })
      .then(() => true)
      .catch(() => false);
    if (earlyEncDialogVisible) {
      console.log(
        '[SuperSyncPage] Found leftover encryption dialog before setup - handling it',
      );
      await this._fillAndConfirmEncryptionDialog(
        enableEncryptionDialogEarly,
        config.password || 'e2e-default-encryption-pw',
      );
      // Wait for dialog to close; log a warning if it doesn't close in time
      const closed = await this.page
        .locator('mat-dialog-container')
        .first()
        .waitFor({ state: 'detached', timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      if (!closed) {
        console.warn(
          '[SuperSyncPage] Encryption dialog did not close after confirmation - continuing anyway',
        );
      }
    }

    // Ensure any remaining overlays from previous operations are closed
    // This prevents "backdrop intercepts pointer events" errors when clicking buttons
    await this.ensureOverlaysClosed();

    // Wait for any pending navigation to complete before opening the dialog.
    // Angular routing (e.g., from / to /#/tag/TODAY/tasks) can be in-flight,
    // which causes Playwright to block element interactions with
    // "waiting for navigation to finish" errors.
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    await this.page
      .waitForURL(/#\/(tag|project)\/.+\/tasks/, { timeout: 10000 })
      .catch(() => {});

    // Open sync settings via right-click (context menu)
    // This allows configuring sync even when already set up
    // Use noWaitAfter to prevent blocking on Angular hash navigation
    await this.syncBtn.click({ button: 'right', noWaitAfter: true });

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

    // Store the encryption password so syncAndWait() can handle dialogs mid-test
    if (config.password) {
      this._encryptionPassword = config.password;
    }

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
    const enableEncryptionDialog = this.page.locator('dialog-enable-encryption');

    // Wait for config dialog to close, password dialog to appear, or
    // mandatory encryption setup dialog to appear (SuperSync requires encryption)
    const configDialogClosed = await Promise.race([
      configDialog
        .waitFor({ state: 'hidden', timeout: 15000 })
        .then(() => 'config_closed'),
      passwordDialog
        .waitFor({ state: 'visible', timeout: 15000 })
        .then(() => 'password_appeared'),
      enableEncryptionDialog
        .first()
        .waitFor({ state: 'visible', timeout: 15000 })
        .then(() => 'enable_encryption_appeared'),
    ]).catch(() => 'timeout');

    let encryptionHandledDuringSave = false;
    if (configDialogClosed === 'enable_encryption_appeared') {
      // Mandatory encryption setup dialog appeared — fill password and confirm.
      // The config dialog AND the sync-wrapper may both open instances, so handle
      // all of them in a loop, always targeting the topmost (highest index) one.
      const defaultPw = config.password || 'e2e-default-encryption-pw';
      console.log('[SuperSyncPage] Mandatory encryption dialog appeared after save');
      for (let round = 0; round < 3; round++) {
        const encCount = await enableEncryptionDialog.count();
        if (encCount === 0) break;
        console.log(
          `[SuperSyncPage] Handling encryption dialog (${encCount} open, round ${round})`,
        );
        const topDialog = enableEncryptionDialog.nth(encCount - 1);
        await topDialog.locator('input[type="password"]').first().fill(defaultPw);
        await topDialog.locator('input[type="password"]').nth(1).fill(defaultPw);
        await topDialog.locator('button[mat-flat-button]').click();
        await expect(enableEncryptionDialog).toHaveCount(encCount - 1, {
          timeout: 15000,
        });
      }
      // After all encryption dialogs close, the config dialog save handler
      // continues and closes the config dialog
      await configDialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      encryptionHandledDuringSave = true;
    } else if (configDialogClosed === 'timeout') {
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
      const encSyncTimeout = 15000;
      const outcome = await Promise.race([
        passwordDialog
          .waitFor({ state: 'visible', timeout: encSyncTimeout })
          .then(() => 'password_dialog' as const),
        this.freshClientDialog
          .waitFor({ state: 'visible', timeout: encSyncTimeout })
          .then(() => 'fresh_client_dialog' as const),
        this.syncImportConflictDialog
          .waitFor({ state: 'visible', timeout: encSyncTimeout })
          .then(() => 'sync_import_dialog' as const),
        decryptErrorDialog
          .waitFor({ state: 'visible', timeout: encSyncTimeout })
          .then(() => 'decrypt_error_dialog' as const),
        // Mandatory encryption dialog (disableClose:true) opened by sync wrapper
        // after successful sync when SuperSync has no encryption configured
        enableEncryptionDialog
          .first()
          .waitFor({ state: 'visible', timeout: encSyncTimeout })
          .then(() => 'enable_encryption_dialog' as const),
        // Sync error icon indicates encrypted data received but no password
        this.syncErrorIcon
          .waitFor({ state: 'visible', timeout: encSyncTimeout })
          .then(() => 'sync_error' as const),
        // Timeout fallback - we'll check state manually after timeout
        this.page.waitForTimeout(encSyncTimeout).then(() => 'timeout' as const),
      ]).catch(() => 'error' as const);

      console.log(`[SuperSyncPage] Sync outcome: ${outcome}`);

      if (outcome === 'password_dialog') {
        // Server has encrypted data - enter password and sync (this is Client B)
        console.log('[SuperSyncPage] Password dialog appeared - entering password');
        const passwordInput = passwordDialog.locator('input[type="password"]');
        await passwordInput.fill(config.password!);
        const saveAndSyncBtn = passwordDialog.locator(
          'button[mat-flat-button][color="primary"]',
        );
        await saveAndSyncBtn.click();
        await passwordDialog.waitFor({ state: 'hidden', timeout: 30000 });
      } else if (outcome === 'decrypt_error_dialog') {
        const decryptPw = config.decryptionFailedPassword || config.password;
        if (decryptPw) {
          console.log(
            '[SuperSyncPage] Decrypt error dialog — entering password to retry',
          );
          const decryptDlg = this.page.locator('dialog-handle-decrypt-error');
          const pwInput = decryptDlg.locator('input[type="password"]');
          await pwInput.fill(decryptPw);
          const retryBtn = decryptDlg.locator('button[mat-flat-button][color="primary"]');
          await retryBtn.click();
          await decryptDlg.waitFor({ state: 'hidden', timeout: 30000 });
        } else {
          console.log(
            '[SuperSyncPage] Decrypt error dialog appeared - no password available',
          );
          throw new Error('Decrypt error dialog appeared - no password configured');
        }
      } else if (outcome === 'enable_encryption_dialog') {
        // Mandatory encryption dialog appeared (disableClose:true) - Client A
        // Handle it directly since ensureOverlaysClosed cannot dismiss it
        console.log(
          '[SuperSyncPage] Mandatory encryption dialog appeared - handling directly',
        );
        await this._fillAndConfirmEncryptionDialog(
          enableEncryptionDialog,
          config.password!,
        );
      } else if (outcome === 'fresh_client_dialog') {
        // Fresh client dialog - server has no encrypted data yet
        // This means we're Client A (first client)
        console.log('[SuperSyncPage] Fresh client dialog - enabling encryption');
        await this.freshClientConfirmBtn.click();
        await this.freshClientDialog.waitFor({ state: 'hidden', timeout: 5000 });

        // Wait for mandatory encryption dialog (fires after sync completes)
        await this._waitForAndHandleEncryptionDialogIfNeeded(
          enableEncryptionDialog,
          config.password!,
        );
      } else if (outcome === 'sync_import_dialog') {
        // Sync import conflict - use configured choice (default: remote)
        const useLocal = config.syncImportChoice === 'local';
        console.log(
          `[SuperSyncPage] Sync import conflict dialog - using ${useLocal ? 'local' : 'remote'}`,
        );
        if (useLocal) {
          await this.syncImportUseLocalBtn.click();
        } else {
          await this.syncImportUseRemoteBtn.click();
        }
        await this.syncImportConflictDialog.waitFor({ state: 'hidden', timeout: 5000 });

        // After handling sync import, check for password dialog
        const passwordDialogAfterImport = await passwordDialog
          .waitFor({ state: 'visible', timeout: 5000 })
          .then(() => true)
          .catch(() => false);

        if (passwordDialogAfterImport) {
          const passwordInput = passwordDialog.locator('input[type="password"]');
          await passwordInput.fill(config.password!);
          const saveAndSyncBtn = passwordDialog.locator(
            'button[mat-flat-button][color="primary"]',
          );
          await saveAndSyncBtn.click();
          await passwordDialog.waitFor({ state: 'hidden', timeout: 30000 });
        } else {
          // No password dialog after import - this might be Client A
          // Check if sync succeeded
          const syncSucceeded = await this.syncCheckIcon.isVisible().catch(() => false);
          if (!syncSucceeded) {
            // Wait for mandatory encryption dialog (fires after sync completes)
            await this._waitForAndHandleEncryptionDialogIfNeeded(
              enableEncryptionDialog,
              config.password!,
            );
          }
        }
      } else if (outcome === 'sync_error') {
        // Sync error - could mean encrypted data without password, or a non-encryption error
        // (e.g., SYNC_IMPORT conflict after backup import)
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
          const saveAndSyncBtn = passwordDialog.locator(
            'button[mat-flat-button][color="primary"]',
          );
          await saveAndSyncBtn.click();
          await passwordDialog.waitFor({ state: 'hidden', timeout: 30000 });
        } else {
          // No password dialog - the sync error is not about encryption
          // (e.g., SYNC_IMPORT conflict). Treat as Client A and enable encryption.
          console.log(
            '[SuperSyncPage] No password dialog after sync error - waiting for mandatory encryption dialog',
          );
          await this._waitForAndHandleEncryptionDialogIfNeeded(
            enableEncryptionDialog,
            config.password!,
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
          const saveAndSyncBtn = passwordDialog.locator(
            'button[mat-flat-button][color="primary"]',
          );
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
            const saveAndSyncBtn = passwordDialog.locator(
              'button[mat-flat-button][color="primary"]',
            );
            await saveAndSyncBtn.click();
            await passwordDialog.waitFor({ state: 'hidden', timeout: 30000 });
          } else {
            // No password dialog - the sync error is not about encryption
            // (e.g., SYNC_IMPORT conflict). Treat as Client A and enable encryption.
            console.log(
              '[SuperSyncPage] No password dialog after sync error - waiting for mandatory encryption dialog',
            );
            await this._waitForAndHandleEncryptionDialogIfNeeded(
              enableEncryptionDialog,
              config.password!,
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
            const saveAndSyncBtn = passwordDialog.locator(
              'button[mat-flat-button][color="primary"]',
            );
            await saveAndSyncBtn.click();
            await passwordDialog.waitFor({ state: 'hidden', timeout: 30000 });
          } else if (laterOutcome === 'sync_success') {
            // Sync succeeded with no password dialog - wait for encryption dialog
            console.log(
              '[SuperSyncPage] Sync success after wait - waiting for encryption dialog',
            );
            await this._waitForAndHandleEncryptionDialogIfNeeded(
              enableEncryptionDialog,
              config.password!,
            );
          } else if (laterOutcome === 'sync_error') {
            // Wait for password dialog after error
            const dialogAfterError = await passwordDialog
              .waitFor({ state: 'visible', timeout: 10000 })
              .then(() => true)
              .catch(() => false);
            if (dialogAfterError) {
              const passwordInput = passwordDialog.locator('input[type="password"]');
              await passwordInput.fill(config.password!);
              const saveAndSyncBtn = passwordDialog.locator(
                'button[mat-flat-button][color="primary"]',
              );
              await saveAndSyncBtn.click();
              await passwordDialog.waitFor({ state: 'hidden', timeout: 30000 });
            } else {
              throw new Error('Sync error but no password dialog');
            }
          } else {
            throw new Error('Unable to determine sync outcome after waiting');
          }
        } else if (hasSyncSuccess) {
          // Sync succeeded - could be Client A (needs encryption setup) or Client B (needs password).
          // Race for both dialogs simultaneously to avoid timing issues where one appears
          // after we've already given up waiting for it.
          console.log(
            '[SuperSyncPage] Sync success - racing for password or encryption dialog',
          );
          const dialogOutcome = await Promise.race([
            passwordDialog
              .waitFor({ state: 'visible', timeout: 5000 })
              .then(() => 'password' as const),
            enableEncryptionDialog
              .first()
              .waitFor({ state: 'visible', timeout: 5000 })
              .then(() => 'encryption' as const),
            this.page.waitForTimeout(5000).then(() => 'none' as const),
          ]).catch(() => 'none' as const);

          if (dialogOutcome === 'password') {
            console.log('[SuperSyncPage] Password dialog appeared - entering password');
            const passwordInput = passwordDialog.locator('input[type="password"]');
            await passwordInput.fill(config.password!);
            const saveAndSyncBtn = passwordDialog.locator(
              'button[mat-flat-button][color="primary"]',
            );
            await saveAndSyncBtn.click();
            await passwordDialog.waitFor({ state: 'hidden', timeout: 30000 });
          } else if (dialogOutcome === 'encryption') {
            console.log(
              '[SuperSyncPage] Mandatory encryption dialog appeared - handling',
            );
            await this._fillAndConfirmEncryptionDialog(
              enableEncryptionDialog,
              config.password!,
            );
          } else {
            console.log(
              '[SuperSyncPage] No dialog appeared - encryption may already be configured',
            );
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
      // Encryption is mandatory for SuperSync, so even when the caller doesn't
      // explicitly set isEncryptionEnabled, we must handle encryption dialogs.
      const defaultPassword = config.password || 'e2e-default-encryption-pw';
      const enterPasswordDialog = this.page.locator('dialog-enter-encryption-password');

      // IMPORTANT: Wait for the initial sync to complete or for a dialog to appear
      // BEFORE entering the dialog loop. The sync runs asynchronously after save(),
      // and the mandatory encryption dialog (_promptSuperSyncEncryptionIfNeeded)
      // opens AFTER sync completes. Without this wait, the dialog loop finds no
      // dialogs and breaks immediately, missing the encryption dialog entirely.
      console.log('[SuperSyncPage] Waiting for initial sync outcome...');
      const syncTimeout = 45000;
      const initialOutcome = await Promise.race([
        enableEncryptionDialog
          .first()
          .waitFor({ state: 'visible', timeout: syncTimeout })
          .then(() => 'enable_encryption' as const),
        enterPasswordDialog
          .waitFor({ state: 'visible', timeout: syncTimeout })
          .then(() => 'enter_password' as const),
        this.freshClientDialog
          .waitFor({ state: 'visible', timeout: syncTimeout })
          .then(() => 'fresh_client' as const),
        this.syncImportConflictDialog
          .waitFor({ state: 'visible', timeout: syncTimeout })
          .then(() => 'sync_import' as const),
        passwordDialog
          .waitFor({ state: 'visible', timeout: syncTimeout })
          .then(() => 'password' as const),
        // Decryption error dialog — appears when server has old encrypted data
        this.page
          .locator('dialog-handle-decrypt-error')
          .waitFor({ state: 'visible', timeout: syncTimeout })
          .then(() => 'decrypt_error' as const),
        // Sync error icon means encrypted data without password — wait for dialog
        this.syncErrorIcon
          .waitFor({ state: 'visible', timeout: syncTimeout })
          .then(() => 'sync_error' as const),
        // Sync check icon means sync completed. The encryption dialog opens AFTER
        // sync via the async _promptSuperSyncEncryptionIfNeeded(), so we add a
        // 2s delay. If the encryption dialog appears during this delay, its promise
        // resolves first and wins the race (because our .then() hasn't resolved yet).
        this.syncCheckIcon
          .waitFor({ state: 'visible', timeout: syncTimeout })
          .then(() => this.page.waitForTimeout(2000))
          .then(() => 'sync_success' as const),
      ]).catch(() => 'timeout' as const);
      console.log(`[SuperSyncPage] Initial sync outcome: ${initialOutcome}`);

      // If sync completed/errored without a dialog, wait briefly for post-sync dialogs
      if (
        initialOutcome === 'sync_error' ||
        initialOutcome === 'sync_success' ||
        initialOutcome === 'timeout'
      ) {
        console.log('[SuperSyncPage] Checking for late-appearing post-sync dialogs...');
        await Promise.race([
          enableEncryptionDialog.first().waitFor({ state: 'visible', timeout: 3000 }),
          enterPasswordDialog.waitFor({ state: 'visible', timeout: 3000 }),
          passwordDialog.waitFor({ state: 'visible', timeout: 3000 }),
        ]).catch(() => {});
      }

      // Handle dialogs in a loop — multiple can appear in sequence
      for (let dialogRound = 0; dialogRound < 5; dialogRound++) {
        // Check what dialog is currently visible
        const freshDialogVisible = await this.freshClientDialog
          .isVisible()
          .catch(() => false);
        if (freshDialogVisible) {
          await this.freshClientConfirmBtn.click();
          await this.freshClientDialog.waitFor({ state: 'hidden', timeout: 5000 });
          continue;
        }

        const syncImportDialogVisible = await this.syncImportConflictDialog
          .isVisible()
          .catch(() => false);
        if (syncImportDialogVisible) {
          if (config.syncImportChoice === 'local') {
            await this.syncImportUseLocalBtn.click();
          } else {
            await this.syncImportUseRemoteBtn.click();
          }
          await this.syncImportConflictDialog.waitFor({
            state: 'hidden',
            timeout: 5000,
          });
          continue;
        }

        // Client A: mandatory encryption setup dialog
        const enableEncVisible = await enableEncryptionDialog
          .isVisible()
          .catch(() => false);
        if (enableEncVisible) {
          console.log('[SuperSyncPage] Mandatory encryption dialog — setting password');
          const topEncDlg = enableEncryptionDialog.last();
          const pwInput = topEncDlg.locator('input[type="password"]').first();
          const confirmPwInput = topEncDlg.locator('input[type="password"]').nth(1);
          await pwInput.fill(defaultPassword);
          await confirmPwInput.fill(defaultPassword);
          const setPasswordBtn = topEncDlg.locator('button[mat-flat-button]');
          await setPasswordBtn.click();
          await topEncDlg.waitFor({
            state: 'hidden',
            timeout: 15000,
          });
          continue;
        }

        // Client B: enter-password dialog (server has encrypted data)
        const enterPwVisible = await enterPasswordDialog.isVisible().catch(() => false);
        if (enterPwVisible) {
          console.log('[SuperSyncPage] Enter-password dialog — entering password');
          const passwordInput = enterPasswordDialog.locator('input[type="password"]');
          await passwordInput.fill(defaultPassword);
          const saveAndSyncBtn = enterPasswordDialog.locator(
            'button[mat-flat-button][color="primary"]',
          );
          await saveAndSyncBtn.click();
          await enterPasswordDialog.waitFor({
            state: 'hidden',
            timeout: 30000,
          });
          continue;
        }

        // Client B: legacy password dialog (dialog-enter-encryption-password vs
        // dialog-sync-initial-cfg password prompt)
        const legacyPwVisible = await passwordDialog.isVisible().catch(() => false);
        if (legacyPwVisible) {
          console.log('[SuperSyncPage] Password dialog — entering password');
          const passwordInput = passwordDialog.locator('input[type="password"]');
          await passwordInput.fill(defaultPassword);
          const saveAndSyncBtn = passwordDialog.locator(
            'button[mat-flat-button][color="primary"]',
          );
          await saveAndSyncBtn.click();
          await passwordDialog.waitFor({
            state: 'hidden',
            timeout: 30000,
          });
          continue;
        }

        // "Decryption Failed" dialog — appears when server has old encrypted ops
        // from before an encryption change via import
        const decryptErrorDialog = this.page.locator('dialog-handle-decrypt-error');
        const decryptErrorVisible = await decryptErrorDialog
          .isVisible()
          .catch(() => false);
        if (decryptErrorVisible) {
          if (config.decryptionFailedPassword) {
            console.log(
              '[SuperSyncPage] Decryption Failed dialog — entering password to retry',
            );
            const passwordInput = decryptErrorDialog.locator('input[type="password"]');
            await passwordInput.fill(config.decryptionFailedPassword);
            const retryBtn = decryptErrorDialog.locator(
              'button[mat-flat-button][color="primary"]',
            );
            await retryBtn.click();
            await decryptErrorDialog.waitFor({ state: 'hidden', timeout: 30000 });
          } else {
            console.log(
              '[SuperSyncPage] Decryption Failed dialog — no password provided, cancelling',
            );
            const cancelBtn = decryptErrorDialog.locator(
              'mat-dialog-actions button[mat-button]',
            );
            await cancelBtn.click();
            await decryptErrorDialog.waitFor({ state: 'hidden', timeout: 5000 });
          }
          continue;
        }

        // No dialog currently visible — wait for one to appear or for dialogs to clear
        const dialogCount = await this.page.locator('mat-dialog-container').count();
        if (dialogCount === 0) {
          break; // All dialogs closed
        }

        // Wait briefly for dialog state to settle, then re-check
        await this.page.waitForTimeout(1000);
      }

      // After a successful sync on SuperSync, _promptSuperSyncEncryptionIfNeeded()
      // fires asynchronously (lazy import) and may open the enable_encryption dialog.
      // Handle it BEFORE asserting all dialogs are closed — the dialog has
      // disableClose:true and won't close on its own.
      const lateEnableEncDialog = await enableEncryptionDialog
        .first()
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      if (lateEnableEncDialog) {
        console.log(
          '[SuperSyncPage] Late enable-encryption dialog appeared — setting password',
        );
        const topEncDlg = enableEncryptionDialog.last();
        await topEncDlg.locator('input[type="password"]').first().fill(defaultPassword);
        await topEncDlg.locator('input[type="password"]').nth(1).fill(defaultPassword);
        await topEncDlg.locator('button[mat-flat-button]').click();
        await topEncDlg.waitFor({ state: 'hidden', timeout: 15000 });
      }

      // Wait for all dialogs to close
      await expect(this.page.locator('mat-dialog-container')).toHaveCount(0, {
        timeout: 15000,
      });

      // Wait for sync to complete (either already done or triggered after dialog)
      const checkAlreadyVisible = await this.syncCheckIcon.isVisible().catch(() => false);

      if (!checkAlreadyVisible) {
        const spinnerAppeared = await this.syncSpinner
          .waitFor({ state: 'visible', timeout: 5000 })
          .then(() => true)
          .catch(() => false);

        if (spinnerAppeared) {
          await this.syncSpinner.waitFor({ state: 'hidden', timeout: 30000 });
        }

        await this.syncCheckIcon.waitFor({ state: 'visible', timeout: 15000 });
      }
    } else if (needsEncryptionEnabled && !encryptionHandledDuringSave) {
      // When waitForInitialSync is false but encryption is needed and wasn't
      // already handled during the save dialog flow.
      // Possible scenarios:
      //   - Client B: server has encrypted data → password dialog appears
      //   - Client A: empty server → sync succeeds → mandatory encryption dialog appears
      //   - Wrong password test: password dialog → decrypt error
      //   - Client with local BACKUP_IMPORT: sync-import-conflict dialog appears
      const decryptErrorDialog = this.page.locator('dialog-handle-decrypt-error');

      // Race for whichever dialog/state appears first
      const encOutcome = await Promise.race([
        passwordDialog
          .waitFor({ state: 'visible', timeout: 15000 })
          .then(() => 'password_dialog' as const),
        enableEncryptionDialog
          .first()
          .waitFor({ state: 'visible', timeout: 15000 })
          .then(() => 'enable_encryption' as const),
        decryptErrorDialog
          .waitFor({ state: 'visible', timeout: 15000 })
          .then(() => 'decrypt_error' as const),
        this.syncImportConflictDialog
          .waitFor({ state: 'visible', timeout: 15000 })
          .then(() => 'sync_import_conflict' as const),
        this.syncSpinner
          .waitFor({ state: 'visible', timeout: 15000 })
          .then(() => 'spinner' as const),
        this.syncCheckIcon
          .waitFor({ state: 'visible', timeout: 15000 })
          .then(() => 'sync_success' as const),
        this.page.waitForTimeout(20000).then(() => 'timeout' as const),
      ]).catch(() => 'timeout' as const);

      console.log(
        `[SuperSyncPage] needsEncryption + waitForInitialSync=false outcome: ${encOutcome}`,
      );

      if (encOutcome === 'password_dialog') {
        // Server has encrypted data (Client B) - enter the password
        console.log(
          '[SuperSyncPage] Password dialog appeared - entering password (may be wrong)',
        );
        const passwordInput = passwordDialog.locator('input[type="password"]');
        await passwordInput.fill(config.password!);
        const saveAndSyncBtn = passwordDialog.locator(
          'button[mat-flat-button][color="primary"]',
        );
        await saveAndSyncBtn.click();

        const result = await Promise.race([
          passwordDialog
            .waitFor({ state: 'hidden', timeout: 30000 })
            .then(() => 'password_dialog_closed'),
          decryptErrorDialog
            .waitFor({ state: 'visible', timeout: 30000 })
            .then(() => 'decrypt_error'),
        ]).catch(() => 'timeout');

        console.log(`[SuperSyncPage] After entering password: ${result}`);
      } else if (encOutcome === 'enable_encryption') {
        // Mandatory encryption dialog (Client A with empty server, sync succeeded first)
        console.log(
          '[SuperSyncPage] Mandatory encryption dialog appeared - handling directly',
        );
        await this._fillAndConfirmEncryptionDialog(
          enableEncryptionDialog,
          config.password || 'e2e-default-encryption-pw',
        );
      } else if (encOutcome === 'sync_import_conflict') {
        // Sync import conflict dialog appeared (e.g., after backup import)
        // Let the test handle this dialog — just log and return
        console.log(
          '[SuperSyncPage] Sync import conflict dialog appeared - letting test handle it',
        );
      } else if (encOutcome === 'sync_success') {
        // Sync succeeded without any dialogs — encryption may already be configured
        console.log(
          '[SuperSyncPage] Sync succeeded without dialogs (encryption already configured)',
        );
      }
      // For spinner, decrypt_error, timeout - just return and let the test handle it
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

    // Final safety: the mandatory encryption prompt (_promptSuperSyncEncryptionIfNeeded)
    // fires after each sync completes, but may skip if the config dialog is still closing
    // (animation race with _matDialog.openDialogs check). If encryption wasn't handled yet,
    // trigger an explicit sync to re-fire the prompt now that all dialogs are definitely closed.
    if (needsEncryptionEnabled && !encryptionHandledDuringSave) {
      // Check if encryption dialog is already visible
      let finalEncVisible = await enableEncryptionDialog
        .first()
        .isVisible()
        .catch(() => false);

      if (!finalEncVisible) {
        // Trigger a sync to force _promptSuperSyncEncryptionIfNeeded to run
        // with no other dialogs open. Race between the encryption dialog appearing
        // (first-time setup) and sync completing with check icon (encryption already
        // configured — prompt was skipped).
        console.log('[SuperSyncPage] Triggering sync to flush encryption prompt...');
        await this.syncBtn.click().catch(() => {});

        // Wait for sync to complete or encryption dialog (whichever first)
        const syncOrDialog = await Promise.race([
          enableEncryptionDialog
            .first()
            .waitFor({ state: 'visible', timeout: 20000 })
            .then(() => 'encryption' as const),
          this.syncCheckIcon
            .waitFor({ state: 'visible', timeout: 20000 })
            .then(() => 'sync_complete' as const),
        ]).catch(() => 'timeout' as const);

        console.log(`[SuperSyncPage] Sync flush result: ${syncOrDialog}`);

        if (syncOrDialog === 'encryption') {
          finalEncVisible = true;
        } else if (syncOrDialog === 'sync_complete') {
          // Sync completed — the prompt fires asynchronously AFTER sync returns.
          // Wait briefly for the dialog to appear.
          finalEncVisible = await enableEncryptionDialog
            .first()
            .waitFor({ state: 'visible', timeout: 5000 })
            .then(() => true)
            .catch(() => false);
          if (finalEncVisible) {
            console.log(
              '[SuperSyncPage] Encryption dialog appeared after sync completion',
            );
          }
        }
      }

      if (finalEncVisible) {
        console.log('[SuperSyncPage] Late encryption dialog at end of setup - handling');
        await this._fillAndConfirmEncryptionDialog(
          enableEncryptionDialog,
          config.password || 'e2e-default-encryption-pw',
        );
      }
    }
  }

  /**
   * Enable encryption by reconfiguring the SuperSync provider.
   * This will trigger a clean slate operation (server wipe + fresh encrypted upload).
   *
   * Prerequisites: SuperSync must already be configured without encryption
   */
  async enableEncryption(password: string): Promise<void> {
    const enableEncryptionDialog = this.page.locator('dialog-enable-encryption');

    // Check if the mandatory encryption dialog is already open.
    // The sync wrapper opens this dialog with disableClose:true when SuperSync
    // is configured without encryption, so ensureOverlaysClosed() cannot dismiss it.
    const isEncDialogAlreadyOpen = await enableEncryptionDialog
      .isVisible()
      .catch(() => false);

    if (isEncDialogAlreadyOpen) {
      console.log(
        '[SuperSyncPage] Mandatory encryption dialog already open - handling directly',
      );
      await this._fillAndConfirmEncryptionDialog(enableEncryptionDialog, password);
      await this._waitForEncryptionSyncComplete();
      return;
    }

    // No encryption dialog open - open settings and enable encryption manually
    // Open sync settings via right-click
    // Use noWaitAfter to prevent blocking on Angular hash navigation
    await this.syncBtn.click({ button: 'right', noWaitAfter: true });
    await this.providerSelect.waitFor({ state: 'visible', timeout: 10000 });

    // CRITICAL: Select "SuperSync" from provider dropdown to load current configuration
    // Without this, the form shows default/empty values instead of the actual current state
    await this.selectSuperSyncProviderWithRetry();

    // Wait for the provider change listener to load config and update the form model.
    // The listener is async (loads from IndexedDB) so we poll for the encryption buttons
    // instead of using an arbitrary timeout that may be insufficient in CI.
    const encBtnResult = await this._waitForEncryptionButtonAfterProviderChange();

    if (encBtnResult === 'already-enabled') {
      // Already enabled - just close the dialog
      const configDialog = this.page.locator('mat-dialog-container').first();
      const cancelBtn = configDialog.locator('button').filter({ hasText: /cancel/i });
      await cancelBtn.click();
      await this.page.waitForTimeout(500);
      return;
    }

    if (encBtnResult !== 'enable-visible') {
      throw new Error(
        'Enable encryption button not visible after checking top level and Advanced section',
      );
    }

    // Enable encryption by clicking the "Enable Encryption" button which opens a dialog
    await this.enableEncryptionBtn.click();

    // Wait for the Enable Encryption dialog to appear
    await enableEncryptionDialog.waitFor({ state: 'visible', timeout: 5000 });

    await this._fillAndConfirmEncryptionDialog(enableEncryptionDialog, password);

    // Close the "Configure Sync" dialog if still open
    const configDialogCount = await this.page.locator('mat-dialog-container').count();
    if (configDialogCount > 0) {
      const configDialog = this.page.locator('mat-dialog-container').first();
      const cancelBtn = configDialog.locator('button').filter({ hasText: /cancel/i });
      const hasCancelBtn = await cancelBtn.isVisible().catch(() => false);
      if (hasCancelBtn) {
        await cancelBtn.click();
      }
    }

    // Wait for all dialogs to close
    await expect(this.page.locator('mat-dialog-container')).toHaveCount(0, {
      timeout: 10000,
    });

    // CRITICAL: Ensure all overlays are properly closed
    // This handles backdrop removal and any lingering dialogs
    await this.ensureOverlaysClosed();

    await this._waitForEncryptionSyncComplete();
  }

  /**
   * Wait briefly for the encryption dialog to appear and handle it if it does.
   * The dialog fires automatically from _promptSuperSyncEncryptionIfNeeded after
   * sync returns InSync. If encryption is already configured, the dialog won't appear.
   */
  private async _waitForAndHandleEncryptionDialogIfNeeded(
    enableEncryptionDialog: Locator,
    password: string,
  ): Promise<void> {
    // Check if already visible
    if (
      await enableEncryptionDialog
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      console.log('[SuperSyncPage] Encryption dialog already visible - handling');
      await this._fillAndConfirmEncryptionDialog(enableEncryptionDialog, password);
      return;
    }

    // Wait for it to appear - use a generous timeout since it fires asynchronously
    // after sync completes and the component is lazy-loaded
    console.log('[SuperSyncPage] Waiting for encryption dialog to appear...');
    const appeared = await enableEncryptionDialog
      .first()
      .waitFor({ state: 'visible', timeout: 15000 })
      .then(() => true)
      .catch(() => false);

    if (appeared) {
      await this._fillAndConfirmEncryptionDialog(enableEncryptionDialog, password);
    } else {
      console.log(
        '[SuperSyncPage] No encryption dialog - encryption may already be configured',
      );
    }
  }

  /**
   * Fill in the encryption dialog password fields and click confirm.
   */
  private async _fillAndConfirmEncryptionDialog(
    dialog: Locator,
    password: string,
  ): Promise<void> {
    const passwordInput = dialog.locator('input[type="password"]').first();
    const confirmPasswordInput = dialog.locator('input[type="password"]').nth(1);
    await passwordInput.fill(password);
    await confirmPasswordInput.fill(password);

    // Click the confirm button (mat-flat-button with color="primary")
    // In setup mode the button text is "Set Password", in full mode it's "Enable Encryption"
    const confirmBtn = dialog.locator('button[mat-flat-button][color="primary"]');
    await confirmBtn.click();

    await this.page.waitForTimeout(500);

    // Wait for the encryption dialog to close
    await dialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});

    // Wait for any remaining dialogs to close
    await expect(this.page.locator('mat-dialog-container'))
      .toHaveCount(0, {
        timeout: 10000,
      })
      .catch(() => {});

    await this.ensureOverlaysClosed();
  }

  /**
   * Poll for the encryption button state after provider selection.
   * The provider change listener asynchronously loads config from IndexedDB
   * and updates the Formly model, which controls button visibility.
   * Returns 'enable-visible', 'already-enabled', or 'not-found'.
   */
  private async _waitForEncryptionButtonAfterProviderChange(): Promise<
    'enable-visible' | 'already-enabled' | 'not-found'
  > {
    const POLL_TIMEOUT = 10000;
    const POLL_INTERVAL = 200;
    const deadline = Date.now() + POLL_TIMEOUT;

    // SuperSync hides the disable button but shows "Change Password" when encryption is set
    const changePasswordBtn = this.page.locator('.e2e-change-password-btn button');

    while (Date.now() < deadline) {
      // Check if disable button is visible (encryption already enabled - file-based providers)
      if (await this.disableEncryptionBtn.isVisible().catch(() => false)) {
        return 'already-enabled';
      }

      // Check if "Change Password" button is visible (encryption already enabled - SuperSync)
      if (await changePasswordBtn.isVisible().catch(() => false)) {
        return 'already-enabled';
      }

      // Check if enable button is visible at top level (SuperSync placement)
      if (await this.enableEncryptionBtn.isVisible().catch(() => false)) {
        return 'enable-visible';
      }

      await this.page.waitForTimeout(POLL_INTERVAL);
    }

    // Last resort: try expanding Advanced section
    const advancedCollapsible = this.page.locator(
      '.collapsible-header:has-text("Advanced")',
    );
    if (await advancedCollapsible.isVisible().catch(() => false)) {
      await advancedCollapsible.click();
      const found = await this.enableEncryptionBtn
        .waitFor({ state: 'visible', timeout: 3000 })
        .then(() => true)
        .catch(() => false);
      if (found) {
        return 'enable-visible';
      }
    }

    return 'not-found';
  }

  /**
   * Wait for the clean slate sync to complete after enabling/disabling encryption.
   */
  private async _waitForEncryptionSyncComplete(): Promise<void> {
    const spinnerAppeared = await this.syncSpinner
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (spinnerAppeared) {
      await this.syncSpinner.waitFor({ state: 'hidden', timeout: 30000 });
    }
    await this.syncCheckIcon.waitFor({ state: 'visible', timeout: 10000 });
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

    // Wait for the provider change listener to load config and update the form model.
    // Poll for the disable encryption button which appears when isEncryptionEnabled is true.
    const encBtnResult = await this._waitForEncryptionButtonAfterProviderChange();

    if (encBtnResult === 'already-enabled') {
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
   * Handle any sync-blocking dialogs (Angular Material or native).
   * Returns true if a dialog was handled, false otherwise.
   * @private
   */
  private async _handleSyncDialogs(useLocal: boolean): Promise<boolean> {
    // 1. Fresh client confirmation dialog (Angular Material)
    if (await this.freshClientDialog.isVisible().catch(() => false)) {
      console.log('[syncAndWait] Fresh client dialog detected, confirming...');
      await this.freshClientConfirmBtn.click();
      await this.freshClientDialog.waitFor({ state: 'hidden', timeout: 5000 });
      return true;
    }

    // 2. Conflict resolution dialog
    if (await this.conflictDialog.isVisible().catch(() => false)) {
      console.log(
        `[syncAndWait] Conflict dialog detected, using ${useLocal ? 'local' : 'remote'} data...`,
      );
      if (useLocal) {
        await this.conflictApplyBtn.click();
      } else {
        await this.conflictUseRemoteBtn.click();
        await this.page.waitForTimeout(200);
        await this.conflictApplyBtn.click();
      }
      await this.conflictDialog.waitFor({ state: 'hidden', timeout: 5000 });
      return true;
    }

    // 3. Sync import conflict dialog
    if (await this.syncImportConflictDialog.isVisible().catch(() => false)) {
      console.log(
        `[syncAndWait] Sync import conflict detected, using ${useLocal ? 'local' : 'remote'} data...`,
      );
      if (useLocal) {
        await this.syncImportUseLocalBtn.click();
      } else {
        await this.syncImportUseRemoteBtn.click();
      }
      await this.syncImportConflictDialog.waitFor({ state: 'hidden', timeout: 5000 });
      return true;
    }

    // 4. Enter encryption password dialog (appears when encrypted data is received
    //    but no password is configured, e.g., after import or reconnection)
    const enterPasswordDialog = this.page.locator('dialog-enter-encryption-password');
    if (await enterPasswordDialog.isVisible().catch(() => false)) {
      console.log('[syncAndWait] Enter-password dialog detected, entering password');
      const passwordInput = enterPasswordDialog.locator('input[type="password"]');
      await passwordInput.fill(this._encryptionPassword);
      const saveAndSyncBtn = enterPasswordDialog.locator(
        'button[mat-flat-button][color="primary"]',
      );
      await saveAndSyncBtn.click();
      await enterPasswordDialog.waitFor({ state: 'hidden', timeout: 30000 });
      return true;
    }

    // 5. Enable encryption dialog (appears when SuperSync requires encryption
    //    setup, e.g., after account reset clears server data)
    const enableEncryptionDialog = this.page.locator('dialog-enable-encryption');
    if (await enableEncryptionDialog.isVisible().catch(() => false)) {
      console.log('[syncAndWait] Enable-encryption dialog detected, setting password');
      const topDialog = enableEncryptionDialog.last();
      await topDialog
        .locator('input[type="password"]')
        .first()
        .fill(this._encryptionPassword);
      await topDialog
        .locator('input[type="password"]')
        .nth(1)
        .fill(this._encryptionPassword);
      await topDialog.locator('button[mat-flat-button]').click();
      await topDialog.waitFor({ state: 'hidden', timeout: 15000 });
      return true;
    }

    return false;
  }

  /**
   * Trigger a manual sync and wait for it to complete, handling any dialogs that appear.
   * This is the main method to use for syncing in tests.
   *
   * Automatically handles:
   * - Native window.confirm dialogs (fresh client sync confirmation)
   * - Fresh client confirmation dialogs (Angular Material)
   * - Conflict resolution (uses "Use All Remote" by default)
   * - Sync import conflicts (uses remote by default)
   *
   * Dialogs are checked continuously during the sync wait, not just once at the start.
   * This prevents sync hangs when dialogs appear mid-sync.
   *
   * @param options.useLocal - For conflicts, use local data instead of remote (default: false)
   * @param options.timeout - Maximum time to wait for sync (default: 30000ms)
   */
  async syncAndWait(
    options: { useLocal?: boolean; timeout?: number } = {},
  ): Promise<void> {
    // Increased default timeout from 15s to 30s for multi-client scenarios under load
    const { useLocal = false, timeout = 30000 } = options;

    // Register handler for native window.confirm dialogs that may appear during sync
    // (e.g., fresh client confirmation, data repair). Use a non-once handler that
    // removes itself when sync completes.
    let dialogHandlerActive = true;
    const dialogHandler = async (
      dialog: import('@playwright/test').Dialog,
    ): Promise<void> => {
      if (!dialogHandlerActive) return;
      try {
        if (dialog.type() === 'confirm') {
          console.log(
            `[syncAndWait] Native confirm dialog: "${dialog.message().substring(0, 80)}..." - accepting`,
          );
          await dialog.accept();
        } else if (dialog.type() === 'alert') {
          console.log(
            `[syncAndWait] Native alert dialog: "${dialog.message().substring(0, 80)}..." - dismissing`,
          );
          await dialog.dismiss();
        }
      } catch {
        // Dialog already handled by another listener - ignore
      }
    };
    this.page.on('dialog', dialogHandler);

    try {
      // Click sync button
      await this.syncBtn.click();

      // Check if sync already completed (for very fast syncs)
      const checkAlreadyVisible = await this.syncCheckIcon.isVisible().catch(() => false);

      if (!checkAlreadyVisible) {
        // Sync not yet complete, wait for it to start or complete
        const spinnerAppeared = await this.syncSpinner
          .waitFor({ state: 'visible', timeout: 2000 })
          .then(() => true)
          .catch(() => false);

        if (spinnerAppeared) {
          // Wait for sync to complete, continuously checking for blocking dialogs.
          // Previously we checked dialogs once then blocked on spinner - but dialogs
          // can appear at any point during sync (especially after server round-trips).
          const startTime = Date.now();

          while (Date.now() - startTime < timeout) {
            // Handle any visible dialog first
            const handledDialog = await this._handleSyncDialogs(useLocal);
            if (handledDialog) {
              // Encryption/password dialogs trigger re-sync via afterClosed() → sync().
              // Wait briefly so the new sync has time to start (spinner appears).
              await this.page.waitForTimeout(2000);
              continue;
            }

            // Wait for spinner to hide with short timeout to allow periodic dialog checks
            const remaining = Math.max(timeout - (Date.now() - startTime), 1000);
            const waitChunk = Math.min(3000, remaining);

            try {
              await this.syncSpinner.waitFor({ state: 'hidden', timeout: waitChunk });
              break; // Spinner hidden - sync complete
            } catch {
              // Spinner still visible - check for error state
              const hasError = await this.syncErrorIcon.isVisible().catch(() => false);
              if (hasError) {
                // Before throwing, give encryption dialogs a chance to appear.
                // DecryptNoPasswordError sets ERROR status THEN opens the dialog
                // asynchronously (lazy import), so the dialog may not be visible yet.
                await this.page.waitForTimeout(500);
                const handledEncryptionDialog = await this._handleSyncDialogs(useLocal);
                if (handledEncryptionDialog) {
                  continue; // Dialog handled — re-sync will start, re-enter loop
                }
                throw new Error('Sync failed with error state during syncAndWait()');
              }
              // Continue loop to re-check for dialogs
            }
          }

          // Final check
          const isStillSpinning = await this.syncSpinner.isVisible().catch(() => false);
          if (isStillSpinning) {
            throw new Error(
              `syncAndWait timed out after ${timeout}ms - spinner still visible`,
            );
          }
        }

        // Check for encryption dialogs before waiting for check icon.
        // The sync may have ended with ERROR status and opened a dialog.
        await this._handleSyncDialogs(useLocal);

        // Now wait for check icon to appear (whether spinner appeared or not)
        await this.syncCheckIcon.waitFor({ state: 'visible', timeout: 10000 });
      }

      // Post-sync dialog check: _promptSuperSyncEncryptionIfNeeded() runs AFTER
      // sync completes (check icon visible) and may open enable_encryption or
      // enter_password dialogs asynchronously (lazy import causes delay).
      // Give these dialogs time to appear and handle them.
      await this.page.waitForTimeout(1500);
      const postSyncDialog = await this._handleSyncDialogs(useLocal);
      if (postSyncDialog) {
        console.log(
          '[syncAndWait] Post-sync encryption dialog handled, waiting for re-sync...',
        );
        // The dialog's afterClosed() triggers a new sync() call.
        // Wait for that sync cycle to complete.
        const reSpinner = await this.syncSpinner
          .waitFor({ state: 'visible', timeout: 5000 })
          .then(() => true)
          .catch(() => false);
        if (reSpinner) {
          await this.syncSpinner.waitFor({ state: 'hidden', timeout: 30000 });
        }
        await this.syncCheckIcon.waitFor({ state: 'visible', timeout: 10000 });

        // Check for another dialog after re-sync (e.g., enter_password after enable_encryption)
        await this.page.waitForTimeout(1500);
        const secondDialog = await this._handleSyncDialogs(useLocal);
        if (secondDialog) {
          console.log(
            '[syncAndWait] Second post-sync dialog handled, waiting for re-sync...',
          );
          const reSpinner2 = await this.syncSpinner
            .waitFor({ state: 'visible', timeout: 5000 })
            .then(() => true)
            .catch(() => false);
          if (reSpinner2) {
            await this.syncSpinner.waitFor({ state: 'hidden', timeout: 30000 });
          }
          await this.syncCheckIcon.waitFor({ state: 'visible', timeout: 10000 });
        }
      }
    } finally {
      // Clean up the dialog handler
      dialogHandlerActive = false;
      this.page.off('dialog', dialogHandler);
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
    // Use noWaitAfter to prevent blocking on Angular hash navigation
    await this.syncBtn.click({ button: 'right', noWaitAfter: true });
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
        .waitFor({ state: 'visible', timeout: 5000 })
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
    // Use noWaitAfter to prevent blocking on Angular hash navigation
    await this.syncBtn.click({ button: 'right', noWaitAfter: true });
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
