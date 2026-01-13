import { expect, test } from '../../fixtures/test.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import { ProjectPage } from '../../pages/project.page';
import { waitForStatePersistence } from '../../utils/waits';
import { isWebDavServerUp } from '../../utils/check-webdav';
import {
  createSyncFolder,
  generateSyncFolderName,
  setupSyncClient,
  waitForSyncComplete,
  WEBDAV_CONFIG_TEMPLATE,
} from '../../utils/sync-helpers';

// Timing constants for sync detection

const WEBDAV_TIMESTAMP_DELAY_MS = 2000;

test.describe('WebDAV Sync Expansion', () => {
  // Run sync tests serially to avoid WebDAV server contention
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    const isUp = await isWebDavServerUp(WEBDAV_CONFIG_TEMPLATE.baseUrl);
    if (!isUp) {
      console.warn('WebDAV server not reachable. Skipping WebDAV tests.');
      test.skip(true, 'WebDAV server not reachable');
    }
  });

  test('should sync projects', async ({ browser, baseURL, request }) => {
    test.slow();
    const SYNC_FOLDER_NAME = generateSyncFolderName('e2e-expansion-proj');
    await createSyncFolder(request, SYNC_FOLDER_NAME);
    const WEBDAV_CONFIG = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${SYNC_FOLDER_NAME}`,
    };

    const url = baseURL || 'http://localhost:4242';

    // --- Client A ---
    const { context: contextA, page: pageA } = await setupSyncClient(browser, url);
    const syncPageA = new SyncPage(pageA);
    const workViewPageA = new WorkViewPage(pageA);
    const projectPageA = new ProjectPage(pageA);
    await workViewPageA.waitForTaskList();

    // Configure Sync A
    await syncPageA.setupWebdavSync(WEBDAV_CONFIG);

    // Create Project on A
    const projectName = 'Synced Project';
    await projectPageA.createProject(projectName);

    // Navigate to the newly created project (createProject doesn't auto-navigate)
    await projectPageA.navigateToProjectByName(projectName);

    // Add task to new project on A
    await workViewPageA.addTask('Task in Project A');

    // Sync A
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);

    // --- Client B ---
    const { context: contextB, page: pageB } = await setupSyncClient(browser, url);
    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);
    const projectPageB = new ProjectPage(pageB);
    await workViewPageB.waitForTaskList();

    // Configure Sync B
    await syncPageB.setupWebdavSync(WEBDAV_CONFIG);
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);

    // Wait for state persistence to complete after sync
    await waitForStatePersistence(pageB);

    // Wait for the synced project to appear in the sidebar
    // First ensure Projects group is expanded
    const projectsTree = pageB.locator('nav-list-tree').filter({ hasText: 'Projects' });
    const projectsGroupBtn = projectsTree
      .locator('.g-multi-btn-wrapper nav-item button')
      .first();
    await projectsGroupBtn.waitFor({ state: 'visible', timeout: 5000 });
    const isExpanded = await projectsGroupBtn.getAttribute('aria-expanded');
    if (isExpanded !== 'true') {
      await projectsGroupBtn.click();
    }

    // Now wait for the project to appear
    const projectBtn = projectsTree.locator('button').filter({ hasText: projectName });
    await projectBtn.waitFor({ state: 'visible', timeout: 15000 });

    await projectPageB.navigateToProjectByName(projectName);

    // Verify task
    await expect(pageB.locator('task')).toHaveCount(1);
    await expect(pageB.locator('task').first()).toContainText('Task in Project A');

    // Add task on B in project
    await workViewPageB.addTask('Task in Project B');

    // Wait for state persistence before syncing
    await waitForStatePersistence(pageB);

    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);

    // Wait for server to process and ensure Last-Modified timestamp differs
    // WebDAV servers often have second-level timestamp precision
    await pageB.waitForTimeout(WEBDAV_TIMESTAMP_DELAY_MS);

    // Sync A - trigger sync to download changes from B
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);

    // Wait for state persistence to complete after sync
    await waitForStatePersistence(pageA);

    // Navigate to project page to verify task synced
    await projectPageA.navigateToProjectByName(projectName);

    // Check if task B is visible immediately after sync (no reload)
    await expect(pageA.locator('task', { hasText: 'Task in Project B' })).toBeVisible({
      timeout: 20000,
    });

    await contextA.close();
    await contextB.close();
  });

  test('should sync task done state', async ({ browser, baseURL, request }) => {
    test.slow();
    const SYNC_FOLDER_NAME = generateSyncFolderName('e2e-expansion-done');
    await createSyncFolder(request, SYNC_FOLDER_NAME);
    const WEBDAV_CONFIG = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${SYNC_FOLDER_NAME}`,
    };

    const url = baseURL || 'http://localhost:4242';

    // --- Client A ---
    const { context: contextA, page: pageA } = await setupSyncClient(browser, url);
    const syncPageA = new SyncPage(pageA);
    const workViewPageA = new WorkViewPage(pageA);
    await workViewPageA.waitForTaskList();

    await syncPageA.setupWebdavSync(WEBDAV_CONFIG);

    const taskName = 'Task to be done';
    await workViewPageA.addTask(taskName);

    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);

    // --- Client B ---
    const { context: contextB, page: pageB } = await setupSyncClient(browser, url);
    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);
    await workViewPageB.waitForTaskList();

    // Configure Sync B
    await syncPageB.setupWebdavSync(WEBDAV_CONFIG);
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);

    // Wait for state persistence to complete after sync
    await waitForStatePersistence(pageB);

    // Verify task synced to B
    const taskB = pageB.locator('task', { hasText: taskName }).first();
    await expect(taskB).toBeVisible({ timeout: 20000 });
    await expect(taskB).not.toHaveClass(/isDone/);

    // --- Test 1: Mark done on B, verify on A ---
    await taskB.hover();
    const doneBtnB = taskB.locator('.task-done-btn');
    await doneBtnB.click({ force: true });
    await expect(taskB).toHaveClass(/isDone/);

    // Wait for state persistence before syncing
    await waitForStatePersistence(pageB);

    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);

    // Sync A to get done state from B
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);

    // Wait for state persistence to complete after sync
    await waitForStatePersistence(pageA);

    // Note: We DON'T reload - sync updates NgRx directly
    // Verify task is marked as done on A after sync
    const taskA = pageA.locator('task', { hasText: taskName }).first();
    await expect(taskA).toHaveClass(/isDone/, { timeout: 10000 });

    await contextA.close();
    await contextB.close();
  });
});
