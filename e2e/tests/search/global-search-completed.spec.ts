import { type Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';

/**
 * A search for a finished task must not end in "nothing found": the default
 * search leaves done and archived tasks out, so it says that they match and
 * points to the include option (2026-11 user survey: "could not find completed
 * or archived tasks").
 */

const NOTES = 'Dr. Meyer, room 4';

const searchFor = async (page: Page, term: string): Promise<void> => {
  await page.keyboard.press('Shift+F');
  await expect(page).toHaveURL(/\/#\/search$/);
  await page.locator('search-page .search-field input').fill(term);
};

const includeCompletedMatches = async (page: Page): Promise<void> => {
  const hint = page.locator('search-page .e2e-completed-hidden');
  await expect(hint).toContainText('Only completed or archived tasks match');
  await page.locator('search-page mat-checkbox input').check();
  await expect(hint).toHaveCount(0);
};

// Notes as a user would have written them; typing them is not what is under test.
const setTaskNotes = async (page: Page, title: string, notes: string): Promise<void> => {
  await page.evaluate(
    ({ taskTitle, taskNotes }) => {
      type TaskLike = { id: string; title: string };
      type AppState = { tasks: { entities: Record<string, TaskLike> } };
      type StoreLike = {
        subscribe: (fn: (s: AppState) => void) => { unsubscribe: () => void };
        dispatch: (action: unknown) => void;
      };
      const store = (window as unknown as { __e2eTestHelpers: { store: StoreLike } })
        .__e2eTestHelpers.store;
      let state: AppState | undefined;
      store.subscribe((s) => (state = s)).unsubscribe();
      const task = Object.values(state?.tasks.entities ?? {}).find(
        (t) => t.title === taskTitle,
      );
      if (!task) {
        throw new Error('Task to add notes to was not found');
      }
      store.dispatch({
        type: '[Task Shared] updateTask',
        task: { id: task.id, changes: { notes: taskNotes } },
        meta: {
          isPersistent: true,
          entityType: 'TASK',
          entityId: task.id,
          opType: 'UPD',
        },
      });
    },
    { taskTitle: title, taskNotes: notes },
  );
};

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

test.describe('Global Search: completed and archived tasks', () => {
  test('gets back a task that was ticked off by accident', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const taskName = `${testPrefix}-TickedByAccident`;
    await workViewPage.addTask(taskName);
    await taskPage.markTaskAsDone(taskPage.getTaskByText(taskName));

    await searchFor(page, taskName);
    await includeCompletedMatches(page);

    const result = page
      .locator('search-page mat-list-item')
      .filter({ hasText: taskName });
    await expect(result).toHaveCount(1);
    await result.click();

    await expect(page).toHaveURL(/\/#\/tag\/TODAY\/tasks/);
    const doneTask = taskPage.getTaskByText(taskName);
    await expect(doneTask).toBeVisible();
    await expect(doneTask).toHaveClass(/isDone/);

    await doneTask.hover();
    await doneTask.locator('done-toggle').click();
    // The reopen animation briefly shows both rows. Wait for each list to settle.
    await expect(taskPage.getUndoneTasks().filter({ hasText: taskName })).toHaveCount(1);
    await expect(taskPage.getDoneTasks().filter({ hasText: taskName })).toHaveCount(0);
  });

  test('finds an archived task and shows its notes', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const taskName = `${testPrefix}-FinishedLastWeek`;
    await workViewPage.addTask(taskName);
    await setTaskNotes(page, taskName, NOTES);
    await taskPage.markTaskAsDone(taskPage.getTaskByText(taskName));
    await finishDay(page);

    await searchFor(page, taskName);
    await includeCompletedMatches(page);

    const result = page
      .locator('search-page mat-list-item')
      .filter({ hasText: taskName });
    await expect(result).toHaveCount(1);
    await result.click();

    // History opens on the day the task was finished
    await expect(page).toHaveURL(/\/history/);
    const historyRow = page
      .locator('.task-summary-table tr')
      .filter({ hasText: taskName });
    await historyRow.locator('td.title button').click();

    await expect(page.locator('dialog-view-archived-task')).toContainText(NOTES);
  });

  test('points to completed matches on a phone-sized screen', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const taskName = `${testPrefix}-DoneOnPhone`;
    await workViewPage.addTask(taskName);
    await taskPage.markTaskAsDone(taskPage.getTaskByText(taskName));
    await page.setViewportSize({ width: 390, height: 844 });

    await searchFor(page, taskName);
    await expect(page.locator('search-page .e2e-completed-hidden')).toBeInViewport({
      ratio: 1,
    });
    await includeCompletedMatches(page);

    await expect(
      page.locator('search-page mat-list-item').filter({ hasText: taskName }),
    ).toBeInViewport();
  });

  test('keeps the plain message when no completed task matches', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask(`${testPrefix}-StillOpen`);

    await searchFor(page, `${testPrefix}-NoSuchTask`);

    await expect(page.locator('search-page .no-results')).toContainText(
      'No tasks, notes, projects or tags found',
    );
    await expect(page.locator('search-page .e2e-completed-hidden')).toHaveCount(0);
  });
});
