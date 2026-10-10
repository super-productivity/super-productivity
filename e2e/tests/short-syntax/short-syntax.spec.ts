import { type Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';

type TaskStateSnapshot = {
  title: string;
  dueDay?: string | null;
  dueWithTime?: number | null;
};

/**
 * Reads a task's persisted fields from the NgRx store via the
 * `window.__e2eTestHelpers` hook (dev/test builds), so the assertion does not
 * depend on which view happens to render the task. A task due next week is not
 * in the Today list, so the DOM is the wrong place to look.
 */
const getTaskStateByTitle = async (
  page: Page,
  taskTitle: string,
): Promise<TaskStateSnapshot | null> =>
  page.evaluate((title) => {
    type TaskLike = {
      title?: string;
      dueDay?: string | null;
      dueWithTime?: number | null;
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
          dueWithTime: task.dueWithTime ?? null,
        }
      : null;
  }, taskTitle);

/**
 * The nth occurrence of `weekday` counting from today (n = 1 is the next
 * occurrence), mirroring the parser's `@<n><weekday>` resolution. Evaluated in
 * the browser so it uses the same local wall clock the parser ran with.
 */
const nthWeekdayDueDay = (page: Page, weekday: number, nth: number): Promise<string> =>
  page.evaluate(
    (args) => {
      const now = new Date();
      const diff = (args.weekday - now.getDay() + 7) % 7;
      const extraDays = (args.nth - 1) * 7;
      const due = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + diff + extraDays,
      );
      const month = `${due.getMonth() + 1}`.padStart(2, '0');
      const day = `${due.getDate()}`.padStart(2, '0');
      return `${due.getFullYear()}-${month}-${day}`;
    },
    { weekday, nth },
  );

test.describe('Short Syntax', () => {
  test('should add task with project via short syntax', async ({
    page,
    workViewPage,
  }) => {
    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    // Add a task with project short syntax
    await workViewPage.addTask('0 test task koko +i');

    // Verify task is visible
    const task = page.locator('task').first();
    await expect(task).toBeVisible({ timeout: 10000 });

    // Verify the task has the Inbox tag
    const taskTags = task.locator('tag');
    await expect(taskTags).toContainText('Inbox', { timeout: 5000 });
  });

  test('should set the due date for nth-weekday syntax', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // "@2monday" is the Monday after next, so the task is not in the Today
    // list; pass null as the expectedVisibleTitle to skip that wait.
    const taskTitle = `${testPrefix}-Nth Weekday`;
    // Sampled on both sides of creation so a local-midnight rollover between
    // them cannot fail the assertion (see e2e/utils/test-timezone.ts).
    const dueDayBeforeAdd = await nthWeekdayDueDay(page, 1, 2);

    await workViewPage.addTask(`${taskTitle} @2monday`, false, null);

    await expect
      .poll(async () => (await getTaskStateByTitle(page, taskTitle))?.dueDay ?? null)
      .not.toBeNull();

    const taskState = await getTaskStateByTitle(page, taskTitle);
    expect(taskState).not.toBeNull();
    expect(taskState!.title).toBe(taskTitle);
    expect(taskState!.title).not.toContain('@2monday');
    expect(taskState!.dueWithTime).toBeNull();

    const dueDayAfterAdd = await nthWeekdayDueDay(page, 1, 2);
    expect([dueDayBeforeAdd, dueDayAfterAdd]).toContain(taskState!.dueDay);
  });
});
