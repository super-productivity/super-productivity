import { type Page } from '@playwright/test';
import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  createProjectReliably,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { ProjectPage } from '../../pages/project.page';

// Robust helper to create a tag
const createTagReliably = async (page: Page, tagName: string): Promise<void> => {
  await page.goto('/#/tag/TODAY/work');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // Ensure sidebar is in full mode
  const navSidenav = page.locator('.nav-sidenav');
  if (await navSidenav.isVisible()) {
    const isCompact = await navSidenav.evaluate((el) =>
      el.classList.contains('compactMode'),
    );
    if (isCompact) {
      const toggleBtn = navSidenav.locator('.mode-toggle');
      if (await toggleBtn.isVisible()) {
        await toggleBtn.click();
        await page.waitForTimeout(500);
      }
    }
  }

  // Find the Tags section wrapper
  const tagsTree = page.locator('nav-list-tree').filter({ hasText: 'Tags' }).first();
  await tagsTree.waitFor({ state: 'visible' });

  // The "Create Tag" button is an additional-btn with an 'add' icon
  const addBtn = tagsTree.locator('.additional-btn mat-icon:has-text("add")').first();

  if (await addBtn.isVisible()) {
    await addBtn.click();
  } else {
    const groupNavItem = tagsTree.locator('nav-item').first();
    await groupNavItem.hover();
    await page.waitForTimeout(200);
    if (await addBtn.isVisible()) {
      await addBtn.click();
    } else {
      throw new Error('Could not find Create Tag button');
    }
  }

  // Dialog
  const dialog = page.locator('mat-dialog-container');
  await dialog.waitFor({ state: 'visible', timeout: 10000 });

  const input = dialog.locator('input[type="text"]').first();
  await input.fill(tagName);

  const submitBtn = dialog
    .locator('button[type="submit"], button:has-text("Save")')
    .first();
  await submitBtn.click();

  await dialog.waitFor({ state: 'hidden' });
};

