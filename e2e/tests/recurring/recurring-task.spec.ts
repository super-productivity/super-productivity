import { test, expect } from '../../fixtures/test.fixture';
import { type Page } from '@playwright/test';

const DB_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ONE_HOUR = 60 * 60 * 1000;
const THIRTY_MINUTES = 30 * 60 * 1000;

type TaskStateSnapshot = {
  title: string;
  dueDay?: string | null;
  timeEstimate?: number | null;
};

/**
 * The suite runs in Europe/Berlin (e2e/global-setup.ts) at whatever wall-clock
 * time CI fires, so a test can straddle local midnight: a task created at
 * 23:59:5x is stored under the previous day while the assertion a second later
 * resolves to the next one (run 33808991651). Callers therefore sample this
 * once before creating the task and once at assertion time and accept either
 * side of the rollover.
 */
const getDbDateStr = async (page: Page, offsetDays = 0): Promise<string> =>
  page.evaluate((offset) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  }, offsetDays);

const getTaskStateByTitle = async (
  page: Page,
  taskTitle: string,
): Promise<TaskStateSnapshot | null> =>
  page.evaluate((title) => {
    type TaskLike = {
      title?: string;
      dueDay?: string | null;
      timeEstimate?: number | null;
    };
    type StoreState = {
      tasks?: {
        entities?: Record<string, TaskLike | undefined>;
      };
    };
    type StoreSubscription = {
      unsubscribe: () => void;
    };
    type StoreLike = {
      subscribe: (next: (state: StoreState) => void) => StoreSubscription;
    };
    type E2ETestHelpers = {
      store?: StoreLike;
    };

    const helpers = (window as unknown as { __e2eTestHelpers?: E2ETestHelpers })
      .__e2eTestHelpers;
    const store = helpers?.store;
    if (!store) {
      throw new Error('__e2eTestHelpers.store missing');
    }

    let latestState: StoreState | undefined;
    const subscription = store.subscribe((state) => {
      latestState = state;
    });
    subscription.unsubscribe();

    const task = Object.values(latestState?.tasks?.entities ?? {}).find((candidate) =>
      candidate?.title?.includes(title),
    );

    return task
      ? {
          title: task.title ?? '',
          dueDay: task.dueDay ?? null,
          timeEstimate: task.timeEstimate ?? null,
        }
      : null;
  }, taskTitle);

// Mirrors BasePage.addTask but skips the "wait for the task in the today list"
// step that would time out for tasks scheduled for a future day. Caller is
// expected to pre-bake the testPrefix into `rawTaskInput` since BasePage's
// internal prefix logic is not reused here.
const addTaskWithoutWaitingForTodayList = async (
  page: Page,
  rawTaskInput: string,
): Promise<void> => {
  const inputEl = page.locator('add-task-bar.global .main-input');
  const isInputVisible = await inputEl
    .first()
    .isVisible()
    .catch(() => false);
  if (!isInputVisible) {
    await page.locator('.tour-addBtn').click();
  }

  const input = inputEl.first();
  await input.waitFor({ state: 'visible', timeout: 10000 });
  await input.click();
  await input.clear();
  await input.fill(rawTaskInput);
  await page.locator('.e2e-add-task-submit').click();
};

const expectTaskTitleWithoutShortSyntax = async (
  page: Page,
  taskTitle: string,
  token: string,
): Promise<TaskStateSnapshot> => {
  await expect
    .poll(async () => (await getTaskStateByTitle(page, taskTitle))?.title ?? null)
    .not.toBeNull();

  const taskState = await getTaskStateByTitle(page, taskTitle);
  expect(taskState).not.toBeNull();
  expect(taskState!.title).toContain(taskTitle);
  expect(taskState!.title).not.toContain(token);
  return taskState!;
};

/**
 * Recurring/Scheduled Task E2E Tests
 *
 * Tests scheduled task workflow including:
 * - Creating scheduled tasks with short syntax
 * - Time estimates with short syntax
 * - Task scheduling via context menu
 *
 * Note: Full TaskRepeatCfg creation via UI requires complex dialog navigation.
 * These tests focus on the scheduled task workflow which is the most common use case.
 */

