import { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';

/**
 * A long column renders its first 100 cards and a "Show all (n)" button;
 * the header counts every task. A card moved into it, by keyboard or by a
 * drag below the last card shown, becomes the last card shown, so it stays in
 * view and keeps the focus while the column stays capped. Never stored: a
 * reload shows the first 100 again.
 */

const TASK_COUNT = 150;

/** Creates the tasks in the Inbox in one go (the UI would take minutes). */
const seedTasks = async (page: Page, prefix: string): Promise<void> => {
  await page.evaluate(
    ({ count, titlePrefix }) => {
      const store = (
        window as unknown as {
          __e2eTestHelpers?: { store?: { dispatch: (action: unknown) => void } };
        }
      ).__e2eTestHelpers?.store;
      if (!store) throw new Error('__e2eTestHelpers.store missing');
      const operations = Array.from({ length: count }, (_, index) => ({
        type: 'create',
        tempId: `temp-${index}`,
        data: { title: `${titlePrefix}-${String(index).padStart(3, '0')}` },
      }));
      for (let offset = 0; offset < count; offset += 50) {
        store.dispatch({
          type: '[Task Shared] batchUpdateForProject',
          projectId: 'INBOX_PROJECT',
          operations: operations.slice(offset, offset + 50),
          createdTaskIds: Object.fromEntries(
            operations.map(({ tempId }, index) => [tempId, `long-${index}`]),
          ),
          createdTaskTimestamp: Date.now(),
          meta: {
            isPersistent: true,
            entityType: 'PROJECT',
            entityId: 'INBOX_PROJECT',
            opType: 'BATCH',
          },
        });
      }
    },
    { count: TASK_COUNT, titlePrefix: prefix },
  );
};

/** A CDK drag with real pointer moves, ending in the target's lower half. */
const dragCard = async (page: Page, card: Locator, target: Locator): Promise<void> => {
  const from = await card.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('drag source or target not visible');
  const [fromHalfW, fromHalfH] = [from.width / 2, from.height / 2];
  const [toHalfW, toHalfH] = [to.width / 2, to.height / 2];
  const fromX = from.x + fromHalfW;
  const fromY = from.y + fromHalfH;
  const toX = to.x + toHalfW;
  const toY = to.y + toHalfH;
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move(fromX, fromY + 8, { steps: 3 });
  await page.mouse.move(toX, toY, { steps: 15 });
  // Past the last card's middle: the marker goes after it.
  await page.mouse.move(toX, toY + toHalfH + 4, { steps: 5 });
  await page.mouse.up();
};

test.describe('Long view columns', () => {
  test('renders 100 cards, counts all, and keeps a card moved past them in view', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await seedTasks(page, testPrefix);
    await page.goto('/#/boards/KANBAN_DEFAULT');
    await page.getByRole('button', { name: 'Create Tag', exact: true }).click();
    const todo = page.locator('[data-board-selection-scope="TODO"]');
    const progress = page.locator('[data-board-selection-scope="IN_PROGRESS"]');
    const todoCards = todo.locator('.drop-list planner-task');
    const showAll = todo.getByRole('button', { name: /^Show all/ });

    await expect(todoCards).toHaveCount(100);
    await expect(todo.locator('header .tasks-total-estimate')).toContainText(
      String(TASK_COUNT),
    );
    await expect(showAll).toHaveText(`Show all (${TASK_COUNT})`);

    // Out to In Progress and back: it comes back as the last card shown, and
    // the column still renders 100.
    const card = todoCards.first();
    const id = await card.getAttribute('data-task-id');
    await card.focus();
    await page.keyboard.press('Control+Shift+ArrowRight');
    const moved = progress.locator(`planner-task[data-task-id="${id}"]`);
    await expect(moved).toBeFocused();
    await expect(todoCards).toHaveCount(100);
    await page.keyboard.press('Control+Shift+ArrowLeft');
    const back = todo.locator(`planner-task[data-task-id="${id}"]`);
    await expect(back).toBeFocused();
    await expect(back).toBeInViewport();
    await expect(todoCards).toHaveCount(100);
    await expect(todoCards.last()).toHaveAttribute('data-task-id', id!);

    // A fresh visit shows the first 100 again (nothing is stored).
    await page.goto('/#/tag/TODAY/tasks');
    await page.goto('/#/boards/KANBAN_DEFAULT');
    await expect(todoCards).toHaveCount(100);

    // Dragged in after the last card shown: it is the last card shown.
    await todoCards.first().focus();
    const dragId = await todoCards.first().getAttribute('data-task-id');
    await page.keyboard.press('Control+Shift+ArrowRight');
    await expect(progress.locator('planner-task')).toHaveCount(1);
    const last = todoCards.last();
    await last.scrollIntoViewIfNeeded();
    await dragCard(page, progress.locator('planner-task'), last);
    await expect(progress.locator('planner-task')).toHaveCount(0);
    const dropped = todo.locator(`planner-task[data-task-id="${dragId}"]`);
    await expect(dropped).toBeVisible();
    await expect(todoCards).toHaveCount(100);
    await expect(todoCards.last()).toHaveAttribute('data-task-id', dragId!);

    // "Show all" renders the rest.
    await showAll.click();
    await expect(todoCards).toHaveCount(TASK_COUNT);
    await expect(showAll).toHaveCount(0);
  });
});
