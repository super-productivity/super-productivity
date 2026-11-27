import { CURRENT_SCHEMA_VERSION } from '@sp/shared-schema';
import { type Locator, type Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';

/**
 * An archived task found through Search can be brought back from its details
 * dialog, without looking it up again in History (2026-11 user survey: "could
 * not find completed or archived tasks" / "wanted to undo a mistake").
 */

const finishDay = async (page: Page): Promise<void> => {
  await page.locator('.e2e-finish-day').click();
  await page.waitForURL(/daily-summary/);
  const saveBtn = page.locator(
    'daily-summary button[mat-flat-button][color="primary"]:last-of-type',
  );
  // Archiving navigates back to Today asynchronously; wait for it to settle.
  await Promise.all([
    page.waitForURL(/#\/tag\/TODAY\/tasks/, { timeout: 15000 }),
    saveBtn.click(),
  ]);
  await expect(page.locator('task-list').first()).toBeVisible();
};

const searchIncludingCompleted = async (page: Page, term: string): Promise<Locator> => {
  await page.keyboard.press('Shift+F');
  await expect(page).toHaveURL(/\/#\/search$/);
  await page.locator('search-page .search-field input').fill(term);
  await page.locator('search-page .include-completed-toggle input').check();
  return page.locator('search-page mat-list-item').filter({ hasText: term });
};

type TaskSnapshot = {
  id: string;
  title: string;
  dueWithTime?: number;
  remindAt?: number;
};

const readLiveTask = (page: Page, title: string): Promise<TaskSnapshot | undefined> =>
  page.evaluate((name) => {
    type State = { tasks: { entities: Record<string, TaskSnapshot> } };
    type Store = { subscribe: (fn: (s: State) => void) => { unsubscribe: () => void } };
    const { store } = (window as unknown as { __e2eTestHelpers: { store: Store } })
      .__e2eTestHelpers;
    let task: TaskSnapshot | undefined;
    store
      .subscribe((s) => {
        task = Object.values(s.tasks.entities).find((t) => t.title.includes(name));
      })
      .unsubscribe();
    return task;
  }, title);

test.describe('Global Search: restore an archived task', () => {
  test('restores an archived task from its details dialog', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const taskName = `${testPrefix}-ArchivedByMistake`;
    await workViewPage.addTask(taskName);
    await taskPage.markTaskAsDone(taskPage.getTaskByText(taskName));
    await finishDay(page);
    await expect(taskPage.getTaskByText(taskName)).toHaveCount(0);

    const archivedResult = await searchIncludingCompleted(page, taskName);
    await expect(archivedResult).toHaveCount(1);
    await archivedResult.locator('.view-details-btn').click();

    const detailsDialog = page.locator('dialog-view-archived-task');
    await expect(detailsDialog).toContainText(taskName);
    // Activated by keyboard: the action must not need a pointer.
    await detailsDialog.locator('.e2e-restore-archived-task').focus();
    await page.keyboard.press('Enter');
    await page.locator('dialog-confirm [e2e="confirmBtn"]').click();

    // The dialog closes and the task is back in the list as an open task.
    await expect(page).toHaveURL(/\/#\/tag\/TODAY\/tasks/);
    await expect(detailsDialog).toHaveCount(0);
    await expect(taskPage.getUndoneTasks().filter({ hasText: taskName })).toHaveCount(1);

    // Search no longer lists it as archived. Search reads the archive once when
    // it opens and the restore leaves the archive asynchronously, so reopen it
    // until the archived copy is gone.
    await expect(async () => {
      await page.goto('/#/tag/TODAY/tasks');
      await workViewPage.waitForTaskList();
      const restoredResult = await searchIncludingCompleted(page, taskName);
      await expect(restoredResult).toHaveCount(1, { timeout: 2000 });
      await expect(restoredResult.locator('.view-details-btn')).toHaveCount(0, {
        timeout: 2000,
      });
    }).toPass({ timeout: 15000 });
  });

  test('preserves a schedule received while the restore confirmation is open', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const title = `${testPrefix}-RemoteRestore`;
    await workViewPage.addTask(title);
    await taskPage.markTaskAsDone(taskPage.getTaskByText(title));
    const task = (await readLiveTask(page, title))!;
    await finishDay(page);
    const result = await searchIncludingCompleted(page, title);
    await result.locator('.view-details-btn').click();
    await page.locator('.e2e-restore-archived-task').click();
    const confirm = page.locator('dialog-confirm [e2e="confirmBtn"]');
    await expect(confirm).toBeVisible();

    const twoDays = 2 * 86_400_000;
    const dueWithTime = Date.now() + twoDays;
    const remindAt = dueWithTime - 3600000;
    // Replay the other device's restore and subsequent schedule before the local
    // confirmation. Use the task produced by this app's actual completion flow.
    await page.evaluate(
      (remote) => {
        type Store = { dispatch: (a: unknown) => void };
        const { store } = (window as unknown as { __e2eTestHelpers: { store: Store } })
          .__e2eTestHelpers;
        const base = {
          clientId: 'remote',
          schemaVersion: remote.schemaVersion,
          entityType: 'TASK',
          entityId: remote.task.id,
          opType: 'UPD',
          timestamp: Date.now(),
        };
        store.dispatch({
          type: '[OperationLog] Bulk Apply Operations',
          operations: [
            {
              ...base,
              id: crypto.randomUUID(),
              actionType: '[Task Shared] restoreTask',
              payload: { task: remote.task, subTasks: [] },
              vectorClock: { remote: 1 },
            },
            {
              ...base,
              id: crypto.randomUUID(),
              actionType: '[Task Shared] scheduleTaskWithTime',
              payload: {
                task: remote.task,
                dueWithTime: remote.dueWithTime,
                remindAt: remote.remindAt,
                isMoveToBacklog: false,
              },
              vectorClock: { remote: 2 },
            },
          ],
        });
      },
      { task, dueWithTime, remindAt, schemaVersion: CURRENT_SCHEMA_VERSION },
    );
    expect(await readLiveTask(page, title)).toMatchObject({ dueWithTime, remindAt });
    await confirm.click();
    await expect(page.locator('dialog-view-archived-task')).toBeHidden();
    expect(await readLiveTask(page, title)).toMatchObject({ dueWithTime, remindAt });
  });
});
