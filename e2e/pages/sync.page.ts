import { type Page, type Locator } from '@playwright/test';
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
  }

  async setupWebdavSync(config: {
    baseUrl: string;
    username: string;
    password: string;
    syncFolderPath: string;
  }): Promise<void> {
    // Dismiss any visible snackbars/toasts that might block clicks
    const snackBar = this.page.locator('.mat-mdc-snack-bar-container');
    if (await snackBar.isVisible({ timeout: 500 }).catch(() => false)) {
      const dismissBtn = snackBar.locator('button');
      if (await dismissBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        await dismissBtn.click().catch(() => {});
      }
      await this.page.waitForTimeout(500);
    }

    // Ensure sync button is visible and clickable
    await this.syncBtn.waitFor({ state: 'visible', timeout: 10000 });

    // Click sync button to open settings dialog - use force click if needed
    await this.syncBtn.click({ timeout: 5000 });

    // Wait for dialog to appear
    const dialog = this.page.locator('mat-dialog-container, .mat-mdc-dialog-container');
    const dialogVisible = await dialog
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);

    // If dialog didn't open, try clicking again
    if (!dialogVisible) {
      await this.page.waitForTimeout(500);
      await this.syncBtn.click({ force: true });
      await dialog.waitFor({ state: 'visible', timeout: 5000 });
    }

    // Wait for dialog to be fully loaded
    await this.page.waitForLoadState('networkidle');
    await this.providerSelect.waitFor({ state: 'visible', timeout: 10000 });

    // Wait a moment for Angular animations
    await this.page.waitForTimeout(500);

    // Click on provider select to open dropdown with retry
    const webdavOption = this.page.locator('mat-option').filter({ hasText: 'WebDAV' });

    // Use the existing providerSelect locator which targets the mat-select directly
    const selectElement = this.providerSelect;

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
        // First attempt: regular click
        await selectElement.click().catch(() => {});
      } else if (attempt === 1) {
        // Second attempt: use Space key to open
        await this.page.keyboard.press('Space');
      } else if (attempt === 2) {
        // Third attempt: use ArrowDown to open
        await this.page.keyboard.press('ArrowDown');
      } else {
        // Later attempts: force click
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
        // Now wait for WebDAV option specifically
        const webdavVisible = await webdavOption
          .waitFor({ state: 'visible', timeout: 3000 })
          .then(() => true)
          .catch(() => false);

        if (webdavVisible) {
          await webdavOption.click();
          // Wait for dropdown to close and form to update
          await this.page.waitForTimeout(500);
          break;
        }
      }

      // Close dropdown if it opened but option not found, then retry
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(500);
    }

    // Wait for form fields to be visible before filling
    await this.baseUrlInput.waitFor({ state: 'visible', timeout: 10000 });

    // Fill in the configuration
    await this.baseUrlInput.fill(config.baseUrl);
    await this.userNameInput.fill(config.username);
    await this.passwordInput.fill(config.password);
    await this.syncFolderInput.fill(config.syncFolderPath);

    // Save the configuration
    await this.saveBtn.click();

    // Wait for dialog to close
    await this.page.waitForTimeout(500);
  }

  async triggerSync(): Promise<void> {
    await this.syncBtn.click();
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
}
