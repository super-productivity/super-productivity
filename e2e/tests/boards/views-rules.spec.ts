import { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { waitForStatePersistence } from '../../utils/waits';
import {
  createView,
  openViewEditor,
  saveViewEditor,
  setViewSort,
  sideNavViewRow,
  viewEditorSection,
} from '../../utils/view-helpers';

/**
 * Views (boards) with the filter menu's rules: priority and deadline columns,
 * "Save as view…" from a task list's filter menu, and the view's title bar.
 */

const viewIdFromUrl = (page: Page): string => {
  const id = page.url().match(/#\/boards\/([^/?]+)/)?.[1];
  if (!id) {
    throw new Error(`not on a view page: ${page.url()}`);
  }
  return id;
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

    await createView(page, {
      title: `${testPrefix}-Priorities`,
      sections: [
        { title: 'No priority', rules: [{ rule: 'Priority', value: 'Not set' }] },
        { title: 'High', rules: [{ rule: 'Priority', value: 'High' }] },
      ],
    });

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

    await createView(page, {
      title: `${testPrefix}-Deadlines`,
      sections: [
        { title: 'Any' },
        { title: 'Due today', rules: [{ rule: 'Deadline', value: 'Today' }] },
      ],
    });

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

  test('saves a filtered Today as the filter alone, named after it, and turns Views on', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    // Views off, as on a new install: "Save as view…" is still offered.
    await workViewPage.waitForTaskList();
    await page.locator('nav-view-group nav-item').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Disable feature' }).click();
    await expect(page.locator('nav-view-group')).toHaveCount(0);

    await page.goto('/#/project/INBOX_PROJECT/tasks');
    await workViewPage.waitForTaskList();
    const later = `${testPrefix}-Later`;
    await workViewPage.addTask(later);
    await page.goto('/#/tag/TODAY/tasks');
    await workViewPage.waitForTaskList();
    const now = `${testPrefix}-Now`;
    await workViewPage.addTask(now);
    await expect(page.locator('task').filter({ hasText: later })).toHaveCount(0);

    // Today filtered to the Inbox project.
    await page.locator('.task-filter-btn').click();
    await page.getByRole('menuitem', { name: /Filter By/ }).click();
    await page.getByRole('menuitem', { name: 'Project', exact: true }).click();
    await page.getByPlaceholder('Filter Projects').fill('Inbox');
    // Back to the top menu: the input takes one Escape, each submenu one.
    const menus = page.locator('.mat-mdc-menu-panel');
    await expect(async () => {
      if ((await menus.count()) > 1) await page.keyboard.press('Escape');
      expect(await menus.count()).toBe(1);
    }).toPass();
    await page.getByRole('menuitem', { name: 'Save as view…' }).click();
    const dialog = page.locator('dialog-board-edit');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Title' })).toHaveValue('Inbox');
    await expect(dialog).toContainText('not only today');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();

    // Every matching task, not only today's, and Views are back in the menu.
    await expect(page).toHaveURL(/#\/boards\/[^/]+$/);
    const rows = page.locator('boards board-panel task');
    await expect(rows.filter({ hasText: now })).toHaveCount(1);
    await expect(rows.filter({ hasText: later })).toHaveCount(1);
    await expect(sideNavViewRow(page, viewIdFromUrl(page))).toBeVisible();
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

    // Only this test's tasks, in the order they were added.
    await createView(page, {
      title: `${testPrefix}-List`,
      sections: [{ sort: 'Created' }],
    });
    const rows = page.locator('boards board-panel task');
    const titles = async (): Promise<string[]> =>
      (await rows.locator('task-title').allInnerTexts())
        .map((title) => title.trim())
        .filter((title) => title.startsWith(testPrefix));
    await expect.poll(titles).toEqual([first, second]);

    // Back to manual order, then move the second row up with the keyboard.
    const dialog = await openViewEditor(page);
    await setViewSort(page, viewEditorSection(dialog, 0), 'Manual');
    await saveViewEditor(dialog);

    await rows.filter({ hasText: second }).first().focus();
    await page.keyboard.press('Control+Shift+ArrowUp');
    await expect.poll(titles).toEqual([second, first]);

    await waitForStatePersistence(page);
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
    await createView(page, { title });
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

  test('the title-bar filter on a one-column view opens the view editor', async ({
    page,
    testPrefix,
  }) => {
    await createView(page, { title: `${testPrefix}-Filtered` });
    const dialog = page.locator('dialog-board-edit');

    // Where a list has its filter menu, a view has its editor: it covers
    // every rule, the menu only some.
    await page.locator('page-title .task-filter-btn').click();
    await expect(dialog).toBeVisible();
    await expect(page.locator('.mat-mdc-menu-panel')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // The filter shortcut does the same.
    await page.keyboard.press('c');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('view-editor-section')).toHaveCount(1);
  });

  test('a view with several columns has no title-bar filter', async ({ page }) => {
    for (const id of ['KANBAN_DEFAULT', 'EISENHOWER_MATRIX']) {
      // A fresh profile lacks some of their tags, so the page may show a
      // "create tag" prompt instead of panels; the title bar is the same.
      await page.goto(`/#/boards/${id}`);
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
  });
});
