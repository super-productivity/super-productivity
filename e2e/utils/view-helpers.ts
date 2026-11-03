import { expect, Locator, Page } from '@playwright/test';

/**
 * Opens the "Create view" dialog from the + of the side menu's Views section.
 * The + only shows on hover (desktop), like the other section buttons.
 */
export const openCreateViewDialog = async (page: Page): Promise<Locator> => {
  await page.locator('nav-view-group > div.g-multi-btn-wrapper').hover();
  await page.locator('[data-nav-btn="add-view"]').click();
  const dialog = page.locator('dialog-board-edit');
  await expect(dialog).toBeVisible();
  return dialog;
};

/** Opens the editor of the open view from the title bar's "More actions". */
export const openViewEditor = async (page: Page): Promise<Locator> => {
  await page
    .locator('page-title .page-title-actions')
    .getByRole('button', { name: 'More actions' })
    .click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const dialog = page.locator('dialog-board-edit');
  await expect(dialog).toBeVisible();
  return dialog;
};

/**
 * The title bar's List/Board button ("Show as board" / "Show as list"):
 * switches the open view to the other mode and waits for it.
 */
export const toggleViewLayout = async (page: Page): Promise<void> => {
  const board = page.locator('boards board');
  const wasList = await board.evaluate((el) => el.classList.contains('isListLayout'));
  await page
    .locator('page-title .page-title-actions')
    .getByRole('button', { name: wasList ? 'Show as board' : 'Show as list' })
    .click();
  if (wasList) {
    await expect(board).not.toHaveClass(/isListLayout/);
  } else {
    await expect(board).toHaveClass(/isListLayout/);
  }
};

/** A stored view (board), as the store holds it. */
export type BoardState = {
  id: string;
  title: string;
  cols: number;
  boardCols?: number;
  panels: unknown[];
};

/** Reads a view (board) from the store. */
export const readBoard = (page: Page, id: string): Promise<BoardState | undefined> =>
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

/**
 * A board column's title, a button that opens the view editor with that
 * column's section open.
 */
export const columnTitleButton = (panel: Locator, title: string): Locator =>
  panel.locator('header').getByRole('button', { name: title, exact: true });

/** A view row of the side menu's Views section, by view id. */
export const sideNavViewRow = (page: Page, viewId: string): Locator =>
  page.locator(`nav-view-group [data-view-id="${viewId}"]`);

/**
 * A rule of a section, by its label in the Add-rule menu ("Priority",
 * "Planned Date", "Completion", "Required Tags", …). `value` is the label of
 * the option to pick; tag rules take tag titles; Project takes project titles.
 */
export interface ViewRuleSpec {
  rule: string;
  value?: string;
  tags?: string[];
  projects?: string[];
}

export interface ViewSectionSpec {
  /** Not needed for the only section of a list (its title is hidden). */
  title?: string;
  rules?: ViewRuleSpec[];
  /** A sort option label ("Manual", "Title", "Created", …). */
  sort?: string;
}

export interface ViewSpec {
  title?: string;
  /** Default: list. */
  layout?: 'list' | 'board';
  columns?: number;
  /** Sections (List) or columns (Board), in order. */
  sections?: ViewSectionSpec[];
}

/** A section card of the open view editor. */
export const viewEditorSection = (dialog: Locator, index: number): Locator =>
  dialog.locator('view-editor-section').nth(index);

/** The open view editor's name (the dialog title) as text. */
export const viewEditorName = (dialog: Locator): Locator =>
  dialog.locator('[mat-dialog-title] view-editor-title .title-text');

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Opens a section card's rules. With several sections each card opens and
 * closes on its own (its chevron); a single section is always open, a list's
 * without a card.
 */
export const expandViewSection = async (section: Locator): Promise<void> => {
  // The section first: a toggle counted before it renders would read as none.
  await expect(section.locator('.section-header, .section-body').first()).toBeVisible();
  const toggle = section.locator('.section-toggle[aria-expanded="false"]');
  if (await toggle.count()) {
    await toggle.click();
  }
  await expect(section.locator('.section-body')).toBeVisible();
};

