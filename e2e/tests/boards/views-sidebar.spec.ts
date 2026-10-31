import { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { waitForStatePersistence } from '../../utils/waits';
import { openCreateViewDialog, sideNavViewRow } from '../../utils/view-helpers';

/**
 * Boards are views: each one is a row in the side menu's Views section with
 * its own route, `/boards/<id>`. A column can require a due date; moving a
 * task into it schedules the task, unless no date can satisfy the rule.
 */

const viewIdFromUrl = (page: Page): string => {
  const id = page.url().match(/#\/boards\/([^/?]+)/)?.[1];
  if (!id) {
    throw new Error(`not on a view page: ${page.url()}`);
  }
  return id;
};

const fillViewTitle = async (dialog: Locator, title: string): Promise<void> => {
  await dialog
    .locator('board-edit')
    .getByRole('textbox', { name: 'Title', exact: true })
    .first()
    .fill(title);
};

test.describe('Views in the side menu', () => {
  test('creates a view from the side menu, keeps it on reload and leaves it on delete', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const sideNav = page.locator('magic-side-nav');
    // The Boards entry and tab bar are gone; views are listed one by one.
    await expect(sideNav.getByRole('menuitem', { name: 'Boards' })).toHaveCount(0);
    await expect(sideNav.getByRole('menuitem', { name: 'Views' })).toBeVisible();

    const title = `${testPrefix}-Quick wins`;
    const dialog = await openCreateViewDialog(page);
    await expect(dialog.getByRole('button', { name: /Delete/ })).toHaveCount(0);
    await fillViewTitle(dialog, title);
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();

    // Saving opens the new view.
    await expect(page).toHaveURL(/#\/boards\/[^/]+$/);
    const viewId = viewIdFromUrl(page);
    const row = sideNavViewRow(page, viewId);
    await expect(row).toContainText(title);
    await expect(page.locator('boards')).toBeVisible();

    // A deep link to a custom view survives a reload (the store only holds the
    // default views until the data has loaded).
    await waitForStatePersistence(page);
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`#/boards/${viewId}$`));
    await expect(sideNavViewRow(page, viewId)).toContainText(title);

    // Deleting the open view moves to another one.
    await sideNavViewRow(page, viewId).locator('a.nav-link').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page
      .locator('dialog-confirm')
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await expect(sideNavViewRow(page, viewId)).toHaveCount(0);
    await expect(page).toHaveURL(/#\/boards\/[^/]+$/);
    expect(viewIdFromUrl(page)).not.toBe(viewId);
  });

  test('a Today column schedules a task moved into it, an Overdue column refuses it', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    // Add the task in the Inbox, so it starts without a due date.
    await page.goto('/#/project/INBOX_PROJECT/tasks');
    await workViewPage.waitForTaskList();
    const taskTitle = `${testPrefix}-Due task`;
    await workViewPage.addTask(taskTitle);

    const dialog = await openCreateViewDialog(page);
    const form = dialog.locator('board-edit');
    await fillViewTitle(dialog, `${testPrefix}-Due columns`);
    const titles = form.getByRole('textbox', { name: 'Title', exact: true });
    for (const [i, name] of ['Unscheduled', 'Due today', 'Overdue'].entries()) {
      await form.getByRole('button', { name: 'Add new Panel' }).click();
      // The new panel row renders asynchronously.
      await expect(titles).toHaveCount(i + 2);
      await titles.last().fill(name);
    }
    await form.getByText('Not Scheduled', { exact: true }).first().click();
    const dueDate = form.getByRole('combobox', { name: 'Due date', exact: true });
    await dueDate.nth(1).click();
    await page.getByRole('option', { name: 'Today', exact: true }).click();
    await dueDate.nth(2).click();
    await page.getByRole('option', { name: 'Overdue', exact: true }).click();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();

    const panels = page.locator('boards board-panel');
    await expect(panels).toHaveCount(3);
    const card = (panelIndex: number): Locator =>
      panels.nth(panelIndex).locator('planner-task').filter({ hasText: taskTitle });
    await expect(card(0)).toHaveCount(1);
    await expect(card(1)).toHaveCount(0);
    // No date makes a task overdue, so that column has no add row.
    await expect(panels.nth(2).locator('add-task-inline')).toHaveCount(0);

    // Unscheduled → Due today: the task gets scheduled for today.
    await card(0).focus();
    await page.keyboard.press('Control+Shift+ArrowDown');
    await expect(card(1)).toHaveCount(1);
    await expect(card(0)).toHaveCount(0);

    // Due today → Overdue: refused, the task and its focus stay.
    await card(1).focus();
    await page.keyboard.press('Control+Shift+ArrowDown');
    await expect(card(1)).toBeFocused();
    await expect(card(2)).toHaveCount(0);

    // It really is due today.
    await page.goto('/#/tag/TODAY/tasks');
    await expect(page.locator('task').filter({ hasText: taskTitle })).toHaveCount(1);
  });
});
