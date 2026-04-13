import { type Page, type Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

export class SyncPage extends BasePage {
  readonly syncBtn: Locator;
  readonly providerSelect: Locator;
  readonly baseUrlInput: Locator;
  readonly userNameInput: Locator;
  readonly passwordInput: Locator;
  readonly syncFolderInput: Locator;
  readonly saveBtn: Locator;
  readonly syncSpinner: Locator;
  readonly syncCheckIcon: Locator;
  readonly encryptionPasswordInput: Locator;
  readonly enableEncryptionBtn: Locator;
  readonly disableEncryptionBtn: Locator;

  constructor(page: Page) {
    super(page);
    this.syncBtn = page.locator('button.sync-btn');
    this.providerSelect = page.locator('formly-field-mat-select mat-select');
    this.baseUrlInput = page.locator('.e2e-baseUrl input');
    this.userNameInput = page.locator('.e2e-userName input');
    this.passwordInput = page.locator('.e2e-password input');
    this.syncFolderInput = page.locator('.e2e-syncFolderPath input');
    this.saveBtn = page.locator('mat-dialog-actions button[mat-stroked-button]');
    this.syncSpinner = page.locator('.sync-btn mat-icon.spin');
    this.syncCheckIcon = page.locator('.sync-btn mat-icon.sync-state-ico');
    // Encryption-related locators
    // Note: encryptionPasswordInput is no longer used directly - password is entered in a dialog
    this.encryptionPasswordInput = page.locator(
      '.e2e-file-based-encrypt-key input[type="password"]',
    );
    // Enable encryption button is in Advanced Settings (file-based providers)
    this.enableEncryptionBtn = page.locator(
      '.e2e-file-based-enable-encryption-btn button',
    );
    // Disable encryption button is in the encryption status box (main view)
    this.disableEncryptionBtn = page.locator('.e2e-disable-encryption-btn button');
  }

  async setupWebdavSync(config: {
    baseUrl: string;
    username: string;
    password: string;
    syncFolderPath: string;
    isEncryptionEnabled?: boolean;
    encryptionPassword?: string;
  }): Promise<void> {
    // Try entire setup flow up to 2 times (dialog-level retry)
    for (let dialogAttempt = 0; dialogAttempt < 2; dialogAttempt++) {
      if (dialogAttempt > 0) {
        console.log(`[setupWebdavSync] Dialog-level retry attempt ${dialogAttempt + 1}`);
      }

      // Dismiss any visible snackbars/toasts that might block clicks
      const snackBar = this.page.locator('.mat-mdc-snack-bar-container');
      if (await snackBar.isVisible({ timeout: 500 }).catch(() => false)) {
        const dismissBtn = snackBar.locator('button');
        if (await dismissBtn.isVisible({ timeout: 500 }).catch(() => false)) {
          await dismissBtn.click().catch(() => {});
        }
        await this.page.waitForTimeout(500);
      }

      // Wait for any pending navigation to complete before opening the dialog.
      // Angular hash-based routing (e.g., from / to /#/tag/TODAY/tasks) can be in-flight,
      // which causes Playwright to block element interactions with
      // "waiting for navigation to finish" errors.
      await this.page.waitForLoadState('domcontentloaded').catch(() => {});
      await this.page
        .waitForURL(/#\/(tag|project)\/.+\/tasks/, { timeout: 10000 })
        .catch(() => {});

      // Ensure sync button is visible and clickable
      await this.syncBtn.waitFor({ state: 'visible', timeout: 10000 });

      // Click sync button to open settings dialog
      // Use noWaitAfter to prevent blocking on Angular hash navigation
      await this.syncBtn.click({ timeout: 5000, noWaitAfter: true });

      // Wait for dialog to appear
      const dialog = this.page.locator('mat-dialog-container, .mat-mdc-dialog-container');
      const dialogVisible = await dialog
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true)
        .catch(() => false);

      // If dialog didn't open, try clicking again
      if (!dialogVisible) {
        await this.page.waitForTimeout(500);
        await this.syncBtn.click({ force: true, noWaitAfter: true });
        await dialog.waitFor({ state: 'visible', timeout: 5000 });
      }

      // Wait for dialog to be fully loaded
      await this.page.waitForLoadState('networkidle');
      await this.providerSelect.waitFor({ state: 'visible', timeout: 10000 });

      // Wait a moment for Angular animations
      await this.page.waitForTimeout(500);

      // Click on provider select to open dropdown with retry
      const webdavOption = this.page.locator('mat-option').filter({ hasText: 'WebDAV' });
      const selectElement = this.providerSelect;
      const selectValueText = this.page.locator(
        'formly-field-mat-select .mat-mdc-select-value-text',
      );

      let selectionSucceeded = false;

      for (let attempt = 0; attempt < 5; attempt++) {
        // Ensure the select is in view
        await selectElement.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(async () => {
          // If scrollIntoViewIfNeeded fails, try scrolling the dialog content
          const dialogContent = this.page.locator('mat-dialog-content');
          if (await dialogContent.isVisible()) {
            await dialogContent.evaluate((el) => el.scrollTo(0, 0));
          }
        });
        await this.page.waitForTimeout(300);

        // Focus and click the select element
        await selectElement.focus().catch(() => {});
        await this.page.waitForTimeout(200);

        // Try multiple ways to open the dropdown
        if (attempt === 0) {
          await selectElement.click().catch(() => {});
        } else if (attempt === 1) {
          await this.page.keyboard.press('Space');
        } else if (attempt === 2) {
          await this.page.keyboard.press('ArrowDown');
        } else {
          await selectElement.click({ force: true }).catch(() => {});
        }
        await this.page.waitForTimeout(500);

        // Wait for any mat-option to appear (dropdown opened)
        const anyOption = this.page.locator('mat-option').first();
        const anyOptionVisible = await anyOption
          .waitFor({ state: 'visible', timeout: 3000 })
          .then(() => true)
          .catch(() => false);

        if (anyOptionVisible) {
          const webdavVisible = await webdavOption
            .waitFor({ state: 'visible', timeout: 3000 })
            .then(() => true)
            .catch(() => false);

          if (webdavVisible) {
            await webdavOption.click();

            // KEY FIX: Verify selection actually took effect by checking mat-select value
            const selectionVerified = await selectValueText
              .waitFor({ state: 'visible', timeout: 3000 })
              .then(async () => {
                const text = await selectValueText.textContent();
                return text?.includes('WebDAV') ?? false;
              })
              .catch(() => false);

            if (selectionVerified) {
              // Selection confirmed - now wait for Formly to process the model change
              await this.page.waitForTimeout(500); // Allow Formly hideExpression to evaluate

              // Wait for WebDAV form fields with increased timeout
              const fieldVisible = await this.baseUrlInput
                .waitFor({ state: 'visible', timeout: 8000 })
                .then(() => true)
                .catch(() => false);

              if (fieldVisible) {
                selectionSucceeded = true;
                break; // Form fields are visible, we can proceed
              }
            }
          }
        }

        // Close dropdown and retry
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(500);
      }

      if (selectionSucceeded) {
        // Final verification with increased timeout
        await this.baseUrlInput.waitFor({ state: 'visible', timeout: 15000 });

        // Fill in the configuration
        await this.baseUrlInput.fill(config.baseUrl);
        await this.userNameInput.fill(config.username);
        await this.passwordInput.fill(config.password);
        await this.syncFolderInput.fill(config.syncFolderPath);

        // Save the configuration
        await this.saveBtn.click();

        // Wait for dialog to close
        await dialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(500);

        if (config.isEncryptionEnabled && config.encryptionPassword) {
          await this.waitForSyncReady();
          await this.enableEncryption(config.encryptionPassword);
        }
        return; // Success - exit the method
      }

      // Selection failed after all attempts - close dialog and retry from scratch
      console.log(
        '[setupWebdavSync] All dropdown attempts failed, closing dialog to retry',
      );
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(1000);

      // Ensure dialog is closed before retrying
      await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    }

    // If we get here, both dialog-level attempts failed
    throw new Error(
      '[setupWebdavSync] Failed to setup WebDAV sync after multiple dialog-level retries',
    );
  }

  async triggerSync(): Promise<void> {
    // Dismiss any open dialogs/overlays that might block the sync button
    const overlay = this.page.locator('.cdk-overlay-backdrop');
    if (await overlay.isVisible({ timeout: 500 }).catch(() => false)) {
      // Try pressing Escape to close any open dialog
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(300);
      // If overlay is still there, try clicking outside to dismiss
      if (await overlay.isVisible({ timeout: 300 }).catch(() => false)) {
        await overlay.click({ force: true }).catch(() => {});
        await this.page.waitForTimeout(300);
      }
    }

    // Use noWaitAfter to prevent blocking on Angular hash navigation
    await this.syncBtn.click({ noWaitAfter: true });
    // Wait for any sync operation to start (spinner appears or completes immediately)
    await Promise.race([
      this.syncSpinner.waitFor({ state: 'visible', timeout: 1000 }).catch(() => {}),
      this.syncCheckIcon.waitFor({ state: 'visible', timeout: 1000 }).catch(() => {}),
    ]);
  }

  async waitForSyncComplete(): Promise<void> {
    // Wait for sync spinner to disappear
    await this.syncSpinner.waitFor({ state: 'hidden', timeout: 20000 }); // Reduced from 30s to 20s
    // Verify check icon appears
    await this.syncCheckIcon.waitFor({ state: 'visible' });
  }

  /**
   * Waits for sync to be ready after page load.
   * This ensures the provider config has been loaded from IndexedDB.
   */
  async waitForSyncReady(): Promise<void> {
    // Wait for sync button to show the check icon (indicates provider is ready)
    // The sync button shows sync_disabled when not ready, and check/done_all when ready
    await this.syncCheckIcon.waitFor({ state: 'visible', timeout: 10000 });
  }

  /**
   * Expands the Advanced settings section in the sync dialog.
   * The formly-collapsible component uses a custom structure with .collapsible-header
   */
  async expandAdvancedSettings(): Promise<void> {
    // Find the Advanced collapsible header by its text content
    const collapsibleHeader = this.page.locator(
      'formly-collapsible .collapsible-header:has-text("Advanced")',
    );

    // Wait for it to be visible
    await collapsibleHeader.waitFor({ state: 'visible', timeout: 5000 });

    // Check if the panel is already expanded by looking for .collapsible-panel sibling
    const collapsiblePanel = this.page.locator('formly-collapsible .collapsible-panel');
    const isExpanded = await collapsiblePanel.isVisible().catch(() => false);

    if (!isExpanded) {
      await collapsibleHeader.click();
      // Wait for expansion animation
      await this.page.waitForTimeout(500);
      // Wait for panel to be visible
      await collapsiblePanel.waitFor({ state: 'visible', timeout: 3000 });
    }
  }

  /**
   * Enables encryption for file-based providers (WebDAV, Dropbox, LocalFile).
   *
   * Flow:
   * 1. Opens sync settings dialog
   * 2. Expands Advanced settings
   * 3. Clicks "Enable Encryption" button
   * 4. Fills password in the enable encryption dialog
   * 5. Confirms encryption
   */
  async enableEncryption(password: string): Promise<void> {
    // Wait for any pending navigation to complete before opening the dialog.
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    await this.page
      .waitForURL(/#\/(tag|project)\/.+\/tasks/, { timeout: 10000 })
      .catch(() => {});

    // Open sync settings dialog using right-click
    // Use noWaitAfter to prevent blocking on Angular hash navigation
    await this.syncBtn.click({ button: 'right', noWaitAfter: true });
    const settingsDialog = this.page.locator(
      'mat-dialog-container, .mat-mdc-dialog-container',
    );
    await settingsDialog.waitFor({ state: 'visible', timeout: 5000 });

    // Expand advanced settings to access encryption button
    await this.expandAdvancedSettings();

    // Check if encryption is already enabled
    const isEnabled = await this.disableEncryptionBtn.isVisible().catch(() => false);
    if (isEnabled) {
      // Encryption already enabled, close dialog and return
      await this.page.keyboard.press('Escape');
      await settingsDialog
        .first()
        .waitFor({ state: 'hidden', timeout: 5000 })
        .catch(() => {});
      return;
    }

    // Click the "Enable Encryption" button to open encryption dialog
    await this.enableEncryptionBtn.waitFor({ state: 'visible', timeout: 5000 });
    await expect(this.enableEncryptionBtn).toBeEnabled({ timeout: 5000 });
    await this.enableEncryptionBtn.click();

    // Wait for the encryption dialog to appear
    // The dialog has title "Enable Encryption?" and contains password fields
    const encryptionDialog = this.page.locator('mat-dialog-container').filter({
      hasText: 'Enable Encryption?',
    });
    await encryptionDialog.waitFor({ state: 'visible', timeout: 5000 });

    // Fill in the password fields directly by finding them within the dialog
    const passwordInput = encryptionDialog.locator('input[type="password"]').first();
    const confirmInput = encryptionDialog.locator('input[type="password"]').nth(1);

    // Fill password field
    await passwordInput.waitFor({ state: 'visible', timeout: 5000 });
    await passwordInput.fill(password);

    // Fill confirm password field
    await confirmInput.waitFor({ state: 'visible', timeout: 5000 });
    await confirmInput.fill(password);

    // Wait a moment for validation
    await this.page.waitForTimeout(300);

    // Click the "Enable Encryption" button in this dialog
    // It's the mat-flat-button with a lock icon
    const confirmBtn = encryptionDialog.locator(
      'button[mat-flat-button]:has-text("Enable Encryption")',
    );
    await confirmBtn.waitFor({ state: 'visible', timeout: 5000 });
    await expect(confirmBtn).toBeEnabled({ timeout: 5000 });
    await confirmBtn.click();

    // Wait for encryption dialog to close
    // Use a unique element from the encryption dialog that won't exist after close
    await encryptionDialog.waitFor({ state: 'hidden', timeout: 60000 });

    // The settings dialog should auto-close after encryption is enabled
    // Wait a moment for the state to settle
    await this.page.waitForTimeout(500);

    // Close settings dialog if still open
    const isSettingsStillOpen = await settingsDialog
      .first()
      .isVisible()
      .catch(() => false);
    if (isSettingsStillOpen) {
      await this.page.keyboard.press('Escape');
      await settingsDialog
        .first()
        .waitFor({ state: 'hidden', timeout: 5000 })
        .catch(() => {});
    }
  }

  /**
   * Disables encryption for file-based providers.
   * Opens the sync settings dialog and clicks the "Disable Encryption" button.
   * Note: The Disable Encryption button is in the main view (encryption status box),
   * NOT in the Advanced Config section.
   */
  async disableEncryptionForFileBased(): Promise<void> {
    // Wait for any pending navigation to complete before opening the dialog.
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    await this.page
      .waitForURL(/#\/(tag|project)\/.+\/tasks/, { timeout: 10000 })
      .catch(() => {});

    // Open sync settings dialog using right-click
    // Use noWaitAfter to prevent blocking on Angular hash navigation
    await this.syncBtn.click({ button: 'right', noWaitAfter: true });
    const dialog = this.page.locator('mat-dialog-container, .mat-mdc-dialog-container');
    await dialog.waitFor({ state: 'visible', timeout: 5000 });

    // Wait for dialog content to render
    await this.page.waitForTimeout(500);

    // Click the Disable Encryption button (in the encryption status box, main view)
    await this.disableEncryptionBtn.scrollIntoViewIfNeeded();
    await this.disableEncryptionBtn.waitFor({ state: 'visible', timeout: 5000 });
    await this.disableEncryptionBtn.click();

    // Wait for confirmation dialog "Disable Encryption?" to appear
    const confirmDialog = this.page.locator('mat-dialog-container').filter({
      hasText: 'Disable Encryption?',
    });
    await confirmDialog.waitFor({ state: 'visible', timeout: 5000 });

    // Click the confirm button
    const confirmBtn = confirmDialog.locator('button[mat-flat-button]');
    await confirmBtn.waitFor({ state: 'visible', timeout: 5000 });
    await confirmBtn.click();

    // Wait for confirmation dialog to close — this is the reliable completion signal.
    // The operation uploads an unencrypted snapshot to WebDAV (network I/O),
    // updates IndexedDB, and clears caches before closing the dialog.
    // Use generous timeout for slow CI/network.
    await confirmDialog.waitFor({ state: 'hidden', timeout: 30000 });

    // Both dialogs auto-close (confirmation via dialogRef.close(), then
    // settings via closeAllDialogs()). Wait for all dialogs to be gone.
    await expect(this.page.locator('mat-dialog-container')).toHaveCount(0, {
      timeout: 10000,
    });

    // Dismiss success snackbar if visible (could block sync button)
    const snackBar = this.page.locator('.mat-mdc-snack-bar-container');
    if (await snackBar.isVisible({ timeout: 500 }).catch(() => false)) {
      const dismissBtn = snackBar.locator('button');
      if (await dismissBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        await dismissBtn.click().catch(() => {});
      }
      await snackBar.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    }
  }
}
