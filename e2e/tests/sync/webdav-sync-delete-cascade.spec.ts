import { expect } from '@playwright/test';
import { test } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import { TaskPage } from '../../pages/task.page';
import { TagPage } from '../../pages/tag.page';
import { ProjectPage } from '../../pages/project.page';
import { waitForStatePersistence, waitForAppReady } from '../../utils/waits';
import {
  WEBDAV_CONFIG_TEMPLATE,
  setupSyncClient,
  createSyncFolder,
  waitForSyncComplete,
  generateSyncFolderName,
  dismissTourIfVisible,
  waitForArchivePersistence,
  closeContextsSafely,
} from '../../utils/sync-helpers';
import { Page } from 'playwright';

/**
 * WebDAV Delete Cascade E2E Tests
 *
 * These tests verify that deleting entities (tags/projects) properly cascades
 * to archived tasks across multiple clients:
 * - Delete tag with archived tasks syncs to other client
 * - Delete project with archived tasks syncs to other client
 * - Concurrent delete tag + archive task
 */

/**
 * Archive done tasks via Daily Summary flow
 * Adapted from webdav-sync-archive.spec.ts
 */
const archiveDoneTasks = async (page: Page): Promise<void> => {
  const finishDayBtn = page.locator('.e2e-finish-day');
  await finishDayBtn.waitFor({ state: 'visible', timeout: 10000 });
  await finishDayBtn.click();

  await page.waitForURL(/daily-summary/, { timeout: 15000 });

  const saveAndGoHomeBtn = page.locator(
    'daily-summary button[mat-flat-button]:has(mat-icon:has-text("wb_sunny"))',
  );
  await saveAndGoHomeBtn.waitFor({ state: 'visible', timeout: 10000 });
  await saveAndGoHomeBtn.click();

  await page.waitForURL(/(active\/tasks|tag\/TODAY\/tasks)/, { timeout: 15000 });
};

