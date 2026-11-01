import { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { waitForStatePersistence } from '../../utils/waits';
import {
  createView,
  readBoard,
  seedInboxTasks,
  toggleViewLayout,
} from '../../utils/view-helpers';

/**
 * List and Board are two modes of one view, switched from the title bar
 * without opening the editor. A board keeps its column count through a list.
 */

const actions = (page: Page): Locator => page.locator('page-title .page-title-actions');
const layoutButton = (page: Page): Locator => actions(page).locator('.view-layout-btn');
const filterButton = (page: Page): Locator => actions(page).locator('.task-filter-btn');

/** The panels' left edges, rounded: equal ones share a grid column. */
const panelLefts = (page: Page): Promise<number[]> =>
  page
    .locator('boards board-panel')
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().left)));

test.describe('View layout (List/Board in the title bar)', () => {
  test('the Eisenhower Matrix becomes a list and comes back as 2×2', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.goto('/#/boards/EISENHOWER_MATRIX');
    const board = page.locator('boards board');
    await expect(page.locator('boards board-panel')).toHaveCount(4);
    await expect(board).not.toHaveClass(/isListLayout/);
    await expect(filterButton(page)).toHaveCount(0);
    // The first of the view's actions, named for what it does.
    await expect(actions(page).getByRole('button').first()).toHaveAccessibleName(
      'Show as list',
    );

    await toggleViewLayout(page);
    expect(await readBoard(page, 'EISENHOWER_MATRIX')).toEqual(
      expect.objectContaining({ cols: 1, boardCols: 2 }),
    );
    // Sections of one list, with the list's filter menu.
    await expect(page.locator('boards board-panel')).toHaveCount(4);
    await expect(filterButton(page)).toBeVisible();
    // Still first, so still under the pointer, and it keeps the focus.
    await expect(actions(page).getByRole('button').first()).toHaveAccessibleName(
      'Show as board',
    );
    await expect(layoutButton(page)).toBeFocused();

    // The mode is stored: it survives a reload.
    await waitForStatePersistence(page);
    await page.reload();
    await expect(page.locator('boards board')).toHaveClass(/isListLayout/);

    await toggleViewLayout(page);
    expect((await readBoard(page, 'EISENHOWER_MATRIX'))?.cols).toBe(2);
    await expect(filterButton(page)).toHaveCount(0);
    // Two columns, two rows: the first and third quadrant share a column.
    await expect
      .poll(async () => {
        const lefts = await panelLefts(page);
        return [lefts[0] === lefts[2], lefts[1] === lefts[3], lefts[0] !== lefts[1]];
      })
      .toEqual([true, true, true]);
  });

  test('a view created as a list becomes a board with a column per section', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await createView(page, {
      title: `${testPrefix}-Sections`,
      sections: [{ title: 'One' }, { title: 'Two' }, { title: 'Three' }],
    });
    const id = page.url().match(/#\/boards\/([^/?]+)/)?.[1] ?? '';
    expect((await readBoard(page, id))?.cols).toBe(1);

    await toggleViewLayout(page);
    const saved = await readBoard(page, id);
    expect(saved?.cols).toBe(3);
    expect(saved?.boardCols).toBeUndefined();
    await expect.poll(async () => new Set(await panelLefts(page)).size).toBe(3);
  });

  test('on phones every view is a list, and the title bar keeps to its name', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/#/boards/EISENHOWER_MATRIX');
    const board = page.locator('boards board');
    // Sections of one list, with task rows; the stored layout stays 2×2.
    await expect(page.locator('boards board-panel collapsible.task-section')).toHaveCount(
      4,
    );
    await expect(board).toHaveClass(/isListLayout/);
    await expect(page.locator('boards planner-task')).toHaveCount(0);
    expect((await readBoard(page, 'EISENHOWER_MATRIX'))?.cols).toBe(2);

    // The view's name and its menu, without List/Board or filter.
    await expect(actions(page).getByRole('button')).toHaveCount(1);
    await expect(page.locator('page-title .page-title-text')).toHaveText(
      'Eisenhower Matrix',
    );
    await actions(page).getByRole('button', { name: 'More actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Show as/ })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Wider again: the columns come back as cards.
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(board).not.toHaveClass(/isListLayout/);
    await expect(layoutButton(page)).toBeVisible();
  });

  test('on phones long sections with multiline rows stack without overlapping', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    // Taller than the screen, with rows that wrap (an unbreakable URL too).
    await seedInboxTasks(
      page,
      Array.from({ length: 16 }, (_, index) =>
        index % 4
          ? `${testPrefix}-${index}`
          : `${testPrefix}-${index} a long title https://example.com/share/6a8de183-d750-83eb-81e0-97bcffed0946?q=plain that wraps`,
      ),
    );
    // No rules: both sections hold every task.
    await createView(page, {
      title: `${testPrefix}-Long`,
      sections: [{ title: 'One' }, { title: 'Two' }],
    });
    await page.setViewportSize({ width: 375, height: 800 });
    const sections = page.locator('boards board-panel');
    await expect(sections.nth(0).locator('task')).toHaveCount(16);
    await expect(sections.nth(1).locator('task')).toHaveCount(16);

    // Each section is as tall as its rows: its last row ends above the next
    // section (a capped section stays in its box but its rows spill over).
    const lastRowBottomAndNextTop = (): Promise<number[]> =>
      sections.evaluateAll((els) => {
        const rows = els[0].querySelectorAll('task');
        return [
          rows[rows.length - 1].getBoundingClientRect().bottom,
          els[1].getBoundingClientRect().top,
        ].map(Math.round);
      });
    await expect
      .poll(async () => {
        const [lastRowBottom, nextTop] = await lastRowBottomAndNextTop();
        return lastRowBottom <= nextTop;
      })
      .toBe(true);
  });
});
