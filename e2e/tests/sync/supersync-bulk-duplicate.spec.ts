import { test, expect } from '../../fixtures/supersync.fixture';
import type { Locator } from '@playwright/test';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  getSubtaskElement,
  getTaskElement,
  renameTask,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

const rootRows = (client: SimulatedE2EClient): Locator =>
  client.page.locator('.task-list-inner[data-id="UNDONE"] > task');

const rootIds = (client: SimulatedE2EClient): Promise<string[]> =>
  rootRows(client).evaluateAll((rows) =>
    rows.map((row) => row.getAttribute('data-task-id')!),
  );

interface TaskTreeItem {
  id: string;
  title: string;
  parentId: string | null;
  subTaskIds: string[];
}

const taskTree = (client: SimulatedE2EClient): Promise<TaskTreeItem[]> =>
  client.page.locator('task').evaluateAll((rows) =>
    rows.map((row) => ({
      id: row.getAttribute('data-task-id')!,
      title: row.querySelector('task-title')!.textContent!.trim(),
      parentId: row.parentElement?.closest('task')?.getAttribute('data-task-id') ?? null,
      subTaskIds: Array.from(row.querySelectorAll('.sub-tasks task')).map(
        (child) => child.getAttribute('data-task-id')!,
      ),
    })),
  );

const duplicate = async (
  client: SimulatedE2EClient,
  ids: string[],
  trigger: 'menu' | 'shortcut',
): Promise<void> => {
  for (const id of ids) {
    await client.page
      .locator(`task[data-task-id="${id}"] task-title`)
      .first()
      .click({ modifiers: ['Control'] });
  }
  const bar = client.page.locator('task-multi-select-bar .bar');
  await expect(bar).toContainText(`${ids.length} selected`);
  if (trigger === 'menu') {
    await bar.getByRole('button', { name: 'Actions' }).click();
    await client.page.getByRole('menuitem', { name: /Duplicate/ }).click();
  } else {
    await client.page.keyboard.press('Control+d');
  }
};

test.describe('@supersync bulk duplication', () => {
  for (const trigger of ['menu', 'shortcut'] as const) {
    test(`replicates ${trigger} copies and preserves a concurrent remote edit`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      test.setTimeout(240000);
      const clients: SimulatedE2EClient[] = [];
      try {
        const user = await createTestUser(testRunId);
        const config = getSuperSyncConfig(user);
        const appUrl = baseURL || 'http://localhost:4242';
        const clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
        clients.push(clientA);
        await clientA.sync.setupSuperSync(config);
        const parentTitle = `Parent-${testRunId}`;
        const childTitle = `Child-${testRunId}`;
        const otherTitle = `Other-${testRunId}`;
        const remoteTitle = `Remote-${testRunId}`;
        for (const title of [parentTitle, otherTitle, remoteTitle]) {
          await clientA.workView.addTask(title);
          await waitForTask(clientA.page, title);
        }
        const parent = getTaskElement(clientA, parentTitle);
        await clientA.workView.addSubTask(parent, childTitle);
        const parentId = (await parent.getAttribute('data-task-id'))!;
        const childId = (await getSubtaskElement(clientA, childTitle).getAttribute(
          'data-task-id',
        ))!;
        const otherId = (await getTaskElement(clientA, otherTitle).getAttribute(
          'data-task-id',
        ))!;
        const remoteId = (await getTaskElement(clientA, remoteTitle).getAttribute(
          'data-task-id',
        ))!;
        const originals = await rootIds(clientA);
        await clientA.sync.syncAndWait();

        const clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
        clients.push(clientB);
        await clientB.sync.setupSuperSync(config);
        await clientB.sync.syncAndWait();
        await waitForTask(clientB.page, childTitle);
        expect(await rootIds(clientB)).toEqual(originals);

        // Both clients change independently before exchanging their new operations.
        await duplicate(clientA, [parentId, childId, otherId], trigger);
        await expect(rootRows(clientA)).toHaveCount(5);
        const duplicated = await rootIds(clientA);
        expect(new Set(duplicated).size).toBe(5);
        const copies = [parentId, otherId].map(
          (id) => duplicated[duplicated.indexOf(id) + 1],
        );
        for (const copyId of copies) {
          expect(copyId).toBeTruthy();
          expect(originals).not.toContain(copyId);
        }
        const parentCopy = clientA.page.locator(`task[data-task-id="${copies[0]}"]`);
        await expect(parentCopy.locator('.sub-tasks task')).toHaveCount(1);
        await expect(parentCopy.locator('.sub-tasks task task-title')).toHaveText([
          childTitle,
        ]);
        for (const id of [parentId, childId, otherId]) {
          await expect(clientA.page.locator(`task[data-task-id="${id}"]`)).toHaveClass(
            /isMultiSelected/,
          );
        }
        await clientA.page.keyboard.press('Escape');
        const expectedTree = (await taskTree(clientA)).map((task) => ({
          ...task,
          title: task.id === remoteId ? `${remoteTitle}-edited` : task.title,
        }));
        await renameTask(clientB, remoteTitle, `${remoteTitle}-edited`);
        await clientA.sync.syncAndWait();
        await clientB.sync.syncAndWait();
        await clientA.sync.syncAndWait();
        for (const client of clients) {
          expect(await rootIds(client)).toEqual(duplicated);
          await waitForTask(client.page, `${remoteTitle}-edited`);
          await expect(client.page.locator('task')).toHaveCount(7);
          expect(await taskTree(client)).toEqual(expectedTree);
          await expect(
            client.page.locator(`task[data-task-id="${copies[0]}"] .sub-tasks task`),
          ).toHaveCount(1);
        }

        await duplicate(clientB, copies, trigger === 'menu' ? 'shortcut' : 'menu');
        await expect(rootRows(clientB)).toHaveCount(7);
        const twiceDuplicated = await rootIds(clientB);
        expect(new Set(twiceDuplicated).size).toBe(7);
        for (const id of copies) {
          const sourceIndex = twiceDuplicated.indexOf(id);
          expect(sourceIndex).toBeGreaterThanOrEqual(0);
          const newCopy = twiceDuplicated[sourceIndex + 1];
          expect(newCopy).toBeTruthy();
          expect(duplicated).not.toContain(newCopy);
        }
        await clientB.page.keyboard.press('Escape');
        const finalTree = await taskTree(clientB);
        await clientB.sync.syncAndWait();
        await clientA.sync.syncAndWait();
        expect(await rootIds(clientA)).toEqual(twiceDuplicated);
        await expect(clientA.page.locator('task')).toHaveCount(10);
        expect(await taskTree(clientA)).toEqual(finalTree);
        await clientB.page.reload();
        await clientB.workView.waitForTaskList();
        expect(await rootIds(clientB)).toEqual(twiceDuplicated);
        await expect(clientB.page.locator('task')).toHaveCount(10);
        expect(await taskTree(clientB)).toEqual(finalTree);
        await waitForTask(clientB.page, `${remoteTitle}-edited`);
      } finally {
        for (const client of clients) await closeClient(client);
      }
    });
  }
});
