import { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import {
  addViewRule,
  fillViewEditor,
  openCreateViewDialog,
  openViewEditor,
  saveViewEditor,
  viewEditorSection,
} from '../../utils/view-helpers';

/**
 * The view editor: layout, sections with only the rules that are set, a live
 * count per section, and saving without losing what it doesn't show.
 */

type BoardState = { id: string; title: string; cols: number; panels: unknown[] };

const readBoard = (page: Page, id: string): Promise<BoardState | undefined> =>
  page.evaluate((boardId) => {
    let boards: BoardState[] = [];
    (
      window as unknown as {
        __e2eTestHelpers: {
          store: {
            subscribe: (
              next: (state: { boards: { boardCfgs: BoardState[] } }) => void,
            ) => {
              unsubscribe: () => void;
            };
          };
        };
      }
    ).__e2eTestHelpers.store
      .subscribe((state) => (boards = state.boards.boardCfgs))
      .unsubscribe();
    return boards.find((board) => board.id === boardId);
  }, id);

const values = (inputs: Locator): Promise<string[]> =>
  inputs.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));

const viewIdFromUrl = (page: Page): string => {
  const id = page.url().match(/#\/boards\/([^/?]+)/)?.[1];
  if (!id) {
    throw new Error(`not on a view page: ${page.url()}`);
  }
  return id;
};

test.describe('View editor', () => {
  test('creates a list with one section and a rule, counting live what it shows', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await page.goto('/#/project/INBOX_PROJECT/tasks');
    await workViewPage.waitForTaskList();
    const high = `${testPrefix}-Urgent thing`;
    await workViewPage.addTask(`${high} p1`);
    await workViewPage.addTask(`${testPrefix}-Other thing`);

    const dialog = await openCreateViewDialog(page);
    const save = dialog.getByRole('button', { name: 'Save', exact: true });
    // No error before the title was touched; Save stays enabled.
    await expect(dialog.locator('mat-error')).toHaveCount(0);
    await expect(save).toBeEnabled();
    // A new view starts with one section, a list, its title hidden.
    const section = viewEditorSection(dialog, 0);
    await expect(section).toHaveCount(1);
    await expect(section.getByRole('textbox')).toHaveCount(0);
    await expect(dialog.getByText('Sections stack in one task list')).toBeVisible();

    // Saving without a title shows why and focuses it.
    await save.click();
    const title = dialog.getByRole('textbox', { name: 'Title', exact: true });
    await expect(title).toBeFocused();
    await expect(dialog.locator('mat-error')).toContainText('required');

    await title.fill(`${testPrefix}-Urgent`);
    const count = section.locator('.count');
    const countBefore = Number((await count.innerText()).split(' ')[0]);
    expect(countBefore).toBeGreaterThanOrEqual(2);
    await addViewRule(page, section, { rule: 'Priority', value: 'High' });
    await expect(count).toHaveText('1 task');
    // Only the set rule shows, with a remove button.
    await expect(section.locator('.rule-row:not(.sort-row)')).toHaveCount(1);
    await saveViewEditor(dialog);

    await expect(page).toHaveURL(/#\/boards\/[^/]+$/);
    const rows = page.locator('boards board-panel task');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(high);
    // The hidden section title took the view's.
    const board = await readBoard(page, viewIdFromUrl(page));
    expect(board?.cols).toBe(1);
    expect((board?.panels[0] as { title: string }).title).toBe(`${testPrefix}-Urgent`);
  });

  test('switches between List and Board, and reorders and duplicates columns', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const dialog = await openCreateViewDialog(page);
    await fillViewEditor(page, dialog, {
      title: `${testPrefix}-Layouts`,
      sections: [{ title: 'Alpha' }, { title: 'Beta' }],
    });
    await expect(dialog.getByRole('spinbutton', { name: 'Columns' })).toHaveCount(0);
    await expect(dialog.getByRole('heading', { name: 'Sections' })).toBeVisible();

    await fillViewEditor(page, dialog, { layout: 'board' });
    const columns = dialog.getByRole('spinbutton', { name: 'Columns', exact: true });
    await expect(columns).toHaveValue('2');
    await expect(dialog.getByRole('heading', { name: 'Columns' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Add column' })).toBeVisible();
    await expect(dialog.getByText('Columns side by side, tasks as cards')).toBeVisible();

    await fillViewEditor(page, dialog, { layout: 'list' });
    await expect(columns).toHaveCount(0);
    await fillViewEditor(page, dialog, { layout: 'board' });

    // Move Beta up, then duplicate it.
    const titles = dialog.getByRole('textbox', { name: 'Column title' });
    const sectionMenu = (i: number): Locator =>
      viewEditorSection(dialog, i).getByRole('button', { name: 'More actions' });
    await sectionMenu(1).click();
    await page.getByRole('menuitem', { name: 'Move up' }).click();
    await expect.poll(() => values(titles)).toEqual(['Beta', 'Alpha']);
    await sectionMenu(0).click();
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();
    await expect.poll(() => values(titles)).toEqual(['Beta', 'Beta (copy)', 'Alpha']);
    await saveViewEditor(dialog);

    const panels = page.locator('boards board-panel');
    await expect(panels).toHaveCount(3);
    await expect(page.locator('boards board')).not.toHaveClass(/isSingleColumn/);
    await expect(panels.nth(0).locator('header')).toContainText('Beta');
    await expect(panels.nth(1).locator('header')).toContainText('Beta (copy)');
  });

  test('editing a view keeps the values the editor does not show', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    // As a newer client would store it: an unknown date rule, sort key and field.
    const panel = {
      id: 'future-panel',
      title: 'Later',
      taskIds: [],
      includedTagIds: [],
      excludedTagIds: [],
      taskDoneState: 1,
      scheduledState: 1,
      backlogState: 1,
      isParentTasksOnly: false,
      projectIds: [''],
      dueState: 'nextQuarter',
      sortKey: 'energy',
      energyLevel: 'high',
    };
    await page.evaluate((p) => {
      (
        window as unknown as {
          __e2eTestHelpers: { store: { dispatch: (a: unknown) => void } };
        }
      ).__e2eTestHelpers.store.dispatch({
        type: '[Boards] Add Board',
        board: { id: 'future-view', title: 'Future', cols: 1, panels: [p] },
        meta: {
          isPersistent: true,
          entityType: 'BOARD',
          entityId: 'future-view',
          opType: 'CRT',
        },
      });
    }, panel);
    await page.goto('/#/boards/future-view');
    await expect(page.locator('boards board-panel')).toHaveCount(1);

    const dialog = await openViewEditor(page);
    const section = viewEditorSection(dialog, 0);
    await expect(
      section.getByRole('combobox', { name: 'Planned Date', exact: true }),
    ).toContainText('Other (kept)');
    await expect(
      section.getByRole('combobox', { name: 'Sort by', exact: true }),
    ).toContainText('Other (kept)');
    await fillViewEditor(page, dialog, { title: 'Future, renamed' });
    await addViewRule(page, section, { rule: 'Priority', value: 'High' });
    await saveViewEditor(dialog);

    const saved = await readBoard(page, 'future-view');
    expect(saved?.title).toBe('Future, renamed');
    expect(saved?.panels[0]).toEqual(
      expect.objectContaining({
        dueState: 'nextQuarter',
        sortKey: 'energy',
        energyLevel: 'high',
        priorityRule: '3',
        // Its own title (not the view's) is kept.
        title: 'Later',
      }),
    );
  });

  test('saving Kanban unchanged stores it unchanged, titles shown translated', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.goto('/#/boards/KANBAN_DEFAULT');
    await expect(page.locator('boards')).toBeVisible();
    const before = await readBoard(page, 'KANBAN_DEFAULT');
    expect(before?.title).toBe('F.BOARDS.DEFAULT.KANBAN');

    const dialog = await openViewEditor(page);
    await expect(dialog.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(
      'Kanban',
    );
    await expect
      .poll(() => values(dialog.getByRole('textbox', { name: 'Column title' })))
      .toEqual(['To Do', 'In Progress', 'Done']);
    await saveViewEditor(dialog);

    expect(await readBoard(page, 'KANBAN_DEFAULT')).toEqual(before);
  });

  test("clicking a view's title opens its editor and stays on the view", async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.goto('/#/boards/KANBAN_DEFAULT');
    await expect(page.locator('boards board-panel')).toHaveCount(3);

    const title = page.locator('page-title .page-title');
    await expect(title).toHaveAttribute('role', 'button');
    await title.click();
    const dialog = page.locator('dialog-board-edit');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(
      'Kanban',
    );
    await expect(page).toHaveURL(/#\/boards\/KANBAN_DEFAULT$/);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();

    // From the keyboard too.
    await title.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/#\/boards\/KANBAN_DEFAULT$/);
  });

  test('shows one section of a board at a time, the others as a summary', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.goto('/#/boards/KANBAN_DEFAULT');
    await expect(page.locator('boards board-panel')).toHaveCount(3);

    const dialog = await openViewEditor(page);
    const toggles = dialog.locator('view-editor-section .section-toggle');
    await expect(toggles).toHaveCount(3);
    await expect(toggles.nth(0)).toHaveAttribute('aria-expanded', 'true');
    await expect(toggles.nth(1)).toHaveAttribute('aria-expanded', 'false');
    await expect(toggles.nth(2)).toHaveAttribute('aria-expanded', 'false');
    // A collapsed card: its title, then count and rules in one line.
    const done = viewEditorSection(dialog, 2);
    await expect(done.getByRole('textbox', { name: 'Column title' })).toHaveValue('Done');
    await expect(toggles.nth(2)).toContainText(
      'Backlog: Exclude backlog · Completion: Completed',
    );
    await expect(done.locator('.rule-row')).toHaveCount(0);
    await expect(
      viewEditorSection(dialog, 0).locator('[data-rule="done"]'),
    ).toBeVisible();

    // Opening one closes the other.
    await toggles.nth(2).click();
    await expect(toggles.nth(2)).toHaveAttribute('aria-expanded', 'true');
    await expect(toggles.nth(0)).toHaveAttribute('aria-expanded', 'false');
    await expect(done.locator('[data-rule="done"]')).toBeVisible();
    await expect(viewEditorSection(dialog, 0).locator('.rule-row')).toHaveCount(0);
  });
});
