import { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';

/** A task's `tagIds` as the store holds them. */
const storedTagIds = (page: Page, taskId: string): Promise<string[] | undefined> =>
  page.evaluate(
    (id) =>
      new Promise<string[] | undefined>((resolve) => {
        type State = { tasks: { entities: Record<string, { tagIds: string[] }> } };
        const store = (
          window as unknown as {
            __e2eTestHelpers: {
              store: { subscribe: (next: (s: State) => void) => { unsubscribe(): void } };
            };
          }
        ).__e2eTestHelpers.store;
        const sub = store.subscribe((state) => {
          resolve(state.tasks.entities[id]?.tagIds);
          window.setTimeout(() => sub.unsubscribe());
        });
      }),
    taskId,
  );

/**
 * The default views name tags a fresh install doesn't have (`important`,
 * `urgent`, `in-progress`). Their columns show anyway, with a prompt above
 * them to create the tags; until then no move or add may give a task a tag
 * that doesn't exist.
 */
test.describe('Views whose tags do not exist yet', () => {
  test('shows the Eisenhower quadrants, refuses a move into one that needs a missing tag, then allows it once created', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    // No tags: it lands in "Not urgent & not important".
    const title = `${testPrefix}-Plain task`;
    await workViewPage.addTask(title);

    await page.goto('/#/boards/EISENHOWER_MATRIX');
    const panels = page.locator('board-panel');
    await expect(panels).toHaveCount(4);
    const callout = page.locator('board .callout');
    await expect(callout).toContainText('important');
    await expect(callout).toContainText('urgent');
    const createTags = callout.getByRole('button', { name: 'Create Tags', exact: true });
    await expect(createTags).toBeVisible();
    // The quadrants that require a missing tag take no new tasks.
    await expect(panels.getByRole('button', { name: /^Add task to / })).toHaveCount(1);

    const card = (i: number): ReturnType<typeof panels.locator> =>
      panels.nth(i).locator('planner-task').filter({ hasText: title });
    await expect(card(3)).toHaveCount(1);

    // Up into "Not urgent & important", which requires `important`: refused.
    await card(3).focus();
    await page.keyboard.press('Control+Shift+ArrowUp');
    // Filtered: other snacks (e.g. the storage warning) can be up at the same time.
    await expect(
      page.locator('snack-custom').filter({ hasText: "can't be moved here" }),
    ).toHaveCount(1);
    await expect(card(3)).toHaveCount(1);
    await expect(card(1)).toHaveCount(0);
    // The task kept its tags (none): no dangling tag id.
    const taskId = (await card(3).getAttribute('data-task-id'))!;
    expect(await storedTagIds(page, taskId)).toEqual([]);

    await createTags.click();
    await expect(callout).toHaveCount(0);
    await expect(panels.getByRole('button', { name: /^Add task to / })).toHaveCount(4);

    // The same move now gives the task the tag.
    await card(3).focus();
    await page.keyboard.press('Control+Shift+ArrowUp');
    await expect(card(1)).toHaveCount(1);
    await expect(card(3)).toHaveCount(0);
    await expect(card(1)).toBeFocused();
    expect(await storedTagIds(page, taskId)).toEqual(['EM_IMPORTANT']);
  });
});
