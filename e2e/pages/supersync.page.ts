import { type Page, type Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

export interface SuperSyncConfig {
  baseUrl: string;
  accessToken: string;
  isEncryptionEnabled?: boolean;
  password?: string;
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
  readonly encryptionCheckbox: Locator;
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
    this.encryptionCheckbox = page.locator(
      '.e2e-isEncryptionEnabled input[type="checkbox"]',
    );
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
   * Configure SuperSync with server URL and access token.
   * Uses right-click to open settings dialog (works even when sync is already configured).
   *
   * @param config - SuperSync configuration
   * @param waitForInitialSync - If true (default), waits for the automatic initial sync to complete
   *                            and handles dialogs. Set to false when you want to manually handle
   *                            dialogs (e.g., to test specific dialog behaviors).
   */
  async setupSuperSync(
    config: SuperSyncConfig,
    waitForInitialSync = true,
  ): Promise<void> {
    // Auto-accept native browser confirm dialogs (window.confirm used for fresh client sync confirmation)
    // Only handles 'confirm' dialogs to avoid conflicts with test handlers that may handle 'alert' dialogs
    this.page.on('dialog', async (dialog) => {
      if (dialog.type() === 'confirm') {
        const message = dialog.message();
        // Validate this is the expected fresh client sync confirmation
        const expectedPatterns = [/fresh/i, /remote/i, /sync/i, /operations/i];
        const isExpectedDialog = expectedPatterns.some((pattern) =>
          pattern.test(message),
        );

        if (!isExpectedDialog) {
          console.error(`[SuperSyncPage] Unexpected confirm dialog: "${message}"`);
          throw new Error(
            `Unexpected confirm dialog message: "${message}". ` +
              `Expected fresh client sync confirmation.`,
          );
        }

        console.log(`[SuperSyncPage] Auto-accepting confirm dialog: "${message}"`);
        await dialog.accept();
      }
    });

    // Wait for sync button to be ready first
    // The sync button depends on globalConfig being loaded (isSyncIconEnabled),
    // which can take time after initial app load. Use longer timeout and retry.
    const syncBtnTimeout = 30000;
    try {
      await this.syncBtn.waitFor({ state: 'visible', timeout: syncBtnTimeout });
    } catch {
      // If sync button not visible, the app might not be fully loaded
      // Wait a bit more and try once more (reduced from 2000ms - rare fallback)
      console.log('[SuperSyncPage] Sync button not found initially, waiting longer...');
      await this.page.waitForTimeout(1000);
      await this.syncBtn.waitFor({ state: 'visible', timeout: syncBtnTimeout });
    }

    // Wait for network to be idle - helps ensure Angular has finished loading
    await this.page.waitForLoadState('networkidle').catch(() => {
      console.log('[SuperSyncPage] Network idle timeout (non-fatal)');
    });

    // Retry loop for opening the sync settings dialog via right-click
    // Sometimes the right-click doesn't register, especially under load
    let dialogOpened = false;
    for (let dialogAttempt = 0; dialogAttempt < 5; dialogAttempt++) {
      if (this.page.isClosed()) {
        throw new Error('Page was closed during SuperSync setup');
      }

      console.log(
        `[SuperSyncPage] Opening sync settings dialog (attempt ${dialogAttempt + 1})...`,
      );

      // Use right-click to always open sync settings dialog
      // (left-click triggers sync if already configured)
      await this.syncBtn.click({ button: 'right' });

      try {
        // Wait for dialog container first
        const dialogContainer = this.page.locator('mat-dialog-container');
        await dialogContainer.waitFor({ state: 'visible', timeout: 5000 });

        // Wait for formly form to initialize inside dialog
        // This ensures the form structure is ready before interacting with fields
        await this.page
          .locator('mat-dialog-container formly-form')
          .waitFor({ state: 'visible', timeout: 5000 });

        // Wait for the formly form to be rendered inside the dialog
        // Under heavy load, the dialog may appear but form rendering is delayed
        await this.providerSelect.waitFor({ state: 'visible', timeout: 5000 });

        // Ensure the element is actually attached and stable
        await expect(this.providerSelect).toBeAttached({ timeout: 2000 });

        dialogOpened = true;
        console.log('[SuperSyncPage] Sync settings dialog opened successfully');
        break;
      } catch {
        console.log(
          `[SuperSyncPage] Dialog not opened on attempt ${dialogAttempt + 1}, retrying...`,
        );
        // Dismiss any partial state
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(200); // Reduced from 500ms
      }
    }

    if (!dialogOpened) {
      // Last attempt with longer timeout
      console.log('[SuperSyncPage] Final attempt to open sync settings dialog...');
      await this.syncBtn.click({ button: 'right', force: true });
      const dialogContainer = this.page.locator('mat-dialog-container');
      await dialogContainer.waitFor({ state: 'visible', timeout: 10000 });
      await this.providerSelect.waitFor({ state: 'visible', timeout: 10000 });
      await expect(this.providerSelect).toBeAttached({ timeout: 5000 });
    }

    // Additional wait for the element to be stable/interactive (reduced from 300ms)
    await this.page.waitForTimeout(100);

    // Retry loop for opening the dropdown - use toPass() for more robust retries
    const superSyncOption = this.page
      .locator('mat-option')
      .filter({ hasText: 'SuperSync' });
    const dropdownPanel = this.page.locator('.mat-mdc-select-panel');
    const dropdownBackdrop = this.page.locator(
      '.cdk-overlay-backdrop.cdk-overlay-transparent-backdrop',
    );

    await expect(async () => {
      // Check if page is still open
      if (this.page.isClosed()) {
        throw new Error('Page was closed during SuperSync setup');
      }

      // If a dropdown backdrop is showing, dismiss it first
      if (await dropdownBackdrop.isVisible()) {
        console.log('[SuperSyncPage] Dismissing existing dropdown overlay...');
        await this.page.keyboard.press('Escape');
        await dropdownBackdrop
          .waitFor({ state: 'hidden', timeout: 2000 })
          .catch(() => {});
        await this.page.waitForTimeout(100); // Reduced from 200ms
      }

      // Ensure the select is still attached (may have been re-rendered)
      await expect(this.providerSelect).toBeAttached({ timeout: 2000 });

      // Click to open dropdown - use force to bypass any lingering overlays
      await this.providerSelect.click({ timeout: 3000, force: true });

      // Wait for dropdown panel to appear
      await dropdownPanel.waitFor({ state: 'visible', timeout: 3000 });

      // Verify the option is visible
      await expect(superSyncOption).toBeVisible({ timeout: 2000 });
    }).toPass({
      timeout: 30000,
      intervals: [200, 400, 600, 800, 1000, 1200], // Reduced from [500, 1000, 1500, 2000, 2500, 3000]
    });

    // Click the SuperSync option and verify selection was applied
    await expect(async () => {
      // Check if dropdown is open - if not, we may need to reopen it
      if (!(await dropdownPanel.isVisible())) {
        await this.providerSelect.click({ timeout: 2000, force: true });
        await dropdownPanel.waitFor({ state: 'visible', timeout: 3000 });
      }

      // Click the option if visible
      if (await superSyncOption.isVisible()) {
        await superSyncOption.click({ timeout: 2000 });
      }

      // Wait for dropdown panel to close
      await dropdownPanel.waitFor({ state: 'detached', timeout: 3000 });

      // CRITICAL: Verify selection was actually applied
      const selectedText = await this.providerSelect
        .locator('.mat-mdc-select-value-text')
        .textContent();
      if (!selectedText?.includes('SuperSync')) {
        throw new Error(`Provider selection not applied. Selected: "${selectedText}"`);
      }
    }).toPass({
      timeout: 15000,
      intervals: [200, 400, 600, 800], // Reduced from [500, 1000, 1500, 2000]
    });

    // Wait for formly to re-render SuperSync-specific fields after provider selection
    // The hideExpression on these fields triggers a re-render that needs time to complete
    // NOTE: The mat-select UI updates immediately, but the formly model update is async.
    // We must wait for the actual DOM elements to appear, not just the UI selection.
    await this.page.waitForLoadState('networkidle').catch(() => {});

    // Fill Access Token first (it's outside the collapsible)
    // Use toPass() to handle slow formly model updates and hideExpression re-evaluation
    // First wait for the wrapper element to exist (formly has processed the model change)
    // Then wait for the textarea inside to be visible
    await expect(async () => {
      // Check if the wrapper element exists (formly hideExpression has evaluated)
      const wrapper = this.page.locator('.e2e-accessToken');
      await wrapper.waitFor({ state: 'attached', timeout: 3000 });
      // Then check if the textarea is visible
      await this.accessTokenInput.waitFor({ state: 'visible', timeout: 3000 });
    }).toPass({
      timeout: 30000,
      intervals: [200, 400, 600, 800, 1000], // Reduced from [500, 1000, 1500, 2000, 3000]
    });
    await this.accessTokenInput.fill(config.accessToken);

    // Expand "Advanced settings" collapsible to access baseUrl and encryption fields
    // Use text-based locator to find the correct collapsible (there may be others on the page)
    const advancedCollapsible = this.page.locator(
      '.collapsible-header:has-text("Advanced")',
    );
    await advancedCollapsible.waitFor({ state: 'visible', timeout: 5000 });
    await advancedCollapsible.click();
    // Wait for baseUrl input to be visible (confirms collapsible is expanded)
    await this.baseUrlInput.waitFor({ state: 'visible', timeout: 3000 });

    // Now fill baseUrl (inside the collapsible)
    await this.baseUrlInput.waitFor({ state: 'visible' });
    await this.baseUrlInput.fill(config.baseUrl);

    // Handle Encryption (also inside the collapsible)
    // Only modify checkbox if encryption is explicitly configured
    // Skip checkbox handling if isEncryptionEnabled is not specified (undefined)
    if (config.isEncryptionEnabled !== undefined) {
      // Angular Material checkboxes can start in an indeterminate "mixed" state before the form loads.
      // Use the label click with retry logic to reliably toggle the checkbox state.
      const checkboxLabel = this.page.locator('.e2e-isEncryptionEnabled label');

      // Wait for checkbox to be in a stable state (not indeterminate)
      await this.encryptionCheckbox.waitFor({ state: 'attached', timeout: 5000 });
      await this.page.waitForTimeout(200); // Let Angular settle

      if (config.isEncryptionEnabled) {
        // Use toPass() to retry until checkbox is checked - handles initial indeterminate state
        await expect(async () => {
          const isChecked = await this.encryptionCheckbox.isChecked();
          if (!isChecked) {
            await checkboxLabel.click();
            await this.page.waitForTimeout(100);
          }
          await expect(this.encryptionCheckbox).toBeChecked({ timeout: 1000 });
        }).toPass({ timeout: 15000, intervals: [500, 1000, 1500, 2000] });

        if (config.password) {
          await this.encryptionPasswordInput.waitFor({ state: 'visible' });
          await this.encryptionPasswordInput.fill(config.password);
          await this.encryptionPasswordInput.blur();
        }
      } else {
        // Use toPass() to retry until checkbox is unchecked
        await expect(async () => {
          const isChecked = await this.encryptionCheckbox.isChecked();
          if (isChecked) {
            await checkboxLabel.click();
            await this.page.waitForTimeout(100);
          }
          await expect(this.encryptionCheckbox).not.toBeChecked({ timeout: 1000 });
        }).toPass({ timeout: 15000, intervals: [500, 1000, 1500, 2000] });
      }
    }

    // Save - use a robust click that handles element detachment during dialog close
    // The dialog may close and navigation may start before click completes
    try {
      // Wait for button to be stable before clicking
      await this.saveBtn.waitFor({ state: 'visible', timeout: 5000 });
      await this.page.waitForTimeout(100); // Brief settle

      // Click and don't wait for navigation to complete - just initiate the action
      await Promise.race([
        this.saveBtn.click({ timeout: 5000 }),
        // If dialog closes quickly, the click may fail - that's OK if dialog is gone
        this.page
          .locator('mat-dialog-container')
          .waitFor({ state: 'detached', timeout: 5000 }),
      ]);
    } catch (e) {
      // If click failed but dialog is already closed, that's fine
      const dialogStillOpen = await this.page
        .locator('mat-dialog-container')
        .isVisible()
        .catch(() => false);
      if (dialogStillOpen) {
        // Dialog still open - the click actually failed
        throw e;
      }
      // Dialog closed - click worked or was unnecessary
      console.log('[SuperSyncPage] Dialog closed (click may have been interrupted)');
    }

    // Wait for dialog to fully close
    await this.page
      .locator('mat-dialog-container')
      .waitFor({ state: 'detached', timeout: 5000 })
      .catch(() => {});

    // Check if sync starts automatically (it should if enabled)
    if (waitForInitialSync) {
      try {
        await this.syncSpinner.waitFor({ state: 'visible', timeout: 5000 });
        console.log(
          '[SuperSyncPage] Initial sync started automatically, waiting for completion...',
        );
        await this.waitForSyncComplete();
      } catch (e) {
        // No auto-sync, that's fine
      }
    }
  }

  /**
   * Trigger a sync operation by clicking the sync button.
   */
  async triggerSync(): Promise<void> {
    // Wait a bit to ensure any previous internal state is cleared (reduced from 1000ms)
    await this.page.waitForTimeout(300);

    // Check if sync is already running to avoid "Sync already in progress" errors
    // If it is, wait for it to finish so we can trigger a fresh sync that includes our latest changes
    if (await this.syncSpinner.isVisible()) {
      console.log(
        '[SuperSyncPage] Sync already in progress, waiting for it to finish...',
      );
      await this.syncSpinner.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {
        console.log(
          '[SuperSyncPage] Warning: Timed out waiting for previous sync to finish',
        );
      });
      // Add a small buffer after spinner disappears (reduced from 500ms)
      await this.page.waitForTimeout(200);
    }

    // Use force:true to bypass any tooltip overlays that might be in the way
    await this.syncBtn.click({ force: true });
    // Wait for sync to start or complete immediately
    await Promise.race([
      this.syncSpinner.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {}),
      this.syncCheckIcon.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {}),
    ]);
  }

  /**
   * Wait for sync to complete (spinner gone, no error).
   * Automatically handles sync dialogs:
   * - Fresh client confirmation dialog
   * - Conflict resolution dialog (uses remote by default)
   */
  async waitForSyncComplete(timeout = 30000): Promise<void> {
    const startTime = Date.now();
    let stableCount = 0; // Count consecutive checks where sync appears complete

    // Poll for completion while handling dialogs
    while (Date.now() - startTime < timeout) {
      // Check if page is still open
      if (this.page.isClosed()) {
        throw new Error('Page was closed while waiting for sync to complete');
      }

      // Check if fresh client confirmation dialog appeared
      if (await this.freshClientDialog.isVisible()) {
        console.log('[SuperSyncPage] Fresh client dialog detected, confirming...');
        try {
          await this.freshClientConfirmBtn.click({ timeout: 2000 });
          await this.page.waitForTimeout(200); // Reduced from 500ms
        } catch (e) {
          // Dialog may have auto-closed or been detached - that's OK
          console.log(
            '[SuperSyncPage] Fresh client dialog closed before click completed',
          );
        }
        stableCount = 0;
        continue;
      }

      // Check if conflict resolution dialog appeared
      if (await this.conflictDialog.isVisible()) {
        console.log('[SuperSyncPage] Conflict dialog detected, using remote...');
        await this.conflictUseRemoteBtn.click();
        // Wait for selection to be applied and Apply to be enabled (reduced from 500ms)
        await this.page.waitForTimeout(200);

        // Wait for Apply button to be enabled (with retry)
        // Increase retries to allow for processing time (50 * 200ms = 10s)
        for (let i = 0; i < 50; i++) {
          // If dialog closed unexpectedly, break loop
          if (!(await this.conflictDialog.isVisible())) {
            break;
          }

          // Check if enabled with short timeout to avoid long waits if element missing
          const isEnabled = await this.conflictApplyBtn
            .isEnabled({ timeout: 1000 })
            .catch(() => false);

          if (isEnabled) {
            console.log('[SuperSyncPage] Clicking Apply to apply resolution...');
            await this.conflictApplyBtn.click();
            break;
          }
          await this.page.waitForTimeout(100); // Reduced from 200ms
        }

        // Wait for dialog to close
        await this.conflictDialog
          .waitFor({ state: 'hidden', timeout: 5000 })
          .catch(() => {});
        await this.page.waitForTimeout(200); // Reduced from 500ms (dialog already confirmed hidden)
        stableCount = 0;
        continue;
      }

      // Check if sync import conflict dialog appeared
      // This dialog appears when a SYNC_IMPORT filters all remote ops
      if (await this.syncImportConflictDialog.isVisible()) {
        console.log(
          '[SuperSyncPage] Sync import conflict dialog detected, using local...',
        );
        await this.syncImportUseLocalBtn.click();
        // Wait for dialog to close
        await this.syncImportConflictDialog
          .waitFor({ state: 'hidden', timeout: 10000 })
          .catch(() => {});
        await this.page.waitForTimeout(200); // Reduced from 500ms (dialog already confirmed hidden)
        stableCount = 0;
        continue;
      }

      // Check if sync is complete
      const isSpinning = await this.syncSpinner.isVisible();
      if (!isSpinning) {
        // Check for error state first
        const hasError = await this.syncErrorIcon.isVisible();
        if (hasError) {
          // Check for error snackbar - only treat as error if it contains actual error keywords
          const errorSnackbar = this.page.locator(
            'simple-snack-bar, .mat-mdc-snack-bar-container',
          );
          const snackbarText = await errorSnackbar.textContent().catch(() => '');
          const snackbarLower = (snackbarText || '').toLowerCase();

          // Only throw if this looks like a real sync error, not an informational message
          // Informational messages include: "Deleted task X Undo", "addCreated task X", etc.
          // Rate limit errors (429) are transient - the app retries automatically
          const isRateLimitError =
            snackbarLower.includes('rate limit') ||
            snackbarLower.includes('429') ||
            snackbarLower.includes('retry in');

          const isRealError =
            (snackbarLower.includes('error') ||
              snackbarLower.includes('failed') ||
              snackbarLower.includes('problem') ||
              snackbarLower.includes('could not') ||
              snackbarLower.includes('unable to')) &&
            !isRateLimitError;

          if (isRealError) {
            throw new Error(`Sync failed: ${snackbarText?.trim() || 'Server error'}`);
          }

          // If rate limited, wait for the retry (app handles this automatically)
          if (isRateLimitError) {
            console.log('[SuperSyncPage] Rate limited, waiting for automatic retry...');
            stableCount = 0;
            await this.page.waitForTimeout(500); // Reduced from 1000ms (rare error condition)
            continue;
          }
          // Not a real error, just an informational snackbar - continue checking
        }

        // Sync finished - check icon may appear briefly or not at all
        const checkVisible = await this.syncCheckIcon.isVisible();
        if (checkVisible) {
          return; // Sync complete with check icon
        }

        // No spinner, no error - sync likely complete
        // Wait for stable state (3 consecutive checks) to confirm
        stableCount++;
        if (stableCount >= 3) {
          console.log('[SuperSyncPage] Sync complete (no spinner, no error)');
          return;
        }

        await this.page.waitForTimeout(150); // Reduced from 300ms
        continue;
      }

      // Still spinning - reset stable count
      stableCount = 0;
      await this.page.waitForTimeout(100); // Reduced from 200ms
    }

    throw new Error(`Sync did not complete within ${timeout}ms`);
  }

  /**
   * Check if sync resulted in an error.
   */
  async hasSyncError(): Promise<boolean> {
    return this.syncErrorIcon.isVisible();
  }

  /**
   * Perform a full sync and wait for completion.
   * Includes a settling delay to let UI update after sync.
   */
  async syncAndWait(): Promise<void> {
    await this.triggerSync();
    await this.waitForSyncComplete();
    // Allow UI to settle after sync - reduces flakiness (reduced from 300ms)
    await this.page.waitForTimeout(100);
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

    // Scroll down to find the change password button
    const dialogContent = this.page.locator('mat-dialog-content');
    await dialogContent.evaluate((el) => el.scrollTo(0, el.scrollHeight));

    // Click the "Change Encryption Password" button
    const changePasswordBtn = this.page.locator(
      'button:has-text("Change Encryption Password")',
    );
    await changePasswordBtn.waitFor({ state: 'visible', timeout: 5000 });
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

    // Click the confirm button - wait for it to be enabled first
    const confirmBtn = changePasswordDialog.locator('button[color="warn"]');
    await expect(confirmBtn).toBeEnabled({ timeout: 5000 });
    await confirmBtn.click();

    // Wait for the dialog to close (password change complete)
    await changePasswordDialog.waitFor({ state: 'detached', timeout: 60000 });

    // Check for snackbar - if visible, verify it's not an error
    // The snackbar may auto-dismiss quickly, so we use a short timeout
    const snackbar = this.page.locator('simple-snack-bar');
    try {
      await snackbar.waitFor({ state: 'visible', timeout: 3000 });
      const snackbarText = (await snackbar.textContent()) || '';
      const lowerText = snackbarText.toLowerCase();

      // Check for error indicators
      if (
        lowerText.includes('error') ||
        lowerText.includes('failed') ||
        lowerText.includes('critical')
      ) {
        throw new Error(`Password change failed: ${snackbarText}`);
      }
      // Success - snackbar appeared and wasn't an error
    } catch (e) {
      // Snackbar not visible or already dismissed - that's OK
      // The dialog closing successfully is the primary indicator of success
      if (e instanceof Error && e.message.includes('Password change failed')) {
        throw e; // Re-throw actual error snackbars
      }
      // Otherwise ignore - dialog closed = success
    }

    // Small wait for UI to settle (reduced from 500ms)
    await this.page.waitForTimeout(200);

    // Close the sync settings dialog if still open
    const dialogContainer = this.page.locator('mat-dialog-container');
    if (await dialogContainer.isVisible()) {
      await this.page.keyboard.press('Escape');
      await dialogContainer.waitFor({ state: 'detached', timeout: 5000 });
    }
  }
}
