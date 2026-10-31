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

/** Creates a one-column-per-panel view with the given panel titles. */
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
      panels.nth(i).locator('planner-task').filter({ hasText: taskTitle });
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
      panels.nth(i).locator('planner-task').filter({ hasText: taskTitle });
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
    await expect(
      column.locator('planner-task').filter({ hasText: unplanned }),
    ).toHaveCount(1);
    await expect(column.locator('planner-task').filter({ hasText: planned })).toHaveCount(
      0,
    );
    // One column reads like a list.
    await expect(page.locator('boards board')).toHaveClass(/isSingleColumn/);
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
});
