import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * Issue #9776 — clearing a field with `undefined` was dropped by
 * JSON.stringify on the sync wire, so the change never replayed on other
 * devices.
 *
 * Reproducible one-click case: the subtask collapse state
 * (`_hideSubTasksMode`). Collapsing writes a real enum value (HideAll = 2)
 * and always synced. Expanding writes `undefined`, whose key was dropped
 * from the op payload — so the remote device stayed collapsed forever
 * ("my subtasks disappeared on my phone").
 *
 * The fix carries cleared keys out-of-band in `clearedFields`
 * (src/app/util/cleared-update-fields.ts); this test proves the full
 * two-client round trip through a real SuperSync server:
 *
 * 1. Client A creates a parent with one subtask; both clients sync.
 * 2. A collapses (chevron) -> sync -> B is collapsed too (control:
 *    proves collapse state syncs at all).
 * 3. A expands (chevron) -> sync -> B MUST show the subtask again
 *    (the direction that was broken).
 */

const addSubtask = async (
  page: SimulatedE2EClient['page'],
  parentTaskName: string,
  subtaskTitle: string,
): Promise<void> => {
  const parentTask = page.locator(`task:has-text("${parentTaskName}")`).first();
  await parentTask.waitFor({ state: 'visible', timeout: 10000 });

  // Focus the task and use keyboard shortcut 'a' to add a subtask
  await parentTask.focus();
  await page.waitForTimeout(100);
  await parentTask.press('a');

  const draftInput = page.locator('.e2e-add-subtask-input');
  await draftInput.waitFor({ state: 'visible', timeout: 5000 });
  await draftInput.fill(subtaskTitle);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await draftInput.waitFor({ state: 'detached', timeout: 5000 });

  await waitForTask(page, subtaskTitle);
  await page.waitForTimeout(200);
};

/** The chevron on the parent cycles Show -> HideAll -> Show (isEndless). */
const clickSubTaskToggle = async (
  page: SimulatedE2EClient['page'],
  parentTaskName: string,
): Promise<void> => {
  const toggleBtn = page
    .locator(`task:not(.hasNoSubTasks):has-text("${parentTaskName}")`)
    .first()
    .locator('.toggle-sub-tasks-btn');
  await toggleBtn.waitFor({ state: 'visible', timeout: 10000 });
  await toggleBtn.click();
};

const subtaskLocator = (
  page: SimulatedE2EClient['page'],
  subtaskName: string,
): ReturnType<SimulatedE2EClient['page']['locator']> =>
  page.locator(`task.hasNoSubTasks:has-text("${subtaskName}")`);

test.describe('@supersync Clear field via undefined (#9776)', () => {
  test('expanding subtasks on A syncs the cleared _hideSubTasksMode to B', async ({
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

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // 1. Client A creates parent + subtask, both clients sync
      const parentName = `Parent-${testRunId}`;
      const subName = `Sub-${testRunId}`;
      await clientA.workView.addTask(parentName);
      await waitForTask(clientA.page, parentName);
      await addSubtask(clientA.page, parentName, subName);

      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, parentName);
      await expect(subtaskLocator(clientB.page, subName)).toBeVisible({
        timeout: 10000,
      });
      console.log('[ClearField9776] Both clients see parent + subtask');

      // 2. CONTROL: collapse on A -> B collapses too (HideAll is a real
      // enum value and synced even before the fix)
      await clickSubTaskToggle(clientA.page, parentName);
      await expect(subtaskLocator(clientA.page, subName)).toBeHidden({
        timeout: 10000,
      });
      await clientA.page.waitForTimeout(500); // let op-log capture settle
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await expect(subtaskLocator(clientB.page, subName)).toBeHidden({
        timeout: 10000,
      });
      console.log('[ClearField9776] Collapse synced A -> B (control)');

      // 3. THE BUG: expand on A -> B must expand too. Before the fix the
      // expand op serialized to changes: {} and B stayed collapsed.
      await clickSubTaskToggle(clientA.page, parentName);
      await expect(subtaskLocator(clientA.page, subName)).toBeVisible({
        timeout: 10000,
      });
      await clientA.page.waitForTimeout(500); // let op-log capture settle
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await expect(subtaskLocator(clientB.page, subName)).toBeVisible({
        timeout: 10000,
      });
      console.log('[ClearField9776] ✓ Expand synced A -> B');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
