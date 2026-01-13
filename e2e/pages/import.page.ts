import { type Page, type Locator } from '@playwright/test';
import { BasePage } from './base.page';
import * as path from 'path';

/**
 * Page object for file import operations.
 * Handles navigation to import settings and file import functionality.
 */
export class ImportPage extends BasePage {
  /** Import from file button */
  readonly importFromFileBtn: Locator;
  /** Hidden file input element */
  readonly fileInput: Locator;
  /** Import from URL button */
  readonly importFromUrlBtn: Locator;
  /** Export backup button */
  readonly exportBackupBtn: Locator;

  constructor(page: Page) {
    super(page);
    // The import button contains text "Import from file" and has file_download icon
    this.importFromFileBtn = page.locator(
      'file-imex button:has(mat-icon:has-text("file_download"))',
    );
    this.fileInput = page.locator('file-imex input[type="file"]');
    this.importFromUrlBtn = page.locator(
      'file-imex button:has(mat-icon:has-text("cloud_download"))',
    );
    this.exportBackupBtn = page.locator(
      'file-imex button:has(mat-icon:has-text("file_upload"))',
    );
  }

  /**
   * Navigate to the import/export settings page.
   */
  async navigateToImportPage(): Promise<void> {
    await this.page.goto('/#/config');
    await this.page.waitForLoadState('networkidle');
    // Wait for page content to fully render
    await this.page.waitForTimeout(1000);

    // The file-imex component is inside the collapsible "Import/Export" section
    // First, find and expand the Import/Export section
    const importExportSection = this.page.locator(
      'collapsible:has-text("Import/Export")',
    );
    await importExportSection.scrollIntoViewIfNeeded();
    await this.page.waitForTimeout(300);

    // Click on the collapsible header to expand it
    const collapsibleHeader = importExportSection.locator('.collapsible-header, .header');
    await collapsibleHeader.click();
    await this.page.waitForTimeout(500);

    // Now the file-imex component should be visible
    await this.importFromFileBtn.waitFor({ state: 'visible', timeout: 10000 });
  }

  /**
   * Import a backup file using the file input.
   * This triggers the native file dialog via Playwright's setInputFiles.
   *
   * @param filePath - Absolute path to the backup JSON file
   */
  async importBackupFile(filePath: string): Promise<void> {
    // Set the file on the hidden input element
    await this.fileInput.setInputFiles(filePath);

    // Dispatch change event to ensure Angular detects the file change
    // Use evaluate to dispatch directly as the input might be hidden/detached from view
    try {
      // Check if element is still attached before dispatching event
      // If setInputFiles triggered the import immediately, the element might be gone
      // We use elementHandle with a short timeout to avoid waiting 15s if it's gone
      const handle = await this.fileInput.elementHandle({ timeout: 1000 });
      if (handle) {
        await handle.evaluate((node) => {
          node.dispatchEvent(new Event('change', { bubbles: true }));
        });
      }
    } catch (e) {
      // Ignore timeout errors as they indicate the element was removed (import started)
      const msg = (e as Error).message;
      if (!msg.includes('Timeout')) {
        console.log(
          'Dispatch event failed (maybe import already started/element removed):',
          msg,
        );
      }
    }

    // Wait for import to be processed
    // The app navigates to TODAY tag after successful import via Angular router
    // Poll for URL change since Angular uses hash-based routing
    const startTime = Date.now();
    const timeout = 30000;
    while (Date.now() - startTime < timeout) {
      const url = this.page.url();
      if (url.includes('tag') && url.includes('TODAY')) {
        break;
      }
      await this.page.waitForTimeout(500);
    }

    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(1000);
  }

  /**
   * Get the path to a test fixture file.
   *
   * @param filename - Name of the fixture file in e2e/fixtures/
   * @returns Absolute path to the fixture file
   */
  static getFixturePath(filename: string): string {
    return path.resolve(__dirname, '..', 'fixtures', filename);
  }
}
