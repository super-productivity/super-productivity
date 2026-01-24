import { test, expect } from '../../fixtures/webdav.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import {
  WEBDAV_CONFIG_TEMPLATE,
  setupSyncClient,
  createSyncFolder,
  waitForSyncComplete,
  generateSyncFolderName,
} from '../../utils/sync-helpers';

test.describe('@webdav WebDAV Sync Advanced Features', () => {
  // Run sync tests serially to avoid WebDAV server contention
  test.describe.configure({ mode: 'serial' });

  test('should sync sub-tasks correctly', async ({ browser, baseURL, request }) => {
    const SYNC_FOLDER_NAME = generateSyncFolderName('e2e-advanced-sub');
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

    // Configure Sync on Client A
    await syncPageA.setupWebdavSync(WEBDAV_CONFIG);

    // Create Parent Task
    const parentTaskName = 'Parent Task';
    await workViewPageA.addTask(parentTaskName);
    const parentTaskA = pageA.locator('task', { hasText: parentTaskName }).first();

    // Create Sub Tasks
    await workViewPageA.addSubTask(parentTaskA, 'Sub Task 1');
    await workViewPageA.addSubTask(parentTaskA, 'Sub Task 2');

    // Verify structure on A
    await expect(pageA.locator('task-list[listid="SUB"] task')).toHaveCount(2);

    // Sync A
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);

    // --- Client B ---
    const { context: contextB, page: pageB } = await setupSyncClient(browser, url);
    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);
    await workViewPageB.waitForTaskList();

    // Configure Sync on Client B
    await syncPageB.setupWebdavSync(WEBDAV_CONFIG);
    await expect(syncPageB.syncBtn).toBeVisible();

    // Sync B
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);

    // Verify structure on B
    const parentTaskB = pageB.locator('task', { hasText: parentTaskName }).first();
    await expect(parentTaskB).toBeVisible();

    // Wait for sub-task list to be rendered with correct count
    // Sub-tasks are visible by default (no click needed to expand)
    const subTaskList = pageB.locator(`task-list[listid="SUB"]`);
    await expect(subTaskList).toBeVisible({ timeout: 10000 });
    await expect(subTaskList.locator('task')).toHaveCount(2, { timeout: 10000 });
    await expect(subTaskList.locator('task', { hasText: 'Sub Task 1' })).toBeVisible();
    await expect(subTaskList.locator('task', { hasText: 'Sub Task 2' })).toBeVisible();

    await contextA.close();
    await contextB.close();
  });

  test('should sync task attachments', async ({ browser, baseURL, request }) => {
    test.slow();
    const SYNC_FOLDER_NAME = generateSyncFolderName('e2e-advanced-att');
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

    // Configure Sync on Client A
    await syncPageA.setupWebdavSync(WEBDAV_CONFIG);

    // Create Task
    const taskName = 'Attachment Task';
    await workViewPageA.addTask(taskName);
    const taskA = pageA.locator('task', { hasText: taskName }).first();

    // Add Attachment
    // Use context menu which is more reliable
    await taskA.click({ button: 'right' });

    // Click "Attach file or link" in context menu
    // The menu is in a portal, so we query the page
    const attachBtn = pageA.locator('.mat-mdc-menu-content button', {
      hasText: 'Attach',
    });
    await attachBtn.waitFor({ state: 'visible' });
    await attachBtn.click();

    // Dialog opens (direct attachment dialog or via side panel?)
    // The context menu action calls `addAttachment()`, which usually opens the dialog.
    const dialog = pageA.locator('dialog-edit-task-attachment');
    await expect(dialog).toBeVisible();

    // Fill title
    await dialog.locator('input[name="title"]').fill('Google');

    // Fill path/url
    const pathInput = dialog.locator('input[name="path"]');
    await pathInput.fill('https://google.com');

    await dialog.locator('button[type="submit"]').click();

    // Verify attachment indicator appears on task
    const attachmentBtn = taskA.locator('.attachment-btn');
    await expect(attachmentBtn).toBeVisible();

    // Click it to open side panel
    await attachmentBtn.click({ force: true });

    // Verify attachment added on A
    await expect(pageA.locator('.attachment-link')).toBeVisible();
    await expect(pageA.locator('.attachment-link')).toContainText('Google');

    // Sync A
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);

    // --- Client B ---
    const { context: contextB, page: pageB } = await setupSyncClient(browser, url);
    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);
    await workViewPageB.waitForTaskList();

    // Configure Sync on Client B
    await syncPageB.setupWebdavSync(WEBDAV_CONFIG);

    // Sync B
    await syncPageB.triggerSync();
    await waitForSyncComplete(pageB, syncPageB);

    // Verify Attachment on B
    const taskB = pageB.locator('task', { hasText: taskName }).first();
    await expect(taskB).toBeVisible();

    // Scroll task into view - it may be outside viewport after sync
    await taskB.scrollIntoViewIfNeeded();

    // Click the attachment button to open the side panel with attachments expanded
    const attachmentBtnB = taskB.locator('.attachment-btn');
    await expect(attachmentBtnB).toBeVisible();
    await attachmentBtnB.click();

    await expect(pageB.locator('.attachment-link')).toContainText('Google');

    await contextA.close();
    await contextB.close();
  });
});