test.describe('Scheduled Task Operations', () => {
  test('should create task scheduled for today using short syntax', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // Create task with @today short syntax
    const taskTitle = `${testPrefix}-Scheduled Task`;
    const dueDayBeforeAdd = await getDbDateStr(page);
    await workViewPage.addTask(`${taskTitle} @today`);

    // Verify task is visible
    const task = page.locator('task').filter({ hasText: taskTitle });
    await expect(task).toBeVisible({ timeout: 10000 });
    await expect(task.locator('task-title')).not.toContainText('@today');

    const taskState = await expectTaskTitleWithoutShortSyntax(page, taskTitle, '@today');
    const dueDayAfterAdd = await getDbDateStr(page);
    expect([dueDayBeforeAdd, dueDayAfterAdd]).toContain(taskState.dueDay);
  });

  test('should create task with time estimate using short syntax', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // Create task with 1h short syntax for 1 hour estimate
    const taskTitle = `${testPrefix}-Estimated Task`;
    await workViewPage.addTask(`${taskTitle} 1h`);

    // Verify task is visible
    const task = page.locator('task').filter({ hasText: taskTitle });
    await expect(task).toBeVisible({ timeout: 10000 });
    await expect(task.locator('task-title')).not.toContainText('1h');

    const taskState = await expectTaskTitleWithoutShortSyntax(page, taskTitle, '1h');
    expect(taskState.timeEstimate).toBe(ONE_HOUR);
  });

  test('should open context menu on task', async ({ page, workViewPage, testPrefix }) => {
    await workViewPage.waitForTaskList();

    // Create a task
    const taskTitle = `${testPrefix}-Context Menu Task`;
    await workViewPage.addTask(taskTitle);

    // Wait for task
    const task = page.locator('task').filter({ hasText: taskTitle }).first();
    await expect(task).toBeVisible({ timeout: 10000 });

    // Right-click to open context menu
    await task.click({ button: 'right' });

    // Check if the task context menu appeared.
    const contextMenu = page
      .locator('.mat-mdc-menu-panel')
      .filter({ has: page.locator('.quick-access') })
      .first();
    await expect(contextMenu).toBeVisible({ timeout: 3000 });
    await expect(contextMenu.getByRole('menuitem', { name: /Delete/ })).toBeVisible();

    // Close the menu with Escape
    await page.keyboard.press('Escape');

    // Task should still exist after closing menu
    await expect(task).toBeVisible();
  });

  test('should complete scheduled task', async ({
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // Create scheduled task
    const taskTitle = `${testPrefix}-Complete Scheduled`;
    await workViewPage.addTask(`${taskTitle} @today`);

    // Wait for task - use first() to avoid strict mode violation during animations
    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });
    await expect(task.locator('task-title')).not.toContainText('@today');

    // Mark as done
    await taskPage.markTaskAsDone(task);

    // Verify this scheduled task was completed.
    await expect(task).toHaveClass(/isDone/, { timeout: 5000 });
  });

  test('should create task scheduled for tomorrow', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // Create task with @tomorrow short syntax. workViewPage.addTask cannot be
    // used because it waits for the new task in the today list and tomorrow's
    // task does not show up there.
    const taskTitle = `${testPrefix}-Tomorrow Task`;
    const dueDayBeforeAdd = await getDbDateStr(page, 1);
    await addTaskWithoutWaitingForTodayList(page, `${taskTitle} @tomorrow`);

    await expect
      .poll(async () => (await getTaskStateByTitle(page, taskTitle))?.dueDay ?? '')
      .toMatch(DB_DATE_RE);
    const taskState = await expectTaskTitleWithoutShortSyntax(
      page,
      taskTitle,
      '@tomorrow',
    );
    const dueDayAfterAdd = await getDbDateStr(page, 1);
    expect([dueDayBeforeAdd, dueDayAfterAdd]).toContain(taskState.dueDay);

    // Navigate back to work view to verify app is responsive
    await page.goto('/#/tag/TODAY/tasks');
    await page.waitForLoadState('networkidle');

    // Verify the app is still responsive
    await expect(page.locator('task-list').first()).toBeVisible();
  });

  test('should create multiple scheduled tasks', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // Create multiple tasks with different schedules/estimates
    const dueDayBeforeAdd = await getDbDateStr(page);
    await workViewPage.addTask(`${testPrefix}-Task1 @today 30m`);
    await workViewPage.addTask(`${testPrefix}-Task2 @today 1h`);

    // Wait for both tasks
    const task1 = page.locator('task').filter({ hasText: `${testPrefix}-Task1` });
    const task2 = page.locator('task').filter({ hasText: `${testPrefix}-Task2` });

    await expect(task1).toBeVisible({ timeout: 10000 });
    await expect(task2).toBeVisible({ timeout: 10000 });
    await expect(task1.locator('task-title')).not.toContainText(/@today|30m/);
    await expect(task2.locator('task-title')).not.toContainText(/@today|1h/);

    const task1State = await expectTaskTitleWithoutShortSyntax(
      page,
      `${testPrefix}-Task1`,
      '@today',
    );
    const task2State = await expectTaskTitleWithoutShortSyntax(
      page,
      `${testPrefix}-Task2`,
      '@today',
    );
    const dueDayAfterAdd = await getDbDateStr(page);

    expect(task1State.title).not.toContain('30m');
    expect([dueDayBeforeAdd, dueDayAfterAdd]).toContain(task1State.dueDay);
    expect(task1State.timeEstimate).toBe(THIRTY_MINUTES);

    expect(task2State.title).not.toContain('1h');
    expect([dueDayBeforeAdd, dueDayAfterAdd]).toContain(task2State.dueDay);
    expect(task2State.timeEstimate).toBe(ONE_HOUR);
  });
});
