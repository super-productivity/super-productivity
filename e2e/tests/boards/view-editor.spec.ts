import { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import {
  addViewRule,
  columnTitleButton,
  createView,
  fillViewEditor,
  openCreateViewDialog,
  openViewEditor,
  readBoard,
  saveViewEditor,
  viewEditorName,
  viewEditorSection,
  viewRuleChip,
} from '../../utils/view-helpers';

/**
 * The view editor: layout, sections with only the rules that are set, a live
 * count per section, and saving without losing what it doesn't show.
 */

/** The section titles, shown as text. */
const sectionTitles = (dialog: Locator): Promise<string[]> =>
  dialog
    .locator('view-editor-section .section-title')
    .evaluateAll((els) => els.map((el) => el.textContent!.trim()));

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
    await expect(dialog.locator('.title-error')).toHaveCount(0);
    await expect(save).toBeEnabled();
    // A new view starts with one section, a list, its title hidden: an open
    // card without a bar.
    const section = viewEditorSection(dialog, 0);
    await expect(section).toHaveCount(1);
    await expect(section.getByRole('textbox')).toHaveCount(0);
    await expect(section.locator('.section-header')).toHaveCount(0);
    await expect(section.locator('.form-label').first()).toContainText('Rules');

    // Saving without a title shows why and focuses it.
    await save.click();
    const title = dialog.getByRole('textbox', { name: 'Title', exact: true });
    await expect(title).toBeFocused();
    await expect(dialog.locator('.title-error')).toContainText('required');

    await title.fill(`${testPrefix}-Urgent`);
    const count = section.locator('.count');
    const countBefore = Number((await count.innerText()).split(' ')[0]);
    expect(countBefore).toBeGreaterThanOrEqual(2);
    await addViewRule(page, section, { rule: 'Priority', value: 'High' });
    await expect(count).toHaveText('1 task');
    // Only the set rule shows, as a chip with a remove button.
    await expect(section.locator('view-rule-chip')).toHaveCount(1);
    await expect(viewRuleChip(section, 'Priority')).toHaveText('Priority: High');
    await expect(
      section.getByRole('button', { name: 'Remove rule: Priority', exact: true }),
    ).toBeVisible();
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
    const columns = dialog.getByRole('radiogroup', { name: 'Columns per row' });
    await expect(columns).toHaveCount(0);
    await expect(
      dialog.getByRole('heading', { name: 'Sections', exact: true }),
    ).toBeVisible();

    await fillViewEditor(page, dialog, { layout: 'board' });
    // Two sections can only sit side by side: no width to pick.
    await expect(columns).toHaveCount(0);
    await expect(
      dialog.getByRole('heading', { name: 'Columns', exact: true }),
    ).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Add column' })).toBeVisible();

    await fillViewEditor(page, dialog, { layout: 'list' });
    await expect(columns).toHaveCount(0);
    await fillViewEditor(page, dialog, { layout: 'board' });

    // Move Beta (the open card) up, then duplicate it.
    const sectionMenu = (i: number): Locator =>
      viewEditorSection(dialog, i).getByRole('button', { name: 'More actions' });
    await sectionMenu(1).click();
    await page.getByRole('menuitem', { name: 'Move up' }).click();
    await expect.poll(() => sectionTitles(dialog)).toEqual(['Beta', 'Alpha']);
    await sectionMenu(0).click();
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();
    await expect
      .poll(() => sectionTitles(dialog))
      .toEqual(['Beta', 'Beta (copy)', 'Alpha']);
    // A third column: the board stays one row, and now has a width to pick.
    await expect(
      columns.getByRole('radio', { name: '3 per row', exact: true }),
    ).toBeChecked();
    await expect(columns.getByRole('radio')).toHaveCount(2);

    // The drag handle moves the open card too, keeping its identity and rules.
    // The menu's backdrop would take the press; every card is open, so the
    // content scrolls: the top one into view first.
    await expect(page.locator('.mat-mdc-menu-panel')).toHaveCount(0);
    await viewEditorSection(dialog, 0).scrollIntoViewIfNeeded();
    const handle = await viewEditorSection(dialog, 1)
      .locator('.drag-handle')
      .boundingBox();
    const target = await viewEditorSection(dialog, 0).boundingBox();
    if (!handle || !target) throw new Error('Section drag handle or target missing');
    const halfWidth = handle.width / 2;
    const halfHeight = handle.height / 2;
    const x = handle.x + halfWidth;
    const y = handle.y + halfHeight;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 8, { steps: 3 });
    await page.mouse.move(x, target.y + 10, { steps: 15 });
    await page.mouse.up();
    await expect
      .poll(() => sectionTitles(dialog))
      .toEqual(['Beta (copy)', 'Beta', 'Alpha']);
    await saveViewEditor(dialog);

    const panels = page.locator('boards board-panel');
    await expect(panels).toHaveCount(3);
    await expect(page.locator('boards board')).not.toHaveClass(/isSingleColumn/);
    await expect(panels.nth(0).locator('header')).toContainText('Beta (copy)');
    await expect(panels.nth(1).locator('header')).toContainText('Beta');
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
    await expect(viewRuleChip(section, 'Planned Date')).toContainText('Other (kept)');
    await expect(section.getByRole('button', { name: /^Sort by: / })).toContainText(
      'Other (kept)',
    );
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
    await expect(viewEditorName(dialog)).toHaveText('Kanban');
    await expect
      .poll(() => sectionTitles(dialog))
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
    await expect(viewEditorName(dialog)).toHaveText('Kanban');
    await expect(page).toHaveURL(/#\/boards\/KANBAN_DEFAULT$/);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();

    // From the keyboard too.
    await title.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/#\/boards\/KANBAN_DEFAULT$/);
  });

  test('opens and closes the sections of a board each on its own, closed as a summary', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.goto('/#/boards/KANBAN_DEFAULT');
    await expect(page.locator('boards board-panel')).toHaveCount(3);

    const dialog = await openViewEditor(page);
    const card = (i: number): Locator => viewEditorSection(dialog, i);
    await expect(dialog.locator('view-editor-section')).toHaveCount(3);
    await expect(
      dialog.getByRole('heading', { name: 'Columns', exact: true }),
    ).toBeVisible();
    // The first card starts open: its rules as chips, no summary.
    await expect(card(0).locator('.section-toggle')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(card(0).locator('.summary')).toHaveCount(0);
    await expect(card(0).locator('[data-rule="done"]')).toBeVisible();
    await expect(
      dialog.getByRole('group', { name: 'Column 1', exact: true }),
    ).toBeVisible();
    // A collapsed card: its title and its rules in one line.
    await expect(card(1).locator('.section-toggle')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    const done = card(2);
    await expect(done.locator('.section-title')).toHaveText('Done');
    await expect(done.locator('.summary')).toContainText(
      'Backlog: Exclude backlog · Completion: Completed',
    );
    await expect(done.locator('view-rule-chip')).toHaveCount(0);

    // Opening one by keyboard keeps the other open and the focus on its chevron.
    const doneToggle = done.locator('.section-toggle');
    // The dialog's own first focus (the dialog itself) first, or it takes
    // the focus back.
    await expect(page.locator('mat-dialog-container')).toBeFocused();
    await doneToggle.focus();
    await page.keyboard.press('Enter');
    await expect(doneToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(done.locator('[data-rule="done"]')).toBeVisible();
    await expect(doneToggle).toBeFocused();
    // Under its Rules label, a "Completed" column counts its done tasks.
    await expect(done.locator('.form-label .count')).toHaveText(/^\d+ done$/);
    await expect(card(0).locator('[data-rule="done"]')).toBeVisible();

    // A click on its bar, the title too, closes it.
    await done.locator('.section-title').click();
    await expect(doneToggle).toHaveAttribute('aria-expanded', 'false');
    // One summary once the earlier one's leave animation is over.
    await expect(done.locator('.summary')).toHaveCount(1);
    await expect(done.locator('.summary')).toBeVisible();
  });

  test("a column's title opens the editor with that column open", async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.goto('/#/boards/KANBAN_DEFAULT');
    const done = page.locator('boards board-panel').nth(2);
    await expect(done).toBeVisible();
    // No edit button of its own: the title is it.
    await expect(
      done.locator('header').getByRole('button', { name: 'Edit', exact: true }),
    ).toHaveCount(0);

    await columnTitleButton(done, 'Done').click();
    const dialog = page.locator('dialog-board-edit');
    await expect(dialog).toBeVisible();
    const doneCard = viewEditorSection(dialog, 2);
    await expect(doneCard.locator('.section-body')).toBeVisible();
    await expect(viewEditorSection(dialog, 0).locator('.section-toggle')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    // Focus starts on that column's title, as text (not the view's name),
    // which also brings it into view below the collapsed cards.
    const title = doneCard.getByRole('button', { name: 'Rename Done', exact: true });
    await expect(title).toBeFocused();
    await expect(title).toBeInViewport();
    await expect(page).toHaveURL(/#\/boards\/KANBAN_DEFAULT$/);
  });

  test("a tag rule's menu filters the tags and creates a missing one", async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const dialog = await openCreateViewDialog(page);
    await fillViewEditor(page, dialog, { title: `${testPrefix}-Tagged` });
    const section = viewEditorSection(dialog, 0);
    await section.getByRole('button', { name: 'Add rule', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Required Tags', exact: true }).click();

    // The rule's menu opens with its filter focused (not on touch).
    const filter = page.getByRole('searchbox', { name: 'Filter tags', exact: true });
    await expect(filter).toBeFocused();
    const tag = `${testPrefix}-errands`;
    await filter.pressSequentially(tag);
    await expect(page.getByRole('menuitemcheckbox')).toHaveCount(0);
    await page
      .getByRole('menuitem', { name: `Create tag “${tag}”`, exact: true })
      .click();
    // Created and picked; the menu stays open for more.
    await expect(
      page.getByRole('menuitemcheckbox', { name: tag, exact: true }),
    ).toHaveAttribute('aria-checked', 'true');
    await expect(filter).toHaveValue('');
    // An existing title creates nothing.
    await filter.fill(tag.toUpperCase());
    await expect(page.getByRole('menuitem', { name: /^Create tag/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('.mat-mdc-menu-panel')).toHaveCount(0);
    await expect(viewRuleChip(section, 'Required Tags')).toContainText(tag);
    await saveViewEditor(dialog);
    await expect(page).toHaveURL(/#\/boards\/[^/]+$/);

    const board = await readBoard(page, viewIdFromUrl(page));
    const tagIds = (board?.panels[0] as { includedTagIds: string[] }).includedTagIds;
    expect(tagIds.length).toBe(1);
  });

  test('a created view arrives with a snack naming it', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const title = `${testPrefix}-Arrived`;
    await createView(page, { title });
    await expect(
      page.locator('snack-custom').filter({ hasText: `View "${title}" created` }),
    ).toBeVisible();
    await expect(page.locator('page-title')).toContainText(title);
  });
});
