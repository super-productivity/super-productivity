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

/**
 * Opens a section card's rules. With several sections one card is open at a
 * time; a single section has no toggle and is always open.
 */
export const expandViewSection = async (section: Locator): Promise<void> => {
  const toggle = section.locator('.section-toggle');
  if (
    (await toggle.count()) &&
    (await toggle.getAttribute('aria-expanded')) === 'false'
  ) {
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  }
};

/** Picks an option of a select in the editor, by its accessible name. */
const pickOption = async (
  page: Page,
  scope: Locator,
  selectName: string,
  option: string,
): Promise<void> => {
  await scope.getByRole('combobox', { name: selectName, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(page.locator('.mat-mdc-select-panel')).toHaveCount(0);
};

/** Adds a rule to a section and sets its value. */
export const addViewRule = async (
  page: Page,
  section: Locator,
  spec: ViewRuleSpec,
): Promise<void> => {
  await expandViewSection(section);
  await section.getByRole('button', { name: 'Add rule' }).click();
  await page.getByRole('menuitem', { name: spec.rule, exact: true }).click();
  if (spec.projects) {
    // Adding the rule opens its select.
    for (const project of spec.projects) {
      await page.getByRole('option', { name: project, exact: true }).click();
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('.mat-mdc-select-panel')).toHaveCount(0);
  } else if (spec.tags) {
    const input = section
      .locator('.rule-row')
      .filter({ has: page.locator('.rule-label', { hasText: spec.rule }) })
      .locator('tag-edit input');
    for (const tag of spec.tags) {
      await input.fill(tag);
      await page.keyboard.press('Enter');
    }
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
  await pickOption(page, section, rule, value);
};

/** Picks a section's sort ("Manual", "Title", …). */
export const setViewSort = async (
  page: Page,
  section: Locator,
  sort: string,
): Promise<void> => {
  await expandViewSection(section);
  await pickOption(page, section, 'Sort by', sort);
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
    await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill(spec.title);
  }
  const sections = spec.sections ?? [];
  const cards = dialog.locator('view-editor-section');
  while ((await cards.count()) < sections.length) {
    const count = await cards.count();
    await dialog.getByRole('button', { name: /^Add (section|column)$/ }).click();
    await expect(cards).toHaveCount(count + 1);
  }
  if (spec.layout) {
    await dialog
      .locator('view-editor segmented-button-group')
      .getByRole('radio', {
        name: spec.layout === 'board' ? 'Board' : 'List',
        exact: true,
      })
      .click();
  }
  if (spec.columns !== undefined) {
    await dialog
      .getByRole('spinbutton', { name: 'Columns', exact: true })
      .fill(String(spec.columns));
  }
  for (const [i, section] of sections.entries()) {
    const card = viewEditorSection(dialog, i);
    if (section.title !== undefined) {
      await card
        .getByRole('textbox', { name: /^(Section|Column) title$/ })
        .fill(section.title);
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
