import { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { openCreateViewDialog } from '../../utils/view-helpers';
import { waitForStatePersistence } from '../../utils/waits';

/**
 * A one-column view is one task list; its stacked panels are sections of it.
 * Rows move between sections by keyboard and by drag (through the target
 * section's rules), and the regular add-task bar adds into the open view.
 */

const createView = async (
  page: Page,
  title: string,
  sectionTitles: string[],
  configure: (form: Locator) => Promise<void> = async () => undefined,
): Promise<void> => {
  const dialog = await openCreateViewDialog(page);
  const form = dialog.locator('board-edit');
  const titles = form.getByRole('textbox', { name: 'Title', exact: true });
  await titles.first().fill(title);
  for (const [i, name] of sectionTitles.entries()) {
    await form.getByRole('button', { name: 'Add new Panel' }).click();
    await expect(titles).toHaveCount(i + 2);
    await titles.last().fill(name);
  }
  await configure(form);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('boards board-panel')).toHaveCount(sectionTitles.length);
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

/** A CDK drag with real pointer moves (dragTo is too fast for CDK). */
const dragRow = async (page: Page, row: Locator, target: Locator): Promise<void> => {
  const from = await row.locator('done-toggle').first().boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('drag source or target not visible');
  // Box centers, in steps (prettier drops the parentheses no-mixed-operators wants).
  const [fromHalfW, fromHalfH] = [from.width / 2, from.height / 2];
  const [toHalfW, toHalfH] = [to.width / 2, to.height / 2];
  const fromX = from.x + fromHalfW;
  const fromY = from.y + fromHalfH;
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move(fromX, fromY + 8, { steps: 3 });
  await page.mouse.move(to.x + toHalfW, to.y + toHalfH, { steps: 15 });
  await page.mouse.up();
};

test.describe('View sections', () => {
  test('moves a row into the next section by keyboard and by drag, applying its rules', async ({
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

    await createView(
      page,
      `${testPrefix}-Priorities`,
      ['Normal', 'High'],
      async (form) => {
        await pickOption(page, form, 'Priority', 0, 'Not set');
        await pickOption(page, form, 'Priority', 1, 'High');
      },
    );

    const sections = page.locator('boards board-panel');
    // Not CDK's placeholder, which sits in the target list until the drop ends.
    const row = (i: number, title: string): Locator =>
      sections
        .nth(i)
        .locator('task:not(.cdk-drag-placeholder)')
        .filter({ hasText: title });
    // Sections, not cards, and the section headers carry the titles.
    await expect(sections.locator('planner-task')).toHaveCount(0);
    await expect(sections.nth(1).locator('collapsible')).toContainText('High');
    await expect(row(0, first)).toHaveCount(1);

    // Keyboard: past the last row of "Normal" into "High", focus follows.
    const normalRows = sections.nth(0).locator('task');
    await normalRows.last().focus();
    const lastTitle = (await normalRows.last().locator('task-title').innerText()).trim();
    await page.keyboard.press('Control+Shift+ArrowDown');
    await expect(row(1, lastTitle)).toHaveCount(1);
    await expect(row(0, lastTitle)).toHaveCount(0);
    await expect(row(1, lastTitle)).toBeFocused();

    // Drag: another row into "High" gets the high priority too.
    const other = lastTitle === second ? first : second;
    await dragRow(page, row(0, other), sections.nth(1).locator('task-list').first());
    await expect(row(1, other)).toHaveCount(1);
    await expect(row(0, other)).toHaveCount(0);

    await waitForStatePersistence(page);
    await page.reload();
    await expect(row(1, first)).toHaveCount(1);
    await expect(row(1, second)).toHaveCount(1);
  });

  test('focus follows a row into a section that already shows it, also when collapsed', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await page.goto('/#/project/INBOX_PROJECT/tasks');
    await workViewPage.waitForTaskList();
    await workViewPage.addTask(`${testPrefix}-Task`);

    // "All" has no rules, so a row moved into "High" stays in "All" too.
    await createView(page, `${testPrefix}-Overlap`, ['All', 'High'], async (form) => {
      await pickOption(page, form, 'Priority', 1, 'High');
    });
    const sections = page.locator('boards board-panel');
    const allRows = sections.nth(0).locator('task');
    const row = (i: number, title: string): Locator =>
      sections.nth(i).locator('task').filter({ hasText: title });
    await expect(allRows.first()).toBeVisible();
    const title = (await allRows.last().locator('task-title').innerText()).trim();

    await allRows.last().focus();
    await page.keyboard.press('Control+Shift+ArrowDown');
    await expect(row(1, title)).toHaveCount(1);
    await expect(row(0, title)).toHaveCount(1);
    await expect(row(1, title)).toBeFocused();

    // Into the collapsed section again: it opens and its row gets focus.
    await sections.nth(1).locator('collapsible .collapsible-header').first().click();
    await expect(sections.nth(1).locator('task')).toHaveCount(0);
    await row(0, title).focus();
    await page.keyboard.press('Control+Shift+ArrowDown');
    await expect(row(1, title)).toBeFocused();
    await expect(row(0, title)).toHaveCount(1);
  });

  test('a collapsed section renders no rows', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask(`${testPrefix}-Something`);
    await createView(page, `${testPrefix}-Two`, ['One', 'Two']);
    const section = page.locator('boards board-panel').first();
    await expect(section.locator('task').first()).toBeVisible();

    await section.locator('collapsible .collapsible-header').click();
    await expect(section.locator('task')).toHaveCount(0);
    await expect(section.locator('task-list')).toHaveCount(0);
  });

  test('the add-task bar adds into the open view, not the list open before', async ({
    page,
    workViewPage,
    projectPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const projectName = `${testPrefix}-Elsewhere`;
    await projectPage.createProject(projectName);
    await projectPage.navigateToProjectByName(projectName);
    await workViewPage.waitForTaskList();

    // A view of high-priority tasks across all projects.
    await createView(page, `${testPrefix}-Important`, ['Important'], async (form) => {
      await pickOption(page, form, 'Priority', 0, 'High');
    });
    const viewTitle = `${testPrefix}-From the view`;
    await workViewPage.addTask(`${viewTitle}`, false, null);
    const rows = page.locator('boards board-panel task');
    await expect(rows.filter({ hasText: viewTitle })).toHaveCount(1);

    // It went to the Inbox (no project rule), not the project open before.
    await page.goto('/#/project/INBOX_PROJECT/tasks');
    await workViewPage.waitForTaskList();
    await expect(page.locator('task').filter({ hasText: viewTitle })).toHaveCount(1);

    // Off the view, the bar adds as before.
    const listTitle = `${testPrefix}-Plain`;
    await workViewPage.addTask(listTitle);
    await expect(page.locator('task').filter({ hasText: listTitle })).toHaveCount(1);
  });

  test('a drag reorders a one-panel view and the order persists', async ({
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
    await createView(page, `${testPrefix}-Mine`, ['Mine']);

    const rows = page.locator('boards board-panel task:not(.cdk-drag-placeholder)');
    const titles = async (): Promise<string[]> =>
      (await rows.locator('task-title').allInnerTexts())
        .map((title) => title.trim())
        .filter((title) => title.startsWith(testPrefix));
    await expect.poll(titles).toHaveLength(2);
    const [top, bottom] = await titles();

    await dragRow(
      page,
      rows.filter({ hasText: bottom }).first(),
      rows.filter({ hasText: top }).first().locator('task-title'),
    );
    await expect.poll(titles).toEqual([bottom, top]);

    await waitForStatePersistence(page);
    await page.reload();
    await expect.poll(titles).toEqual([bottom, top]);
  });
});
