import { type Locator, type Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';

const sectionTree = (page: Page, label: string): Locator =>
  page.locator('nav-list-tree').filter({
    has: page.locator('.g-multi-btn-wrapper .nav-label', { hasText: label }),
  });

const hoverHeaderButton = async (tree: Locator, icon: string): Promise<Locator> => {
  await tree.locator('.g-multi-btn-wrapper nav-item button').first().hover();
  return tree.locator(
    `.additional-btns button[mat-icon-button]:has(mat-icon:text-is("${icon}"))`,
  );
};

const clickSnackUndo = async (page: Page): Promise<void> => {
  await page.locator('snack-custom button.action').click();
};

test.describe('Sidebar sort A–Z', () => {
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

    await (await hoverHeaderButton(tree, 'sort_by_alpha')).click();
    await expect(labels).toHaveText([created[1], created[2], created[0]]);

    await clickSnackUndo(page);
    await expect(labels).toHaveText(created);
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

    // The Projects header has no room for another button, so the action sits
    // in the project visibility menu.
    await (await hoverHeaderButton(tree, 'visibility')).click();
    await page.getByRole('menuitem', { name: 'Sort projects A–Z' }).click();
    await expect(labels).toHaveText([created[1], created[2], created[0]]);

    await clickSnackUndo(page);
    await expect(labels).toHaveText(created);
  });
});
