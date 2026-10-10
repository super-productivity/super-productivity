import { type Locator, type Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';

const sectionTree = (page: Page, label: string): Locator =>
  page.locator('nav-list-tree').filter({
    has: page.locator('.g-multi-btn-wrapper .nav-label', { hasText: label }),
  });

const moreBtn = (tree: Locator): Locator =>
  tree.locator(
    '.additional-btns button[mat-icon-button]:has(mat-icon:text-is("more_vert"))',
  );

const openSectionMenu = async (tree: Locator): Promise<void> => {
  await tree.locator('.g-multi-btn-wrapper nav-item button').first().hover();
  await moreBtn(tree).click();
};

// tagPage.createTag() can leave Tags collapsed: it reads the header's
// aria-expanded, which the header's (unused) menu trigger reports as false.
// The children container only renders while the section is expanded.
const expandSection = async (tree: Locator): Promise<void> => {
  const children = tree.locator(':scope > .nav-children');
  if ((await children.count()) === 0) {
    await tree.locator('.g-multi-btn-wrapper nav-item button').first().click();
  }
  await expect(children).toHaveCount(1);
};

const clickSnackUndo = async (page: Page): Promise<void> => {
  await page.locator('snack-custom button.action').click();
};

const createFolderFromMenu = async (
  page: Page,
  tree: Locator,
  menuItemName: string,
  folderName: string,
): Promise<void> => {
  await expandSection(tree);
  await openSectionMenu(tree);
  await page.getByRole('menuitem', { name: menuItemName }).click();
  // Focus moving into the dialog also means its form is ready for input.
  const input = page.locator('mat-dialog-container input');
  await expect(input).toBeFocused();
  await input.fill(folderName);
  await expect(input).toHaveValue(folderName);
  await input.press('Enter');
  await expect(
    tree.locator('.folder-item .nav-label', { hasText: folderName }),
  ).toBeVisible();
};

test.describe('Sidebar header menu', () => {
  test('both section headers show only the add and more buttons', async ({
    page,
    workViewPage,
    tagPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    // The Tags section only renders once a tag exists.
    await tagPage.createTag(`${testPrefix}-Tag`);

    for (const label of ['Projects', 'Tags']) {
      const icons = sectionTree(page, label).locator(
        '.g-multi-btn-wrapper .additional-btns mat-icon',
      );
      await expect(icons).toHaveText(['add', 'more_vert']);
    }
  });

  test('creates project and tag folders from the section menus', async ({
    page,
    workViewPage,
    tagPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await tagPage.createTag(`${testPrefix}-Tag`);

    await createFolderFromMenu(
      page,
      sectionTree(page, 'Projects'),
      'Create project folder',
      `${testPrefix}-Project folder`,
    );
    await createFolderFromMenu(
      page,
      sectionTree(page, 'Tags'),
      'Create tag folder',
      `${testPrefix}-Tag folder`,
    );
  });

  test('sorts tags alphabetically and undo restores the previous order', async ({
    page,
    workViewPage,
    tagPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const created = ['Zulu', 'Alpha', 'Mike'].map((name) => `${testPrefix}-${name}`);
    for (const name of created) {
      await tagPage.createTag(name);
    }

    const tree = sectionTree(page, 'Tags');
    const labels = tree.locator('.nav-children .nav-label').filter({
      hasText: testPrefix,
    });
    await expect(labels).toHaveText(created);

    await openSectionMenu(tree);
    await page.getByRole('menuitem', { name: 'Sort tags A–Z' }).click();
    await expect(labels).toHaveText([created[1], created[2], created[0]]);

    await clickSnackUndo(page);
    await expect(labels).toHaveText(created);
  });

  test('reaches and invokes the tag sort with the keyboard alone', async ({
    page,
    workViewPage,
    tagPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const created = ['Zulu', 'Alpha', 'Mike'].map((name) => `${testPrefix}-${name}`);
    for (const name of created) {
      await tagPage.createTag(name);
    }

    const tree = sectionTree(page, 'Tags');
    const labels = tree.locator('.nav-children .nav-label').filter({
      hasText: testPrefix,
    });
    const header = tree.locator('.g-multi-btn-wrapper nav-item button').first();
    const headerBtns = tree.locator('.g-multi-btn-wrapper .additional-btns');

    // Keep the pointer off the sidebar so hover can't reveal the header buttons.
    const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
    await page.mouse.move(viewport.width - 1, viewport.height - 1);

    // Arrive on the header via Tab, as a keyboard user would.
    await header.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(header).toBeFocused();

    // add tag → more
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(moreBtn(tree)).toBeFocused();
    await expect(headerBtns).toHaveCSS('opacity', '1');

    // Opening the menu moves focus to its first entry, "Create tag folder";
    // the more button stays visible while the menu is open.
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Create tag folder' })).toBeFocused();
    await expect(headerBtns).toHaveCSS('opacity', '1');

    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Sort tags A–Z' })).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(labels).toHaveText([created[1], created[2], created[0]]);
  });

  test('sorts projects alphabetically and undo restores the previous order', async ({
    page,
    workViewPage,
    projectPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const created = ['Zulu', 'Alpha', 'Mike'].map((name) => `${testPrefix}-${name}`);
    for (const name of created) {
      await projectPage.createProject(name);
    }

    const tree = sectionTree(page, 'Projects');
    const labels = tree.locator('.nav-children .nav-label').filter({
      hasText: testPrefix,
    });
    await expect(labels).toHaveText(created);

    await openSectionMenu(tree);
    // The Projects menu keeps the project visibility toggles below its actions.
    for (const name of created) {
      await expect(
        page.getByRole('menuitemcheckbox').filter({ hasText: name }),
      ).toHaveAttribute('aria-checked', 'true');
    }
    await page.getByRole('menuitem', { name: 'Sort projects A–Z' }).click();
    await expect(labels).toHaveText([created[1], created[2], created[0]]);

    await clickSnackUndo(page);
    await expect(labels).toHaveText(created);
  });
});
