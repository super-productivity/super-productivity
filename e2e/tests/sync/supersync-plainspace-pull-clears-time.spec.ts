import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { ProjectPage } from '../../pages/project.page';
import {
  addPlainspaceProvider,
  installFakePlainspace,
  successfulPolls,
  waitForPollAfter,
} from '../../utils/plainspace-fake';

const TASK_ID = 'task-1';
const REMOTE_TIME = '2026-11-03T14:30:00.000Z';

/** The task's `dueWithTime` as this client's store has it, or null. */
const dueWithTime = (page: Page): Promise<number | null> =>
  page.evaluate((issueId) => {
    type TaskLike = { issueId?: string; dueWithTime?: number };
    type StoreLike = {
      subscribe: (
        next: (state: { tasks: { entities: Record<string, TaskLike> } }) => void,
      ) => { unsubscribe: () => void };
    };
    const store = (window as unknown as { __e2eTestHelpers: { store: StoreLike } })
      .__e2eTestHelpers.store;
    let task: TaskLike | undefined;
    store
      .subscribe((state) => {
        task = Object.values(state.tasks.entities).find((t) => t?.issueId === issueId);
      })
      .unsubscribe();
    return task?.dueWithTime ?? null;
  }, TASK_ID);

/**
 * Review finding: a time removed in Plainspace is pulled as
 * `dueWithTime: undefined`, which JSON drops from the op (#9776). The device
 * that pulled it has no time; my other devices kept the old one for good.
 */
test.describe('@supersync Plainspace: a time removed in Plainspace', () => {
  test('is removed on my other devices too', async ({ browser, baseURL, testRunId }) => {
    test.setTimeout(240000);
    const appUrl = baseURL || 'http://localhost:4242';
    const projectName = `Camping ${testRunId}`;
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const syncConfig = getSuperSyncConfig(await createTestUser(testRunId));

      // A shares a project; the Plainspace task has a time.
      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      const server = await installFakePlainspace(clientA.page);
      server.addAssignedTask(TASK_ID, 'Buy tent');
      server.remoteEdit(TASK_ID, { scheduledAt: REMOTE_TIME });
      const projectPageA = new ProjectPage(clientA.page);
      await projectPageA.createProject(projectName);
      await addPlainspaceProvider(clientA.page, projectName);
      await projectPageA.navigateToProjectByName(projectName);
      await expect
        .poll(() => dueWithTime(clientA!.page), { timeout: 30000 })
        .toBe(Date.parse(REMOTE_TIME));
      await clientA.sync.setupSuperSync(syncConfig);
      await clientA.sync.syncAndWait();

      // B gets it through SuperSync only: its Plainspace polls fail.
      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      const serverB = await installFakePlainspace(clientB.page);
      serverB.isTasksOffline = true;
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      await expect
        .poll(() => dueWithTime(clientB!.page), { timeout: 30000 })
        .toBe(Date.parse(REMOTE_TIME));

      // Someone removes the time in Plainspace; A pulls it.
      server.remoteEdit(TASK_ID, { scheduledAt: null });
      const before = successfulPolls(server);
      await clientA.page.reload();
      await waitForPollAfter(clientA.page, server, before);
      await expect.poll(() => dueWithTime(clientA!.page)).toBeNull();
      await clientA.sync.syncAndWait();

      // B follows.
      await clientB.sync.syncAndWait();
      await expect.poll(() => dueWithTime(clientB!.page)).toBeNull();
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
