import { test, expect } from '../../fixtures/test.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import { ProjectPage } from '../../pages/project.page';
import { waitForAppReady, waitForStatePersistence } from '../../utils/waits';
import { isWebDavServerUp } from '../../utils/check-webdav';
import {
  WEBDAV_CONFIG_TEMPLATE,
  setupSyncClient,
  createSyncFolder,
  waitForSyncComplete,
  generateSyncFolderName,
  dismissTourIfVisible,
} from '../../utils/sync-helpers';

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

    // Reload to ensure UI is updated with synced data
    await pageB.reload();
    await waitForAppReady(pageB);
    await dismissTourIfVisible(pageB);

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
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);

    // Sync A
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);

    await pageA.reload();
    await waitForAppReady(pageA);

    // Ensure we are on the project page
    await projectPageA.navigateToProjectByName(projectName);

    // Verify task on A
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

    await pageB.reload();
    await waitForAppReady(pageB);
    await dismissTourIfVisible(pageB);
    await workViewPageB.waitForTaskList();

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

    // Reload A to ensure UI reflects synced state
    await pageA.reload();
    await waitForAppReady(pageA);
    await dismissTourIfVisible(pageA);
    await workViewPageA.waitForTaskList();

    // Check if task appears in main list or Done Tasks section
    // First try to find task directly
    let taskA = pageA.locator('task', { hasText: taskName }).first();
    const isTaskVisible = await taskA.isVisible().catch(() => false);

    if (!isTaskVisible) {
      // Task might be in collapsed "Done Tasks" section, expand it
      const doneTasksHeader = pageA.locator('.task-list-header', {
        hasText: 'Done Tasks',
      });
      if (await doneTasksHeader.isVisible()) {
        await doneTasksHeader.click();
        await pageA.waitForTimeout(500);
      }
      // Re-locate task after expanding
      taskA = pageA.locator('task', { hasText: taskName }).first();
    }

    await taskA.waitFor({ state: 'visible', timeout: 10000 });

    // Verify task is marked as done - either has isDone class or is in Done section
    const hasDoneClass = await taskA.evaluate((el) => el.classList.contains('isDone'));
    const isInDoneSection = await pageA
      .locator('.done-tasks task', { hasText: taskName })
      .isVisible()
      .catch(() => false);

    // Task should be done (either by class or by being in done section)
    expect(hasDoneClass || isInDoneSection).toBe(true);

    await contextA.close();
    await contextB.close();
  });
});
