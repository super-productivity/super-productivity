import { test, expect } from '../../fixtures/test.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import { TagPage } from '../../pages/tag.page';
import { isWebDavServerUp } from '../../utils/check-webdav';
import {
  WEBDAV_CONFIG_TEMPLATE,
  createUniqueSyncFolder,
  createWebDavFolder,
  setupClient,
  waitForSync,
} from '../../utils/sync-helpers';

test.describe('WebDAV Sync Tags', () => {
  // Run sync tests serially to avoid WebDAV server contention
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    const isUp = await isWebDavServerUp(WEBDAV_CONFIG_TEMPLATE.baseUrl);
    if (!isUp) {
      console.warn('WebDAV server not reachable. Skipping WebDAV tests.');
      test.skip(true, 'WebDAV server not reachable');
    }
  });

  test('should sync tag creation between clients', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow();
    const SYNC_FOLDER_NAME = createUniqueSyncFolder('tags-create');
    await createWebDavFolder(request, SYNC_FOLDER_NAME);
    const WEBDAV_CONFIG = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${SYNC_FOLDER_NAME}`,
    };

    const url = baseURL || 'http://localhost:4242';

    // --- Client A ---
    const { context: contextA, page: pageA } = await setupClient(browser, url);
    const syncPageA = new SyncPage(pageA);
    const workViewPageA = new WorkViewPage(pageA);
    const tagPageA = new TagPage(pageA);
    await workViewPageA.waitForTaskList();

    // Configure Sync on Client A
    await syncPageA.setupWebdavSync(WEBDAV_CONFIG);
    await expect(syncPageA.syncBtn).toBeVisible();

    // Create a tag via sidebar on Client A
    const tagName = `Work-${Date.now()}`;
    await tagPageA.createTag(tagName);

    // Verify tag exists in sidebar
    const tagExists = await tagPageA.tagExistsInSidebar(tagName);
    expect(tagExists).toBe(true);

    // Sync Client A (Upload)
    await syncPageA.triggerSync();
    await waitForSync(pageA, syncPageA);

    // --- Client B ---
    const { context: contextB, page: pageB } = await setupClient(browser, url);
    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);
    const tagPageB = new TagPage(pageB);
    await workViewPageB.waitForTaskList();

    // Configure Sync on Client B
    await syncPageB.setupWebdavSync(WEBDAV_CONFIG);
    await expect(syncPageB.syncBtn).toBeVisible();

    // Sync Client B (Download)
    await syncPageB.triggerSync();
    await waitForSync(pageB, syncPageB);

    // Verify tag appears on Client B
    const tagExistsOnB = await tagPageB.tagExistsInSidebar(tagName);
    expect(tagExistsOnB).toBe(true);

    // Cleanup
    await contextA.close();
    await contextB.close();
  });

  test('should sync tag assignment to task', async ({ browser, baseURL, request }) => {
    test.slow();
    const SYNC_FOLDER_NAME = createUniqueSyncFolder('tags-assign');
    await createWebDavFolder(request, SYNC_FOLDER_NAME);
    const WEBDAV_CONFIG = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${SYNC_FOLDER_NAME}`,
    };

    const url = baseURL || 'http://localhost:4242';

    // --- Client A ---
    const { context: contextA, page: pageA } = await setupClient(browser, url);
    const syncPageA = new SyncPage(pageA);
    const workViewPageA = new WorkViewPage(pageA);
    const tagPageA = new TagPage(pageA);
    await workViewPageA.waitForTaskList();

    // Configure Sync on Client A
    await syncPageA.setupWebdavSync(WEBDAV_CONFIG);

    // Create a task
    const taskName = `Tagged Task ${Date.now()}`;
    await workViewPageA.addTask(taskName);
    const taskA = pageA.locator('task', { hasText: taskName }).first();
    await expect(taskA).toBeVisible();

    // Create and assign tag to task
    const tagName = `Priority-${Date.now()}`;
    await tagPageA.assignTagToTask(taskA, tagName);

    // Wait for state to settle
    await pageA.waitForTimeout(500);

    // Sync Client A
    await syncPageA.triggerSync();
    await waitForSync(pageA, syncPageA);

    // --- Client B ---
    const { context: contextB, page: pageB } = await setupClient(browser, url);
    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);
    const tagPageB = new TagPage(pageB);
    await workViewPageB.waitForTaskList();

    // Configure Sync on Client B
    await syncPageB.setupWebdavSync(WEBDAV_CONFIG);

    // Sync Client B
    await syncPageB.triggerSync();
    await waitForSync(pageB, syncPageB);

    // Verify task appears on B
    const taskB = pageB.locator('task', { hasText: taskName }).first();
    await expect(taskB).toBeVisible();

    // Verify tag badge is visible on task using tag page helper
    const hasTag = await tagPageB.taskHasTag(taskB, tagName);
    expect(hasTag).toBe(true);

    // Cleanup
    await contextA.close();
    await contextB.close();
  });

  test('should sync tag removal from task', async ({ browser, baseURL, request }) => {
    test.slow();
    const SYNC_FOLDER_NAME = createUniqueSyncFolder('tags-remove');
    await createWebDavFolder(request, SYNC_FOLDER_NAME);
    const WEBDAV_CONFIG = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${SYNC_FOLDER_NAME}`,
    };

    const url = baseURL || 'http://localhost:4242';

    // --- Client A ---
    const { context: contextA, page: pageA } = await setupClient(browser, url);
    const syncPageA = new SyncPage(pageA);
    const workViewPageA = new WorkViewPage(pageA);
    const tagPageA = new TagPage(pageA);
    await workViewPageA.waitForTaskList();

    // Configure Sync on Client A
    await syncPageA.setupWebdavSync(WEBDAV_CONFIG);

    // Create a task with tag
    const taskName = `Remove Tag Task ${Date.now()}`;
    await workViewPageA.addTask(taskName);
    const taskA = pageA.locator('task', { hasText: taskName }).first();

    // Assign tag
    const tagName = `TempTag-${Date.now()}`;
    await tagPageA.assignTagToTask(taskA, tagName);
    await pageA.waitForTimeout(500);

    // Sync to B first
    await syncPageA.triggerSync();
    await waitForSync(pageA, syncPageA);

    // --- Client B: Setup and initial sync ---
    const { context: contextB, page: pageB } = await setupClient(browser, url);
    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);
    await workViewPageB.waitForTaskList();

    await syncPageB.setupWebdavSync(WEBDAV_CONFIG);
    await syncPageB.triggerSync();
    await waitForSync(pageB, syncPageB);

    // Verify task with tag exists on B
    const taskB = pageB.locator('task', { hasText: taskName }).first();
    await expect(taskB).toBeVisible();

    // --- Client A: Remove tag ---
    await tagPageA.removeTagFromTask(taskA, tagName);
    await pageA.waitForTimeout(500);

    // Sync Client A
    await syncPageA.triggerSync();
    await waitForSync(pageA, syncPageA);

    // --- Client B: Sync and verify tag removed ---
    await syncPageB.triggerSync();
    await waitForSync(pageB, syncPageB);

    // Wait for UI to settle after sync (no reload needed, sync updates UI directly)
    await pageB.waitForTimeout(1000);
    await workViewPageB.waitForTaskList();

    // Verify task still exists but without the specific tag indicator
    const taskBAfter = pageB.locator('task', { hasText: taskName }).first();
    await expect(taskBAfter).toBeVisible();

    // Cleanup
    await contextA.close();
    await contextB.close();
  });
});
