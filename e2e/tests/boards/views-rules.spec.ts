import { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { openCreateViewDialog, sideNavViewRow } from '../../utils/view-helpers';

/**
 * Views (boards) with the filter menu's rules: priority and deadline columns,
 * "Save as view…" from a task list's filter menu, and the view's title-bar
 * menu.
 */

const viewIdFromUrl = (page: Page): string => {
  const id = page.url().match(/#\/boards\/([^/?]+)/)?.[1];
  if (!id) {
    throw new Error(`not on a view page: ${page.url()}`);
  }
  return id;
};

/** Creates a view with the given panels stacked in one column. */
const createView = async (
  page: Page,
  title: string,
  panelTitles: string[],
  configure: (form: Locator) => Promise<void>,
): Promise<void> => {
  const dialog = await openCreateViewDialog(page);
  const form = dialog.locator('board-edit');
  const titles = form.getByRole('textbox', { name: 'Title', exact: true });
  await titles.first().fill(title);
  for (const [i, name] of panelTitles.entries()) {
    await form.getByRole('button', { name: 'Add new Panel' }).click();
    await expect(titles).toHaveCount(i + 2);
    await titles.last().fill(name);
  }
  await configure(form);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('boards board-panel')).toHaveCount(panelTitles.length);
};

const pickOption = async (
  page: Page,
  form: Locator,
  label: string,
  index: number,
  option: string,
): Promise<void> => {
  await form.getByRole('combobox', { name: label, exact: true }).nth(index).click();
  await page.getByRole('option', { name: option, exact: true }).click();
};

test.describe('View rules', () => {
  test('a priority column sets the priority of a task moved into it', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await page.goto('/#/project/INBOX_PROJECT/tasks');
    await workViewPage.waitForTaskList();
    const taskTitle = `${testPrefix}-Prioritize me`;
    await workViewPage.addTask(taskTitle);

    await createView(
      page,
      `${testPrefix}-Priorities`,
      ['No priority', 'High'],
      async (form) => {
        await pickOption(page, form, 'Priority', 0, 'Not set');
        await pickOption(page, form, 'Priority', 1, 'High');
      },
    );

    const panels = page.locator('boards board-panel');
    const card = (i: number): Locator =>
      panels.nth(i).locator('task').filter({ hasText: taskTitle });
    await expect(card(0)).toHaveCount(1);

    await card(0).focus();
    await page.keyboard.press('Control+Shift+ArrowDown');
    await expect(card(1)).toHaveCount(1);
    await expect(card(0)).toHaveCount(0);
  });

  test('a "deadline today" column plans a moved task for today', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await page.goto('/#/project/INBOX_PROJECT/tasks');
    await workViewPage.waitForTaskList();
    const taskTitle = `${testPrefix}-Due by tonight`;
    await workViewPage.addTask(taskTitle);

    await createView(
      page,
      `${testPrefix}-Deadlines`,
      ['Any', 'Due today'],
      async (form) => {
        await pickOption(page, form, 'Deadline', 1, 'Today');
      },
    );

    const panels = page.locator('boards board-panel');
    const card = (i: number): Locator =>
      panels.nth(i).locator('task').filter({ hasText: taskTitle });
    await card(0).focus();
    await page.keyboard.press('Control+Shift+ArrowDown');
    await expect(card(1)).toHaveCount(1);

    // A deadline of today plans the task into Today.
    await page.goto('/#/tag/TODAY/tasks');
    await expect(page.locator('task').filter({ hasText: taskTitle })).toHaveCount(1);
  });

  test('saves a filtered list as a view with the same tasks', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await page.goto('/#/project/INBOX_PROJECT/tasks');
    await workViewPage.waitForTaskList();
    const unplanned = `${testPrefix}-Unplanned`;
    const planned = `${testPrefix}-Planned`;
    await workViewPage.addTask(unplanned);
    await workViewPage.addTask(`${planned} @tomorrow`);
    await expect(page.locator('task').filter({ hasText: planned })).toHaveCount(1);

    // Filter the Inbox to tasks without a planned date.
    await page.locator('.task-filter-btn').click();
    await page.getByRole('menuitem', { name: /Filter By/ }).click();
    await page.getByRole('menuitem', { name: 'Planned Date', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Not specified', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('task').filter({ hasText: planned })).toHaveCount(0);

    await page.locator('.task-filter-btn').click();
    await page.getByRole('menuitem', { name: 'Save as view…' }).click();
    const dialog = page.locator('dialog-board-edit');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();

    await expect(page).toHaveURL(/#\/boards\/[^/]+$/);
    const column = page.locator('boards board-panel');
    await expect(column).toHaveCount(1);
    // One column: task rows, like the list it came from.
    await expect(column.locator('task').filter({ hasText: unplanned })).toHaveCount(1);
    await expect(column.locator('task').filter({ hasText: planned })).toHaveCount(0);
    await expect(column.locator('planner-task')).toHaveCount(0);
    await expect(page.locator('boards board')).toHaveClass(/isSingleColumn/);
  });

  test('a one-column view lists task rows and keeps a keyboard reorder', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await page.goto('/#/project/INBOX_PROJECT/tasks');
    await workViewPage.waitForTaskList();
    const first = `${testPrefix}-First`;
    const second = `${testPrefix}-Second`;
    await workViewPage.addTask(first);
    await workViewPage.addTask(second);

    await createView(page, `${testPrefix}-List`, ['Mine'], async (form) => {
      // Only this test's tasks, in the order they were added.
      await pickOption(page, form, 'Sort by', 0, 'Created');
    });
    const rows = page.locator('boards board-panel task');
    const titles = async (): Promise<string[]> =>
      (await rows.locator('task-title').allInnerTexts())
        .map((title) => title.trim())
        .filter((title) => title.startsWith(testPrefix));
    await expect.poll(titles).toEqual([first, second]);

    // Back to manual order, then move the second row up with the keyboard.
    await page
      .locator('page-title .page-title-actions')
      .getByRole('button', { name: 'More actions' })
      .click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    const dialog = page.locator('dialog-board-edit');
    await pickOption(page, dialog.locator('board-edit'), 'Sort by', 0, 'Manual');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();

    await rows.filter({ hasText: second }).first().focus();
    await page.keyboard.press('Control+Shift+ArrowUp');
    await expect.poll(titles).toEqual([second, first]);

    await page.reload();
    await expect.poll(titles).toEqual([second, first]);
  });

  test('the title bar menu duplicates and deletes the open view', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const title = `${testPrefix}-Menu view`;
    await createView(page, title, ['Everything'], async () => undefined);
    const originalId = viewIdFromUrl(page);

    const titleMenu = page
      .locator('page-title .page-title-actions')
      .getByRole('button', { name: 'More actions' });
    await titleMenu.click();
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();
    await expect(page).not.toHaveURL(new RegExp(`#/boards/${originalId}$`));
    const copyId = viewIdFromUrl(page);
    await expect(sideNavViewRow(page, copyId)).toContainText(`${title} (copy)`);

    await titleMenu.click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page
      .locator('dialog-confirm')
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await expect(sideNavViewRow(page, copyId)).toHaveCount(0);
    await expect(sideNavViewRow(page, originalId)).toHaveCount(1);
  });

  test('the title-bar filter sets a rule on a one-column view and clears it again', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await page.goto('/#/project/INBOX_PROJECT/tasks');
    await workViewPage.waitForTaskList();
    const unplanned = `${testPrefix}-Unplanned`;
    const planned = `${testPrefix}-Planned`;
    await workViewPage.addTask(unplanned);
    await workViewPage.addTask(`${planned} @tomorrow`);
    await expect(page.locator('task').filter({ hasText: planned })).toHaveCount(1);

    await createView(
      page,
      `${testPrefix}-Filtered`,
      ['Everything'],
      async () => undefined,
    );
    const rows = page.locator('boards board-panel task');
    await expect(rows.filter({ hasText: unplanned })).toHaveCount(1);
    await expect(rows.filter({ hasText: planned })).toHaveCount(1);

    const filterBtn = page.locator('page-title .task-filter-btn');
    const pickNotPlanned = async (): Promise<void> => {
      await filterBtn.click();
      await page.getByRole('menuitem', { name: /Filter By/ }).click();
      await page.getByRole('menuitem', { name: /Planned Date/ }).click();
      await page.getByRole('menuitem', { name: 'Not specified', exact: true }).click();
      await expect(page.locator('.mat-mdc-menu-panel')).toHaveCount(0);
    };

    // List-only items are not offered on a view.
    await filterBtn.click();
    await expect(page.getByRole('menuitem', { name: /Sort/ }).first()).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Group By/ })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Save as view…' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: /Reset All/i })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await pickNotPlanned();
    await expect(rows.filter({ hasText: planned })).toHaveCount(0);
    await expect(rows.filter({ hasText: unplanned })).toHaveCount(1);

    // The rule is the view's own, so it survives a reload.
    await page.reload();
    await expect(rows.filter({ hasText: unplanned })).toHaveCount(1);
    await expect(rows.filter({ hasText: planned })).toHaveCount(0);

    // Clicking the checked preset again clears the rule.
    await pickNotPlanned();
    await expect(rows.filter({ hasText: planned })).toHaveCount(1);
    await expect(rows.filter({ hasText: unplanned })).toHaveCount(1);
  });

  test('a view with several columns has no title-bar filter', async ({ page }) => {
    for (const id of ['KANBAN_DEFAULT', 'EISENHOWER_MATRIX']) {
      await page.goto(`/#/boards/${id}`);
      await expect(page.locator('boards board-panel').first()).toBeVisible();
      await expect(
        page
          .locator('page-title .page-title-actions')
          .getByRole('button', { name: 'More actions' }),
      ).toBeVisible();
      await expect(page.locator('page-title .task-filter-btn')).toHaveCount(0);
    }
  });

  test('saving a list grouped by tag makes a section per tag and "Other"', async ({
    page,
    workViewPage,
    tagPage,
    testPrefix,
  }) => {
    await page.goto('/#/project/INBOX_PROJECT/tasks');
    await workViewPage.waitForTaskList();
    // Pre-created, so the short syntax attaches them without a confirm dialog.
    await tagPage.createTag('alpha');
    await tagPage.createTag('beta');
    const inAlpha = `${testPrefix}-In alpha`;
    const inBeta = `${testPrefix}-In beta`;
    const untagged = `${testPrefix}-Untagged`;
    await workViewPage.addTask(`${inAlpha} #alpha`);
    await workViewPage.addTask(`${inBeta} #beta`);
    await workViewPage.addTask(untagged);

    await page.locator('.task-filter-btn').click();
    await page.getByRole('menuitem', { name: /Group By/ }).click();
    await page.getByRole('menuitem', { name: 'Tag', exact: true }).click();
    await expect(page.locator('work-view collapsible.is-group')).toHaveCount(3);

    await page.locator('.task-filter-btn').click();
    await page.getByRole('menuitem', { name: 'Save as view…' }).click();
    const dialog = page.locator('dialog-board-edit');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/#\/boards\/[^/]+$/);

    // One column, three sections in sidebar order, "Other" last.
    const sections = page.locator('boards board-panel');
    await expect(sections).toHaveCount(3);
    await expect(page.locator('boards board')).toHaveClass(/isSingleColumn/);
    const rowsIn = (i: number, title: string): Locator =>
      sections.nth(i).locator('task').filter({ hasText: title });
    await expect(sections.nth(0)).toContainText('alpha');
    await expect(rowsIn(0, inAlpha)).toHaveCount(1);
    await expect(rowsIn(0, inBeta)).toHaveCount(0);
    await expect(sections.nth(1)).toContainText('beta');
    await expect(rowsIn(1, inBeta)).toHaveCount(1);
    await expect(sections.nth(2)).toContainText('Other');
    await expect(rowsIn(2, untagged)).toHaveCount(1);
    await expect(rowsIn(2, inAlpha)).toHaveCount(0);

    // The sections differ by tag, so the title-bar menu can't edit tags.
    await page.locator('page-title .task-filter-btn').click();
    await page.getByRole('menuitem', { name: /Filter By/ }).click();
    await expect(page.getByRole('menuitem', { name: /^Tag/ })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: /Priority/ })).toBeEnabled();
  });
});