/**
 * A rule's chip button ("Priority: High", "Required Tags: …"), by the rule's
 * label.
 */
export const viewRuleChip = (section: Locator, rule: string): Locator =>
  section.getByRole('button', { name: new RegExp(`^${escapeRegExp(rule)}(:|$)`) });

/** Picks a radio item of the open menu and waits for the menu to close. */
const pickMenuRadio = async (page: Page, option: string): Promise<void> => {
  await page.getByRole('menuitemradio', { name: option, exact: true }).click();
  await expect(page.locator('.mat-mdc-menu-panel')).toHaveCount(0);
};

/**
 * Ticks checkbox items of the open menu (it stays open), then closes it.
 * Where the menu has a filter (always for tags, from 9 projects), each name
 * is typed into it first, so long lists need no scrolling.
 */
const tickMenuItems = async (page: Page, names: string[]): Promise<void> => {
  const filter = page.locator('.mat-mdc-menu-panel .menu-filter input');
  for (const name of names) {
    if (await filter.isVisible()) {
      await filter.fill(name);
    }
    await page.getByRole('menuitemcheckbox', { name, exact: true }).click();
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('.mat-mdc-menu-panel')).toHaveCount(0);
};

/**
 * Adds a rule to a section and sets its value. Tags and projects must exist
 * (the rule's menu lists them).
 */
export const addViewRule = async (
  page: Page,
  section: Locator,
  spec: ViewRuleSpec,
): Promise<void> => {
  await expandViewSection(section);
  await section.getByRole('button', { name: 'Add rule', exact: true }).click();
  await page.getByRole('menuitem', { name: spec.rule, exact: true }).click();
  if (spec.projects || spec.tags) {
    // Adding a project or tag rule opens its menu.
    await expect(page.locator('.mat-mdc-menu-panel')).toHaveCount(1);
    await tickMenuItems(page, spec.projects ?? spec.tags ?? []);
  } else if (spec.value) {
    await setViewRule(page, section, spec.rule, spec.value);
  }
};

/** Changes the value of a rule a section already shows. */
export const setViewRule = async (
  page: Page,
  section: Locator,
  rule: string,
  value: string,
): Promise<void> => {
  await expandViewSection(section);
  await viewRuleChip(section, rule).click();
  await pickMenuRadio(page, value);
};

/**
 * Picks a section's sort ("Manual", "Title", …). A sort key keeps the menu
 * open for its direction: Escape closes it.
 */
export const setViewSort = async (
  page: Page,
  section: Locator,
  sort: string,
): Promise<void> => {
  await expandViewSection(section);
  await section.getByRole('button', { name: /^Sort by: / }).click();
  await page.getByRole('menuitemradio', { name: sort, exact: true }).click();
  if (sort !== 'Manual') {
    await expect(
      page.getByRole('menuitemradio', { name: sort, exact: true }),
    ).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
  }
  await expect(page.locator('.mat-mdc-menu-panel')).toHaveCount(0);
};

/**
 * Renames through a title shown as text: opens its field (unless open), fills
 * it and confirms with Enter.
 */
const renameTitle = async (
  field: Locator,
  openBtn: Locator,
  title: string,
): Promise<void> => {
  if (!(await field.isVisible())) {
    await openBtn.click();
  }
  await field.fill(title);
  if (title) {
    await field.press('Enter');
    await expect(field).toBeHidden();
  }
};

/** Sets the view's layout and columns. */
const setViewLayout = async (
  dialog: Locator,
  layout: ViewSpec['layout'],
  columns: number | undefined,
): Promise<void> => {
  const toggle = dialog.locator('view-editor mat-button-toggle-group');
  if (layout) {
    await toggle
      .getByRole('radio', { name: layout === 'board' ? 'Board' : 'List', exact: true })
      .click();
  }
  if (columns !== undefined) {
    const value = dialog.locator('.cols-value');
    for (let i = 0; i < 20; i++) {
      const current = Number(await value.innerText());
      if (current === columns) break;
      await dialog
        .getByRole('button', {
          name: current < columns ? 'More columns' : 'Fewer columns',
          exact: true,
        })
        .click();
    }
    await expect(value).toHaveText(String(columns));
  }
};

