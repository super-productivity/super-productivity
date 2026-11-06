import { test, expect } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSubtaskElement,
  getSuperSyncConfig,
  getTaskElement,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import type { Page } from '@playwright/test';
import { waitForAppReady } from '../../utils/waits';

type Completion = { isDone: boolean; doneOn?: number };
const readCompletion = (page: Page, taskId: string): Promise<Completion> =>
  page.evaluate(async (id) => {
    const { store } = (
      window as unknown as {
        __e2eTestHelpers: {
          store: {
            subscribe: (
              cb: (state: { tasks: { entities: Record<string, Completion> } }) => void,
            ) => { unsubscribe: () => void };
          };
        };
      }
    ).__e2eTestHelpers;
    return new Promise<Completion>((resolve) => {
      const subscription = store.subscribe((state) => {
        window.setTimeout(() => subscription.unsubscribe());
        const task = state.tasks.entities[id];
        resolve({ isDone: task.isDone, doneOn: task.doneOn });
      });
    });
  }, taskId);

// #9904 / #9916: setCurrentTask used to reopen the task only in local state.
// The second device must receive a persistent update, including clearing doneOn.
test.describe('@supersync Starting a completed task (#9904)', () => {
  for (const withSubtask of [false, true]) {
    test(`reopening ${withSubtask ? 'a completed subtask by starting its parent' : 'a completed task'} syncs and survives reload`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      let clientA: SimulatedE2EClient | undefined;
      let clientB: SimulatedE2EClient | undefined;
      try {
        const config = getSuperSyncConfig(await createTestUser(testRunId));
        clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
        await clientA.sync.setupSuperSync(config);
        clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
        await clientB.sync.setupSuperSync(config);

        await clientA.workView.waitForTaskList();
        const parentName = `Parent-${testRunId}`;
        const taskName = withSubtask ? `Child-${testRunId}` : parentName;
        await clientA.workView.addTask(parentName);
        if (withSubtask) {
          await clientA.workView.addSubTask(
            getTaskElement(clientA, parentName),
            taskName,
          );
        }
        const taskId = await getSubtaskElement(clientA, taskName).getAttribute(
          'data-task-id',
        );
        expect(taskId).toBeTruthy();
        const parent = getTaskElement(clientA, parentName).first();
        const leaf = getSubtaskElement(clientA, taskName).first();
        await leaf.focus();
        await leaf.press('d');
        await expect(getSubtaskElement(clientA, taskName).first()).toHaveClass(/isDone/);
        await clientA.sync.syncAndWait();
        await clientB.sync.syncAndWait();

        // Control: B really received the completion before A starts tracking.
        await clientB.page.reload();
        await waitForAppReady(clientB.page);
        const completed = await readCompletion(clientB.page, taskId!);
        expect(completed).toMatchObject({ isDone: true, doneOn: expect.any(Number) });

        // Completed rows have no play button; the supported Y shortcut starts
        // them directly without first toggling completion by hand.
        await parent.focus();
        await parent.press('y');
        const startedTask = getSubtaskElement(clientA, taskName).first();
        await expect(startedTask).toHaveClass(/isCurrent/);
        await expect(startedTask).not.toHaveClass(/isDone/);
        await startedTask.focus();
        await startedTask.press('y');
        await expect(startedTask).not.toHaveClass(/isCurrent/);
        await clientA.sync.syncAndWait();
        await clientB.sync.syncAndWait();

        // The old reducer-only change left B done forever, even though sync
        // reported success. Tracking itself must remain local to A.
        const remoteTask = getSubtaskElement(clientB, taskName).first();
        await expect(remoteTask).toBeVisible();
        await expect(remoteTask).not.toHaveClass(/isDone/);
        await expect(clientB.page.locator('task.isCurrent')).toHaveCount(0);
        await clientB.page.reload();
        await waitForAppReady(clientB.page);
        await expect(remoteTask).not.toHaveClass(/isDone/);
        const reopened = await readCompletion(clientB.page, taskId!);
        expect(reopened.isDone).toBe(false);
        expect(reopened.doneOn).toBeUndefined();
      } finally {
        if (clientA) await closeClient(clientA);
        if (clientB) await closeClient(clientB);
      }
    });
  }
});
