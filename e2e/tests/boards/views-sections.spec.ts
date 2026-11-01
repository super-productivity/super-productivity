import { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { createView } from '../../utils/view-helpers';
import { waitForStatePersistence } from '../../utils/waits';

/**
 * A one-column view is one task list; its stacked panels are sections of it.
 * Rows move between sections by keyboard and by drag (through the target
 * section's rules), and the regular add-task bar adds into the open view.
 */

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

    await createView(page, {
      title: `${testPrefix}-Priorities`,
      sections: [
        { title: 'Normal', rules: [{ rule: 'Priority', value: 'Not set' }] },
        { title: 'High', rules: [{ rule: 'Priority', value: 'High' }] },
      ],
    });

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
    await createView(page, {
      title: `${testPrefix}-Overlap`,
      sections: [
        { title: 'All' },
        { title: 'High', rules: [{ rule: 'Priority', value: 'High' }] },
      ],
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
    await createView(page, {
      title: `${testPrefix}-Two`,
      sections: [{ title: 'One' }, { title: 'Two' }],
    });
    const section = page.locator('boards board-panel').first();
    await expect(section.locator('task').first()).toBeVisible();

    await section.locator('collapsible .collapsible-header').click();
    await expect(section.locator('task')).toHaveCount(0);
    await expect(section.locator('task-list')).toHaveCount(0);
  });

  test("a section's + adds a task into that section with its rules", async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await page.goto('/#/project/INBOX_PROJECT/tasks');
    await workViewPage.waitForTaskList();
    await workViewPage.addTask(`${testPrefix}-Existing`);
    await createView(page, {
      title: `${testPrefix}-Add here`,
      sections: [
        { title: 'Normal', rules: [{ rule: 'Priority', value: 'Not set' }] },
        { title: 'High', rules: [{ rule: 'Priority', value: 'High' }] },
      ],
    });
    const sections = page.locator('boards board-panel');
    // No add row in the sections, a "+" in each header instead.
    await expect(sections.locator('add-task-inline')).toHaveCount(0);
    const add = sections
      .nth(1)
      .getByRole('button', { name: 'Add task to High', exact: true });

    // Also from a collapsed section: it opens with the bar at its top.
    await sections.nth(1).locator('collapsible .collapsible-header').first().click();
    await expect(sections.nth(1).locator('task-list')).toHaveCount(0);
    await add.click();
    const input = sections.nth(1).locator('add-task-bar .main-input');
    await expect(input).toBeFocused();
    const title = `${testPrefix}-Added`;
    await input.fill(title);
    await page.keyboard.press('Enter');
    await expect(sections.nth(1).locator('task').filter({ hasText: title })).toHaveCount(
      1,
    );
    await expect(sections.nth(0).locator('task').filter({ hasText: title })).toHaveCount(
      0,
    );

    // Escape closes the bar and focus goes back to the "+".
    await input.press('Escape');
    await expect(sections.nth(1).locator('add-task-bar')).toHaveCount(0);
    await expect(add).toBeFocused();

    // One add bar at a time: another section's "+" closes the open one.
    await sections
      .nth(0)
      .getByRole('button', { name: 'Add task to Normal', exact: true })
      .click();
    await expect(sections.nth(0).locator('add-task-bar .main-input')).toBeFocused();
    await add.click();
    await expect(sections.nth(1).locator('add-task-bar .main-input')).toBeFocused();
    await expect(sections.nth(0).locator('add-task-bar')).toHaveCount(0);
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
    await createView(page, {
      title: `${testPrefix}-Important`,
      sections: [{ rules: [{ rule: 'Priority', value: 'High' }] }],
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

  test('an empty view explains itself and adds a task into the view', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await createView(page, {
      title: `${testPrefix}-Urgent`,
      sections: [{ rules: [{ rule: 'Priority', value: 'High' }] }],
    });
    const empty = page.locator('boards board-panel .view-empty');
    await expect(empty).toContainText('No tasks match this view');
    await expect(empty.getByRole('button', { name: 'Edit view' })).toBeVisible();

    await empty.getByRole('button', { name: 'Add task' }).click();
    const title = `${testPrefix}-First`;
    await page.locator('add-task-bar.global .main-input').fill(title);
    await page.keyboard.press('Enter');
    await expect(
      page.locator('boards board-panel task').filter({ hasText: title }),
    ).toHaveCount(1);
    await expect(empty).toHaveCount(0);
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
    await createView(page, { title: `${testPrefix}-Mine` });

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