/**
 * Fills the open view editor: title, sections with their rules and sort, then
 * the layout (Board sets the columns to the section count) and columns.
 * Sections beyond the ones the view has are added.
 */
export const fillViewEditor = async (
  page: Page,
  dialog: Locator,
  spec: ViewSpec,
): Promise<void> => {
  if (spec.title !== undefined) {
    await renameTitle(
      dialog.getByRole('textbox', { name: 'Title', exact: true }),
      dialog.getByRole('button', { name: 'Rename', exact: true }),
      spec.title,
    );
  }
  const sections = spec.sections ?? [];
  const cards = dialog.locator('view-editor-section');
  while ((await cards.count()) < sections.length) {
    const count = await cards.count();
    await dialog.getByRole('button', { name: /^Add (section|column)$/ }).click();
    await expect(cards).toHaveCount(count + 1);
  }
  if (spec.layout || spec.columns !== undefined) {
    await setViewLayout(dialog, spec.layout, spec.columns);
  }
  for (const [i, section] of sections.entries()) {
    const card = viewEditorSection(dialog, i);
    // A closed card shows its title as part of its bar: open it to rename.
    const closed = card.locator('.section-toggle[aria-expanded="false"]');
    if (section.title !== undefined && (await closed.count())) {
      await closed.click();
    }
    if (section.title !== undefined) {
      await renameTitle(
        card.getByRole('textbox', { name: /^(Section|Column) title$/ }),
        card.locator('view-editor-title .title-btn'),
        section.title,
      );
    }
    for (const rule of section.rules ?? []) {
      await addViewRule(page, card, rule);
    }
    if (section.sort) {
      await setViewSort(page, card, section.sort);
    }
  }
};

/** Saves the editor and waits for the dialog to close. */
export const saveViewEditor = async (dialog: Locator): Promise<void> => {
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
};

/**
 * Creates a view through the editor and waits for it to open with its
 * sections. A new view starts with one section (a List by default).
 */
export const createView = async (page: Page, spec: ViewSpec): Promise<void> => {
  const dialog = await openCreateViewDialog(page);
  await fillViewEditor(page, dialog, spec);
  await saveViewEditor(dialog);
  await expect(page).toHaveURL(/#\/boards\/[^/]+$/);
  await expect(page.locator('boards board-panel')).toHaveCount(
    Math.max(1, spec.sections?.length ?? 1),
  );
};

/**
 * Creates tasks with these titles in the Inbox in one go, through the store
 * (the UI would take minutes for long lists). Ids are `seeded-<index>`, so
 * call it once per test.
 */
export const seedInboxTasks = async (page: Page, titles: string[]): Promise<void> => {
  await page.evaluate((taskTitles) => {
    const store = (
      window as unknown as {
        __e2eTestHelpers?: { store?: { dispatch: (action: unknown) => void } };
      }
    ).__e2eTestHelpers?.store;
    if (!store) throw new Error('__e2eTestHelpers.store missing');
    const operations = taskTitles.map((title, index) => ({
      type: 'create',
      tempId: `temp-${index}`,
      data: { title },
    }));
    const createdTaskIds = Object.fromEntries(
      operations.map(({ tempId }, index) => [tempId, `seeded-${index}`]),
    );
    for (let offset = 0; offset < operations.length; offset += 50) {
      store.dispatch({
        type: '[Task Shared] batchUpdateForProject',
        projectId: 'INBOX_PROJECT',
        operations: operations.slice(offset, offset + 50),
        createdTaskIds,
        createdTaskTimestamp: Date.now(),
        meta: {
          isPersistent: true,
          entityType: 'PROJECT',
          entityId: 'INBOX_PROJECT',
          opType: 'BATCH',
        },
      });
    }
  }, titles);
};
