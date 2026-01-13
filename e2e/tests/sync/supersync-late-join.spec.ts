import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { expectTaskVisible } from '../../utils/supersync-assertions';

/**
 * SuperSync Late Join E2E Tests
 *
 * Scenarios where a client works locally for a while before enabling sync.
 */

test.describe('@supersync SuperSync Late Join', () => {
  test('Late joiner merges correctly with existing server data', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Client A: The "Server" Client (syncs immediately)
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      // A creates initial data
      const taskA1 = `A1-${testRunId}`;
      const taskA2 = `A2-${testRunId}`;
      await clientA.workView.addTask(taskA1);
      await clientA.workView.addTask(taskA2);

      // A Syncs
      await clientA.sync.syncAndWait();
      console.log('Client A synced initial tasks');

      // Client B: The "Late Joiner" (works locally first)
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      // DO NOT SETUP SYNC YET

      // B creates local data
      const taskB1 = `B1-${testRunId}`;
      const taskB2 = `B2-${testRunId}`;
      await clientB.workView.addTask(taskB1);
      await clientB.workView.addTask(taskB2);
      console.log('Client B created local tasks');

      // A creates more data (server moves ahead)
      const taskA3 = `A3-${testRunId}`;
      await clientA.workView.addTask(taskA3);
      await clientA.sync.syncAndWait();
      console.log('Client A added more tasks and synced');

      // B creates more local data
      const taskB3 = `B3-${testRunId}`;
      await clientB.workView.addTask(taskB3);
      console.log('Client B added more local tasks');

      // NOW B Enables Sync
      console.log('Client B enabling sync...');
      await clientB.sync.setupSuperSync(syncConfig);

      // Initial sync happens automatically on setup usually, but let's trigger to be sure
      await clientB.sync.syncAndWait();

      // Handle Potential Conflict Dialog
      // Since B has local data and server has remote data, and they might touch global settings or similar,
      // a conflict might occur. However, tasks are distinct IDs, so they should merge cleanly.
      // If a conflict dialog appears for Global Config or similar, we should handle it.
      // Check multiple times as dialog might appear with slight delay
      const conflictDialog = clientB.page.locator('dialog-conflict-resolution');
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await conflictDialog.waitFor({ state: 'visible', timeout: 2000 });
          console.log('Conflict dialog detected on B, resolving...');
          // Pick Remote for singleton models (like Global Config)
          const useRemoteBtn = conflictDialog
            .locator('button')
            .filter({ hasText: 'Remote' })
            .first();
          if (await useRemoteBtn.isVisible()) {
            await useRemoteBtn.click();
            // Wait for dialog to close
            await conflictDialog.waitFor({ state: 'hidden', timeout: 5000 });
          } else {
            // Fallback: dismiss dialog
            await clientB.page.keyboard.press('Escape');
          }
          // Brief wait for any subsequent dialogs
          await clientB.page.waitForTimeout(500);
        } catch {
          // No conflict dialog visible, proceed
          break;
        }
      }

      // Wait for sync to fully settle after conflict resolution
      await clientB.page.waitForTimeout(2000);

      // Trigger another sync to ensure all data is propagated
      await clientB.sync.syncAndWait();

      // A Syncs to get B's data
      await clientA.sync.syncAndWait();

      // Brief wait for state to propagate
      await clientA.page.waitForTimeout(1000);

      // VERIFICATION
      // Both clients should have A1, A2, A3, B1, B2, B3

      const allTasks = [taskA1, taskA2, taskA3, taskB1, taskB2, taskB3];

      console.log('Verifying all tasks on Client A');
      for (const task of allTasks) {
        await waitForTask(clientA.page, task);
        await expectTaskVisible(clientA, task);
      }

      console.log('Verifying all tasks on Client B');
      for (const task of allTasks) {
        await waitForTask(clientB.page, task);
        await expectTaskVisible(clientB, task);
      }
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Multiple clients with existing data joining SuperSync
   *
   * This test reproduces the critical bug where multiple clients with existing data
   * could each create a SYNC_IMPORT when enabling SuperSync, causing data loss.
   *
   * The bug scenario:
   * - Client 1 has existing data, enables sync → creates SYNC_IMPORT_1
   * - Client 2 has existing data, enables sync → creates SYNC_IMPORT_2 (BUG!)
   * - Client 3 has existing data, enables sync → creates SYNC_IMPORT_3 (BUG!)
   * - Only SYNC_IMPORT_3 survives, all data from Clients 1 and 2 is lost
   *
   * Expected behavior (with fix):
   * - Client 1 enables sync → creates SYNC_IMPORT (server was empty)
   * - Client 2 enables sync → server already has SYNC_IMPORT → downloads and merges
   * - Client 3 enables sync → same as Client 2
   * - All clients end up with ALL data from all three clients
   */
  test('Multiple clients with existing data all merge correctly when joining', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let clientC: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // === PHASE 1: Each client creates local data WITHOUT syncing ===
      console.log('[Test] Phase 1: Creating clients with local data (no sync yet)');

      // Client A creates local tasks
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      const taskA1 = `A1-${testRunId}`;
      const taskA2 = `A2-${testRunId}`;
      await clientA.workView.addTask(taskA1);
      await clientA.workView.addTask(taskA2);
      await waitForTask(clientA.page, taskA1);
      await waitForTask(clientA.page, taskA2);
      console.log('[Test] Client A created 2 local tasks');

      // Client B creates local tasks
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      const taskB1 = `B1-${testRunId}`;
      const taskB2 = `B2-${testRunId}`;
      await clientB.workView.addTask(taskB1);
      await clientB.workView.addTask(taskB2);
      await waitForTask(clientB.page, taskB1);
      await waitForTask(clientB.page, taskB2);
      console.log('[Test] Client B created 2 local tasks');

      // Client C creates local tasks
      clientC = await createSimulatedClient(browser, baseURL!, 'C', testRunId);
      const taskC1 = `C1-${testRunId}`;
      const taskC2 = `C2-${testRunId}`;
      await clientC.workView.addTask(taskC1);
      await clientC.workView.addTask(taskC2);
      await waitForTask(clientC.page, taskC1);
      await waitForTask(clientC.page, taskC2);
      console.log('[Test] Client C created 2 local tasks');

      // === PHASE 2: Clients enable sync one by one ===
      console.log('[Test] Phase 2: Enabling sync on each client');

      // Client A enables sync first (should create SYNC_IMPORT since server is empty)
      console.log('[Test] Client A enabling sync (first to sync)...');
      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.sync.syncAndWait();
      console.log('[Test] Client A synced');

      // Client B enables sync second (should download A's SYNC_IMPORT, NOT create new one)
      console.log('[Test] Client B enabling sync (second to sync)...');
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      // Handle potential conflict dialogs
      const conflictDialogB = clientB.page.locator('dialog-conflict-resolution');
      try {
        await conflictDialogB.waitFor({ state: 'visible', timeout: 2000 });
        console.log('[Test] Conflict dialog on B, resolving...');
        const useRemoteBtn = conflictDialogB
          .locator('button')
          .filter({ hasText: 'Remote' })
          .first();
        if (await useRemoteBtn.isVisible()) {
          await useRemoteBtn.click();
          await conflictDialogB.waitFor({ state: 'hidden', timeout: 5000 });
        }
      } catch {
        // No conflict dialog, proceed
      }
      await clientB.sync.syncAndWait();
      console.log('[Test] Client B synced');

      // Client C enables sync third (should also merge, NOT create SYNC_IMPORT)
      console.log('[Test] Client C enabling sync (third to sync)...');
      await clientC.sync.setupSuperSync(syncConfig);
      await clientC.sync.syncAndWait();
      // Handle potential conflict dialogs
      const conflictDialogC = clientC.page.locator('dialog-conflict-resolution');
      try {
        await conflictDialogC.waitFor({ state: 'visible', timeout: 2000 });
        console.log('[Test] Conflict dialog on C, resolving...');
        const useRemoteBtn = conflictDialogC
          .locator('button')
          .filter({ hasText: 'Remote' })
          .first();
        if (await useRemoteBtn.isVisible()) {
          await useRemoteBtn.click();
          await conflictDialogC.waitFor({ state: 'hidden', timeout: 5000 });
        }
      } catch {
        // No conflict dialog, proceed
      }
      await clientC.sync.syncAndWait();
      console.log('[Test] Client C synced');

      // === PHASE 3: All clients sync to get each other's data ===
      console.log('[Test] Phase 3: Final sync round');
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientC.sync.syncAndWait();

      // Brief wait for state to settle
      await clientA.page.waitForTimeout(1000);

      // === PHASE 4: Verification ===
      console.log('[Test] Phase 4: Verifying all clients have all data');

      const allTasks = [taskA1, taskA2, taskB1, taskB2, taskC1, taskC2];

      // Verify Client A has all 6 tasks
      console.log('[Test] Verifying Client A has all tasks...');
      for (const task of allTasks) {
        await waitForTask(clientA.page, task);
        await expectTaskVisible(clientA, task);
      }

      // Verify Client B has all 6 tasks
      console.log('[Test] Verifying Client B has all tasks...');
      for (const task of allTasks) {
        await waitForTask(clientB.page, task);
        await expectTaskVisible(clientB, task);
      }

      // Verify Client C has all 6 tasks
      console.log('[Test] Verifying Client C has all tasks...');
      for (const task of allTasks) {
        await waitForTask(clientC.page, task);
        await expectTaskVisible(clientC, task);
      }

      // Additional verification - count tasks to ensure no duplicates or missing
      const taskLocatorA = clientA.page.locator(`task:has-text("${testRunId}")`);
      const taskCountA = await taskLocatorA.count();
      expect(taskCountA).toBe(6);

      const taskLocatorB = clientB.page.locator(`task:has-text("${testRunId}")`);
      const taskCountB = await taskLocatorB.count();
      expect(taskCountB).toBe(6);

      const taskLocatorC = clientC.page.locator(`task:has-text("${testRunId}")`);
      const taskCountC = await taskLocatorC.count();
      expect(taskCountC).toBe(6);

      console.log('[Test] SUCCESS: All 3 clients with existing data merged correctly');
    } finally {
      if (clientA) await closeClient(clientA).catch(() => {});
      if (clientB) await closeClient(clientB).catch(() => {});
      if (clientC) await closeClient(clientC).catch(() => {});
    }
  });
});
