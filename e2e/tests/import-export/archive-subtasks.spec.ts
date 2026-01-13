import { test, expect, type Page, type Download } from '@playwright/test';
import { ImportPage } from '../../pages/import.page';
import * as fs from 'fs';

/**
 * E2E Tests for Legacy Data Import/Export with Archive Subtasks
 *
 * BUG: When importing data from before operation logs (legacy data) that contains
 * tasks with subtasks, then archiving via "Finish Day", the subtasks are lost
 * when exporting again.
 *
 * Test Flow:
 * 1. Import legacy backup containing active parent task + subtasks + normal task
 * 2. Mark all tasks as done
 * 3. Click "Finish Day" to archive tasks
 * 4. Export the data
 * 5. Verify exported data contains all archived tasks including subtasks
 *
 * Run with: npm run e2e:file e2e/tests/import-export/legacy-archive-subtasks.spec.ts
 */

// Selectors
const TASK_SEL = 'task';
const TASK_DONE_BTN = '.task-done-btn';
const FINISH_DAY_BTN = '.e2e-finish-day';
const SAVE_AND_GO_HOME_BTN = 'button[mat-flat-button][color="primary"]:last-of-type';

/**
 * Helper to dismiss welcome tour dialog if present
 */
const dismissWelcomeDialog = async (page: Page): Promise<void> => {
  try {
    // Try multiple selectors for the close button
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

  // Click the export button (file_upload icon in file-imex)
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

/**
 * Helper to mark all visible tasks as done
 * Uses hover → wait for done button → click pattern from task-crud tests
 */
const markAllTasksDone = async (page: Page): Promise<void> => {
  // Wait for tasks to be visible
  await page.waitForSelector(TASK_SEL, { state: 'visible', timeout: 10000 });

  let attempts = 0;
  const maxAttempts = 6;

  while (attempts < maxAttempts) {
    // Check for and dismiss welcome dialog if it appeared
    await dismissWelcomeDialog(page);

    const undoneLocator = page.locator('task:not(.isDone)');
    const undoneCount = await undoneLocator.count();
    console.log(
      `[markAllTasksDone] Attempt ${attempts + 1}: ${undoneCount} undone tasks`,
    );

    if (undoneCount === 0) break;

    // Get the first undone task using Playwright locator
    const firstUndone = undoneLocator.first();
    // Must hover over .first-line to trigger hover controls
    // Use .first() because parent tasks contain nested subtask .first-lines
    const firstLine = firstUndone.locator('.first-line').first();
    await firstLine.hover();

    // Wait for the done button to become visible after hover
    // Use .first() for same reason - parent has nested subtask done buttons
    const doneBtn = firstUndone.locator(TASK_DONE_BTN).first();
    await doneBtn.waitFor({ state: 'visible', timeout: 2000 });

    // Click the done button
    await doneBtn.click();
    await page.waitForTimeout(500);

    attempts++;
  }

  const finalCount = await page.locator('task:not(.isDone)').count();
  console.log(`[markAllTasksDone] Finished: ${finalCount} undone tasks remain`);
};

/**
 * Helper to complete finish day flow
 */
const finishDay = async (page: Page): Promise<void> => {
  // Click Finish Day button
  await page.waitForSelector(FINISH_DAY_BTN, { state: 'visible', timeout: 10000 });
  await page.click(FINISH_DAY_BTN);

  // Wait for daily summary page
  await page.waitForSelector('daily-summary', { state: 'visible', timeout: 10000 });

  // Click Save and go home
  await page.waitForSelector(SAVE_AND_GO_HOME_BTN, { state: 'visible', timeout: 10000 });
  await page.click(SAVE_AND_GO_HOME_BTN);

  // Wait for navigation back to work view
  await page.waitForSelector('task-list', { state: 'visible', timeout: 10000 });
  await page.waitForTimeout(1000);
};

test.describe('@legacy-archive Legacy Archive Subtasks via Finish Day', () => {
  test.beforeEach(async ({ page }) => {
    // Capture console logs from the browser
    page.on('console', (msg) => {
      const text = msg.text();
      if (
        text.includes('[DailySummary]') ||
        text.includes('[ArchiveService]') ||
        text.includes('[PfapiStoreDelegateService]')
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
   * Test: Import legacy data, finish day, and verify subtasks are archived
   *
   * BUG: This test documents the bug where subtasks are lost after finish day.
   * Expected: All 4 tasks (parent, 2 subtasks, normal) should be in archiveYoung
   * Actual (bug): Only parent and normal tasks are in archiveYoung, subtasks missing
   */
  test('should preserve subtasks in archive after finish day', async ({ page }) => {
    test.setTimeout(120000); // Long test with multiple steps

    const importPage = new ImportPage(page);

    // Step 1: Import legacy backup with active tasks
    console.log('[Legacy Archive Test] Step 1: Importing legacy backup...');
    await importPage.navigateToImportPage();
    const backupPath = ImportPage.getFixturePath('legacy-archive-subtasks-backup.json');
    await importPage.importBackupFile(backupPath);
    await expect(page).toHaveURL(/.*tag.*TODAY.*tasks/);
    console.log('[Legacy Archive Test] Import completed');

    // Dismiss welcome dialog if present
    await dismissWelcomeDialog(page);

    // Step 2: Navigate to INBOX project to see tasks
    // Note: We navigate to INBOX project because the backup has dueDay in the past,
    // and TODAY tag only shows tasks with dueDay === today (virtual tag pattern)
    console.log('[Legacy Archive Test] Step 2: Navigating to INBOX project...');
    await page.goto('/#/project/INBOX_PROJECT/tasks');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeDialog(page);
    await page.waitForTimeout(1000);

    // Verify tasks are visible (parent tasks - subtasks are nested)
    await page.waitForSelector(TASK_SEL, { state: 'visible', timeout: 10000 });
    const taskCount = await page.locator(TASK_SEL).count();
    console.log(
      `[Legacy Archive Test] Found ${taskCount} tasks (including subtasks when expanded)`,
    );

    // Step 3: Mark all tasks as done (parent tasks first, subtasks auto-done by parent)
    console.log('[Legacy Archive Test] Step 3: Marking all tasks as done...');
    await markAllTasksDone(page);
    console.log('[Legacy Archive Test] All tasks marked as done');

    // Step 4: Navigate to TODAY tag to access Finish Day button
    // Note: Finish Day button is only visible on TODAY tag view when not in planning mode
    console.log('[Legacy Archive Test] Step 4: Navigating to TODAY for Finish Day...');
    await page.goto('/#/tag/TODAY/tasks');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Exit planning mode if we're in it (planning mode hides the Finish Day button)
    const readyToWorkBtn = page.locator('button:has-text("Ready to work!")');
    if (await readyToWorkBtn.isVisible().catch(() => false)) {
      console.log('[Legacy Archive Test] Exiting planning mode...');
      await readyToWorkBtn.click();
      await page.waitForTimeout(500);
    }

    // Step 5: Finish day to archive tasks
    console.log('[Legacy Archive Test] Step 5: Finishing day...');
    await finishDay(page);
    console.log('[Legacy Archive Test] Finish day completed');

    // Step 6: Export and verify
    console.log('[Legacy Archive Test] Step 6: Exporting data...');
    // Wait for IndexedDB writes to complete before navigation
    await page.waitForTimeout(2000);
    await importPage.navigateToImportPage();
    const download = await captureDownload(page);
    const exportedContent = await readDownloadedFile(download);
    const exportedData = JSON.parse(exportedContent);

    // Step 7: Verify archived tasks
    console.log('[Legacy Archive Test] Step 7: Verifying exported data...');
    expect(exportedData).toHaveProperty('data');
    expect(exportedData.data).toHaveProperty('archiveYoung');

    const archiveYoungTask = exportedData.data.archiveYoung.task;
    console.log(
      '[Legacy Archive Test] Exported archiveYoung task IDs:',
      archiveYoungTask.ids,
    );
    console.log(
      '[Legacy Archive Test] Exported archiveYoung entity keys:',
      Object.keys(archiveYoungTask.entities),
    );

    // BUG CHECK: All 4 tasks should be in the archive
    // This is where the bug manifests - subtasks are missing
    expect(archiveYoungTask.ids).toContain('parent-task-1');
    expect(archiveYoungTask.ids).toContain('subtask-1');
    expect(archiveYoungTask.ids).toContain('subtask-2');
    expect(archiveYoungTask.ids).toContain('normal-task-1');

    // Verify entities are present
    expect(archiveYoungTask.entities['parent-task-1']).toBeDefined();
    expect(archiveYoungTask.entities['subtask-1']).toBeDefined();
    expect(archiveYoungTask.entities['subtask-2']).toBeDefined();
    expect(archiveYoungTask.entities['normal-task-1']).toBeDefined();

    // Verify parent-subtask relationships
    const parentTask = archiveYoungTask.entities['parent-task-1'];
    expect(parentTask.subTaskIds).toContain('subtask-1');
    expect(parentTask.subTaskIds).toContain('subtask-2');

    const subtask1 = archiveYoungTask.entities['subtask-1'];
    expect(subtask1.parentId).toBe('parent-task-1');

    const subtask2 = archiveYoungTask.entities['subtask-2'];
    expect(subtask2.parentId).toBe('parent-task-1');

    console.log('[Legacy Archive Test] All subtasks preserved in archive!');
  });

  /**
   * Test: Verify exact count of archived tasks after finish day
   */
  test('should have exactly 4 archived tasks after finish day', async ({ page }) => {
    test.setTimeout(120000);

    const importPage = new ImportPage(page);

    // Import legacy backup
    await importPage.navigateToImportPage();
    const backupPath = ImportPage.getFixturePath('legacy-archive-subtasks-backup.json');
    await importPage.importBackupFile(backupPath);
    await expect(page).toHaveURL(/.*tag.*TODAY.*tasks/);
    await dismissWelcomeDialog(page);

    // Navigate to INBOX project and mark all done
    // Note: We navigate to INBOX project because the backup has dueDay in the past
    await page.goto('/#/project/INBOX_PROJECT/tasks');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeDialog(page);
    await page.waitForTimeout(1000);
    await markAllTasksDone(page);

    // Navigate to TODAY tag to access Finish Day button
    await page.goto('/#/tag/TODAY/tasks');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Exit planning mode if we're in it (planning mode hides the Finish Day button)
    const readyToWorkBtn = page.locator('button:has-text("Ready to work!")');
    if (await readyToWorkBtn.isVisible().catch(() => false)) {
      await readyToWorkBtn.click();
      await page.waitForTimeout(500);
    }

    // Finish day
    await finishDay(page);

    // Export - wait for IndexedDB writes
    await page.waitForTimeout(2000);
    await importPage.navigateToImportPage();
    const download = await captureDownload(page);
    const exportedContent = await readDownloadedFile(download);
    const exportedData = JSON.parse(exportedContent);

    // Count archived tasks
    const archiveYoungTaskIds = exportedData.data.archiveYoung.task.ids;
    const archiveYoungEntityCount = Object.keys(
      exportedData.data.archiveYoung.task.entities,
    ).length;

    console.log('[Legacy Archive Test] Archive task counts:', {
      idsCount: archiveYoungTaskIds.length,
      entitiesCount: archiveYoungEntityCount,
      expectedCount: 4,
    });

    // BUG CHECK: Should have 4 tasks (parent, 2 subtasks, normal)
    expect(archiveYoungTaskIds.length).toBe(4);
    expect(archiveYoungEntityCount).toBe(4);
  });

  /**
   * Test: Verify subtask entity data integrity after archive
   */
  test('should preserve subtask entity data after finish day', async ({ page }) => {
    test.setTimeout(120000);

    const importPage = new ImportPage(page);

    // Import, mark done, finish day
    await importPage.navigateToImportPage();
    const backupPath = ImportPage.getFixturePath('legacy-archive-subtasks-backup.json');
    await importPage.importBackupFile(backupPath);
    await expect(page).toHaveURL(/.*tag.*TODAY.*tasks/);
    await dismissWelcomeDialog(page);

    // Navigate to INBOX project because backup has dueDay in the past
    await page.goto('/#/project/INBOX_PROJECT/tasks');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeDialog(page);
    await page.waitForTimeout(1000);
    await markAllTasksDone(page);

    // Navigate to TODAY tag to access Finish Day button
    await page.goto('/#/tag/TODAY/tasks');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Exit planning mode if we're in it (planning mode hides the Finish Day button)
    const readyToWorkBtn = page.locator('button:has-text("Ready to work!")');
    if (await readyToWorkBtn.isVisible().catch(() => false)) {
      await readyToWorkBtn.click();
      await page.waitForTimeout(500);
    }
    await finishDay(page);

    // Export - wait for IndexedDB writes
    await page.waitForTimeout(2000);
    await importPage.navigateToImportPage();
    const download = await captureDownload(page);
    const exportedContent = await readDownloadedFile(download);
    const exportedData = JSON.parse(exportedContent);

    // Get subtask entities
    const subtask1 = exportedData.data.archiveYoung.task.entities['subtask-1'];
    const subtask2 = exportedData.data.archiveYoung.task.entities['subtask-2'];

    // BUG CHECK: Subtasks should exist and have correct data
    expect(subtask1).toBeDefined();
    expect(subtask1.id).toBe('subtask-1');
    expect(subtask1.title).toBe('Legacy Test - First Subtask');
    expect(subtask1.parentId).toBe('parent-task-1');
    expect(subtask1.isDone).toBe(true);

    expect(subtask2).toBeDefined();
    expect(subtask2.id).toBe('subtask-2');
    expect(subtask2.title).toBe('Legacy Test - Second Subtask');
    expect(subtask2.parentId).toBe('parent-task-1');
    expect(subtask2.isDone).toBe(true);

    console.log('[Legacy Archive Test] Subtask entity data preserved correctly!');
  });
});
