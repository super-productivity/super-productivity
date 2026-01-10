import { Locator } from '@playwright/test';
import { test, expect } from '../../fixtures/test.fixture';
import { WorkViewPage } from '../../pages/work-view.page';

test.describe('Drag Task to change project and labels', () => {
  let workViewPage: WorkViewPage;

  test.beforeEach(async ({ page, testPrefix }) => {
    workViewPage = new WorkViewPage(page, testPrefix);

    // Wait for app to be ready
    await workViewPage.waitForTaskList();
  });

  test('should be able to move task to project by dragging to project link in magic-side-nav', async ({
    page,
    testPrefix,
  }) => {
    // Create task
    await workViewPage.addTask('TestTask');
    await page.waitForSelector('task', { state: 'visible' });

    const project1NavItem = page
      .getByRole('menuitem')
      .filter({ hasText: `${testPrefix}-TestProject 1` });
    const project2NavItem = page
      .getByRole('menuitem')
      .filter({ hasText: `${testPrefix}-TestProject 2` });

    // Helper to create projects reliably by clicking the dialog's Submit button
    const createProject = async (
      name: string,
      expectedNavItem: Locator,
    ): Promise<void> => {
      const dialog = page.locator('dialog-create-project');
      const projectNameInput = dialog.locator('input').first();
      const saveBtn = dialog.locator('button[type="submit"]');

      await page.keyboard.press('Shift+P');
      await dialog.waitFor({ state: 'visible', timeout: 10000 });
      await projectNameInput.waitFor({ state: 'visible', timeout: 10000 });
      await projectNameInput.fill(name);
      await expect(saveBtn).toBeEnabled({ timeout: 5000 });
      await saveBtn.click();
      await dialog.waitFor({ state: 'hidden', timeout: 10000 });
      await expectedNavItem.waitFor({ state: 'visible', timeout: 10000 });
    };

    await createProject(`${testPrefix}-TestProject 1`, project1NavItem);
    await createProject(`${testPrefix}-TestProject 2`, project2NavItem);

    // find drag handle of task
    const firstTask = page.locator('task').first();
    const dragHandle = firstTask.locator('.drag-handle');
    const tagList = firstTask.locator('tag-list');

    // Drag and drop to first project - wait for tag to appear
    await dragHandle.dragTo(project1NavItem);
    await expect(tagList).toContainText(`${testPrefix}-TestProject 1`, {
      timeout: 5000,
    });

    // Drag and drop to second project - wait for tag change
    await dragHandle.dragTo(project2NavItem);
    await expect(tagList).not.toContainText(`${testPrefix}-TestProject 1`, {
      timeout: 5000,
    });
    await expect(tagList).toContainText(`${testPrefix}-TestProject 2`);

    // Drag and drop back to inbox - wait for tag change
    const inboxNavItem = page.getByRole('menuitem').filter({ hasText: 'Inbox' });
    await dragHandle.dragTo(inboxNavItem);
    await expect(tagList).not.toContainText(`${testPrefix}-TestProject 2`, {
      timeout: 5000,
    });
    await expect(tagList).toContainText('Inbox');
  });

  test('should be able to add and remove tags by dragging task to the tag link in magic-side-nav', async ({
    page,
    testPrefix,
  }) => {
    // Create task
    await workViewPage.addTask('TestTask');
    await page.waitForSelector('task', { state: 'visible' });

    // create two tags
    const dialogSelector = 'dialog-create-tag';
    const tagNameInput = page.locator(`${dialogSelector} input[type="text"]`).first();
    const tagDialog = page.locator(dialogSelector);
    const tagMenu = page
      .locator('nav-item')
      .filter({ hasText: 'Tags' })
      .locator('button');
    const createTagBtn = page
      .locator('li.nav-item')
      .filter({ hasText: 'Tags' })
      .locator('button')
      .filter({ hasText: 'add' });

    const tag1NavItem = page
      .getByRole('menuitem')
      .filter({ hasText: `${testPrefix}-Tag1` });
    const tag2NavItem = page
      .getByRole('menuitem')
      .filter({ hasText: `${testPrefix}-Tag2` });

    const saveTag = async (name: string, navItem: Locator): Promise<void> => {
      await tagMenu.hover();
      await createTagBtn.waitFor({ state: 'visible', timeout: 3000 });
      await createTagBtn.click();
      await tagDialog.waitFor({ state: 'visible', timeout: 10000 });
      await tagNameInput.waitFor({ state: 'visible', timeout: 5000 });
      await tagNameInput.fill(name);
      const saveBtn = tagDialog.getByRole('button', { name: 'Save' });
      await saveBtn.waitFor({ state: 'visible', timeout: 5000 });
      await expect(saveBtn).toBeEnabled({ timeout: 5000 });
      await saveBtn.click();
      await tagDialog.waitFor({ state: 'hidden', timeout: 10000 });
      await navItem.waitFor({ state: 'visible', timeout: 10000 });
    };

    await saveTag(`${testPrefix}-Tag1`, tag1NavItem);
    await saveTag(`${testPrefix}-Tag2`, tag2NavItem);

    // find drag handle of task
    const firstTask = page.locator('task').first();
    const dragHandle = firstTask.locator('.drag-handle');
    const tagList = firstTask.locator('tag-list');

    // Drag and drop to first tag - wait for tag to appear
    await dragHandle.dragTo(tag1NavItem);
    await expect(tagList).toContainText(`${testPrefix}-Tag1`, { timeout: 5000 });

    // Drag and drop to second tag - wait for tag to appear
    await dragHandle.dragTo(tag2NavItem);
    await expect(tagList).toContainText(`${testPrefix}-Tag1`);
    await expect(tagList).toContainText(`${testPrefix}-Tag2`, { timeout: 5000 });

    // Drag and drop again to first tag to remove it - wait for tag to disappear
    await dragHandle.dragTo(tag1NavItem);
    await expect(tagList).not.toContainText(`${testPrefix}-Tag1`, { timeout: 5000 });
    await expect(tagList).toContainText(`${testPrefix}-Tag2`);
  });
});
