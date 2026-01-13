import { test, expect, type Page, type Download } from '@playwright/test';
import { ImportPage } from '../../pages/import.page';
import * as fs from 'fs';

/**
 * E2E Tests for Archive Data Import Persistence
 *
 * BUG: When importing a backup file containing archived tasks, the archive data
 * is not properly persisted to IndexedDB. After page reload, archived tasks are lost.
 *
 * Root Cause: ArchiveOperationHandler._handleLoadAllData() skips local imports
 * (isRemote=false), expecting archives to be "written by local backup import flow".
 * However, BackupService.importCompleteBackup() never wrote archive data to IndexedDB.
 *
 * Fix: BackupService.importCompleteBackup() now writes archive data to IndexedDB
 * after dispatching loadAllData.
 *
 * Run with: npm run e2e:file e2e/tests/import-export/archive-import-persistence.spec.ts
 */

/**
 * Helper to dismiss welcome tour dialog if present
 */
const dismissWelcomeDialog = async (page: Page): Promise<void> => {
  try {
    const closeBtn = page.locator('button:has-text("No thanks")').first();
    const isVisible = await closeBtn.isVisible().catch(() => false);
    if (isVisible) {
      await closeBtn.click();
      await page.waitForTimeout(500);
    }
  } catch {
    // Dialog not present, ignore
  }
};

/**
 * Helper to trigger and capture download
 */
const captureDownload = async (page: Page): Promise<Download> => {
  const downloadPromise = page.waitForEvent('download');
  const exportBtn = page.locator(
    'file-imex button:has(mat-icon:has-text("file_upload"))',
  );
  await exportBtn.click();
  return downloadPromise;
};

/**
 * Helper to read downloaded file content
 */
const readDownloadedFile = async (download: Download): Promise<string> => {
  const downloadPath = await download.path();
  if (!downloadPath) {
    throw new Error('Download path is null');
  }
  return fs.readFileSync(downloadPath, 'utf-8');
};

