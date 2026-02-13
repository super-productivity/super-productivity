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

/**
 * SuperSync Cross-Entity Cascade Delete E2E Tests
 *
 * Tests that project deletion propagates correctly across clients.
 * When Client A deletes a project (with tasks), the deletion should
 * propagate to Client B so the project and its tasks disappear.
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-cascade-delete.spec.ts
 */

/**
 * Navigate to project work view by clicking the project in the sidebar.
 */
const navigateToProject = async (
  page: import('@playwright/test').Page,
  projectName: string,
): Promise<void> => {
  const projectNavItem = page.locator(`nav-item:has-text("${projectName}")`).first();
  await projectNavItem.waitFor({ state: 'visible', timeout: 10000 });
  await projectNavItem.click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
};

/**
 * Delete a project via the context menu on the sidebar nav-item.
 */
const deleteProjectViaContextMenu = async (
  page: import('@playwright/test').Page,
  projectName: string,
): Promise<void> => {
  const projectNavItem = page.locator(`nav-item:has-text("${projectName}")`).first();
  await projectNavItem.waitFor({ state: 'visible', timeout: 10000 });

  await projectNavItem.hover();
  const moreBtn = projectNavItem.locator('.additional-btn');
  await moreBtn.waitFor({ state: 'visible', timeout: 5000 });
  await moreBtn.click();

  const deleteMenuItem = page.locator('button[mat-menu-item]:has-text("Delete project")');
  await deleteMenuItem.waitFor({ state: 'visible', timeout: 5000 });
  await deleteMenuItem.click();

  const confirmBtn = page.locator('dialog-confirm button[e2e="confirmBtn"]');
  await confirmBtn.waitFor({ state: 'visible', timeout: 5000 });
  await confirmBtn.click();

  await page.waitForTimeout(1000);
};

test.describe('@supersync Cross-Entity Cascade Delete', () => {
  /**
   * Scenario: Project deletion propagates to another synced client
   *
   * Flow:
   * 1. Client A creates a project with tasks
   * 2. Client A syncs
   * 3. Client B syncs (gets the project with tasks)
   * 4. Verify Client B can see the project and tasks
   * 5. Client A deletes the project (cascade deletes tasks locally)
   * 6. Client A syncs (uploads deletion)
   * 7. Client B syncs (receives deletion)
   * 8. Verify: Both clients have no project and no tasks
   */
  test('Project deletion cascades correctly across clients', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Client A creates project with tasks ============
      console.log('[CascadeDelete] Phase 1: Client A creates project with tasks');

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const projectName = `CascadeProject-${testRunId}`;
      await createProjectReliably(clientA.page, projectName);

      const taskA1 = `TaskA1-${testRunId}`;
      const taskA2 = `TaskA2-${testRunId}`;
      await clientA.workView.addTask(taskA1);
      await clientA.workView.addTask(taskA2);
      await waitForTask(clientA.page, taskA1);
      await waitForTask(clientA.page, taskA2);
      console.log(
        `[CascadeDelete] Client A created project "${projectName}" with 2 tasks`,
      );

      // Sync to upload project and tasks
      await clientA.sync.syncAndWait();
      console.log('[CascadeDelete] Client A synced');

      // ============ PHASE 2: Client B syncs and verifies project ============
      console.log('[CascadeDelete] Phase 2: Client B syncs and verifies project');

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      await clientB.sync.syncAndWait();

      // Verify Client B has the project in sidebar
      const projectOnB = clientB.page.locator(`nav-item:has-text("${projectName}")`);
      await expect(projectOnB).toBeVisible({ timeout: 10000 });

      // Navigate to the project and verify tasks
      await navigateToProject(clientB.page, projectName);
      await waitForTask(clientB.page, taskA1);
      await waitForTask(clientB.page, taskA2);
      console.log('[CascadeDelete] Client B has project and tasks');

      // Navigate Client B to Today before deletion sync to avoid stale view
      await clientB.page.evaluate(() => {
        window.location.hash = '#/tag/TODAY/tasks';
      });
      await clientB.page.waitForURL(/tag\/TODAY/, { timeout: 15000 });

      // ============ PHASE 3: Client A deletes the project ============
      console.log('[CascadeDelete] Phase 3: Client A deletes the project');

      await deleteProjectViaContextMenu(clientA.page, projectName);
      console.log('[CascadeDelete] Client A deleted project');

      // Sync the deletion
      await clientA.sync.syncAndWait();
      console.log('[CascadeDelete] Client A synced deletion');

      // ============ PHASE 4: Client B syncs to receive deletion ============
      console.log('[CascadeDelete] Phase 4: Client B syncs to receive deletion');

      await clientB.sync.syncAndWait();
      // Extra convergence round
      await clientB.sync.syncAndWait();
      console.log('[CascadeDelete] Client B synced');

      // ============ PHASE 5: Verify deletion propagated ============
      console.log('[CascadeDelete] Phase 5: Verifying deletion propagated');

      // Verify project is gone from sidebar on both clients
      const projectOnA = clientA.page.locator(`nav-item:has-text("${projectName}")`);
      await expect(projectOnA).not.toBeVisible({ timeout: 10000 });
      await expect(projectOnB).not.toBeVisible({ timeout: 10000 });
      console.log('[CascadeDelete] Project gone from both sidebars');

      // Verify tasks are not visible on Client A (which is already on Today after deletion)
      const taskA1OnA = clientA.page.locator(`task:has-text("${taskA1}")`);
      const taskA2OnA = clientA.page.locator(`task:has-text("${taskA2}")`);
      await expect(taskA1OnA).not.toBeVisible({ timeout: 10000 });
      await expect(taskA2OnA).not.toBeVisible({ timeout: 10000 });
      console.log('[CascadeDelete] Tasks gone from Client A');

      // Verify tasks are not visible on Client B (which is on Today)
      const taskA1OnB = clientB.page.locator(`task:has-text("${taskA1}")`);
      const taskA2OnB = clientB.page.locator(`task:has-text("${taskA2}")`);
      await expect(taskA1OnB).not.toBeVisible({ timeout: 10000 });
      await expect(taskA2OnB).not.toBeVisible({ timeout: 10000 });
      console.log('[CascadeDelete] Tasks gone from Client B');

      console.log('[CascadeDelete] Cascade delete test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