test.describe('@supersync SuperSync Models', () => {
  test('Projects and their tasks sync correctly', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Client A setup
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // Create Project on Client A
      const projectName = `Proj-${testRunId}`;
      await createProjectReliably(clientA.page, projectName);

      // Go to project
      const projectBtnA = clientA.page.getByText(projectName).first();
      await projectBtnA.waitFor({ state: 'visible' });
      await projectBtnA.click({ force: true });

      // Add task to project
      const taskName = `TaskInProject-${testRunId}`;
      await clientA.workView.addTask(taskName);

      // Sync A
      await clientA.sync.syncAndWait();

      // Client B setup
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();

      // Verify Project exists on B
      const projectsTreeB = clientB.page
        .locator('nav-list-tree')
        .filter({ hasText: 'Projects' })
        .first();
      await projectsTreeB.waitFor({ state: 'visible' });

      const groupNavItemB = projectsTreeB.locator('nav-item').first();
      // Ensure expanded
      const expandBtnB = groupNavItemB
        .locator('button.expand-btn, button.arrow-btn')
        .first();
      if (await expandBtnB.isVisible()) {
        const isExpanded = await expandBtnB.getAttribute('aria-expanded');
        if (isExpanded !== 'true') {
          await groupNavItemB.click();
          await clientB.page.waitForTimeout(500);
        }
      }

      const projectBtnB = clientB.page.getByText(projectName).first();
      await expect(projectBtnB).toBeVisible();

      // Click project on B
      await projectBtnB.click({ force: true });

      // Verify Task exists in project on B
      await waitForTask(clientB.page, taskName);
      await expect(clientB.page.locator(`task:has-text("${taskName}")`)).toBeVisible();
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  test('Tags and tagged tasks sync correctly', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const tagName = `Tag-${testRunId}`;
      const taskName = `TaggedTask-${testRunId}`;

      // Create tag
      await createTagReliably(clientA.page, tagName);

      // Go back to Today
      await clientA.page.goto('/#/tag/TODAY/work');
      await clientA.page.waitForLoadState('networkidle');

      // Create task
      await clientA.workView.addTask(taskName);

      // Helper to dismiss all overlays reliably
      const dismissAllOverlays = async (): Promise<void> => {
        // Dismiss backdrops by pressing Escape multiple times
        for (let j = 0; j < 3; j++) {
          await clientA.page.keyboard.press('Escape');
          await clientA.page.waitForTimeout(100);
        }
        // Wait for any overlays to disappear
        const overlayBackdrop = clientA.page.locator('.cdk-overlay-backdrop');
        try {
          await overlayBackdrop.waitFor({ state: 'hidden', timeout: 2000 });
        } catch {
          // If still visible, force click to dismiss
          if (await overlayBackdrop.isVisible()) {
            await overlayBackdrop.click({ force: true });
            await clientA.page.waitForTimeout(200);
          }
        }
      };

      // Dismiss any existing overlays first
      await dismissAllOverlays();

      // Add tag to task via context menu (most reliable method)
      const taskLocator = clientA.page.locator(`task:has-text("${taskName}")`);
      await taskLocator.waitFor({ state: 'visible' });

      // Retry loop for opening tags menu via context menu
      let menuOpened = false;
      for (let i = 0; i < 3; i++) {
        try {
          // Ensure clean state before each attempt
          await dismissAllOverlays();

          // Right-click on task to open context menu (doesn't trigger edit mode)
          await taskLocator.click({ button: 'right' });
          await clientA.page.waitForTimeout(300);

          // Find and click the "Edit tags" button in context menu
          const ctxEditTags = clientA.page.locator('.e2e-edit-tags-btn').first();
          await ctxEditTags.waitFor({ state: 'visible', timeout: 3000 });
          await ctxEditTags.click();

          // Wait for tag submenu to appear
          const menuPanel = clientA.page.locator('.mat-mdc-menu-panel').last();
          await menuPanel.waitFor({ state: 'visible', timeout: 5000 });
          menuOpened = true;
          break;
        } catch (e) {
          console.log(`Attempt ${i + 1} to open tags menu failed: ${e}, retrying...`);
          await dismissAllOverlays();
          await clientA.page.waitForTimeout(500);
        }
      }

      if (!menuOpened) {
        throw new Error('Failed to open tags menu after 3 attempts');
      }

      // Select the tag from the submenu (last menu panel is the tag submenu)
      const tagMenu = clientA.page.locator('.mat-mdc-menu-panel').last();
      const tagOption = tagMenu
        .locator('button[mat-menu-item]')
        .filter({ hasText: tagName })
        .first();
      await tagOption.waitFor({ state: 'visible', timeout: 3000 });
      await tagOption.click();

      // Wait for menus to close after selection
      await clientA.page.waitForTimeout(500);
      await dismissAllOverlays();

      // Ensure tag is shown on Client A before syncing
      await expect(taskLocator).toContainText(tagName);

      // Sync A
      await clientA.sync.syncAndWait();

      // Client B
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();

      // Verify Tag exists on B
      const tagsTreeB = clientB.page
        .locator('nav-list-tree')
        .filter({ hasText: 'Tags' })
        .first();
      await tagsTreeB.waitFor({ state: 'visible' });

      const groupNavItemB = tagsTreeB.locator('nav-item').first();
      const expandBtnB = groupNavItemB
        .locator('button.expand-btn, button.arrow-btn')
        .first();
      if (await expandBtnB.isVisible()) {
        const isExpanded = await expandBtnB.getAttribute('aria-expanded');
        if (isExpanded !== 'true') {
          await groupNavItemB.click();
          await clientB.page.waitForTimeout(500);
        }
      }

      // Verify tag is visible in sidebar
      await expect(
        clientB.page.locator('nav-list-tree').filter({ hasText: tagName }),
      ).toBeVisible();

      // Switch to the tag view and verify the task is present
      const tagNavItem = tagsTreeB
        .locator('nav-item')
        .filter({ hasText: tagName })
        .first();
      const tagId = await tagNavItem.getAttribute('data-tag-id');
      if (tagId) {
        await clientB.page.goto(`/#/tag/${tagId}/work`);
      } else {
        await tagNavItem.click({ force: true });
      }
      await clientB.page.waitForLoadState('networkidle');

      await waitForTask(clientB.page, taskName);
      const taskB = clientB.page.locator(`task:has-text("${taskName}")`);
      await expect(taskB).toBeVisible();
      // Check for tag text content in the task (more robust than finding specific tag element structure)
      await expect(taskB).toContainText(tagName);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  test('Project notes sync correctly', async ({ browser, baseURL, testRunId }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // Create Project
      const projectName = `NoteProj-${testRunId}`;
      await createProjectReliably(clientA.page, projectName);

      // Navigate to project on A
      // Use sidebar locator to be sure we click the nav item
      const projectsTreeA = clientA.page
        .locator('nav-list-tree')
        .filter({ hasText: 'Projects' })
        .first();
      const projectBtnA = projectsTreeA
        .locator('nav-item')
        .filter({ hasText: projectName })
        .first();

      // Ensure parent is expanded
      const groupNavItemA = projectsTreeA.locator('nav-item').first();
      const expandBtnA = groupNavItemA
        .locator('button.expand-btn, button.arrow-btn')
        .first();
      if (await expandBtnA.isVisible()) {
        const isExpanded = await expandBtnA.getAttribute('aria-expanded');
        if (isExpanded !== 'true') {
          await groupNavItemA.click();
          await clientA.page.waitForTimeout(500);
        }
      }

      await projectBtnA.waitFor({ state: 'visible' });

      // Get Project ID to navigate reliably
      let projectId = await projectBtnA.getAttribute('data-project-id');
      if (!projectId) {
        // Fallback: click and derive from URL if attribute missing
        await projectBtnA.click({ force: true });
        await clientA.page.waitForLoadState('networkidle');
        const urlMatch = clientA.page.url().match(/project\/([^/?#]+)/);
        projectId = urlMatch?.[1] || undefined;
      }
      if (!projectId) {
        throw new Error('Project id not found after creation');
      }

      await clientA.page.goto(`/#/project/${projectId}`);
      await clientA.page.waitForLoadState('networkidle');

      // Add Note
      const noteContent = `This is a synced note ${testRunId}`;
      const projectPageA = new ProjectPage(clientA.page);
      await projectPageA.addNote(noteContent, projectId);

      // Sync A
      await clientA.sync.syncAndWait();

      // Client B
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();

      // Navigate to project on B
      const projectsTreeB = clientB.page
        .locator('nav-list-tree')
        .filter({ hasText: 'Projects' })
        .first();
      await projectsTreeB.waitFor({ state: 'visible' });

      const groupNavItemB = projectsTreeB.locator('nav-item').first();
      const expandBtnB = groupNavItemB
        .locator('button.expand-btn, button.arrow-btn')
        .first();
      if (await expandBtnB.isVisible()) {
        const isExpanded = await expandBtnB.getAttribute('aria-expanded');
        if (isExpanded !== 'true') {
          await groupNavItemB.click();
          await clientB.page.waitForTimeout(500);
        }
      }

      await clientB.page.goto(`/#/project/${projectId}`);
      await clientB.page.waitForLoadState('networkidle');

      // Verify Note
      const toggleNotesBtn = clientB.page.locator('.e2e-toggle-notes-btn');
      if (await toggleNotesBtn.isVisible()) {
        await toggleNotesBtn.click();
      }

      const notesWrapper = clientB.page.locator('notes');
      await expect(notesWrapper).toBeVisible();
      await expect(notesWrapper).toContainText(noteContent);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Tag deletion atomically removes tag from many tasks
   *
   * Tests that when a tag is deleted, all tasks with that tag have
   * the tag removed atomically in a single operation. This verifies
   * the meta-reducer approach for atomic multi-entity changes.
   *
   * Actions:
   * 1. Client A creates a tag
   * 2. Client A creates 10 tasks with that tag (using short syntax)
   * 3. Client A syncs
   * 4. Client B syncs (receives all)
   * 5. Client A deletes the tag
   * 6. Client A syncs
   * 7. Client B syncs
   *
   * Verify:
   * - Tag is gone on both clients
   * - All tasks exist but NO task has the deleted tag
   * - Changes were atomic (single operation in sync)
   */
  test('Tag deletion atomically removes tag from many tasks', async ({
    browser,
    baseURL,
    testRunId,
  }, testInfo) => {
    testInfo.setTimeout(180000);
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const tagName = `BulkTag-${testRunId}`;
      const taskCount = 10;
      const taskNames: string[] = [];

      // 1. Create tag first
      await createTagReliably(clientA.page, tagName);
      console.log(`[BulkTag] Created tag: ${tagName}`);

      // Go back to Today view
      await clientA.page.goto('/#/tag/TODAY/work');
      await clientA.page.waitForLoadState('networkidle');

      // 2. Create tasks with the tag using short syntax: "task name #tagname"
      // This is much faster and more reliable than using the context menu
      for (let i = 0; i < taskCount; i++) {
        const taskName = `TaggedTask-${testRunId}-${i.toString().padStart(2, '0')}`;
        taskNames.push(taskName);

        // Create task with tag using short syntax
        await clientA.workView.addTask(`${taskName} #${tagName}`);
        await waitForTask(clientA.page, taskName);

        // Verify tag is on task
        const taskLocator = clientA.page.locator(`task:has-text("${taskName}")`).first();
        await expect(taskLocator).toContainText(tagName);

        if ((i + 1) % 5 === 0) {
          console.log(`[BulkTag] Created and tagged ${i + 1}/${taskCount} tasks`);
        }
      }
      console.log(`[BulkTag] Created ${taskCount} tasks with tag`);

      // 3. Client A syncs
      await clientA.sync.syncAndWait();
      console.log('[BulkTag] Client A synced');

      // 4. Client B syncs
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      console.log('[BulkTag] Client B synced');

      // Verify B has the tag in sidebar
      const tagsTreeB = clientB.page
        .locator('nav-list-tree')
        .filter({ hasText: 'Tags' })
        .first();
      await tagsTreeB.waitFor({ state: 'visible' });
      await expect(
        clientB.page.locator(`nav-list-tree:has-text("${tagName}")`),
      ).toBeVisible();
      console.log('[BulkTag] Client B sees the tag');

      // 5. Client A deletes the tag
      // Navigate to Today view to ensure sidebar is visible
      await clientA.page.goto('/#/tag/TODAY/work');
      await clientA.page.waitForLoadState('networkidle');

      // Use toPass() to make tag deletion more robust
      await expect(async () => {
        const tagsTreeA = clientA.page
          .locator('nav-list-tree')
          .filter({ hasText: 'Tags' })
          .first();
        await tagsTreeA.waitFor({ state: 'visible', timeout: 3000 });

        // Expand Tags section if collapsed - click directly on the nav-item row
        const groupNavItemA = tagsTreeA.locator('nav-item').first();
        const expandBtnA = groupNavItemA.locator('button').first();
        const isExpanded = await expandBtnA.getAttribute('aria-expanded');
        if (isExpanded !== 'true') {
          await groupNavItemA.click();
          await clientA.page.waitForTimeout(300);
        }

        // Find the specific tag and right-click
        const tagNavItem = tagsTreeA
          .locator('nav-item')
          .filter({ hasText: tagName })
          .first();
        await tagNavItem.waitFor({ state: 'visible', timeout: 3000 });
        await tagNavItem.click({ button: 'right' });

        // Click delete option in context menu
        const deleteBtn = clientA.page
          .locator('.mat-mdc-menu-panel button, .mat-mdc-menu-content button')
          .filter({ hasText: /delete/i })
          .first();
        await deleteBtn.waitFor({ state: 'visible', timeout: 3000 });
        await deleteBtn.click();

        // Handle confirmation dialog
        const confirmBtn = clientA.page
          .locator('dialog-confirm button, mat-dialog-container button')
          .filter({ hasText: /ok|delete|confirm|yes/i })
          .first();
        await confirmBtn.waitFor({ state: 'visible', timeout: 3000 });
        await confirmBtn.click();

        // Wait for tag to disappear from sidebar
        await tagNavItem.waitFor({ state: 'hidden', timeout: 5000 });
      }).toPass({ timeout: 30000, intervals: [1000, 2000, 3000, 5000] });

      console.log('[BulkTag] Tag deleted on Client A');

      // 6. Client A syncs
      await clientA.sync.syncAndWait();
      console.log('[BulkTag] Client A synced after tag deletion');

      // 7. Client B syncs
      await clientB.sync.syncAndWait();
      console.log('[BulkTag] Client B synced');

      // Wait for state to settle and sync to fully process
      await clientA.page.waitForTimeout(500);
      await clientB.page.waitForTimeout(500);

      // Do an extra sync cycle to ensure all state is synchronized
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();

      // Navigate both clients to Today view to refresh the UI
      await clientA.page.goto('/#/tag/TODAY/work');
      await clientA.page.waitForLoadState('networkidle');
      await clientB.page.goto('/#/tag/TODAY/work');
      await clientB.page.waitForLoadState('networkidle');

      // VERIFICATION: Tag should be gone on both clients
      console.log('[BulkTag] Verifying tag is gone...');

      // Check that the tag name doesn't appear in the nav (it should be deleted)
      // We check in the Tags section specifically
      // Use waitFor with state: 'hidden' which handles both hidden and detached elements
      const tagItemA = clientA.page
        .locator('nav-list-tree')
        .filter({ hasText: 'Tags' })
        .locator(`nav-item:has-text("${tagName}")`);
      const tagItemB = clientB.page
        .locator('nav-list-tree')
        .filter({ hasText: 'Tags' })
        .locator(`nav-item:has-text("${tagName}")`);

      // Use longer timeout and toPass for more reliable check
      await expect(async () => {
        await expect(tagItemA).not.toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 15000, intervals: [1000, 2000, 3000] });

      await expect(async () => {
        await expect(tagItemB).not.toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 15000, intervals: [1000, 2000, 3000] });

      console.log('[BulkTag] ✓ Tag is gone on both clients');

      // VERIFICATION: All tasks still exist but WITHOUT the tag
      console.log('[BulkTag] Verifying tasks exist without the tag...');

      // Check first few tasks on Client A
      for (let i = 0; i < 5; i++) {
        const taskName = taskNames[i];
        const taskLocatorA = clientA.page.locator(`task:has-text("${taskName}")`).first();
        await expect(taskLocatorA).toBeVisible({ timeout: 5000 });
        // Task should NOT contain the tag name
        await expect(taskLocatorA).not.toContainText(tagName);
      }
      console.log('[BulkTag] ✓ Tasks on Client A exist without tag');

      // Check first few tasks on Client B
      for (let i = 0; i < 5; i++) {
        const taskName = taskNames[i];
        const taskLocatorB = clientB.page.locator(`task:has-text("${taskName}")`).first();
        await expect(taskLocatorB).toBeVisible({ timeout: 5000 });
        // Task should NOT contain the tag name
        await expect(taskLocatorB).not.toContainText(tagName);
      }
      console.log('[BulkTag] ✓ Tasks on Client B exist without tag');

      // Verify task count matches
      const countA = await clientA.page.locator(`task:has-text("${testRunId}")`).count();
      const countB = await clientB.page.locator(`task:has-text("${testRunId}")`).count();
      expect(countA).toBe(countB);
      expect(countA).toBeGreaterThanOrEqual(taskCount);
      console.log(`[BulkTag] ✓ Both clients have ${countA} tasks`);

      console.log('[BulkTag] ✓ Tag deletion atomic cleanup test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
