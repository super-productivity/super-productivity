import { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { sideNavViewRow } from '../../utils/view-helpers';

/** The tags in the store, by id → title. */
const storedTags = (page: Page): Promise<Record<string, string>> =>
  page.evaluate(
    () =>
      new Promise<Record<string, string>>((resolve) => {
        type State = {
          tag: { ids: string[]; entities: Record<string, { title: string }> };
        };
        const store = (
          window as unknown as {
            __e2eTestHelpers: {
              store: { subscribe: (next: (s: State) => void) => { unsubscribe(): void } };
            };
          }
        ).__e2eTestHelpers.store;
        const sub = store.subscribe((state) => {
          resolve(
            Object.fromEntries(
              state.tag.ids.map((id) => [id, state.tag.entities[id].title]),
            ),
          );
          window.setTimeout(() => sub.unsubscribe());
        });
      }),
  );

/** An item of the open menu (the side menu's rows are menu items too). */
const menuItem = (page: Page, name: string): ReturnType<Page['locator']> =>
  page.locator('.mat-mdc-menu-panel').getByRole('menuitem', { name, exact: true });

const openViewId = (page: Page): string => {
  const id = page.url().match(/#\/boards\/([^/?]+)/)?.[1];
  if (!id) {
    throw new Error(`not on a view page: ${page.url()}`);
  }
  return id;
};

/**
 * A template creates a view together with the tags its rules name, so it works
 * right away: no "missing tags" callout, moves and adds into every column.
 */
test.describe('View templates', () => {
  test('the + menu creates a Kanban view with its tag, reachable by keyboard', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    expect(Object.keys(await storedTags(page))).not.toContain('KANBAN_IN_PROGRESS');

    await page.locator('nav-view-group > div.g-multi-btn-wrapper').hover();
    await page.locator('[data-nav-btn="add-view"]').focus();
    await page.keyboard.press('Enter');
    await expect(menuItem(page, 'Blank view')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(menuItem(page, 'Kanban')).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/#\/boards\/[^/]+$/);
    const id = openViewId(page);
    expect(id).not.toBe('KANBAN_DEFAULT');
    await expect(sideNavViewRow(page, id)).toContainText('Kanban');
    await expect(page.locator('board-panel')).toHaveCount(3);
    await expect(page.locator('board .callout')).toHaveCount(0);
    expect((await storedTags(page)).KANBAN_IN_PROGRESS).toBe('in-progress');
    // Every column takes new tasks.
    await expect(
      page.locator('board-panel').getByRole('button', { name: /^Add task to / }),
    ).toHaveCount(3);
  });

  test('the empty Views page offers the templates; a second use adds no tags', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    for (const id of ['EISENHOWER_MATRIX', 'KANBAN_DEFAULT']) {
      await sideNavViewRow(page, id).locator('a.nav-link').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(sideNavViewRow(page, id)).toHaveCount(0);
    }
    await page.goto('/#/boards');
    const empty = page.locator('boards .no-views');
    await expect(empty).toBeVisible();

    await empty.getByRole('button', { name: 'Eisenhower Matrix' }).click();
    await expect(page.locator('board-panel')).toHaveCount(4);
    await expect(page.locator('board .callout')).toHaveCount(0);
    const firstId = openViewId(page);
    const tags = await storedTags(page);
    expect(tags.EM_IMPORTANT).toBe('important');
    expect(tags.EM_URGENT).toBe('urgent');

    // Again from the side menu: a second view with its own id, the same tags.
    await page.locator('nav-view-group > div.g-multi-btn-wrapper').hover();
    await page.locator('[data-nav-btn="add-view"]').click();
    await menuItem(page, 'Eisenhower Matrix').click();
    await expect(page).not.toHaveURL(new RegExp(`#/boards/${firstId}$`));
    await expect(page.locator('nav-view-group .view-row')).toHaveCount(2);
    expect(await storedTags(page)).toEqual(tags);
  });

  test("the view's ⋮ menu in the title bar moves with the arrow keys", async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.goto('/#/boards/KANBAN_DEFAULT');
    await expect(page.locator('board-panel')).toHaveCount(3);
    await page
      .locator('page-title .page-title-actions')
      .getByRole('button', { name: 'More actions' })
      .focus();
    await page.keyboard.press('Enter');
    await expect(menuItem(page, 'Edit')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menuItem(page, 'Duplicate')).toBeFocused();
  });
});
