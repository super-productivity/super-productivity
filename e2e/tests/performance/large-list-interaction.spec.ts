import { expect, test } from '../../fixtures/test.fixture';
import type { Page } from '@playwright/test';
import { waitForAppReady } from '../../utils/waits';

const LARGE_LIST_TASK_COUNT = 200;
const MAX_BATCH_OPERATIONS_SIZE = 50;

const seedProjectTasks = async (
  page: Page,
  projectId: string,
  taskIdPrefix: string,
): Promise<void> => {
  await page.evaluate(
    ({ batchSize, idPrefix, projectId: targetProjectId, taskCount }) => {
      type StoreLike = {
        dispatch: (action: unknown) => void;
      };
      type E2ETestHelpers = {
        store?: StoreLike;
      };

      const store = (
        window as unknown as {
          __e2eTestHelpers?: E2ETestHelpers;
        }
      ).__e2eTestHelpers?.store;
      if (!store) {
        throw new Error('__e2eTestHelpers.store missing');
      }

      const operations = Array.from({ length: taskCount }, (_, index) => ({
        type: 'create',
        tempId: `temp-${index}`,
        data: { title: `Large list seed ${index + 1}` },
      }));
      const createdTaskIds = Object.fromEntries(
        operations.map(({ tempId }, index) => [
          tempId,
          `${idPrefix}${String(index).padStart(3, '0')}`,
        ]),
      );

      for (let offset = 0; offset < operations.length; offset += batchSize) {
        store.dispatch({
          type: '[Task Shared] batchUpdateForProject',
          projectId: targetProjectId,
          operations: operations.slice(offset, offset + batchSize),
          createdTaskIds,
          createdTaskTimestamp: 1_750_000_000_000,
          meta: {
            isPersistent: true,
            entityType: 'PROJECT',
            entityId: targetProjectId,
            opType: 'BATCH',
          },
        });
      }
    },
    {
      batchSize: MAX_BATCH_OPERATIONS_SIZE,
      idPrefix: taskIdPrefix,
      projectId,
      taskCount: LARGE_LIST_TASK_COUNT,
    },
  );
};

test.describe('Large task-list interaction', () => {
  test('reuses existing task rows when a task is added', async ({
    page,
    workViewPage,
    projectPage,
    taskPage,
    testPrefix,
  }) => {
    const projectName = 'Large list project';
    await projectPage.createProject(projectName);
    await projectPage.navigateToProjectByName(projectName);
    await workViewPage.waitForTaskList();

    const projectIdMatch = page.url().match(/#\/project\/([^/]+)\/tasks/);
    expect(projectIdMatch).not.toBeNull();
    const projectId = decodeURIComponent(projectIdMatch![1]);
    const taskIdPrefix = `${testPrefix}-large-list-`;
    await seedProjectTasks(page, projectId, taskIdPrefix);

    const seededRows = page.locator(`task[data-task-id^="${taskIdPrefix}"]`);
    await expect(seededRows).toHaveCount(LARGE_LIST_TASK_COUNT, { timeout: 20000 });
    await seededRows.evaluateAll((rows) => {
      rows.forEach((row) => {
        const taskId = row.getAttribute('data-task-id');
        if (!taskId) {
          throw new Error('Seeded task row is missing data-task-id');
        }
        row.setAttribute('data-e2e-original-task-id', taskId);
      });
    });

    const addedTaskTitle = `${testPrefix}-Large list user task`;
    await workViewPage.addTask(addedTaskTitle);
    const addedTask = taskPage.getTaskByText(addedTaskTitle);
    await expect(addedTask).toHaveCount(1);
    const addedTaskId = await addedTask.getAttribute('data-task-id');
    expect(addedTaskId).not.toBeNull();
    await expect(page.locator('task')).toHaveCount(LARGE_LIST_TASK_COUNT + 1);
    await expect(page.locator('task').first()).toContainText(addedTaskTitle);

    const replacedTaskIds = await seededRows.evaluateAll((rows) =>
      rows
        .filter(
          (row) =>
            row.getAttribute('data-e2e-original-task-id') !==
            row.getAttribute('data-task-id'),
        )
        .map((row) => row.getAttribute('data-task-id')),
    );
    expect(replacedTaskIds).toEqual([]);

    await page.waitForFunction(
      (targetTaskId) =>
        new Promise<boolean>((resolve) => {
          const openRequest = indexedDB.open('SUP_OPS');
          openRequest.onerror = () => resolve(false);
          openRequest.onsuccess = () => {
            const db = openRequest.result;
            const transaction = db.transaction('ops', 'readonly');
            const getAllRequest = transaction.objectStore('ops').getAll();
            getAllRequest.onerror = () => {
              db.close();
              resolve(false);
            };
            getAllRequest.onsuccess = () => {
              const entries = getAllRequest.result as {
                op?: { d?: string; entityId?: string };
              }[];
              db.close();
              resolve(
                entries.some(
                  ({ op }) => op?.d === targetTaskId || op?.entityId === targetTaskId,
                ),
              );
            };
          };
        }),
      addedTaskId,
      { timeout: 10000 },
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    await expect(page.locator(`task[data-task-id^="${taskIdPrefix}"]`)).toHaveCount(
      LARGE_LIST_TASK_COUNT,
    );
    await expect(taskPage.getTaskByText(addedTaskTitle)).toHaveCount(1);
    await expect(page.locator('task')).toHaveCount(LARGE_LIST_TASK_COUNT + 1);
  });
});
