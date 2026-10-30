import { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { ProjectPage } from '../../pages/project.page';
import {
  installFakePlainspace,
  PLAINSPACE_HOST,
  PLAINSPACE_SPACE,
} from '../../utils/plainspace-fake';

/**
 * A device that joins via SuperSync gets the Plainspace provider and its
 * linked task with its first sync. It must then pull collaborators' changes,
 * on the timer and when the user looks at the app, without ever switching
 * project or tag: the update poll used to start only on a session's first
 * context switch or local `loadAllData`, and this device dispatches neither.
 */

const TASK_ID = 'task-1';

const blockBackgroundSync = (): void => {
  const flags = globalThis as typeof globalThis & Record<string, boolean>;
  flags['__SP_E2E_BLOCK_AUTO_SYNC'] = true;
  flags['__SP_E2E_BLOCK_WS_DOWNLOAD'] = true;
  flags['__SP_E2E_BLOCK_IMMEDIATE_UPLOAD'] = true;
};

/**
 * addPlainspaceProvider() for a SuperSync client: its Advanced Config section
 * can already be open, so it is only expanded when the project select is hidden.
 */
const addPlainspaceProvider = async (page: Page, projectName: RegExp): Promise<void> => {
  await page.locator('.e2e-toggle-issue-provider-panel').click();
  await expect(page.locator('issue-panel')).toBeVisible();
  await page.locator('issue-panel .mat-mdc-tab').last().click();
  await page.getByRole('button', { name: 'Plainspace', exact: true }).click();
  const editDialog = page.locator('dialog-edit-issue-provider');
  await editDialog.locator('input[id*="host"]').fill(PLAINSPACE_HOST);
  await editDialog.locator('input[id*="spaceId"]').fill(PLAINSPACE_SPACE.id);
  await editDialog.locator('input[id*="token"]').fill('pat_e2e');
  const projectSelect = editDialog.locator('mat-select[id*="defaultProjectId"]');
  if (!(await projectSelect.isVisible())) {
    await editDialog.getByRole('button', { name: /Advanced Config/i }).click();
  }
  await projectSelect.click();
  await page.getByRole('option', { name: projectName }).click();
  await editDialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editDialog).toBeHidden();
  await page.locator('.e2e-toggle-issue-provider-panel').click();
};

/** Title of the task linked to Plainspace's TASK_ID, from the live store. */
const linkedTitle = (page: Page): Promise<string | undefined> =>
  page.evaluate(async (issueId) => {
    type StoreLike = {
      subscribe: (next: (state: unknown) => void) => { unsubscribe: () => void };
    };
    interface TaskLike {
      title: string;
      issueId?: string;
    }
    type State = { tasks?: { entities?: Record<string, TaskLike | undefined> } };
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) {
      return undefined;
    }
    const state = await new Promise<State>((resolve) => {
      const sub = store.subscribe((s) => {
        resolve(s as State);
        setTimeout(() => sub.unsubscribe());
      });
    });
    return Object.values(state.tasks?.entities ?? {}).find((t) => t?.issueId === issueId)
      ?.title;
  }, TASK_ID);

test.describe('@supersync Plainspace update poll on a device that joined via sync', () => {
  test.setTimeout(240000);

  test('pulls collaborator changes on the timer and on focus while staying on Today', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let a: SimulatedE2EClient | null = null;
    let b: SimulatedE2EClient | null = null;
    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // A shares a project with one Plainspace task and syncs it.
      a = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      const server = await installFakePlainspace(a.page);
      server.addAssignedTask(TASK_ID, 'Buy tent');
      await a.sync.setupSuperSync(syncConfig);
      await a.page.evaluate(blockBackgroundSync);
      await new ProjectPage(a.page).createProject('Camping');
      // Opened outside the project, the setup dialog asks for the default project.
      await a.page.goto('/#/tag/TODAY/work');
      await a.workView.waitForTaskList();
      await addPlainspaceProvider(a.page, /Camping/);
      await expect.poll(() => linkedTitle(a!.page), { timeout: 30000 }).toBe('Buy tent');
      await a.sync.syncAndWait();

      // A collaborator renames it before B joins.
      server.remoteEdit(TASK_ID, { title: 'Buy big tent' });

      // B joins and gets the provider and the task with its first sync. It
      // stays on Today throughout.
      b = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await installFakePlainspace(b.page, server);
      await b.sync.setupSuperSync(syncConfig);
      await b.page.evaluate(blockBackgroundSync);

      // The timer's first poll (8 s after the provider arrives) pulls it.
      await expect
        .poll(() => linkedTitle(b!.page), { timeout: 30000 })
        .toBe('Buy big tent');

      // Another rename; looking at the app pulls it.
      server.remoteEdit(TASK_ID, { title: 'Buy the green tent' });
      await b.page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect
        .poll(() => linkedTitle(b!.page), { timeout: 15000 })
        .toBe('Buy the green tent');
      expect(b.page.url()).toContain('/tag/TODAY/');
    } finally {
      if (a) await closeClient(a);
      if (b) await closeClient(b);
    }
  });
});