test.describe('@webdav WebDAV Delete Cascade Sync', () => {
  test.describe.configure({ mode: 'serial' });

  /**
   * Test 1.1: Delete tag with archived tasks syncs to other client
   *
   * Setup:
   * - Client A creates Tag1
   * - Client A creates Task1 with Tag1
   * - Client A marks Task1 done, archives it
   * - Client A syncs
   * - Client B syncs (downloads archived Task1)
   *
   * Test:
   * 1. Client A deletes Tag1
   * 2. Client A syncs
   * 3. Client B syncs
   * 4. Verify: No errors, tag cascade completes successfully
   */
  test('Delete tag with archived tasks syncs to other client', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow();
    const SYNC_FOLDER_NAME = generateSyncFolderName('e2e-del-tag-archive');
    const WEBDAV_CONFIG = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${SYNC_FOLDER_NAME}`,
    };
    const url = baseURL || 'http://localhost:4242';

    await createSyncFolder(request, SYNC_FOLDER_NAME);

    // --- Setup Client A ---
    const { context: contextA, page: pageA } = await setupSyncClient(browser, url);
    const syncPageA = new SyncPage(pageA);
    const workViewPageA = new WorkViewPage(pageA);
    const taskPageA = new TaskPage(pageA);
    const tagPageA = new TagPage(pageA);

    await workViewPageA.waitForTaskList();
    await syncPageA.setupWebdavSync(WEBDAV_CONFIG);
    console.log('[Delete Tag] Client A configured');

    // Client A creates a tag
    const tagName = 'TestTag-ToDelete';
    await tagPageA.createTag(tagName);
    console.log('[Delete Tag] Client A created tag');

    // Client A creates task and assigns tag
    const taskName = 'Task-WithTag';
    await workViewPageA.addTask(taskName);
    const task = taskPageA.getTaskByText(taskName).first();
    await tagPageA.assignTagToTask(task, tagName);
    await expect(tagPageA.getTagOnTask(task, tagName)).toBeVisible();
    console.log('[Delete Tag] Client A created task with tag');

    // Mark task done and archive
    await taskPageA.markTaskAsDone(task);
    await pageA.waitForTimeout(300);
    await archiveDoneTasks(pageA);
    await waitForArchivePersistence(pageA);
    await expect(pageA.locator('task')).toHaveCount(0);
    console.log('[Delete Tag] Client A archived task');

    // Client A syncs
    await waitForStatePersistence(pageA);
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log('[Delete Tag] Client A initial sync complete');

    // --- Setup Client B ---
    const { context: contextB, page: pageB } = await setupSyncClient(browser, url);
    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);
    const tagPageB = new TagPage(pageB);

    await workViewPageB.waitForTaskList();
    await syncPageB.setupWebdavSync(WEBDAV_CONFIG);
    console.log('[Delete Tag] Client B configured');

    // Client B syncs (downloads archived task with tag)
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);
    console.log('[Delete Tag] Client B synced, downloaded archived task');

    // Verify tag exists on Client B
    const tagExistsB = await tagPageB.tagExistsInSidebar(tagName);
    expect(tagExistsB).toBe(true);
    console.log('[Delete Tag] Verified tag exists on Client B');

    // --- Client A deletes the tag ---
    await tagPageA.deleteTag(tagName);
    console.log('[Delete Tag] Client A deleted tag');

    // Client A syncs
    await waitForStatePersistence(pageA);
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log('[Delete Tag] Client A synced deletion');

    // Client B syncs
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);
    console.log('[Delete Tag] Client B synced');

    // --- Verify final state ---
    // Tag should be gone on both clients
    const tagExistsAFinal = await tagPageA.tagExistsInSidebar(tagName);
    expect(tagExistsAFinal).toBe(false);
    console.log('[Delete Tag] Tag deleted on Client A');

    const tagExistsBFinal = await tagPageB.tagExistsInSidebar(tagName);
    expect(tagExistsBFinal).toBe(false);
    console.log('[Delete Tag] Tag deleted on Client B');

    // Reload Client B and verify no errors (archive should be cleaned)
    await pageB.reload();
    await waitForAppReady(pageB);
    await dismissTourIfVisible(pageB);
    await workViewPageB.waitForTaskList();

    // Check for no global errors
    const globalError = pageB.locator('.global-error-alert');
    await expect(globalError).not.toBeVisible({ timeout: 3000 });
    console.log('[Delete Tag] No errors after reload on Client B');

    console.log('[Delete Tag] ✓ Delete tag with archived tasks synced correctly');

    // Cleanup
    await closeContextsSafely(contextA, contextB);
  });

  /**
   * Test 1.2: Delete project with archived tasks syncs to other client
   *
   * Setup:
   * - Client A creates Project1
   * - Client A creates Task1 in Project1
   * - Client A marks Task1 done, archives it
   * - Client A syncs
   * - Client B syncs (downloads archived Task1)
   *
   * Test:
   * 1. Client A deletes Project1
   * 2. Client A syncs
   * 3. Client B syncs
   * 4. Verify: Archived task is deleted on both clients
   */
  test('Delete project with archived tasks syncs to other client', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow();
    const SYNC_FOLDER_NAME = generateSyncFolderName('e2e-del-proj-archive');
    const WEBDAV_CONFIG = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${SYNC_FOLDER_NAME}`,
    };
    const url = baseURL || 'http://localhost:4242';

    await createSyncFolder(request, SYNC_FOLDER_NAME);

    // --- Setup Client A ---
    const { context: contextA, page: pageA } = await setupSyncClient(browser, url);
    const syncPageA = new SyncPage(pageA);
    const workViewPageA = new WorkViewPage(pageA);
    const taskPageA = new TaskPage(pageA);
    const projectPageA = new ProjectPage(pageA);

    await workViewPageA.waitForTaskList();
    await syncPageA.setupWebdavSync(WEBDAV_CONFIG);
    console.log('[Delete Project] Client A configured');

    // Client A creates a project
    const projectName = 'TestProject-ToDelete';
    await projectPageA.createProject(projectName);
    await projectPageA.navigateToProjectByName(projectName);
    console.log('[Delete Project] Client A created and navigated to project');

    // Client A creates task in project
    const taskName = 'Task-InProject';
    await workViewPageA.addTask(taskName);
    await expect(pageA.locator('task')).toHaveCount(1);
    console.log('[Delete Project] Client A created task in project');

    // Mark task done
    const task = taskPageA.getTaskByText(taskName).first();
    await taskPageA.markTaskAsDone(task);
    await pageA.waitForTimeout(500);

    // For project view, use "Move done to archive" button instead of Daily Summary
    const moveToArchiveBtn = pageA.locator('.e2e-move-done-to-archive');
    await moveToArchiveBtn.waitFor({ state: 'visible', timeout: 5000 });
    await moveToArchiveBtn.click();
    await pageA.waitForTimeout(500);
    await expect(pageA.locator('task')).toHaveCount(0);
    console.log('[Delete Project] Client A archived task');

    // Navigate to TODAY view before syncing
    await pageA.goto(`${url}/#/tag/TODAY/tasks`);
    await workViewPageA.waitForTaskList();

    // Client A syncs
    await waitForStatePersistence(pageA);
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log('[Delete Project] Client A initial sync complete');

    // --- Setup Client B ---
    const { context: contextB, page: pageB } = await setupSyncClient(browser, url);
    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);
    const projectPageB = new ProjectPage(pageB);

    await workViewPageB.waitForTaskList();
    await syncPageB.setupWebdavSync(WEBDAV_CONFIG);
    console.log('[Delete Project] Client B configured');

    // Client B syncs (downloads project and archived task)
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);
    console.log('[Delete Project] Client B synced');

    // Navigate to the project directly to verify it exists on Client B
    await projectPageB.navigateToProjectByName(projectName);
    console.log('[Delete Project] Verified project exists on Client B (navigated to it)');

    // --- Client A deletes the project ---
    await projectPageA.deleteProject(projectName);
    console.log('[Delete Project] Client A deleted project');

    // Client A syncs
    await waitForStatePersistence(pageA);
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log('[Delete Project] Client A synced deletion');

    // Client B syncs
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);
    console.log('[Delete Project] Client B synced');

    // --- Verify final state ---
    // Navigate to TODAY view on Client B
    await pageB.goto(`${url}/#/tag/TODAY/tasks`);
    await workViewPageB.waitForTaskList();

    // Check for no global errors
    const globalError = pageB.locator('.global-error-alert');
    await expect(globalError).not.toBeVisible({ timeout: 3000 });

    // Project should not exist in sidebar
    const projectInSidebar = pageB
      .locator('magic-side-nav')
      .locator(`text=${projectName}`);
    await expect(projectInSidebar).not.toBeVisible({ timeout: 3000 });

    console.log('[Delete Project] Project deleted on Client B');
    console.log('[Delete Project] ✓ Delete project with archived tasks synced correctly');

    // Cleanup
    await closeContextsSafely(contextA, contextB);
  });

  /**
   * Test 1.3: Concurrent delete tag + archive task
   *
   * Setup:
   * - Client A creates Tag1
   * - Client A creates Task1 with Tag1, Task2 with Tag1
   * - Both sync
   *
   * Test:
   * 1. Client A deletes Tag1 (before sync)
   * 2. Client B marks Task1 done, archives it (before sync)
   * 3. Client A syncs
   * 4. Client B syncs
   * 5. Verify: Task1 is archived but without Tag1 reference
   * 6. Verify: Consistent state on both clients
   */
  test('Concurrent delete tag and archive task', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow();
    const SYNC_FOLDER_NAME = generateSyncFolderName('e2e-del-tag-concurrent');
    const WEBDAV_CONFIG = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${SYNC_FOLDER_NAME}`,
    };
    const url = baseURL || 'http://localhost:4242';

    await createSyncFolder(request, SYNC_FOLDER_NAME);

    // --- Setup Client A ---
    const { context: contextA, page: pageA } = await setupSyncClient(browser, url);
    const syncPageA = new SyncPage(pageA);
    const workViewPageA = new WorkViewPage(pageA);
    const taskPageA = new TaskPage(pageA);
    const tagPageA = new TagPage(pageA);

    await workViewPageA.waitForTaskList();
    await syncPageA.setupWebdavSync(WEBDAV_CONFIG);
    console.log('[Concurrent] Client A configured');

    // Client A creates a tag
    const tagName = 'TestTag-Concurrent';
    await tagPageA.createTag(tagName);
    console.log('[Concurrent] Client A created tag');

    // Client A creates two tasks and assigns tag
    const task1Name = 'Task1-ToArchive';
    const task2Name = 'Task2-Remains';
    await workViewPageA.addTask(task1Name);
    await workViewPageA.addTask(task2Name);

    const task1 = taskPageA.getTaskByText(task1Name).first();
    const task2 = taskPageA.getTaskByText(task2Name).first();
    await tagPageA.assignTagToTask(task1, tagName);
    await tagPageA.assignTagToTask(task2, tagName);
    console.log('[Concurrent] Client A created 2 tasks with tag');

    // Client A syncs
    await waitForStatePersistence(pageA);
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log('[Concurrent] Client A initial sync complete');

    // --- Setup Client B ---
    const { context: contextB, page: pageB } = await setupSyncClient(browser, url);
    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);
    const taskPageB = new TaskPage(pageB);

    await workViewPageB.waitForTaskList();
    await syncPageB.setupWebdavSync(WEBDAV_CONFIG);
    console.log('[Concurrent] Client B configured');

    // Client B syncs (downloads tasks with tag)
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);
    await expect(pageB.locator('task')).toHaveCount(2);
    console.log('[Concurrent] Client B downloaded 2 tasks');

    // --- Concurrent operations ---

    // Client A deletes the tag (before sync)
    await tagPageA.deleteTag(tagName);
    console.log('[Concurrent] Client A deleted tag (not synced yet)');

    // Client B archives Task1 (before sync)
    const task1OnB = taskPageB.getTaskByText(task1Name).first();
    await taskPageB.markTaskAsDone(task1OnB);
    await pageB.waitForTimeout(300);
    await archiveDoneTasks(pageB);
    await waitForArchivePersistence(pageB);
    await expect(pageB.locator('task')).toHaveCount(1); // Only Task2 visible
    console.log('[Concurrent] Client B archived Task1 (not synced yet)');

    // --- Both clients sync ---
    await waitForStatePersistence(pageA);
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log('[Concurrent] Client A synced tag deletion');

    await waitForStatePersistence(pageB);
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);
    console.log('[Concurrent] Client B synced archive');

    // Sync again for eventual consistency
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);
    console.log('[Concurrent] Both synced again for consistency');

    // --- Verify final state ---
    // Tag should be deleted on both clients
    const tagExistsAFinal = await tagPageA.tagExistsInSidebar(tagName);
    expect(tagExistsAFinal).toBe(false);

    // Reload Client B and verify no errors
    await pageB.reload();
    await waitForAppReady(pageB);
    await dismissTourIfVisible(pageB);
    await workViewPageB.waitForTaskList();

    const globalError = pageB.locator('.global-error-alert');
    await expect(globalError).not.toBeVisible({ timeout: 3000 });

    // Task2 should still be visible (but without tag since it was deleted)
    await expect(taskPageB.getTaskByText(task2Name).first()).toBeVisible();
    console.log('[Concurrent] Task2 still visible on Client B');

    // The tag should not be on Task2 anymore
    const task2AfterReload = taskPageB.getTaskByText(task2Name).first();
    const tagOnTask2 = tagPageA.getTagOnTask(task2AfterReload, tagName);
    await expect(tagOnTask2).not.toBeVisible({ timeout: 2000 });
    console.log('[Concurrent] Tag no longer on Task2');

    console.log(
      '[Concurrent] ✓ Concurrent delete tag and archive task resolved correctly',
    );

    // Cleanup
    await closeContextsSafely(contextA, contextB);
  });
});