test.describe('@archive-import Archive Import Persistence', () => {
  test.beforeEach(async ({ page }) => {
    // Capture console logs for debugging
    page.on('console', (msg) => {
      const text = msg.text();
      if (
        text.includes('BackupService') ||
        text.includes('ArchiveDbAdapter') ||
        text.includes('archiveYoung') ||
        text.includes('archiveOld')
      ) {
        console.log(`[Browser] ${text}`);
      }
    });

    // Start with fresh state
    await page.goto('/#/tag/TODAY/tasks');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
  });

  /**
   * Test: Archive data should persist after import and page reload
   *
   * This test reproduces the bug where archived tasks were lost after reload:
   * 1. Import backup with archived tasks
   * 2. Verify archive data is present immediately after import
   * 3. Reload the page
   * 4. Export and verify archive data is still present
   *
   * Before the fix, step 4 would fail because archive data was never written to IndexedDB.
   */
  test('should persist archive data after import and page reload', async ({ page }) => {
    test.setTimeout(120000);

    const importPage = new ImportPage(page);

    // Step 1: Import backup with archived tasks
    console.log('[Archive Import Test] Step 1: Importing backup with archives...');
    await importPage.navigateToImportPage();
    const backupPath = ImportPage.getFixturePath('test-backup-with-archives.json');
    await importPage.importBackupFile(backupPath);
    await expect(page).toHaveURL(/.*tag.*TODAY.*tasks/);
    console.log('[Archive Import Test] Import completed');

    await dismissWelcomeDialog(page);

    // Step 2: Export immediately to verify archive is present
    console.log('[Archive Import Test] Step 2: Exporting immediately after import...');
    await page.waitForTimeout(2000); // Wait for IndexedDB writes
    await importPage.navigateToImportPage();
    const downloadBefore = await captureDownload(page);
    const exportedBefore = await readDownloadedFile(downloadBefore);
    const dataBefore = JSON.parse(exportedBefore);

    // Verify archives exist immediately after import
    console.log(
      '[Archive Import Test] Archive before reload - archiveYoung task IDs:',
      dataBefore.data.archiveYoung?.task?.ids || [],
    );
    expect(dataBefore.data.archiveYoung).toBeDefined();
    expect(dataBefore.data.archiveYoung.task.ids.length).toBeGreaterThan(0);

    // Step 3: Reload the page
    console.log('[Archive Import Test] Step 3: Reloading page...');
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await dismissWelcomeDialog(page);

    // Step 4: Export again and verify archive data persisted
    console.log('[Archive Import Test] Step 4: Exporting after reload...');
    await importPage.navigateToImportPage();
    const downloadAfter = await captureDownload(page);
    const exportedAfter = await readDownloadedFile(downloadAfter);
    const dataAfter = JSON.parse(exportedAfter);

    console.log(
      '[Archive Import Test] Archive after reload - archiveYoung task IDs:',
      dataAfter.data.archiveYoung?.task?.ids || [],
    );

    // BUG CHECK: Archives should persist after reload
    // Before the fix, this would fail because archives were not written to IndexedDB
    expect(dataAfter.data.archiveYoung).toBeDefined();
    expect(dataAfter.data.archiveYoung.task.ids).toContain('archived-young-task-1');
    expect(dataAfter.data.archiveYoung.task.ids).toContain('archived-young-task-2');

    // Verify entity data is preserved
    expect(
      dataAfter.data.archiveYoung.task.entities['archived-young-task-1'],
    ).toBeDefined();
    expect(
      dataAfter.data.archiveYoung.task.entities['archived-young-task-2'],
    ).toBeDefined();

    // Verify task properties
    const archivedTask1 =
      dataAfter.data.archiveYoung.task.entities['archived-young-task-1'];
    expect(archivedTask1.title).toBe('E2E Archive Import - Young Archived Task 1');
    expect(archivedTask1.isDone).toBe(true);

    console.log('[Archive Import Test] Archive data persisted correctly after reload!');
  });

  /**
   * Test: Archive timeTracking data should persist after import and reload
   */
  test('should persist archive timeTracking after import and reload', async ({
    page,
  }) => {
    test.setTimeout(120000);

    const importPage = new ImportPage(page);

    // Import backup with archives
    await importPage.navigateToImportPage();
    const backupPath = ImportPage.getFixturePath('test-backup-with-archives.json');
    await importPage.importBackupFile(backupPath);
    await expect(page).toHaveURL(/.*tag.*TODAY.*tasks/);
    await dismissWelcomeDialog(page);

    // Reload
    await page.waitForTimeout(2000);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await dismissWelcomeDialog(page);

    // Export and verify timeTracking
    await importPage.navigateToImportPage();
    const download = await captureDownload(page);
    const exported = await readDownloadedFile(download);
    const data = JSON.parse(exported);

    // Verify archiveYoung timeTracking has project data
    expect(data.data.archiveYoung.timeTracking).toBeDefined();
    expect(data.data.archiveYoung.timeTracking.project).toBeDefined();
    // The fixture has INBOX_PROJECT with time entries
    expect(data.data.archiveYoung.timeTracking.project['INBOX_PROJECT']).toBeDefined();

    console.log('[Archive Import Test] TimeTracking data persisted correctly!');
  });

  /**
   * Test: Both archiveYoung and archiveOld should persist after import
   *
   * Note: dataRepair only runs when validation fails. Since our fixture is valid,
   * archiveYoung and archiveOld remain separate and should both persist.
   */
  test('should persist both archive types after import', async ({ page }) => {
    test.setTimeout(120000);

    const importPage = new ImportPage(page);

    // Import backup with both archiveYoung and archiveOld
    await importPage.navigateToImportPage();
    const backupPath = ImportPage.getFixturePath('test-backup-with-archives.json');
    await importPage.importBackupFile(backupPath);
    await expect(page).toHaveURL(/.*tag.*TODAY.*tasks/);
    await dismissWelcomeDialog(page);

    // Reload
    await page.waitForTimeout(2000);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await dismissWelcomeDialog(page);

    // Export and verify
    await importPage.navigateToImportPage();
    const download = await captureDownload(page);
    const exported = await readDownloadedFile(download);
    const data = JSON.parse(exported);

    // Both archives should be present
    expect(data.data.archiveYoung).toBeDefined();
    expect(data.data.archiveOld).toBeDefined();

    // Verify archiveYoung has its tasks
    const youngTaskIds = data.data.archiveYoung.task.ids;
    console.log('[Archive Import Test] archiveYoung task IDs:', youngTaskIds);
    expect(youngTaskIds).toContain('archived-young-task-1');
    expect(youngTaskIds).toContain('archived-young-task-2');

    // Verify archiveOld has its tasks
    const oldTaskIds = data.data.archiveOld.task.ids;
    console.log('[Archive Import Test] archiveOld task IDs:', oldTaskIds);
    expect(oldTaskIds).toContain('archived-old-task-1');

    // Verify entity data is preserved in archiveOld
    expect(data.data.archiveOld.task.entities['archived-old-task-1']).toBeDefined();
    expect(data.data.archiveOld.task.entities['archived-old-task-1'].title).toBe(
      'E2E Archive Import - Old Archived Task',
    );

    console.log('[Archive Import Test] Both archive types persisted correctly!');
  });
});
